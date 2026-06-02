const DEFAULT_THRESHOLDS = Object.freeze({
  avaResponseLatencyMs: Number(process.env.PBK_OBSERVABILITY_AVA_RESPONSE_P95_MS || 2000),
  turnCompletionMs: Number(process.env.PBK_OBSERVABILITY_TURN_COMPLETION_P95_MS || 3000),
  eventBusBacklog: Number(process.env.PBK_OBSERVABILITY_EVENT_BACKLOG || 1000),
  qaFailureRate: Number(process.env.PBK_OBSERVABILITY_QA_FAILURE_RATE || 0.05),
  toolCallErrorsPerMinute: Number(process.env.PBK_OBSERVABILITY_TOOL_ERRORS_PER_MINUTE || 10),
});

const state = {
  initialized: false,
  enabled: false,
  alertsEnabled: true,
  otelReady: false,
  serviceName: 'pbk-bridge',
  lastError: '',
  sdk: null,
  api: null,
  tracer: null,
  meter: null,
  instruments: {
    counters: new Map(),
    histograms: new Map(),
  },
  metrics: {
    counters: {},
    histograms: {},
    gauges: {},
  },
  histogramValues: {},
  alerts: [],
};

function envBool(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function safeName(value = '') {
  return String(value || 'metric').trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 120) || 'metric';
}

function cleanAttributes(attributes = {}) {
  const out = {};
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value === undefined || value === null) continue;
    const cleanKey = safeName(key);
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      out[cleanKey] = value;
    } else {
      out[cleanKey] = String(value).slice(0, 240);
    }
  }
  return out;
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function updateHistogram(name, value) {
  const metric = safeName(name);
  const amount = Math.max(0, numeric(value, 0));
  const current = state.metrics.histograms[metric] || {
    count: 0,
    sum: 0,
    min: amount,
    max: amount,
    avg: 0,
    latest: 0,
    p95: 0,
  };
  current.count += 1;
  current.sum += amount;
  current.min = Math.min(current.min, amount);
  current.max = Math.max(current.max, amount);
  current.latest = amount;
  current.avg = Math.round(current.sum / current.count);
  const values = state.histogramValues[metric] || [];
  values.push(amount);
  while (values.length > 200) values.shift();
  state.histogramValues[metric] = values;
  const sorted = [...values].sort((left, right) => left - right);
  current.p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || amount;
  state.metrics.histograms[metric] = current;
  return current;
}

