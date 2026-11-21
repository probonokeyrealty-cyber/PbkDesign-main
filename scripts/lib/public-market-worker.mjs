import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { buildPublicMarketBrief } from './public-market-program.mjs';

const INPUT = '/home/user/pbk-public-market-input.json';
const PROGRAM = '/home/user/pbk-public-market-worker.mjs';
const SECRET =
  /(?:\b(?:ak_|sk-|e2b_|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
export function normalizeMarket(value) {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    SECRET.test(value) ||
    !/^[\p{L}][\p{L} .,'’()-]+$/u.test(value.trim())
  )
    throw Error('invalid_market');
  return value.trim();
}
export const evidenceDigest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function normalizePublicEvidence(value) {
  if (
    value?.ok !== true ||
    value?.live !== true ||
    typeof value.answer !== 'string' ||
    !value.answer.trim() ||
    value.answer.length > 8000 ||
    SECRET.test(value.answer)
  )
    throw Error('public_evidence_unavailable');
  const citations = [
    ...new Set(
      (Array.isArray(value.citations) ? value.citations : []).filter((link) => {
        try {
          if (typeof link !== 'string' || link.length > 1000 || SECRET.test(link)) return false;
          const u = new URL(link);
          const decodedPath = decodeURIComponent(u.pathname);
          return (
            u.protocol === 'https:' &&
            !u.username &&
            !u.password &&
            !u.port &&
            !u.search &&
            !u.hash &&
            !SECRET.test(decodedPath) &&
            !/(?:token|api[_-]?key|secret|credential|access[_-]?key)[/=]/i.test(decodedPath) &&
            u.hostname.includes('.') &&
            !isIP(u.hostname.replace(/[\[\]]/g, '')) &&
            !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname)
          );
        } catch {
          return false;
        }
      })
    ),
  ].slice(0, 5);
  if (!citations.length) throw Error('public_sources_missing');
  return { answer: value.answer.trim(), citations };
}

async function bounded(promise, ms, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(code)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const sdkCreate = async (template, options) =>
  (await import('e2b')).Sandbox.create(template, options);

export function createPublicMarketWorker({
  env = process.env,
  search,
  createSandbox = sdkCreate,
  now = Date.now,
  deadlines = { search: 20000, create: 20000, command: 15000, cleanup: 10000 },
} = {}) {
  const enabled = env.PBK_E2B_MARKET_WORKER_ENABLED === 'true';
  const key = String(env.PBK_E2B_MARKET_WORKER_API_KEY ?? '').trim();
  let busy = false,
    lastSuccess = null,
    phase = !enabled ? 'disabled' : !key ? 'configuration_missing' : 'unverified',
    blockedUntil = 0;
  function status() {
    return {
      kind: 'public_market_worker',
      optional: true,
      enabled,
      configured: enabled && !!key,
      ready: phase === 'verified' && lastSuccess !== null && now() - lastSuccess < 120000,
      state: phase,
      lastSuccessAt: lastSuccess === null ? null : new Date(lastSuccess).toISOString(),
      note: 'Approval-backed public evidence worker. Ask Rex to prepare a cloud market brief; a completed job with confirmed cleanup is required.',
    };
  }
  async function run(request = {}) {
    if (!enabled || !key)
      return { ok: false, result: !enabled ? 'disabled' : 'configuration_missing' };
    if (busy || now() < blockedUntil) return { ok: false, result: 'public_market_worker_busy' };
    let market;
    try {
      if (
        !request ||
        Array.isArray(request) ||
        Object.keys(request).some((k) => !['jobId', 'market'].includes(k)) ||
        !/^market-[a-f0-9-]{36}$/.test(request.jobId ?? '')
      )
        throw Error();
      market = normalizeMarket(request.market);
    } catch {
      return { ok: false, result: 'public_market_request_denied' };
    }
    busy = true;
    phase = 'running';
    let sandbox = null,
      brief = null,
      result = 'public_market_worker_unavailable',
      cleanupConfirmed = false;
    try {
      const evidence = normalizePublicEvidence(
        await bounded(
          Promise.resolve().then(() =>
            search(
              `Public residential real estate market conditions for ${market}. Use public sources for inventory, sold-price trends and days on market. State source dates and uncertainty; do not use personal or CRM information.`
            )
          ),
          deadlines.search,
          'search_timeout'
        )
      );
      const payload = {
        jobId: request.jobId,
        market,
        ...evidence,
        capturedAt: new Date(now()).toISOString(),
      };
      const input = JSON.stringify(payload);
      if (Buffer.byteLength(input) > 16000) throw Error('input_limit');
      const source = await readFile(
        new URL('./public-market-program.mjs', import.meta.url),
        'utf8'
      );
      const creating = Promise.resolve().then(() =>
        createSandbox('base', {
          apiKey: key,
          timeoutMs: 60000,
          requestTimeoutMs: 15000,
          allowInternetAccess: false,
          network: { allowPublicTraffic: false },
          lifecycle: { onTimeout: 'kill' },
          idempotencyKey: request.jobId,
          metadata: { pbkWorkload: 'public-market-brief', jobId: request.jobId },
          envs: {},
        })
      );
      try {
        sandbox = await bounded(creating, deadlines.create, 'creation_unknown');
      } catch {
        blockedUntil = now() + 80000;
        result = 'public_market_creation_unknown';
        // A late create response still owns a sandbox and must attempt cleanup.
        void creating
          .then((late) =>
            bounded(
              Promise.resolve().then(() => late.kill({ requestTimeoutMs: 10000 })),
              deadlines.cleanup,
              'cleanup_timeout'
            )
          )
          .catch(() => {});
        throw Error('creation_unknown');
      }
      await bounded(
        Promise.resolve().then(() => sandbox.files.write(PROGRAM, source)),
        deadlines.command,
        'write_timeout'
      );
      await bounded(
        Promise.resolve().then(() => sandbox.files.write(INPUT, input)),
        deadlines.command,
        'write_timeout'
      );
      const execution = await bounded(
        Promise.resolve().then(() =>
          sandbox.commands.run(`node ${PROGRAM}`, { timeoutMs: 10000, requestTimeoutMs: 15000 })
        ),
        deadlines.command,
        'command_timeout'
      );
      if (
        execution.exitCode !== 0 ||
        typeof execution.stdout !== 'string' ||
        Buffer.byteLength(execution.stdout) > 16000
      )
        throw Error('invalid_output');
      const output = JSON.parse(execution.stdout);
      if (JSON.stringify(output) !== JSON.stringify(buildPublicMarketBrief(payload)))
        throw Error('output_not_bound');
      brief = {
        market,
        summary: output.summary,
        citations: payload.citations,
        capturedAt: payload.capturedAt,
        sourceCount: output.sourceCount,
        limitations: output.limitations,
        evidenceDigest: output.evidenceDigest,
      };
      result = 'public_market_brief_ready';
    } catch {
      phase = 'unavailable';
    } finally {
      // The public SDK returns false only for HTTP404 (already absent).
      if (sandbox)
        try {
          const killed = await bounded(
            Promise.resolve().then(() => sandbox.kill({ requestTimeoutMs: 10000 })),
            deadlines.cleanup,
            'cleanup_timeout'
          );
          cleanupConfirmed = typeof killed === 'boolean';
        } catch {}
      if (sandbox && !cleanupConfirmed) {
        phase = 'cleanup_unconfirmed';
        result = 'public_market_cleanup_unconfirmed';
        blockedUntil = now() + 80000;
      }
      busy = false;
    }
    const ok = !!brief && cleanupConfirmed;
    if (ok) {
      phase = 'verified';
      lastSuccess = now();
    }
    return { ok, result, cleanupConfirmed, ...(ok ? { brief } : {}), businessWrites: 0 };
  }
  return { run, status };
}
