const HOUR_MS = 60 * 60 * 1000;

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function clampCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function classifySourceDataState({
  recordCount = 0,
  lastDataAt = '',
  checkedAt = new Date().toISOString(),
} = {}) {
  if (clampCount(recordCount) === 0) return 'empty';
  const checkedAtMs = parseTimestamp(checkedAt) ?? Date.now();
  const lastDataAtMs = parseTimestamp(lastDataAt);
  if (lastDataAtMs == null) return 'unknown';
  const ageMs = Math.max(0, checkedAtMs - lastDataAtMs);
  if (ageMs <= 6 * HOUR_MS) return 'fresh';
  if (ageMs <= 24 * HOUR_MS) return 'aging';
  return 'stale';
}

export function buildSourceTruthLabel({
  id = '',
  label = '',
  endpoint = '',
  category = 'runtime',
  source = 'bridge',
  endpointReady = true,
  fallbackReason = '',
  degradedReason = '',
  recordCount = 0,
  lastDataAt = '',
  checkedAt = new Date().toISOString(),
  note = '',
} = {}) {
  const safeRecordCount = clampCount(recordCount);
  const checkedAtMs = parseTimestamp(checkedAt) ?? Date.now();
  const lastDataAtMs = parseTimestamp(lastDataAt);
  const status = !endpointReady ? 'offline' : fallbackReason ? 'fallback' : 'live';
  const readiness = !endpointReady ? 'unavailable' : degradedReason ? 'degraded' : 'ready';

  return {
    id,
    label,
    endpoint,
    category,
    status,
    readiness,
    source,
    dataState: classifySourceDataState({
      recordCount: safeRecordCount,
      lastDataAt,
      checkedAt,
    }),
    stalenessMs: lastDataAtMs == null ? null : Math.max(0, checkedAtMs - lastDataAtMs),
    lastCheckedAt: new Date(checkedAtMs).toISOString(),
    lastDataAt: lastDataAtMs == null ? '' : new Date(lastDataAtMs).toISOString(),
    lastUpdatedAt: lastDataAtMs == null ? '' : new Date(lastDataAtMs).toISOString(),
    fallbackReason,
    degradedReason,
    recordCount: safeRecordCount,
    note,
  };
}

export function summarizeSourceTruthLabels(items = []) {
  const labels = Array.isArray(items) ? items : [];
  const count = (key, value) => labels.filter((item) => item?.[key] === value).length;
  return {
    live: count('status', 'live'),
    fallback: count('status', 'fallback'),
    stale: count('status', 'stale'),
    offline: count('status', 'offline'),
    needsWiring: count('status', 'needs-wiring'),
    readiness: {
      ready: count('readiness', 'ready'),
      degraded: count('readiness', 'degraded'),
      unavailable: count('readiness', 'unavailable'),
    },
    data: {
      fresh: count('dataState', 'fresh'),
      aging: count('dataState', 'aging'),
      stale: count('dataState', 'stale'),
      empty: count('dataState', 'empty'),
      unknown: count('dataState', 'unknown'),
    },
  };
}

function getRecord(input, key) {
  const value = input?.[key];
  return value && typeof value === 'object' ? value : {};
}

function readServiceValue(input, id, aliases = []) {
  if (!input || typeof input !== 'object') return undefined;
  for (const key of [id, ...aliases]) {
    if (Object.hasOwn(input, key)) return input[key];
  }
  return undefined;
}

function serviceState(value) {
  if (value === true) return 'ready';
  if (value === false) return 'needs_attention';
  if (!value || typeof value !== 'object') return 'checking';

  const record = value;
  const rawState = String(
    record.operatorState ||
      record.healthState ||
      record.state ||
      record.status ||
      record.result ||
      ''
  ).toLowerCase();

  if (
    record.warning ||
    record.error ||
    record.lastError ||
    record.blocking ||
    rawState.includes('warning') ||
    rawState.includes('fail') ||
    rawState.includes('error') ||
    rawState.includes('missing') ||
    rawState.includes('unavailable') ||
    rawState.includes('needs_attention')
  ) {
    return 'needs_attention';
  }

  if (
    record.ready === true ||
    record.connected === true ||
    record.healthy === true ||
    record.liveReady === true ||
    record.trained === true ||
    rawState.includes('ready') ||
    rawState.includes('connected') ||
    rawState.includes('healthy') ||
    rawState.includes('initialized') ||
    rawState.includes('render_postgres_ready')
  ) {
    return 'ready';
  }

  if (
    record.ready === false ||
    record.connected === false ||
    record.healthy === false ||
    record.trained === false ||
    rawState.includes('blocked') ||
    rawState.includes('gated')
  ) {
    return 'needs_attention';
  }

  if (rawState.includes('checking') || rawState.includes('pending')) return 'checking';
  return 'checking';
}

