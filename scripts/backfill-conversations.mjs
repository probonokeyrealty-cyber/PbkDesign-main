import { pathToFileURL } from 'node:url';

import { ensureConversationSchema } from './conversation-schema.mjs';
import {
  projectActivityEvent,
  projectCallEvent,
  projectContractEvent,
  projectMessageEvent,
} from './conversation-projector.mjs';
import { createConversationStore } from './conversation-store.mjs';
import {
  conversationThreadTitle,
  sellerContactFromEvent,
} from './conversation-live-projector.mjs';

export const BACKFILL_ORDER = Object.freeze([
  'lead_profiles',
  'unified_messages',
  'calls',
  'contracts',
  'activity_log',
]);

const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1000;
const FINAL_CALL_STATUS = /^(busy|cancelled|canceled|complete|completed|ended|failed|hangup|hungup|no-answer|no_answer)$/i;

function boundedBatchSize(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_BATCH_SIZE), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, parsed));
}

function parseCursor(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const separator = text.indexOf(':');
  if (separator <= 0) {
    throw new Error('Backfill cursor must use table:id format.');
  }
  const table = text.slice(0, separator);
  const id = text.slice(separator + 1);
  if (!BACKFILL_ORDER.includes(table)) {
    throw new Error(`Unsupported backfill cursor table: ${table}`);
  }
  return { table, id };
}

export function parseBackfillArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const valueFor = (name) => {
    const prefix = `--${name}=`;
    const inline = args.find((arg) => String(arg).startsWith(prefix));
    if (inline) return String(inline).slice(prefix.length);
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : '';
  };
  const apply = args.includes('--apply');
  return {
    apply,
    dryRun: !apply,
    batchSize: boundedBatchSize(valueFor('batch-size')),
    cursor: parseCursor(valueFor('cursor')),
    workspaceId: String(valueFor('workspace') || 'pbk').trim() || 'pbk',
  };
}

function callKinds(record = {}) {
  const kinds = ['started'];
  const transcript = record.transcript ?? record.transcript_text;
  if (
    (Array.isArray(transcript) && transcript.length > 0) ||
    (typeof transcript === 'string' && transcript.trim())
  ) {
    kinds.push('transcript');
  }
  if (
    record.recording_url ||
    record.recordingUrl ||
    record.storage_path ||
    record.storagePath ||
    record.recording_path ||
    record.recordingPath
  ) {
    kinds.push('recording');
  }
  if (
    record.ended_at ||
    record.endedAt ||
    record.completed_at ||
    record.completedAt ||
    FINAL_CALL_STATUS.test(String(record.status || ''))
  ) {
    kinds.push('completed');
  }
  return kinds;
}

function projectSourceRow(table, record) {
  if (table === 'lead_profiles') return [];
  if (table === 'unified_messages') return [projectMessageEvent(record)];
  if (table === 'calls') {
    return callKinds(record).map((kind) => projectCallEvent(record, kind));
  }
  if (table === 'contracts') return [projectContractEvent(record)];
  if (table === 'activity_log') return [projectActivityEvent(record)];
  throw new Error(`Unsupported backfill source table: ${table}`);
}

function leadThreadRequest(record, workspaceId) {
  return {
    workspaceId,
    leadId: record.id,
    phone: record.phone || '',
    email: record.email || '',
    title: conversationThreadTitle({
      leadName: record.lead_name || record.leadName || '',
      address: record.address || '',
    }),
    source: 'conversation-backfill:lead',
    metadata: {
      projectionSource: 'conversation-backfill',
      sourceTable: 'lead_profiles',
      sourceId: record.id,
    },
  };
}

function eventThreadRequest(event, record, workspaceId) {
  const contact = sellerContactFromEvent(event);
  return {
    workspaceId,
    leadId: event.leadId || null,
    phone: contact.phone,
    email: contact.email,
    title: conversationThreadTitle({
      leadName: record.lead_name || record.leadName || record.seller_name || '',
      address: record.address || record.property_address || '',
    }),
    source: 'conversation-backfill:event',
    metadata: {
      projectionSource: 'conversation-backfill',
      sourceTable: event.sourceTable,
      sourceId: event.sourceId,
      eventType: event.eventType,
    },
  };
}

async function readSourceBatch(pool, table, {
  workspaceId,
  afterId,
  batchSize,
}) {
  const leadScoped = table === 'activity_log' ? 'AND lead_id IS NOT NULL' : '';
  let result;
  try {
    result = await pool.query(
      `SELECT *
       FROM public.${table}
       WHERE workspace_id = $1
         AND id > $2
         ${leadScoped}
       ORDER BY id ASC
       LIMIT $3`,
      [workspaceId, afterId || '', batchSize + 1]
    );
  } catch (error) {
    if (error?.code === '42P01') {
      return {
        rows: [],
        hasMore: false,
        missing: true,
        missingReason: error?.message || `Source table public.${table} does not exist.`,
      };
    }
    throw error;
  }
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return {
    rows: rows.slice(0, batchSize),
    hasMore: rows.length > batchSize,
    missing: false,
    missingReason: '',
  };
}

function emptySourceStats(table) {
  return {
    table,
    rows: 0,
    plannedEvents: 0,
    threadsResolved: 0,
    insertedEvents: 0,
    updatedEvents: 0,
    errors: 0,
    lastCursor: '',
    missing: false,
    missingReason: '',
  };
}

function addTotals(target, source) {
  target.sourceRows += source.rows;
  target.plannedEvents += source.plannedEvents;
  target.threadsResolved += source.threadsResolved;
  target.insertedEvents += source.insertedEvents;
  target.updatedEvents += source.updatedEvents;
  target.errors += source.errors;
}

