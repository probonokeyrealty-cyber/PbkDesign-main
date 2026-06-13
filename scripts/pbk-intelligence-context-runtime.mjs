import {
  buildPBKIntelligenceContext,
  buildPBKIntelligenceFleetReadiness,
  mergePBKIntelligenceContextOutcome,
} from './pbk-intelligence-context.mjs';

const DEFAULT_CONTEXT_TTL_MS = 30 * 60 * 1000;
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

export async function withPBKIntelligenceContext(options = {}, handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('withPBKIntelligenceContext requires a handler function.');
  }
  const context = await loadPBKIntelligenceContextFromSession(options);
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
