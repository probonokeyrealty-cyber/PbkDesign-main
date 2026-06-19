import {
  buildPBKIntelligenceContext,
  buildPBKIntelligenceFleetReadiness,
  mergePBKIntelligenceContextOutcome,
} from './pbk-intelligence-context.mjs';

const DEFAULT_CONTEXT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CONTEXT_FRESHNESS_MS = 60 * 1000;
const contextSessions = new Map();

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getContextLeadId(input = {}) {
  const lead = input.lead || input.leadRecord || {};
  const call = input.call || input.contextCall || {};
  return clean(input.leadId || input.lead_id || input.identity?.leadId || lead.id || lead.leadId || call.leadId || call.lead_id);
}

function getContextCallId(input = {}) {
  const call = input.call || input.contextCall || {};
  return clean(input.callId || input.call_id || input.identity?.callId || input.callState?.callId || call.id || call.callId || call.call_id);
}

function looksLikePBKIntelligenceContext(value = {}) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.identity &&
      value.turnContract &&
      value.memory &&
      value.skills
  );
}

function parseTimeMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function contextAgeMs(context = {}, now = Date.now()) {
  const lastSyncAt =
    context.dataFreshness?.lastSyncAt ||
    context.lastSyncAt ||
    context.updatedAt ||
    context.generatedAt ||
    context.savedAt;
  const lastSyncMs = parseTimeMs(lastSyncAt);
  return lastSyncMs ? Math.max(0, now - lastSyncMs) : Number.POSITIVE_INFINITY;
}

function buildRefreshInput(context = {}, options = {}) {
  const input = options.input && typeof options.input === 'object' ? options.input : {};
  const identity = context.identity && typeof context.identity === 'object' ? context.identity : {};
  const callState = context.callState && typeof context.callState === 'object' ? context.callState : {};
  return {
    leadId: options.leadId || input.leadId || input.lead_id || identity.leadId,
    callId: options.callId || input.callId || input.call_id || identity.callId || callState.callId,
    lead:
      input.lead ||
      input.leadRecord ||
      identity.leadRecord || {
        id: identity.leadId,
        leadName: identity.name,
        phone: identity.phone,
        email: identity.email,
      },
    call:
      input.call ||
      input.contextCall || {
        id: identity.callId || callState.callId,
        leadId: identity.leadId,
        status: callState.live ? 'active' : '',
        phase: callState.phase,
        transcript: callState.transcriptHistory,
      },
    transcript: input.transcript || input.query || input.text || callState.sellerUtterance,
    memory: input.memory || context.memory,
    skills: input.skills || context.skills,
    turnContract: input.turnContract || context.turnContract,
    agents: input.agents || options.agents || context.agents || [],
    outcome: context.outcome,
    lastSyncAt: new Date().toISOString(),
    workspaceId: input.workspaceId || input.workspace_id || context.workspaceId,
    contextId: context.contextId,
  };
}

function getContextKey({ leadId = '', callId = '', input = {}, context = {} } = {}) {
  const resolvedLeadId =
    clean(leadId) ||
    clean(context.identity?.leadId) ||
    clean(context.leadId) ||
    getContextLeadId(input) ||
    clean(context.identity?.normalizedPhone) ||
    clean(input.phone);
  const resolvedCallId =
    clean(callId) ||
    clean(context.identity?.callId) ||
    clean(context.callState?.callId) ||
    clean(context.callId) ||
    getContextCallId(input);
  return `${resolvedLeadId || 'unknown'}:${resolvedCallId || 'none'}`;
}

function pruneExpiredSessions(now = Date.now()) {
  for (const [key, session] of contextSessions.entries()) {
    if (!session?.expiresAt || session.expiresAt > now) continue;
    contextSessions.delete(key);
  }
}

function normalizeContextForSave(context = {}, options = {}) {
  const next = {
    ...(context && typeof context === 'object' ? context : {}),
    savedAt: new Date().toISOString(),
  };
  if (next.fleetReadiness || next.identity || next.memory || next.skills || next.turnContract) {
    next.fleetReadiness = buildPBKIntelligenceFleetReadiness({
      context: next,
      agents: options.agents || next.agents || [],
    });
  }
  return next;
}

