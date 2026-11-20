import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeMarket } from './public-market-worker.mjs';

export function recoverPublicMarketJob(job) {
  if (job?.provider !== 'e2b' || job.status !== 'running') return job;
  return {
    ...job,
    status: 'interrupted',
    consumed: true,
    cleanupConfirmed: false,
    resultSummary:
      'The bridge restarted during this approved job. Completion and cleanup were not confirmed. No automatic retry will run; allow the five-minute safety interval before preparing a fresh approval.',
  };
}

export function createPublicMarketController({
  signingKey = '',
  approvalCapability,
  worker,
  getJob,
  saveJob,
  claimJob = async () => false,
  onComplete = async () => {},
  now = Date.now,
} = {}) {
  const consumed = new Set();
  let activeJob = null;
  const signature = (task) =>
    createHmac('sha256', signingKey)
      .update(
        JSON.stringify([
          task.id,
          task.provider,
          task.action,
          task.summary,
          task.costEstimate,
          task.requestedBy,
          task.risk,
          task.payload?.jobId,
          task.payload?.market,
        ])
      )
      .digest('hex');
  function valid(task) {
    try {
      const expected = Buffer.from(signature(task));
      const actual = Buffer.from(String(task.payload?.signature ?? ''));
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }
  async function prepare(request = {}) {
    let market;
    try {
      if (
        !signingKey ||
        request.agentId !== 'rex' ||
        Object.keys(request).some((k) => !['agentId', 'market'].includes(k))
      )
        throw Error();
      market = normalizeMarket(request.market);
    } catch {
      return { ok: false, result: 'public_market_request_denied' };
    }
    const id = randomUUID(),
      at = new Date(now()).toISOString();
    const task = {
      id: `admin-e2b-market-${id}`,
      provider: 'e2b',
      action: 'public_market_brief',
      status: 'pending',
      requiresApproval: true,
      dryRun: true,
      risk: 'high',
      requestedBy: 'Rex',
      createdAt: at,
      updatedAt: at,
      summary: `Prepare a public market brief for ${market} in one temporary network-disabled worker (maximum 60 seconds).`,
      costEstimate:
        'One sandbox up to 60 seconds plus one public search. A five-minute safety interval applies between starts.',
      payload: { jobId: `market-${id}`, market },
    };
    task.payload.signature = signature(task);
    const job = {
      id: task.payload.jobId,
      approvalTaskId: task.id,
      provider: 'e2b',
      source: 'public-market-brief',
      market,
      targetLabel: `Public market brief: ${market}`,
      status: 'awaiting-approval',
      consumed: false,
      createdAt: at,
      updatedAt: at,
      resultSummary: 'Waiting for operator approval. No public search or sandbox has run.',
      sources: [],
    };
    try {
      await saveJob(job);
    } catch {
      return { ok: false, result: 'public_market_persistence_unavailable' };
    }
    return { ok: true, result: 'queued_for_approval', task, job };
  }
  async function start(task, capability) {
    const job = getJob(task?.payload?.jobId);
    if (
      !signingKey ||
      capability !== approvalCapability ||
      typeof capability !== 'symbol' ||
      task?.provider !== 'e2b' ||
      task.action !== 'public_market_brief' ||
      task.status !== 'approved' ||
      task.requiresApproval !== true ||
      Object.keys(task.payload ?? {})
        .sort()
        .join(',') !== 'jobId,market,signature' ||
      !valid(task) ||
      !job ||
      job.approvalTaskId !== task.id ||
      job.market !== task.payload.market ||
      job.consumed ||
      consumed.has(job.id)
    )
      return { ok: false, result: 'public_market_approval_denied' };
    if (activeJob) return { ok: false, result: 'public_market_worker_busy' };
    const status = worker.status();
    if (!status.enabled || ['disabled', 'configuration_missing'].includes(status.state))
      return { ok: false, result: status.state || 'disabled' };
    consumed.add(job.id);
    activeJob = job.id;
    try {
      if (!(await claimJob(job.id))) {
        activeJob = null;
        return { ok: false, result: 'public_market_claim_denied' };
      }
    } catch {
      activeJob = null;
      return { ok: false, result: 'public_market_persistence_unavailable' };
    }
    const started = {
      ...job,
      consumed: true,
      status: 'running',
      startedAt: new Date(now()).toISOString(),
      resultSummary: 'Approved public market brief is running. No lead records are included.',
    };
    try {
      await saveJob(started);
    } catch {
      activeJob = null;
      return { ok: false, result: 'public_market_persistence_unavailable' };
    }
    const completion = new Promise((resolve) => setImmediate(resolve))
      .then(async () => {
        let result;
        try {
          result = await worker.run({ jobId: job.id, market: job.market });
        } catch {
          result = { ok: false, result: 'public_market_worker_unavailable' };
        }
        const finished = {
          ...started,
          status: result.ok ? 'complete' : 'failed',
          completedAt: new Date(now()).toISOString(),
          cleanupConfirmed: result.cleanupConfirmed === true,
          resultSummary: result.ok
            ? result.brief.summary
            : `Public market worker did not complete: ${String(result.result).slice(0, 100)}.`,
          sources: result.ok ? result.brief.citations : [],
          resultData: result.ok
            ? result.brief
            : { result: result.result, cleanupConfirmed: result.cleanupConfirmed === true },
        };
        try {
          await saveJob(finished);
        } catch {
          result = { ok: false, result: 'public_market_result_persistence_failed' };
        }
        await onComplete(task.id, job.id, result);
        return result;
      })
      .finally(() => {
        activeJob = null;
      });
    // The request returns immediately; failed persistence/notifications must never be unhandled.
    void completion.catch(() => {});
    return { ok: true, result: 'queued', jobId: job.id, completion };
  }
  return { prepare, start };
}