export async function runConversationBackfill({
  pool,
  apply = false,
  batchSize = DEFAULT_BATCH_SIZE,
  cursor = null,
  workspaceId = 'pbk',
  createStore = createConversationStore,
  ensureSchema = ensureConversationSchema,
  onProgress = () => {},
  maxBatches = Number.POSITIVE_INFINITY,
} = {}) {
  const mode = apply ? 'apply' : 'dry-run';
  if (!pool) {
    return {
      ok: false,
      skipped: true,
      result: 'postgres_unavailable',
      mode,
      complete: false,
      nextCursor: cursor,
    };
  }

  const normalizedBatchSize = boundedBatchSize(batchSize);
  const normalizedCursor =
    typeof cursor === 'string' ? parseCursor(cursor) : cursor;
  const startIndex = normalizedCursor
    ? BACKFILL_ORDER.indexOf(normalizedCursor.table)
    : 0;
  if (startIndex < 0) {
    throw new Error(`Unsupported backfill cursor table: ${normalizedCursor?.table}`);
  }

  if (apply) await ensureSchema(pool);
  const store = createStore(pool);
  const sources = [];
  const failures = [];
  const totals = {
    sourceRows: 0,
    plannedEvents: 0,
    threadsResolved: 0,
    insertedEvents: 0,
    updatedEvents: 0,
    errors: 0,
  };
  let batches = 0;

  for (let tableIndex = startIndex; tableIndex < BACKFILL_ORDER.length; tableIndex += 1) {
    const table = BACKFILL_ORDER[tableIndex];
    const source = emptySourceStats(table);
    let afterId =
      normalizedCursor && normalizedCursor.table === table
        ? normalizedCursor.id
        : '';
    let hasMore = true;

    while (hasMore) {
      if (batches >= maxBatches) {
        addTotals(totals, source);
        sources.push(source);
        return {
          ok: failures.length === 0,
          mode,
          complete: false,
          nextCursor: { table, id: afterId },
          batchSize: normalizedBatchSize,
          batches,
          workspaceId,
          sources,
          totals,
          failures,
        };
      }

      const batch = await readSourceBatch(pool, table, {
        workspaceId,
        afterId,
        batchSize: normalizedBatchSize,
      });
      hasMore = batch.hasMore;
      if (batch.missing) {
        source.missing = true;
        source.missingReason = batch.missingReason;
        break;
      }
      if (!batch.rows.length) break;

      let checkpointId = afterId;
      let batchFailed = false;
      for (const record of batch.rows) {
        source.rows += 1;
        try {
          if (table === 'lead_profiles') {
            if (apply) {
              await store.resolveThread(leadThreadRequest(record, workspaceId));
              source.threadsResolved += 1;
            }
            checkpointId = record.id;
            continue;
          }

          const events = projectSourceRow(table, record);
          source.plannedEvents += events.length;
          if (!apply) {
            checkpointId = record.id;
            continue;
          }

          for (const event of events) {
            const thread = await store.resolveThread(
              eventThreadRequest(event, record, workspaceId)
            );
            source.threadsResolved += 1;
            const persisted = await store.upsertEvent({
              ...event,
              workspaceId,
              threadId: thread.id,
            });
            if (persisted.inserted) source.insertedEvents += 1;
            else source.updatedEvents += 1;
          }
          checkpointId = record.id;
        } catch (error) {
          source.errors += 1;
          failures.push({
            table,
            id: record.id || '',
            error: error?.message || String(error),
          });
          batchFailed = true;
          break;
        }
      }

      batches += 1;
      afterId = checkpointId;
      source.lastCursor = afterId;
      await onProgress({
        mode,
        table,
        cursor: `${table}:${afterId}`,
        rows: batch.rows.length,
        hasMore: hasMore || batchFailed,
      });
      if (batchFailed) {
        addTotals(totals, source);
        sources.push(source);
        return {
          ok: false,
          mode,
          complete: false,
          nextCursor: { table, id: afterId },
          batchSize: normalizedBatchSize,
          batches,
          workspaceId,
          sources,
          totals,
          failures,
        };
      }
    }

    addTotals(totals, source);
    sources.push(source);
  }

  return {
    ok: failures.length === 0,
    mode,
    complete: true,
    nextCursor: null,
    batchSize: normalizedBatchSize,
    batches,
    workspaceId,
    sources,
    totals,
    failures,
  };
}

export async function createBackfillPool(env = process.env) {
  const databaseUrl = String(
    env.PBK_DATABASE_URL || env.DATABASE_URL || ''
  ).trim();
  if (!databaseUrl) return null;
  const pgModule = await import('pg');
  const Pool = pgModule.Pool || pgModule.default?.Pool || pgModule.default;
  if (typeof Pool !== 'function') {
    throw new TypeError('Postgres Pool constructor is unavailable.');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: /(localhost|127\.0\.0\.1)/.test(databaseUrl)
      ? false
      : { rejectUnauthorized: false },
  });
}

export function backfillExitCode(result, { apply = false } = {}) {
  if (result?.ok === true) return 0;
  if (result?.result === 'postgres_unavailable' && !apply) return 0;
  return 1;
}

async function main() {
  const options = parseBackfillArgs(process.argv.slice(2));
  const pool = await createBackfillPool();
  try {
    const result = await runConversationBackfill({
      pool,
      ...options,
      onProgress(progress) {
        console.error(`[pbk-conversations] checkpoint ${progress.cursor}`);
      },
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = backfillExitCode(result, options);
  } finally {
    await pool?.end?.();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
