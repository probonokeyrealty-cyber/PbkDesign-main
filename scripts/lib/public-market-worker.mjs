import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { buildPublicMarketBrief } from '../fixtures/public-market-program.mjs';

const INPUT = '/home/user/pbk-public-market-input.json';
const PROGRAM = '/home/user/pbk-public-market-worker.mjs';
const STAGING_SERVICE = 'srv-dbvk7tv40ujc73e0d8gg';
const MAX_FAST_PATH_PERCENT = 10;
export const MOCK_EXA_MARKET = 'Tampa, FL';
export const publicMarketQuery = (market) =>
  `Public residential real estate market conditions for ${market}. Use public sources for inventory, sold-price trends and days on market. State source dates and uncertainty; do not use personal or CRM information.`;
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

export function normalizePublicEvidence(value, { allowSimulated = false } = {}) {
  if (
    value?.ok !== true ||
    !(allowSimulated ? value?.simulated === true && value.live === false : value?.live === true && value.simulated !== true) ||
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
const loadE2b = () => import('e2b');

export function isPublicMarketStaging(env = process.env) {
  return env.RENDER === 'true' && env.RENDER_SERVICE_ID === STAGING_SERVICE;
}

export const mockExaCacheRequested = (env) => env.PBK_EXA_MOCK_CACHE_PROBE === 'true';
export const mockExaCacheEnabled = (env) => mockExaCacheRequested(env) && fastPathPercent(env) === 10;

function fastPathPercent(env) {
  if (!isPublicMarketStaging(env)) return 0;
  const raw = env.PBK_E2B_MARKET_FAST_PATH_PERCENT;
  if (typeof raw !== 'string' || !/^(?:0|[1-9]\d*)$/.test(raw)) return 0;
  const percent = Number(raw);
  return percent <= MAX_FAST_PATH_PERCENT ? percent : 0;
}

function selectsFastPath(jobId, percent) {
  const bucket = createHash('sha256')
    .update(`pbk-market-upload-v1:${jobId}`)
    .digest()
    .readUInt32BE();
  return bucket / 2 ** 32 < percent / 100;
}

export function createPublicMarketWorker({
  env = process.env,
  search,
  createSandbox,
  loadSandboxSdk = loadE2b,
  now = Date.now,
  deadlines = { search: 20000, create: 20000, command: 15000, cleanup: 10000 },
} = {}) {
  const enabled = env.PBK_E2B_MARKET_WORKER_ENABLED === 'true';
  const key = String(env.PBK_E2B_MARKET_WORKER_API_KEY ?? '').trim();
  const percent = enabled && key ? fastPathPercent(env) : 0;
  const mockExaCache = mockExaCacheEnabled(env);
  const armFor = (jobId) => percent > 0 && selectsFastPath(jobId, percent) ? 'batched' : 'standard';
  const workerInstanceId = randomUUID();
  let sandboxSdk;
  let sdkLoading;
  let preloadOperation;
  let sdkPreload = { state: 'not_started' };
  let busy = false,
    lastSuccess = null,
    phase = !enabled ? 'disabled' : !key ? 'configuration_missing' : 'unverified',
    blockedUntil = 0;
  function getSandboxSdk() {
    if (sandboxSdk) return Promise.resolve(sandboxSdk);
    sdkLoading ??= Promise.resolve().then(loadSandboxSdk).then(({ Sandbox }) => {
      if (typeof Sandbox?.create !== 'function') throw Error('sandbox_sdk_unavailable');
      sandboxSdk = Sandbox;
      return Sandbox;
    }).finally(() => { sdkLoading = undefined; });
    return sdkLoading;
  }
  function preloadSdk(listenerReadyMs) {
    if (!enabled || !key || createSandbox || !isPublicMarketStaging(env)) return;
    if (preloadOperation) return preloadOperation;
    const began = performance.now();
    sdkPreload = { state: 'loading', workerInstanceId, listenerReadyMs: Math.round(listenerReadyMs),
      startedAtMs: Math.round(began) };
    function finish(state) {
      const ended = performance.now();
      sdkPreload = { ...sdkPreload, state, completedAtMs: Math.round(ended), durationMs: Math.round(ended - began) };
    }
    // Import the module only. Sandbox creation still requires approved work.
    preloadOperation = getSandboxSdk().then(() => finish('ready'), () => finish('failed'));
    return preloadOperation;
  }
  function status() {
    return {
      kind: 'public_market_worker',
      optional: true,
      enabled,
      configured: enabled && !!key,
      fastPathPercent: percent,
      ...(mockExaCache && { mockExaCache: true }),
      sdkPreload: { ...sdkPreload },
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
    const batched = armFor(request.jobId) === 'batched';
    if (mockExaCacheRequested(env) && !(mockExaCache && batched && market === MOCK_EXA_MARKET))
      return { ok: false, result: 'public_market_mock_probe_denied' };
    busy = true;
    phase = 'running';
    const began = performance.now();
    const stagesMs = {};
    let searchTiming;
    let provisioning = null;
    let uploadRequests = 0;
    async function measure(stage, action) {
      const started = performance.now();
      try {
        return await action();
      } finally {
        stagesMs[stage] = Math.round(performance.now() - started);
      }
    }
    let sandbox = null,
      brief = null,
      result = 'public_market_worker_unavailable',
      cleanupConfirmed = false;
    try {
      const searchResult = await measure('search', () =>
        bounded(
          Promise.resolve().then(() =>
            search(publicMarketQuery(market), mockExaCache ? { mockCacheProbe: true } : undefined)
          ),
          deadlines.search,
          'search_timeout'
        )
      );
      const reported = searchResult?.searchTiming;
      const isDuration = (ms) => Number.isSafeInteger(ms) && ms >= 0;
      if (isDuration(reported?.sessionChecksMs) && (reported.exaQueryMs === null || isDuration(reported.exaQueryMs))) {
        searchTiming = { sessionChecksMs: reported.sessionChecksMs, exaQueryMs: reported.exaQueryMs };
      }
      if (mockExaCache) {
        const fetched = Date.parse(reported?.fetchedAt);
        if (!searchTiming || reported.exaQueryMs !== null ||
          !(reported.cacheStatus === 'miss' && isDuration(reported.mockResponseMs) ||
            reported.cacheStatus === 'hit' && reported.mockResponseMs === null) ||
          !Number.isFinite(fetched) || new Date(fetched).toISOString() !== reported.fetchedAt)
          throw Error('public_market_mock_timing_unavailable');
        Object.assign(searchTiming, {
          mode: 'mock', cacheStatus: reported.cacheStatus,
          mockResponseMs: reported.mockResponseMs, fetchedAt: reported.fetchedAt,
        });
      }
      const evidence = normalizePublicEvidence(searchResult, { allowSimulated: mockExaCache });
      const payload = {
        jobId: request.jobId,
        market,
        ...evidence,
        capturedAt: mockExaCache ? searchTiming.fetchedAt : new Date(now()).toISOString(),
      };
      const input = JSON.stringify(payload);
      if (Buffer.byteLength(input) > 16000) throw Error('input_limit');
      const source = await readFile(
        new URL('../fixtures/public-market-program.mjs', import.meta.url),
        'utf8'
      );
      let provisionExpired = false;
      const creating = Promise.resolve().then(async () => {
        const timing = provisioning = {
          sdkState: createSandbox ? 'injected' : sandboxSdk ? 'warm' : 'cold',
          sdkLoadMs: sandboxSdk && !createSandbox ? 0 : null,
          createMs: null,
        };
        if (!createSandbox && !sandboxSdk) {
          const started = performance.now();
          try {
            await getSandboxSdk();
          } finally {
            timing.sdkLoadMs = Math.round(performance.now() - started);
          }
        }
        // If the SDK loaded after the provisioning deadline, don't issue a late create.
        if (provisionExpired) throw Error('creation_unknown');
        const options = {
          apiKey: key,
          timeoutMs: 60000,
          requestTimeoutMs: 15000,
          allowInternetAccess: false,
          network: { allowPublicTraffic: false },
          lifecycle: { onTimeout: 'kill' },
          idempotencyKey: request.jobId,
          metadata: { pbkWorkload: 'public-market-brief', jobId: request.jobId },
          envs: {},
        };
        const started = performance.now();
        try {
          return await (createSandbox ? createSandbox('base', options) : sandboxSdk.create('base', options));
        } finally {
          timing.createMs = Math.round(performance.now() - started);
        }
      });
      try {
        sandbox = await measure('provision', () =>
          bounded(creating, deadlines.create, 'creation_unknown')
        );
      } catch {
        provisionExpired = true;
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
      await measure('upload', async () => {
        const write = (...args) => {
          uploadRequests++;
          return bounded(
            Promise.resolve().then(() => sandbox.files.write(...args)),
            deadlines.command,
            'write_timeout'
          );
        };
        if (batched) {
          await write(
            [
              { path: PROGRAM, data: source },
              { path: INPUT, data: input },
            ],
            { useOctetStream: false, requestTimeoutMs: deadlines.command }
          );
        } else {
          await write(PROGRAM, source);
          await write(INPUT, input);
        }
      });
      const execution = await measure('execute', () =>
        bounded(
          Promise.resolve().then(() =>
            sandbox.commands.run(`node ${PROGRAM}`, { timeoutMs: 10000, requestTimeoutMs: 15000 })
          ),
          deadlines.command,
          'command_timeout'
        )
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
        ...(mockExaCache && { simulated: true }),
      };
      result = 'public_market_brief_ready';
    } catch {
      phase = 'unavailable';
    } finally {
      // The public SDK returns false only for HTTP404 (already absent).
      if (sandbox)
        try {
          const killed = await measure('cleanup', () =>
            bounded(
              Promise.resolve().then(() => sandbox.kill({ requestTimeoutMs: 10000 })),
              deadlines.cleanup,
              'cleanup_timeout'
            )
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
    const executionMetrics = {
      arm: batched ? 'batched' : 'standard',
      workerInstanceId,
      provisioning: provisioning ? { ...provisioning } : null,
      ...(searchTiming ? { searchTiming } : {}),
      uploadRequests,
      stagesMs,
      totalMs: Math.round(performance.now() - began),
    };
    return {
      ok,
      result,
      cleanupConfirmed,
      ...(ok ? { brief } : {}),
      businessWrites: 0,
      executionMetrics,
    };
  }
  return { run, status, armFor, preloadSdk };
}