export function clearPBKIntelligenceContextSessions() {
  contextSessions.clear();
}

export function getPBKIntelligenceContextSessionStatus() {
  pruneExpiredSessions();
  return {
    ok: true,
    result: 'pbk_intelligence_context_sessions',
    count: contextSessions.size,
    keys: Array.from(contextSessions.keys()),
  };
}

export async function loadPBKIntelligenceContextFromSession(options = {}) {
  pruneExpiredSessions();
  const key = getContextKey(options);
  const existing = contextSessions.get(key);
  if (existing?.context) return existing.context;
  if (looksLikePBKIntelligenceContext(options.context) || looksLikePBKIntelligenceContext(options.input)) {
    const context = options.context || options.input;
    await savePBKIntelligenceContextToSession(context, {
      key,
      ttlMs: options.ttlMs,
      agents: options.agents || context.agents || [],
    });
    return context;
  }
  const input = {
    ...(options.input || {}),
    leadId: options.leadId || options.input?.leadId || options.input?.lead_id,
    callId: options.callId || options.input?.callId || options.input?.call_id,
  };
  const context = buildPBKIntelligenceContext(input);
  await savePBKIntelligenceContextToSession(context, {
    key,
    ttlMs: options.ttlMs,
    agents: input.agents || options.agents || [],
  });
  return context;
}

export async function savePBKIntelligenceContextToSession(context = {}, options = {}) {
  const normalized = normalizeContextForSave(context, options);
  const key = options.key || getContextKey({ context: normalized, input: options.input || {} });
  const ttlMs = Math.max(1000, Number(options.ttlMs || DEFAULT_CONTEXT_TTL_MS));
  contextSessions.set(key, {
    context: normalized,
    savedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });
  return normalized;
}

export async function ensureFreshPBKIntelligenceContext(context = {}, options = {}) {
  if (!looksLikePBKIntelligenceContext(context)) return context;
  const maxAgeMs = Math.max(
    1000,
    Number(options.maxAgeMs || options.freshnessTtlMs || options.freshness_ttl_ms || DEFAULT_CONTEXT_FRESHNESS_MS)
  );
  if (contextAgeMs(context) <= maxAgeMs) return context;

  const rebuilt = buildPBKIntelligenceContext(buildRefreshInput(context, options));
  const refreshed = {
    ...rebuilt,
    outcome: {
      ...(rebuilt.outcome && typeof rebuilt.outcome === 'object' ? rebuilt.outcome : {}),
      ...(context.outcome && typeof context.outcome === 'object' ? context.outcome : {}),
    },
    auditTrail: [
      ...(Array.isArray(context.auditTrail) ? context.auditTrail : []),
      ...(Array.isArray(rebuilt.auditTrail) ? rebuilt.auditTrail : []),
      {
        event: 'pbk_intelligence_context_refreshed',
        at: new Date().toISOString(),
        previousLastSyncAt: context.dataFreshness?.lastSyncAt || context.lastSyncAt || '',
        maxAgeMs,
      },
    ],
  };
  refreshed.fleetReadiness = buildPBKIntelligenceFleetReadiness({
    context: refreshed,
    agents: options.agents || options.input?.agents || refreshed.agents || [],
  });
  return refreshed;
}

export async function withPBKIntelligenceContext(options = {}, handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('withPBKIntelligenceContext requires a handler function.');
  }
  const loadedContext = await loadPBKIntelligenceContextFromSession(options);
  const context = await ensureFreshPBKIntelligenceContext(loadedContext, options);
  let result;
  try {
    result = await handler(context);
  } catch (error) {
    await savePBKIntelligenceContextToSession(context, options);
    throw error;
  }
  const outcome =
    result?.outcome && typeof result.outcome === 'object'
      ? result.outcome
      : context.outcome && typeof context.outcome === 'object'
        ? context.outcome
        : {};
  const merged = mergePBKIntelligenceContextOutcome(context, {
    ...outcome,
    agents: options.agents || options.input?.agents || [],
  });
  Object.assign(context, merged);
  await savePBKIntelligenceContextToSession(context, options);
  return result;
}
