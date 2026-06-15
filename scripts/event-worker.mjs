import pg from 'pg';
import { EventTypes, consumeEvents, createEventBus, getEventBusStatus } from './event-bus/streams.mjs';
import {
  initializeObservability,
  incrementObservabilityCounter,
  recordEventBusBacklogMetric,
  recordLatencyMetric,
} from './observability.mjs';
import {
  ensureNurtureSchema,
  pauseNurtureForPhoneStop,
  processDueNurtureInstances,
  startNurtureSequenceCore,
} from './nurture-agent.mjs';

const { Pool } = pg;

void initializeObservability({ serviceName: 'pbk-event-worker' });

const DATABASE_URL = String(process.env.PBK_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const BRIDGE_URL = String(process.env.PBK_EVENT_WORKER_BRIDGE_URL || process.env.PBK_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const BRIDGE_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const configuredBridgeTimeoutMs = Number(process.env.PBK_EVENT_WORKER_BRIDGE_TIMEOUT_MS || 30_000);
const BRIDGE_TIMEOUT_MS = Number.isFinite(configuredBridgeTimeoutMs)
  ? Math.max(5_000, Math.min(120_000, configuredBridgeTimeoutMs))
  : 30_000;
const PG_POOL_MAX = Math.max(1, Math.min(4, Number(process.env.PBK_PG_POOL_MAX || 1)));
const PG_CONNECTION_TIMEOUT_MS = Math.max(
  1000,
  Math.min(15000, Number(process.env.PBK_PG_CONNECTION_TIMEOUT_MS || 8000))
);
const PG_IDLE_TIMEOUT_MS = Math.max(
  5000,
  Math.min(60000, Number(process.env.PBK_PG_IDLE_TIMEOUT_MS || 10000))
);
const PG_MAX_LIFETIME_SECONDS = Math.max(
  60,
  Math.min(1800, Number(process.env.PBK_PG_MAX_LIFETIME_SECONDS || 300))
);

let pool = null;

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: PG_POOL_MAX,
      connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
      maxLifetimeSeconds: PG_MAX_LIFETIME_SECONDS,
      keepAlive: true,
      keepAliveInitialDelayMillis: 1000,
      ssl: /(localhost|127\.0\.0\.1)/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
    });
    pool.on('error', (error) => {
      console.warn('[pbk-event-worker] pg pool error:', error?.message || error);
    });
  }
  return pool;
}

async function ensureDeadLetterTable() {
  const db = getPool();
  if (!db) return { ok: false, reason: 'postgres_unavailable' };
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_dead_letters (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id TEXT NOT NULL DEFAULT 'pbk',
      event_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT NOT NULL DEFAULT '',
      stack TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    DELETE FROM public.event_dead_letters older
    USING public.event_dead_letters newer
    WHERE older.tenant_id = newer.tenant_id
      AND older.event_id = newer.event_id
      AND older.event_id <> ''
      AND older.ctid < newer.ctid;
    CREATE UNIQUE INDEX IF NOT EXISTS event_dead_letters_tenant_event_idx
      ON public.event_dead_letters (tenant_id, event_id)
      WHERE event_id <> '';
  `);
  return { ok: true };
}

async function ensureWorkerSchemas() {
  await ensureDeadLetterTable();
  const db = getPool();
  if (db) await ensureNurtureSchema(db);
  return { ok: true };
}

async function recordDeadLetter(record = {}) {
  const db = getPool();
  if (!db) {
    console.warn('[pbk-event-worker] dead-letter skipped without PBK_DATABASE_URL:', record.eventType || record.event_type);
    return { ok: false, reason: 'postgres_unavailable' };
  }
  await db.query(
    `INSERT INTO public.event_dead_letters (
      tenant_id, event_id, event_type, source, payload, error, stack, created_at
    )
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
    ON CONFLICT (tenant_id, event_id) WHERE event_id <> ''
    DO UPDATE SET
      event_type = EXCLUDED.event_type,
      source = EXCLUDED.source,
      payload = EXCLUDED.payload,
      error = EXCLUDED.error,
      stack = EXCLUDED.stack,
      created_at = EXCLUDED.created_at`,
    [
      'pbk',
      String(record.eventId || record.event_id || ''),
      String(record.eventType || record.event_type || 'unknown'),
      String(record.source || ''),
      JSON.stringify(record.payload && typeof record.payload === 'object' ? record.payload : {}),
      String(record.error || '').slice(0, 1000),
      String(record.stack || '').slice(0, 5000),
      record.createdAt || record.created_at || new Date().toISOString(),
    ],
  );
  return { ok: true };
}

async function invokeBridgeTool(toolName, params = {}, options = {}) {
  if (!BRIDGE_URL || !BRIDGE_KEY) {
    throw new Error(`Bridge ${toolName} is unavailable because PBK_EVENT_WORKER_BRIDGE_URL or PBK_BRIDGE_API_KEY is missing.`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  let response;
  let text = '';
  try {
    response = await fetch(`${BRIDGE_URL}/invoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BRIDGE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.idempotencyKey
          ? { 'Idempotency-Key': String(options.idempotencyKey).slice(0, 160) }
          : {}),
      },
      body: JSON.stringify({ toolName, params }),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Bridge ${toolName} timed out after ${BRIDGE_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Bridge ${toolName} returned malformed JSON.`);
  }
  if (!response.ok) {
    throw new Error(`Bridge ${toolName} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`Bridge ${toolName} returned an empty or invalid response body.`);
  }
  const allowedFailureResults = new Set(
    Array.isArray(options.allowFailureResults) ? options.allowFailureResults.map(String) : [],
  );
  const nestedResult =
    body.result && typeof body.result === 'object' && !Array.isArray(body.result)
      ? body.result
      : null;
  const applicationResult = String(
    nestedResult?.result
    || nestedResult?.reason
    || (typeof body.result === 'string' ? body.result : '')
    || body.reason
    || '',
  );
  if (
    (
      body.ok === false
      || body.skipped === true
      || nestedResult?.ok === false
      || nestedResult?.skipped === true
    )
    && !allowedFailureResults.has(applicationResult)
  ) {
    throw new Error(
      `Bridge ${toolName} failed: ${String(
        nestedResult?.error
        || nestedResult?.reason
        || nestedResult?.result
        || body.error
        || body.reason
        || applicationResult
        || 'application_error',
      ).slice(0, 300)}`,
    );
  }
  return body;
}

