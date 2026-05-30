function assert(condition, message) {
  if (!condition) throw new Error(message);
}

process.env.PBK_OBSERVABILITY_ENABLED = 'true';
process.env.PBK_OBSERVABILITY_ALERTS_ENABLED = 'true';

const {
  getObservabilityStatus,
  incrementObservabilityCounter,
  initializeObservability,
  recordEventBusBacklogMetric,
  recordGuardrailViolationMetric,
  recordLatencyMetric,
  recordQaValidationMetric,
  withObservabilitySpan,
} = await import('./observability.mjs');

await initializeObservability({ serviceName: 'pbk-observability-smoke' });

const spanResult = await withObservabilitySpan('observability.smoke', { source: 'smoke-test' }, async () => 'span-ok');
assert(spanResult === 'span-ok', 'withObservabilitySpan did not return the wrapped function result.');

recordLatencyMetric('speech_final_to_reply_start_ms', 2501, { callId: 'obs-smoke-call' });
recordLatencyMetric('turn_completion_ms', 3105, { callId: 'obs-smoke-call' });
incrementObservabilityCounter('tool_call_errors', 11, { toolName: 'sendDocuSign' });
recordQaValidationMetric({ toolName: 'sendDocuSign', ok: false, reason: 'missing_envelope' });
recordGuardrailViolationMetric({ toolName: 'telnyx_call', code: 'dnc_block', severity: 'critical' });
recordEventBusBacklogMetric(1001, { streamName: 'pbk:events' });

const status = getObservabilityStatus();

assert(status.enabled === true, 'Observability did not enable in smoke mode.');
assert(status.serviceName === 'pbk-observability-smoke', 'Observability service name was not preserved.');
assert(status.metrics?.counters?.guardrail_violations >= 1, 'Guardrail violation counter was not recorded.');
assert(status.metrics?.counters?.qa_failures >= 1, 'QA failure counter was not recorded.');
assert(status.metrics?.histograms?.speech_final_to_reply_start_ms?.count === 1, 'Ava response latency histogram was not recorded.');
assert(status.metrics?.gauges?.event_bus_backlog === 1001, 'Event bus backlog gauge was not recorded.');
assert(status.alerts?.some((alert) => alert.type === 'ava_response_latency_high'), 'Ava latency alert was not emitted.');
assert(status.alerts?.some((alert) => alert.type === 'event_bus_backlog_high'), 'Event bus backlog alert was not emitted.');
assert(status.alerts?.some((alert) => alert.type === 'guardrail_violation'), 'Guardrail violation alert was not emitted.');

console.log('observability smoke passed', {
  enabled: status.enabled,
  otelReady: status.otelReady,
  alertCount: status.alerts.length,
  counters: status.metrics.counters,
});