function pushAlert(type, details = {}) {
  if (!state.alertsEnabled) return null;
  const alert = {
    id: `obs-alert-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    severity: details.severity || 'warning',
    message: String(details.message || type).slice(0, 500),
    details: cleanAttributes(details.details || {}),
    createdAt: new Date().toISOString(),
  };
  state.alerts.push(alert);
  while (state.alerts.length > 100) state.alerts.shift();
  void sendSlackAlert(alert);
  return alert;
}

async function sendSlackAlert(alert) {
  const webhookUrl = String(process.env.PBK_OBSERVABILITY_SLACK_WEBHOOK_URL || process.env.PBK_SLACK_WEBHOOK_URL || '').trim();
  if (!webhookUrl || !/^https:\/\//i.test(webhookUrl)) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[PBK Observability] ${alert.severity.toUpperCase()}: ${alert.message}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*PBK Observability* ${alert.severity.toUpperCase()}\n${alert.message}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `type=${alert.type} at ${alert.createdAt}`,
              },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    state.lastError = error?.message || String(error);
  }
}

async function tryStartOpenTelemetry(serviceName) {
  try {
    const [
      api,
      sdkNode,
      traceExporterModule,
      metricExporterModule,
      metricsSdk,
      httpInstrumentation,
    ] = await Promise.all([
      import('@opentelemetry/api'),
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/exporter-metrics-otlp-http'),
      import('@opentelemetry/sdk-metrics'),
      import('@opentelemetry/instrumentation-http'),
    ]);
    const traceExporter = new traceExporterModule.OTLPTraceExporter();
    const metricReader = new metricsSdk.PeriodicExportingMetricReader({
      exporter: new metricExporterModule.OTLPMetricExporter(),
      exportIntervalMillis: Math.max(5000, Number(process.env.PBK_OTEL_EXPORT_INTERVAL_MS || 30000)),
    });
    const sdk = new sdkNode.NodeSDK({
      serviceName,
      traceExporter,
      metricReader,
      instrumentations: [
        new httpInstrumentation.HttpInstrumentation(),
      ],
    });
    await sdk.start();
    state.sdk = sdk;
    state.api = api;
    state.tracer = api.trace.getTracer(serviceName);
    state.meter = api.metrics.getMeter(serviceName);
    state.otelReady = true;
    state.lastError = '';
  } catch (error) {
    state.otelReady = false;
    state.lastError = error?.code === 'ERR_MODULE_NOT_FOUND'
      ? 'opentelemetry_packages_not_installed'
      : (error?.message || String(error));
  }
}

export async function initializeObservability(options = {}) {
  const serviceName = String(options.serviceName || process.env.OTEL_SERVICE_NAME || process.env.PBK_OBSERVABILITY_SERVICE_NAME || 'pbk-bridge').trim() || 'pbk-bridge';
  state.serviceName = serviceName;
  // Enable when explicitly set, when an OTLP endpoint is configured, or when
  // running on Render where OTEL_EXPORTER_OTLP_ENDPOINT should be wired via env.
  const isHosted = Boolean(process.env.RENDER || process.env.FLY_APP_NAME);
  state.enabled = envBool('PBK_OBSERVABILITY_ENABLED', Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) || isHosted);
  state.alertsEnabled = envBool('PBK_OBSERVABILITY_ALERTS_ENABLED', true);
  if (state.initialized) return getObservabilityStatus();
  state.initialized = true;
  if (state.enabled) {
    await tryStartOpenTelemetry(serviceName);
  }
  return getObservabilityStatus();
}

function getCounterInstrument(name) {
  if (!state.meter) return null;
  const metric = safeName(name);
  if (!state.instruments.counters.has(metric)) {
    state.instruments.counters.set(metric, state.meter.createCounter(metric));
  }
  return state.instruments.counters.get(metric);
}

function getHistogramInstrument(name) {
  if (!state.meter) return null;
  const metric = safeName(name);
  if (!state.instruments.histograms.has(metric)) {
    state.instruments.histograms.set(metric, state.meter.createHistogram(metric));
  }
  return state.instruments.histograms.get(metric);
}

export function incrementObservabilityCounter(name, amount = 1, attributes = {}) {
  const metric = safeName(name);
  const count = Math.max(0, numeric(amount, 1));
  state.metrics.counters[metric] = (state.metrics.counters[metric] || 0) + count;
  getCounterInstrument(metric)?.add(count, cleanAttributes(attributes));
  if (metric === 'tool_call_errors' && count >= DEFAULT_THRESHOLDS.toolCallErrorsPerMinute) {
    pushAlert('tool_call_errors_high', {
      severity: 'warning',
      message: `Tool call errors exceeded ${DEFAULT_THRESHOLDS.toolCallErrorsPerMinute}/minute threshold.`,
      details: { amount: count, ...attributes },
    });
  }
  return state.metrics.counters[metric];
}

export function recordLatencyMetric(name, value, attributes = {}) {
  const metric = safeName(name);
  const amount = Math.max(0, numeric(value, 0));
  const summary = updateHistogram(metric, amount);
  getHistogramInstrument(metric)?.record(amount, cleanAttributes(attributes));
  if (metric === 'speech_final_to_reply_start_ms' && amount > DEFAULT_THRESHOLDS.avaResponseLatencyMs) {
    pushAlert('ava_response_latency_high', {
      severity: 'warning',
      message: `Ava response latency ${amount}ms exceeded ${DEFAULT_THRESHOLDS.avaResponseLatencyMs}ms.`,
      details: { value: amount, ...attributes },
    });
  }
  if (metric === 'turn_completion_ms' && amount > DEFAULT_THRESHOLDS.turnCompletionMs) {
    pushAlert('call_turn_latency_high', {
      severity: 'warning',
      message: `Call turn latency ${amount}ms exceeded ${DEFAULT_THRESHOLDS.turnCompletionMs}ms.`,
      details: { value: amount, ...attributes },
    });
  }
  return summary;
}

export function recordGaugeMetric(name, value, attributes = {}) {
  const metric = safeName(name);
  const amount = Math.max(0, numeric(value, 0));
  state.metrics.gauges[metric] = amount;
  getHistogramInstrument(`${metric}_observations`)?.record(amount, cleanAttributes(attributes));
  return amount;
}

export function recordEventBusBacklogMetric(value, attributes = {}) {
  const backlog = recordGaugeMetric('event_bus_backlog', value, attributes);
  if (backlog > DEFAULT_THRESHOLDS.eventBusBacklog) {
    pushAlert('event_bus_backlog_high', {
      severity: 'warning',
      message: `Event bus backlog ${backlog} exceeded ${DEFAULT_THRESHOLDS.eventBusBacklog}.`,
      details: { backlog, ...attributes },
    });
  }
  return backlog;
}

export function recordQaValidationMetric({ toolName = '', ok = true, reason = '', source = '' } = {}) {
  incrementObservabilityCounter('qa_validations', 1, { toolName, source });
  if (ok === false) {
    incrementObservabilityCounter('qa_failures', 1, { toolName, reason, source });
  }
  const total = state.metrics.counters.qa_validations || 0;
  const failed = state.metrics.counters.qa_failures || 0;
  const rate = total ? failed / total : 0;
  state.metrics.gauges.qa_failure_rate = Number(rate.toFixed(4));
  if (total >= 1 && rate > DEFAULT_THRESHOLDS.qaFailureRate) {
    pushAlert('qa_failure_rate_high', {
      severity: 'warning',
      message: `QA failure rate ${(rate * 100).toFixed(1)}% exceeded ${(DEFAULT_THRESHOLDS.qaFailureRate * 100).toFixed(1)}%.`,
      details: { toolName, reason, rate },
    });
  }
  return { total, failed, rate };
}

export function recordGuardrailViolationMetric({ toolName = '', code = '', severity = 'critical', source = '' } = {}) {
  incrementObservabilityCounter('guardrail_violations', 1, { toolName, code, severity, source });
  pushAlert('guardrail_violation', {
    severity: severity === 'critical' ? 'critical' : 'warning',
    message: `Guardrail violation${toolName ? ` for ${toolName}` : ''}: ${code || 'unknown'}.`,
    details: { toolName, code, source },
  });
}

export async function withObservabilitySpan(name, attributes = {}, fn = async () => null) {
  if (typeof fn !== 'function') throw new Error('withObservabilitySpan requires a function.');
  const spanName = safeName(name);
  if (!state.tracer) return fn();
  return state.tracer.startActiveSpan(spanName, { attributes: cleanAttributes(attributes) }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus?.({ code: state.api?.SpanStatusCode?.OK || 1 });
      return result;
    } catch (error) {
      span.recordException?.(error);
      span.setStatus?.({
        code: state.api?.SpanStatusCode?.ERROR || 2,
        message: error?.message || String(error),
      });
      throw error;
    } finally {
      span.end?.();
    }
  });
}

export function getObservabilityStatus() {
  return {
    ok: true,
    enabled: state.enabled,
    initialized: state.initialized,
    otelReady: state.otelReady,
    serviceName: state.serviceName,
    lastError: state.lastError,
    thresholds: { ...DEFAULT_THRESHOLDS },
    metrics: {
      counters: { ...state.metrics.counters },
      histograms: JSON.parse(JSON.stringify(state.metrics.histograms)),
      gauges: { ...state.metrics.gauges },
    },
    alerts: [...state.alerts],
  };
}

export async function shutdownObservability() {
  if (state.sdk?.shutdown) {
    await state.sdk.shutdown().catch((error) => {
      state.lastError = error?.message || String(error);
    });
  }
  state.sdk = null;
  state.api = null;
  state.tracer = null;
  state.meter = null;
  state.otelReady = false;
  return getObservabilityStatus();
}