async function handleEvent(event) {
  const startedAt = Date.now();
  const eventStepKey = (step) => `event:${event.id}:${step}`;
  switch (event.type) {
    case EventTypes.CALL_COMPLETED:
      await invokeBridgeTool('scoreCallQuality', {
        id: `call-qa-event-${event.id}`,
        eventId: event.id,
        callId: event.payload.callId || event.payload.call_id || '',
        transcript: event.payload.transcript || '',
        source: 'event-worker',
        createRexDecision: true,
      }, { idempotencyKey: eventStepKey('score-call-quality') });
      {
        await invokeBridgeTool(
          'upsertCallEmbeddingFromTranscript',
          {
            workspaceId: event.payload.workspaceId || event.payload.workspace_id || 'pbk',
            callId: event.payload.callId || event.payload.call_id || '',
            leadId: event.payload.leadId || event.payload.lead_id || '',
            transcript: event.payload.transcript || event.payload.transcriptText || event.payload.transcript_text || '',
            outcome: event.payload.outcome || event.payload.outcomeLabel || event.payload.outcome_label || 'completed',
            status: event.payload.status || 'completed',
            sentiment: event.payload.sentiment ?? event.payload.sentimentScore ?? event.payload.sentiment_score ?? null,
            source: 'event-worker-call-completed',
          },
          {
            allowFailureResults: ['insufficient_call_memory'],
            idempotencyKey: eventStepKey('upsert-call-embedding'),
          },
        );
      }
      if (event.payload.scriptId || event.payload.script_id || event.payload.contextAwareScript?.id) {
        await invokeBridgeTool('recordContextAwareScriptOutcome', {
          workspaceId: event.payload.workspaceId || event.payload.workspace_id || 'pbk',
          scriptId: event.payload.scriptId || event.payload.script_id || event.payload.contextAwareScript?.id || '',
          callId: event.payload.callId || event.payload.call_id || '',
          leadId: event.payload.leadId || event.payload.lead_id || '',
          outcomeEventId: `event-${event.id}-script-${event.payload.scriptId || event.payload.script_id || event.payload.contextAwareScript?.id || ''}`,
          outcome: event.payload.outcome || event.payload.outcomeLabel || event.payload.outcome_label || 'completed',
          success: event.payload.success,
          dealValue: event.payload.dealValue || event.payload.deal_value || event.payload.assignmentFee || event.payload.assignment_fee || 0,
          source: 'event-worker',
        }, { idempotencyKey: eventStepKey('record-script-outcome') });
      }
      break;
    case EventTypes.LEAD_IMPORTED:
      console.log(`[pbk-event-worker] lead imported: ${event.payload.leadId || event.payload.lead_id || 'unknown'}`);
      await invokeBridgeTool('handleRexLeadImported', {
        ...event.payload,
        eventId: event.id,
        idempotencyKey: eventStepKey('rex-lead-imported'),
        source: event.source || 'event-worker',
      }, { idempotencyKey: eventStepKey('rex-lead-imported') });
      break;
    case EventTypes.LEAD_UPDATED:
      {
        const oldStage = String(event.payload.oldStage || event.payload.old_stage || '').toLowerCase();
        const newStage = String(event.payload.newStage || event.payload.new_stage || event.payload.stage || '').toLowerCase();
        const leadId = event.payload.leadId || event.payload.lead_id || event.payload.id || '';
        if (leadId && oldStage !== newStage && /^(warm|hot)$/i.test(newStage)) {
          const db = getPool();
          const result = await startNurtureSequenceCore(db, {
            ...event.payload,
            leadId,
            trigger: 'lead.updated',
            source: 'event-worker',
          }, {
            invokeTool: invokeBridgeTool,
          });
          if (result?.ok === false) {
            throw new Error(`Lead nurture start failed: ${result.error || result.reason || result.result || 'application_error'}`);
          }
          console.log(`[pbk-event-worker] nurture ${result.result || 'handled'} for lead ${leadId}`);
        }
      }
      break;
    case 'sms.received':
      {
        const db = getPool();
        const result = await pauseNurtureForPhoneStop(db, event.payload || {});
        if (result?.ok === false) {
          throw new Error(`SMS stop handling failed: ${result.error || result.reason || result.result || 'application_error'}`);
        }
        if (result.paused) {
          console.log(`[pbk-event-worker] paused ${result.paused} nurture instance(s) for lead ${result.leadId}`);
        }
      }
      break;
    case EventTypes.QA_VALIDATION_FAILED:
      console.warn(`[pbk-event-worker] QA failure: ${event.payload.toolName || 'unknown'} ${event.payload.reason || ''}`);
      break;
    case EventTypes.TOOL_INVOKED:
      console.log(`[pbk-event-worker] tool invoked: ${event.payload.toolName || 'unknown'}`);
      break;
    default:
      console.log(`[pbk-event-worker] unhandled event: ${event.type}`);
  }
  recordLatencyMetric('event_processing_latency_ms', Date.now() - startedAt, {
    eventType: event.type,
    source: event.source || '',
  });
}

