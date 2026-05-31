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

let pool = null;

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 2,
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
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
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

async function invokeBridgeTool(toolName, params = {}) {
  if (!BRIDGE_URL || !BRIDGE_KEY) {
    return { ok: false, skipped: true, reason: 'bridge_url_or_key_missing' };
  }
  const response = await fetch(`${BRIDGE_URL}/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BRIDGE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ toolName, params }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { text };
  }
  if (!response.ok) {
    throw new Error(`Bridge ${toolName} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

async function handleEvent(event) {
  const startedAt = Date.now();
  switch (event.type) {
    case EventTypes.CALL_COMPLETED:
      await invokeBridgeTool('scoreCallQuality', {
        callId: event.payload.callId || event.payload.call_id || '',
        transcript: event.payload.transcript || '',
        source: 'event-worker',
        createRexDecision: true,
      });
      {
        const embedding = await invokeBridgeTool('upsertCallEmbeddingFromTranscript', {
          workspaceId: event.payload.workspaceId || event.payload.workspace_id || 'pbk',
          callId: event.payload.callId || event.payload.call_id || '',
          leadId: event.payload.leadId || event.payload.lead_id || '',
          transcript: event.payload.transcript || event.payload.transcriptText || event.payload.transcript_text || '',
          outcome: event.payload.outcome || event.payload.outcomeLabel || event.payload.outcome_label || 'completed',
          status: event.payload.status || 'completed',
          sentiment: event.payload.sentiment ?? event.payload.sentimentScore ?? event.payload.sentiment_score ?? null,
          source: 'event-worker-call-completed',
        });
        if (embedding?.ok === false && embedding?.result !== 'insufficient_call_memory') {
          console.warn(`[pbk-event-worker] call embedding skipped/failed: ${embedding.result || 'unknown'} ${embedding.error || ''}`.trim());
        }
      }
      if (event.payload.scriptId || event.payload.script_id || event.payload.contextAwareScript?.id) {
        await invokeBridgeTool('recordContextAwareScriptOutcome', {
          scriptId: event.payload.scriptId || event.payload.script_id || event.payload.contextAwareScript?.id || '',
          callId: event.payload.callId || event.payload.call_id || '',
          leadId: event.payload.leadId || event.payload.lead_id || '',
          outcome: event.payload.outcome || event.payload.outcomeLabel || event.payload.outcome_label || 'completed',
          success: event.payload.success,
          dealValue: event.payload.dealValue || event.payload.deal_value || event.payload.assignmentFee || event.payload.assignment_fee || 0,
          source: 'event-worker',
        });
      }
      break;
    case EventTypes.LEAD_IMPORTED:
      console.log(`[pbk-event-worker] lead imported: ${event.payload.leadId || event.payload.lead_id || 'unknown'}`);
      await invokeBridgeTool('handleRexLeadImported', {
        ...event.payload,
        source: event.source || 'event-worker',
      });
      break;
    case EventTypes.LEAD_UPDATED:
      {
        const oldStage = String(event.payload.oldStage || event.payload.old_stage || '').toLowerCase();
        const newStage = String(event.payload.newStage || event.payload.new_stage || event.payload.stage || '').toLowerCase();
        const leadId = event.payload.leadId || event.payload.lead_id || event.payload.id || '';
        if (leadId && oldStage !== newStage && /^(warm|hot)$/i.test(newStage)) {
          const db = getPool();
          const result = await startNurtureSequenceCore(db, {
            leadId,
            trigger: 'lead.updated',
            source: 'event-worker',
          }, {
            invokeTool: invokeBridgeTool,
          });
          console.log(`[pbk-event-worker] nurture ${result.result || 'handled'} for lead ${leadId}`);
        }
      }
      break;
    case 'sms.received':
      {
        const db = getPool();
        const result = await pauseNurtureForPhoneStop(db, event.payload || {});
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
    batchSize: Number(process.env.PBK_EVENT_WORKER_BATCH_SIZE || 10),
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