function stateLabel(state) {
  if (state === 'ready') return 'Ready';
  if (state === 'needs_attention') return 'Needs attention';
  return 'Checking';
}

function serviceCopy(label, state, value, readyCopy, attentionCopy, checkingCopy) {
  const record = value && typeof value === 'object' ? value : {};
  const detail = record.copy || record.operatorCopy || record.message || record.note;
  const prefix = stateLabel(state);
  if (typeof detail === 'string' && detail.trim()) return `${prefix}: ${detail.trim()}`;
  if (state === 'ready') return `${prefix}: ${readyCopy}`;
  if (state === 'needs_attention') return `${prefix}: ${attentionCopy}`;
  return `${prefix}: ${checkingCopy || `${label} is still being checked.`}`;
}

export function buildOperatorHealthSummary(input = {}) {
  const services = [
    {
      id: 'render',
      label: 'Render',
      aliases: ['renderBridge'],
      ready: 'Hosted bridge is reachable.',
      attention: 'Hosted bridge needs a connection check.',
      checking: 'Checking the hosted bridge.',
    },
    {
      id: 'openclaw',
      label: 'OpenClaw',
      aliases: ['bridge', 'openClaw'],
      ready: 'Local command bridge is connected.',
      attention: 'Local command bridge needs setup.',
      checking: 'Checking the local command bridge.',
    },
    {
      id: 'redis',
      label: 'Redis',
      aliases: ['cache'],
      ready: 'Fast queue and cache are ready.',
      attention: 'Queue or cache needs attention.',
      checking: 'Checking queue and cache.',
    },
    {
      id: 'postgres',
      label: 'Postgres',
      aliases: ['database', 'renderPostgres'],
      ready: 'Lead and workflow data are saved and ready.',
      attention: 'Saved workspace data needs attention.',
      checking: 'Checking saved workspace data.',
    },
    {
      id: 'netlify',
      label: 'Netlify',
      aliases: ['frontend'],
      ready: 'Agent dashboard is available.',
      attention: 'Agent dashboard deploy needs attention.',
      checking: 'Checking the agent dashboard.',
    },
    {
      id: 'slack',
      label: 'Slack',
      aliases: [],
      ready: 'Team alerts can be sent.',
      attention: 'Team alerts need setup.',
      checking: 'Checking team alerts.',
    },
    {
      id: 'docusign',
      label: 'DocuSign',
      aliases: ['docuSign', 'docs'],
      ready: 'Contracts can be prepared for signature.',
      attention: 'Contracts need a DocuSign check before sending.',
      checking: 'Checking contract sending.',
    },
    {
      id: 'sms',
      label: 'SMS',
      aliases: ['telnyx', 'texting'],
      ready: 'Text messages can be sent.',
      attention: 'Text messaging needs setup.',
      checking: 'Checking text messaging.',
    },
    {
      id: 'email',
      label: 'Email',
      aliases: ['instantly'],
      ready: 'Emails can be sent.',
      attention: 'Email sending needs setup.',
      checking: 'Checking email sending.',
    },
    {
      id: 'avaLearning',
      label: 'Ava learning',
      aliases: ['ava_learning', 'learning'],
      ready: 'Ava is saving lessons from calls.',
      attention: 'Ava learning needs attention.',
      checking: 'Checking Ava learning.',
    },
  ];

  const rootRecord = input && typeof input === 'object' ? input : {};
  const providers = getRecord(rootRecord, 'providers');
  const tooling = getRecord(rootRecord, 'tooling');

  return services.map((service) => {
    const value =
      readServiceValue(rootRecord, service.id, service.aliases) ??
      readServiceValue(providers, service.id, service.aliases) ??
      readServiceValue(tooling, service.id, service.aliases);
    const state = serviceState(value);
    return {
      id: service.id,
      label: service.label,
      state,
      copy: serviceCopy(
        service.label,
        state,
        value,
        service.ready,
        service.attention,
        service.checking
      ),
    };
  });
}
