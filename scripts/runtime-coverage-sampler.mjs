import { randomUUID } from 'node:crypto';
import { appendRuntimeCoverageCheckpoint, RUNTIME_COVERAGE_POLICY, runtimeCoverageHealthReady } from './runtime-coverage-store.mjs';
import { getRuntimeEvidenceContext } from './runtime-evidence-context.mjs';

export function createRuntimeCoverageSampler({ pool, secret, revision, enabled = false, hosted = false,
  protocol = process.env.PBK_RUNTIME_CENSUS_PROTOCOL ?? 'legacy-v1',
  health, now = Date.now, monotonicNow = () => performance.now(), setTimer = setTimeout,
  clearTimer = clearTimeout, bootId = randomUUID() } = {}) {
  let running = false, stopped = false, inFlight = false, timer, controller, previous = null;
  let lastResult = 'coverage_not_started';
  const contextAllowed = () => !pool?.controlled
    && !['controlled', 'diagnostic'].includes(getRuntimeEvidenceContext().classification);
  const fixedGates = enabled === true && hosted === true && contextAllowed();
  const getHealth = () => { try { return typeof health === 'function' ? health() : null; } catch { return null; } };
  const status = () => ({ running, inFlight, lastResult, segmentRef: previous?.segmentRef ?? null,
    sequence: previous?.sequence ?? null, cutoff: previous?.cutoff ?? null });
  const schedule = () => {
    if (!running || stopped) return;
    timer = setTimer(async () => {
      timer = undefined;
      await sample();
      schedule();
    }, RUNTIME_COVERAGE_POLICY.sampleMs);
    timer?.unref?.();
  };
  async function sample({ cutoff } = {}) {
    if (stopped) return { verified: false, result: 'coverage_sampler_stopped' };
    if (!fixedGates || !contextAllowed() || !previous && !runtimeCoverageHealthReady(getHealth())) {
      return { verified: false, result: 'coverage_sampler_disabled_or_unready' };
    }
    if (inFlight) return { verified: false, result: 'coverage_sample_in_progress' };
    inFlight = true;
    controller = new AbortController();
    try {
      const result = await appendRuntimeCoverageCheckpoint({ pool, secret, revision, now, protocol,
        cutoff, monotonicNow, bootId, previous, health: getHealth(), signal: controller.signal });
      if (stopped || controller.signal.aborted) {
        previous = null; lastResult = 'coverage_operation_abandoned';
        return { verified: false, result: lastResult };
      }
      previous = result.verified ? structuredClone(result.report) : null;
      lastResult = result.result;
      return result;
    } catch {
      previous = null; lastResult = 'coverage_observation_failed';
      return { verified: false, result: lastResult };
    } finally { inFlight = false; controller = undefined; }
  }
  function start() {
    if (stopped || !fixedGates || !contextAllowed() || !runtimeCoverageHealthReady(getHealth())) return false;
    if (running) return true;
    running = true;
    void sample();
    schedule();
    return true;
  }
  function stop() {
    stopped = true; running = false; previous = null;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    controller?.abort();
  }
  return { start, stop, sample, status };
}