function startNurtureInterval() {
  const intervalMs = Math.max(15000, Number(process.env.PBK_NURTURE_WORKER_INTERVAL_MS || 60000));
  const run = async () => {
    const db = getPool();
    if (!db) return;
    try {
      const result = await processDueNurtureInstances(db, {
        limit: Number(process.env.PBK_NURTURE_WORKER_BATCH_SIZE || 50),
        invokeTool: invokeBridgeTool,
      });
      if (result.processed) {
        console.log(`[pbk-event-worker] processed ${result.processed} due nurture step(s)`);
      }
    } catch (error) {
      console.warn('[pbk-event-worker] nurture processing skipped:', error?.message || error);
      incrementObservabilityCounter('event_worker_nurture_errors', 1, { error: error?.message || String(error) });
    }
  };
  void run();
  return setInterval(run, intervalMs);
}

async function main() {
  await ensureWorkerSchemas().catch((error) => {
    console.warn('[pbk-event-worker] worker schema ensure skipped:', error?.message || error);
  });

  const bus = createEventBus();
  const status = await getEventBusStatus({ bus });
  recordEventBusBacklogMetric(status.backlog || status.streamLength || status.pendingMemoryEvents || 0, {
    streamName: status.streamName || '',
    mode: status.mode || '',
  });
  console.log('[pbk-event-worker] event bus status:', JSON.stringify(status));
  if (!status.configured || status.mode !== 'redis') {
    console.warn('[pbk-event-worker] Redis event bus is not configured. Set PBK_REDIS_URL before running this worker in production.');
    await new Promise(() => {});
    return;
  }

  const nurtureTimer = startNurtureInterval();
  await consumeEvents(handleEvent, {
    bus,
    batchSize: 1,
    blockMs: Number(process.env.PBK_EVENT_WORKER_BLOCK_MS || 5000),
    deadLetterSink: recordDeadLetter,
  });
  clearInterval(nurtureTimer);
}

process.on('SIGTERM', async () => {
  await pool?.end().catch(() => {});
  process.exit(0);
});

main().catch(async (error) => {
  console.error('[pbk-event-worker] fatal:', error);
  incrementObservabilityCounter('event_worker_fatal_errors', 1, { error: error?.message || String(error) });
  await pool?.end().catch(() => {});
  process.exit(1);
});
