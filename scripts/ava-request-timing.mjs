import { performance } from 'node:perf_hooks';

const STAGES = new Set([
  'body_read', 'session_read', 'controller_intake', 'intent_plan',
  'controller_planned', 'tool_execution', 'lead_lookup', 'controller_final',
  'controller_final_recheck', 'session_write',
]);

// Labels are allowlisted; never retain prompts, lead data, or exception messages.
export function createAvaRequestTiming({ now = () => performance.now() } = {}) {
  const startedAt = now();
  const stages = [];

  function begin(name) {
    if (!STAGES.has(name)) throw new TypeError('Unknown Ava timing stage');
    return now();
  }

  function finish(stage, start, outcome) {
    stages.push({ stage, durationMs: Math.max(0, now() - start), outcome });
  }

  function outcome(error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'error';
  }

  return {
    async measure(stage, operation) {
      const start = begin(stage);
      try {
        const result = await operation();
        finish(stage, start, 'returned');
        return result;
      } catch (error) {
        finish(stage, start, outcome(error));
        throw error;
      }
    },
    measureSync(stage, operation) {
      const start = begin(stage);
      try {
        const result = operation();
        finish(stage, start, 'returned');
        return result;
      } catch (error) {
        finish(stage, start, outcome(error));
        throw error;
      }
    },
    snapshot() {
      return {
        schema: 'pbk.ava.request_timing.v1',
        metricKind: 'operator_request',
        durationMs: Math.max(0, now() - startedAt),
        stages: stages.map((stage) => ({ ...stage })),
      };
    },
  };
}
