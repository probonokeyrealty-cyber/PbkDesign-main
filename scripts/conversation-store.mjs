import {
  normalizeConversationEmail,
  normalizeConversationPhone,
} from './conversation-identity.mjs';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const SYNCABLE_SENDER_LIFECYCLES = new Set([
  'active',
  'warming',
  'paused',
  'quarantined',
  'retired',
]);
const TERMINAL_SENDER_LIFECYCLES = new Set(['retired', 'release_pending', 'released']);

function jsonValue(value) {
  return value ?? {};
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function senderLifecycleStatus(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function senderIdentityMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeSenderIdentityMetadata(currentValue, incomingValue) {
  const current = senderIdentityMetadata(currentValue);
  const incoming = senderIdentityMetadata(incomingValue);
  const merged = { ...current, ...incoming };

  for (const historyKey of ['lifecycleHistory', 'lifecycleSyncHistory']) {
    const entries = [
      ...(Array.isArray(current[historyKey]) ? current[historyKey] : []),
      ...(Array.isArray(incoming[historyKey]) ? incoming[historyKey] : []),
    ];
    if (!entries.length) continue;
    const seen = new Set();
    merged[historyKey] = entries
      .filter((entry) => {
        const key = JSON.stringify(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(-50);
  }

  for (const bindingKey of [
    'releaseApprovalId',
    'releaseRequestedAt',
    'releasePreviousLifecycleStatus',
  ]) {
    if (Object.hasOwn(current, bindingKey)) merged[bindingKey] = current[bindingKey];
  }
  return merged;
}

function isOperatorManagedSenderIdentity(identity) {
  const metadata = senderIdentityMetadata(identity?.metadata);
  if (metadata.operatorManaged === true || metadata.operatorManaged === 'true') return true;
  return [
    metadata.lifecycleSource,
    metadata.source,
    metadata.lifecycleReason,
    metadata.reason,
    metadata.managedBy,
  ].some((value) => /^operator(?:$|[\s:_-])/i.test(String(value ?? '').trim()));
}

export function chooseSyncedLifecycle(existing, incoming) {
  const current = senderLifecycleStatus(existing?.lifecycleStatus);
  const next = senderLifecycleStatus(incoming?.lifecycleStatus);
  const safeNext = SYNCABLE_SENDER_LIFECYCLES.has(next) ? next : 'quarantined';

  if (!current) return safeNext;
  if (TERMINAL_SENDER_LIFECYCLES.has(current)) return current;
  if (['paused', 'quarantined'].includes(current) && isOperatorManagedSenderIdentity(existing)) {
    return current;
  }
  if (['paused', 'quarantined'].includes(current) && safeNext === 'active') {
    return current;
  }
  return safeNext;
}

export function mapConversationThreadRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    leadId: row.lead_id,
    status: row.status,
    assignedAgent: row.assigned_agent,
    title: row.title,
    lastEventAt: row.last_event_at,
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    unreadCount: row.unread_count,
    pinned: row.pinned,
    archivedAt: row.archived_at,
    spamReportedAt: row.spam_reported_at,
    mergedIntoThreadId: row.merged_into_thread_id,
    metadata: jsonValue(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapConversationEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    threadId: row.thread_id,
    leadId: row.lead_id,
    eventType: row.event_type,
    channel: row.channel,
    direction: row.direction,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    provider: row.provider,
    senderIdentityId: row.sender_identity_id,
    actorType: row.actor_type,
    actorName: row.actor_name,
    subject: row.subject,
    body: row.body,
    status: row.status,
    occurredAt: row.occurred_at,
    readAt: row.read_at,
    hiddenAt: row.hidden_at,
    spamReportedAt: row.spam_reported_at,
    payload: jsonValue(row.payload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSenderIdentityRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    providerIdentityId: row.provider_identity_id,
    channel: row.channel,
    address: row.address,
    normalizedAddress: row.normalized_address,
    label: row.label,
    region: row.region,
    lifecycleStatus: row.lifecycle_status,
    healthStatus: row.health_status,
    healthScore: numericValue(row.health_score),
    isWorkspaceDefault: row.is_workspace_default,
    inboundGraceUntil: row.inbound_grace_until,
    retiredAt: row.retired_at,
    releasedAt: row.released_at,
    metadata: jsonValue(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSafeSenderIdentityRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    channel: row.channel,
    address: row.address,
    label: row.label,
    region: row.region,
    lifecycleStatus: row.lifecycle_status,
    healthStatus: row.health_status,
    healthScore: numericValue(row.health_score),
    isWorkspaceDefault: row.is_workspace_default,
    inboundGraceUntil: row.inbound_grace_until,
    retiredAt: row.retired_at,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requiredText(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function workspaceId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'pbk';
}

function requiredWorkspaceId(value) {
  return requiredText(value, 'workspaceId');
}

function boundedLimit(value, fallback = DEFAULT_PAGE_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_PAGE_LIMIT);
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function conversationCursorError(message = 'Invalid cursor') {
  return Object.assign(new Error(message), {
    statusCode: 400,
    code: 'INVALID_CONVERSATION_CURSOR',
  });
}

function validateCursorObject(cursor) {
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw conversationCursorError();
  }
  return cursor;
}

function validateCursorId(cursor) {
  if (
    !Object.hasOwn(cursor, 'id') ||
    typeof cursor.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)
  ) {
    throw conversationCursorError('Cursor id must be a UUID-like string');
  }
}

function validateThreadCursor(cursor) {
  validateCursorObject(cursor);
  if (!Object.hasOwn(cursor, 'lastEventAt')) {
    throw conversationCursorError('Thread cursor lastEventAt is required');
  }
  validateCursorId(cursor);
  if (
    cursor.lastEventAt !== null &&
    (typeof cursor.lastEventAt !== 'string' ||
      !cursor.lastEventAt.trim() ||
      !Number.isFinite(Date.parse(cursor.lastEventAt)))
  ) {
    throw conversationCursorError('Thread cursor lastEventAt must be a valid timestamp or null');
  }
  if (Object.hasOwn(cursor, 'occurredAt') || Object.hasOwn(cursor, 'includeHidden')) {
    throw conversationCursorError('Invalid thread cursor shape');
  }
  return cursor;
}

function validateTimelineCursor(cursor) {
  validateCursorObject(cursor);
  for (const field of ['occurredAt', 'id', 'includeHidden']) {
    if (!Object.hasOwn(cursor, field)) {
      throw conversationCursorError(`Timeline cursor ${field} is required`);
    }
  }
  validateCursorId(cursor);
  if (
    typeof cursor.occurredAt !== 'string' ||
    !cursor.occurredAt.trim() ||
    !Number.isFinite(Date.parse(cursor.occurredAt))
  ) {
    throw conversationCursorError('Timeline cursor occurredAt must be a valid timestamp');
  }
  if (typeof cursor.includeHidden !== 'boolean') {
    throw conversationCursorError('Timeline cursor includeHidden must be a boolean');
  }
  if (Object.hasOwn(cursor, 'lastEventAt')) {
    throw conversationCursorError('Invalid timeline cursor shape');
  }
  return cursor;
}

function decodeCursorPayload(value) {
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) throw conversationCursorError();
  try {
    return validateCursorObject(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw conversationCursorError();
  }
}

function decodeThreadCursor(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    return {};
  }
  return validateThreadCursor(decodeCursorPayload(value));
}

function decodeTimelineCursor(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    return validateTimelineCursor(decodeCursorPayload(value));
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw conversationCursorError();
  if (
    Object.hasOwn(value, 'includeHidden') &&
    value.includeHidden !== undefined &&
    typeof value.includeHidden !== 'boolean'
  ) {
    throw conversationCursorError('Timeline includeHidden must be a boolean');
  }
  if (!value.cursor) return value;

  const encoded = validateTimelineCursor(decodeCursorPayload(value.cursor));
  if (
    Object.hasOwn(value, 'includeHidden') &&
    value.includeHidden !== undefined &&
    value.includeHidden !== encoded.includeHidden
  ) {
    throw conversationCursorError(
      'Timeline cursor visibility does not match the requested visibility'
    );
  }
  return {
    ...encoded,
    limit: value.limit ?? encoded.limit,
  };
}

async function withTransaction(pool, callback) {
  if (typeof pool?.connect !== 'function') {
    if (typeof pool?.query !== 'function') throw new Error('A Postgres pool is required');
    return callback(pool);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }
}

function senderIdentityLockKey(workspace, provider, channel, normalizedAddress) {
  return `communication-sender-identity:${workspace}:${provider}:${channel}:${normalizedAddress}`;
}

async function lockSenderIdentity(client, workspace, provider, channel, normalizedAddress) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    senderIdentityLockKey(workspace, provider, channel, normalizedAddress),
  ]);
}

async function selectSenderIdentityById(client, identityId, workspace, { forUpdate = false } = {}) {
  const result = await client.query(
    `
      SELECT *
      FROM public.communication_sender_identities
      WHERE id = $1
        AND workspace_id = $2
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE' : ''}
    `,
    [identityId, workspace]
  );
  return mapSenderIdentityRow(result.rows[0]);
}

async function selectSenderIdentityByAddress(
  client,
  workspace,
  provider,
  channel,
  normalizedAddress
) {
  const result = await client.query(
    `
      SELECT *
      FROM public.communication_sender_identities
      WHERE workspace_id = $1
        AND provider = $2
        AND channel = $3
        AND normalized_address = $4
      LIMIT 1
      FOR UPDATE
    `,
    [workspace, provider, channel, normalizedAddress]
  );
  return mapSenderIdentityRow(result.rows[0]);
}

async function selectLeadThread(client, workspace, leadId) {
  const result = await client.query(
    `
      SELECT *
      FROM public.conversation_threads
      WHERE workspace_id = $1
        AND lead_id = $2
        AND merged_into_thread_id IS NULL
      LIMIT 1
    `,
    [workspace, leadId]
  );
  return result.rows[0] ?? null;
}

async function selectIdentityThreads(client, workspace, phone, email) {
  if (!phone && !email) return [];
  const result = await client.query(
    `
      SELECT matched.*
      FROM (
        SELECT DISTINCT t.*
        FROM public.conversation_thread_identities AS identity
        JOIN public.conversation_threads AS t ON t.id = identity.thread_id
        WHERE identity.workspace_id = $1
          AND (
            ($2 <> '' AND identity.identity_type = 'phone' AND identity.normalized_value = $2)
            OR ($3 <> '' AND identity.identity_type = 'email' AND identity.normalized_value = $3)
          )
          AND t.merged_into_thread_id IS NULL
      ) AS matched
      ORDER BY
        (matched.lead_id IS NOT NULL) DESC,
        matched.last_event_at DESC NULLS LAST,
        matched.id DESC
    `,
    [workspace, phone, email]
  );
  return result.rows;
}

function conversationIdentityLockKey(workspace, type, value) {
  return value ? `conversation-identity:${workspace}:${type}:${value}` : '';
}

function conversationLeadLockKey(workspace, leadId) {
  return leadId ? `conversation-thread:${workspace}:${leadId}` : '';
}

function conversationLockKeys(workspace, { identities = [], leadIds = [] } = {}) {
  return [
    ...identities.map(({ type, value }) => conversationIdentityLockKey(workspace, type, value)),
    ...leadIds.map((leadId) => conversationLeadLockKey(workspace, leadId)),
  ]
    .filter(Boolean)
    .filter((lockKey, index, lockKeys) => lockKeys.indexOf(lockKey) === index)
    .sort();
}

async function lockConversationKeys(client, lockKeys) {
  for (const lockKey of lockKeys) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [lockKey]);
  }
}

async function lockConversationResolution(client, workspace, leadId, phone, email) {
  await lockConversationKeys(
    client,
    conversationLockKeys(workspace, {
      identities: [
        { type: 'phone', value: phone },
        { type: 'email', value: email },
      ],
      leadIds: [leadId],
    })
  );
}

async function lockConversationThreads(client, workspace, threadIds) {
  const ids = [...new Set(threadIds.filter(Boolean))].sort();
  if (!ids.length) return [];
  const result = await client.query(
    `
      SELECT *
      FROM public.conversation_threads
      WHERE id = ANY($1::uuid[])
        AND workspace_id = $2
      ORDER BY id
      FOR UPDATE
    `,
    [ids, workspace]
  );
  if (result.rows.some((row) => row.workspace_id !== workspace)) {
    throw new Error('Conversation thread lock returned a different workspace');
  }
  return result.rows;
}

async function lockCurrentThreadDestinations(client, workspace, threadIds) {
  const requestedIds = [...new Set(threadIds.filter(Boolean))].sort();
  const rowsById = new Map();
  let pendingIds = requestedIds;

  while (pendingIds.length) {
    const lockedRows = await lockConversationThreads(client, workspace, pendingIds);
    for (const row of lockedRows) rowsById.set(row.id, row);
    pendingIds = [
      ...new Set(
        lockedRows.map((row) => row.merged_into_thread_id).filter((id) => id && !rowsById.has(id))
      ),
    ].sort();
  }

  const destinations = new Map();
  for (const requestedId of requestedIds) {
    let row = rowsById.get(requestedId) ?? null;
    const visited = new Set();
    while (row?.merged_into_thread_id) {
      if (visited.has(row.id)) throw new Error('Conversation thread merge cycle detected');
      visited.add(row.id);
      row = rowsById.get(row.merged_into_thread_id) ?? null;
    }
    destinations.set(requestedId, row);
  }
  return destinations;
}

async function selectMergeLockSnapshot(client, workspace, threadIds) {
  const stableIds = [...new Set(threadIds.filter(Boolean))].sort();
  const result = await client.query(
    `
      SELECT
        thread.id,
        thread.workspace_id,
        thread.lead_id,
        identity.identity_type,
        identity.normalized_value
      FROM public.conversation_threads AS thread
      LEFT JOIN public.conversation_thread_identities AS identity
        ON identity.thread_id = thread.id
        AND identity.workspace_id = thread.workspace_id
      WHERE thread.workspace_id = $1
        AND thread.id = ANY($2::uuid[])
      ORDER BY thread.id, identity.identity_type, identity.normalized_value
    `,
    [workspace, stableIds]
  );

  const threads = new Map();
  const identities = [];
  for (const row of result.rows) {
    if (row.workspace_id !== workspace) {
      throw new Error('Conversation threads must belong to the requested workspace');
    }
    if (!threads.has(row.id)) {
      threads.set(row.id, {
        id: row.id,
        workspace_id: row.workspace_id,
        lead_id: row.lead_id,
      });
    }
    if (row.identity_type && row.normalized_value) {
      identities.push({
        type: row.identity_type,
        value: row.normalized_value,
      });
    }
  }
  if (threads.size !== stableIds.length) {
    throw new Error('Both conversation threads must exist in the requested workspace');
  }

  return {
    workspace,
    threads: [...threads.values()],
    identities,
  };
}

async function selectIdentityDestinationThreadIds(client, workspace, identities) {
  if (!identities.length) return [];
  const result = await client.query(
    `
      WITH requested(identity_type, normalized_value) AS (
        SELECT *
        FROM unnest($2::text[], $3::text[])
      )
      SELECT DISTINCT identity.thread_id
      FROM requested
      JOIN public.conversation_thread_identities AS identity
        ON identity.workspace_id = $1
        AND identity.identity_type = requested.identity_type
        AND identity.normalized_value = requested.normalized_value
      ORDER BY identity.thread_id
    `,
    [
      workspace,
      identities.map((identity) => identity.type),
      identities.map((identity) => identity.value),
    ]
  );
  return result.rows.map((row) => row.thread_id);
}

function validateMergeLockSnapshot(snapshot, threads) {
  const snapshotById = new Map(snapshot.threads.map((thread) => [thread.id, thread]));
  for (const thread of threads) {
    if (!thread) continue;
    const previous = snapshotById.get(thread.id);
    if (
      !previous ||
      previous.workspace_id !== thread.workspace_id ||
      previous.lead_id !== thread.lead_id
    ) {
      throw new Error(`Conversation thread ${thread.id} changed after merge lock snapshot`);
    }
  }
}

async function findSourceEvent(client, event, { lock = false } = {}) {
  if (!event.sourceTable || !event.sourceId) return null;
  const result = await client.query(
    `
      SELECT id, thread_id
      FROM public.conversation_events
      WHERE workspace_id = $1
        AND source_table = $2
        AND source_id = $3
        AND event_type = $4
      LIMIT 1
      ${lock ? 'FOR UPDATE' : ''}
    `,
    [event.workspace, event.sourceTable, event.sourceId, event.eventType]
  );
  return result.rows[0] ?? null;
}

async function lockEventThreads(client, threadIds, workspace, requiredThreadId) {
  const ids = [...new Set(threadIds.filter(Boolean))].sort();
  const result = await client.query(
    `
      SELECT id, merged_into_thread_id
      FROM public.conversation_threads
      WHERE id = ANY($1::uuid[])
        AND workspace_id = $2
      ORDER BY id
      FOR UPDATE
    `,
    [ids, workspace]
  );
  const requiredThread = result.rows.find((row) => row.id === requiredThreadId);
  if (!requiredThread || requiredThread.merged_into_thread_id) {
    throw new Error('Conversation thread is missing or already merged');
  }
  return ids;
}

async function recomputeThreadAggregates(client, threadIds, workspace) {
  const ids = [...new Set(threadIds.filter(Boolean))].sort();
  if (!ids.length) return [];
  const result = await client.query(
    `
      WITH target_threads AS (
        SELECT thread.id AS thread_id
        FROM public.conversation_threads AS thread
        WHERE thread.workspace_id = $2
          AND thread.id = ANY($1::uuid[])
      ),
      aggregates AS (
        SELECT
          target.thread_id,
          MAX(event.occurred_at) FILTER (
            WHERE event.hidden_at IS NULL
          ) AS last_event_at,
          MAX(event.occurred_at) FILTER (
            WHERE event.direction = 'inbound'
              AND event.hidden_at IS NULL
          ) AS last_inbound_at,
          MAX(event.occurred_at) FILTER (
            WHERE event.direction = 'outbound'
              AND event.hidden_at IS NULL
          ) AS last_outbound_at,
          COUNT(event.id) FILTER (
            WHERE event.direction = 'inbound'
              AND event.read_at IS NULL
              AND event.hidden_at IS NULL
          )::integer AS unread_count
        FROM target_threads AS target
        LEFT JOIN public.conversation_events AS event
          ON event.thread_id = target.thread_id
          AND event.workspace_id = $2
        GROUP BY target.thread_id
      )
      UPDATE public.conversation_threads AS thread
      SET
        last_event_at = aggregates.last_event_at,
        last_inbound_at = aggregates.last_inbound_at,
        last_outbound_at = aggregates.last_outbound_at,
        unread_count = aggregates.unread_count,
        updated_at = NOW()
      FROM aggregates
      WHERE thread.id = aggregates.thread_id
        AND thread.workspace_id = $2
      RETURNING thread.*
    `,
    [ids, workspace]
  );
  return result.rows;
}

function mergeActorFields(actor) {
  if (typeof actor === 'string') {
    return { actorType: 'user', actorName: actor };
  }
  if (actor && typeof actor === 'object' && !Array.isArray(actor)) {
    return {
      actorType: typeof actor.type === 'string' && actor.type.trim() ? actor.type.trim() : 'user',
      actorName:
        (typeof actor.name === 'string' && actor.name.trim()) ||
        (typeof actor.id === 'string' && actor.id.trim()) ||
        '',
    };
  }
  return { actorType: 'system', actorName: '' };
}

function validateThreadMerge(canonical, merged) {
  if (!canonical || !merged) throw new Error('Both conversation threads must exist');
  if (canonical.id === merged.id) {
    throw new Error('Canonical and merged thread IDs must be different');
  }
  if (canonical.workspace_id !== merged.workspace_id) {
    throw new Error('Conversation threads must belong to the same workspace');
  }
  if (canonical.merged_into_thread_id) {
    throw new Error(
      `Thread ${canonical.id} is already merged into ${canonical.merged_into_thread_id} and cannot be canonical`
    );
  }
  if (merged.merged_into_thread_id) {
    throw new Error(
      `Thread ${merged.id} is already merged into ${merged.merged_into_thread_id} and cannot be merged`
    );
  }
  if (!canonical.lead_id && merged.lead_id) {
    throw new Error(`Lead-bound thread ${merged.id} must be canonical`);
  }
  if (canonical.lead_id && merged.lead_id && canonical.lead_id !== merged.lead_id) {
    throw new Error('Conversation threads belong to different leads');
  }
}

async function mergeConversationThreadRows(client, canonical, merged, actor) {
  validateThreadMerge(canonical, merged);
  const canonicalId = canonical.id;
  const mergedId = merged.id;
  const workspace = canonical.workspace_id;

  await client.query(
    `
      DELETE FROM public.conversation_events AS duplicate
      USING public.conversation_events AS kept
      WHERE duplicate.thread_id = $1
        AND kept.thread_id = $2
        AND duplicate.workspace_id = $3
        AND kept.workspace_id = $3
        AND duplicate.workspace_id = kept.workspace_id
        AND duplicate.source_table <> ''
        AND duplicate.source_id <> ''
        AND duplicate.source_table = kept.source_table
        AND duplicate.source_id = kept.source_id
        AND duplicate.event_type = kept.event_type
    `,
    [mergedId, canonicalId, workspace]
  );
  await client.query(
    `
      UPDATE public.conversation_events
      SET
        thread_id = $2,
        lead_id = COALESCE($3, lead_id),
        updated_at = NOW()
      WHERE thread_id = $1
        AND workspace_id = $4
    `,
    [mergedId, canonicalId, canonical.lead_id ?? null, workspace]
  );
  await client.query(
    `
      DELETE FROM public.conversation_thread_identities AS duplicate
      USING public.conversation_thread_identities AS kept
      WHERE duplicate.thread_id = $1
        AND kept.thread_id = $2
        AND duplicate.workspace_id = $3
        AND kept.workspace_id = $3
        AND duplicate.workspace_id = kept.workspace_id
        AND duplicate.identity_type = kept.identity_type
        AND duplicate.normalized_value = kept.normalized_value
    `,
    [mergedId, canonicalId, workspace]
  );
  await client.query(
    `
      UPDATE public.conversation_thread_identities
      SET
        thread_id = $2,
        lead_id = COALESCE($3, lead_id),
        updated_at = NOW()
      WHERE thread_id = $1
        AND workspace_id = $4
    `,
    [mergedId, canonicalId, canonical.lead_id ?? null, workspace]
  );

  const mergedAt = new Date().toISOString();
  const mergeMetadata = JSON.stringify({
    mergedThreadId: mergedId,
    actor: actor ?? null,
    mergedAt,
  });
  await client.query(
    `
      UPDATE public.conversation_threads AS canonical
      SET
        metadata = COALESCE(canonical.metadata, '{}'::jsonb)
          || jsonb_build_object('lastMerge', $2::jsonb),
        updated_at = NOW()
      WHERE canonical.id = $1
        AND canonical.workspace_id = $3
      RETURNING canonical.*
    `,
    [canonicalId, mergeMetadata, workspace]
  );
  await client.query(
    `
      UPDATE public.conversation_threads
      SET
        merged_into_thread_id = $2,
        archived_at = COALESCE(archived_at, NOW()),
        unread_count = 0,
        updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $3
    `,
    [mergedId, canonicalId, workspace]
  );

  const { actorType, actorName } = mergeActorFields(actor);
  const auditPayload = JSON.stringify({
    canonicalThreadId: canonicalId,
    mergedThreadId: mergedId,
    actor: actor ?? null,
  });
  await client.query(
    `
      INSERT INTO public.conversation_events (
        workspace_id,
        thread_id,
        lead_id,
        event_type,
        channel,
        direction,
        source_table,
        source_id,
        actor_type,
        actor_name,
        body,
        status,
        occurred_at,
        payload
      )
      VALUES (
        $1, $2, $3, 'thread.merged', 'system', 'internal',
        'conversation_threads', $4, $5, $6, $7, 'completed', $8, $9::jsonb
      )
      ON CONFLICT (workspace_id, source_table, source_id, event_type)
      WHERE source_table <> '' AND source_id <> ''
      DO UPDATE SET
        thread_id = EXCLUDED.thread_id,
        lead_id = EXCLUDED.lead_id,
        actor_type = EXCLUDED.actor_type,
        actor_name = EXCLUDED.actor_name,
        body = EXCLUDED.body,
        status = EXCLUDED.status,
        occurred_at = EXCLUDED.occurred_at,
        payload = EXCLUDED.payload,
        updated_at = NOW()
    `,
    [
      canonical.workspace_id,
      canonicalId,
      canonical.lead_id ?? null,
      mergedId,
      actorType,
      actorName,
      `Merged conversation thread ${mergedId} into ${canonicalId}`,
      mergedAt,
      auditPayload,
    ]
  );

  const aggregateRows = await recomputeThreadAggregates(client, [canonicalId], workspace);
  return aggregateRows[0] ?? canonical;
}

async function insertLeadThread(client, input) {
  const result = await client.query(
    `
      INSERT INTO public.conversation_threads (
        workspace_id,
        lead_id,
        title,
        metadata
      )
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (workspace_id, lead_id)
        WHERE lead_id IS NOT NULL AND merged_into_thread_id IS NULL
      DO UPDATE SET updated_at = NOW()
      RETURNING *
    `,
    [input.workspace, input.leadId, input.title, JSON.stringify(input.metadata ?? {})]
  );
  return result.rows[0];
}

async function insertProvisionalThread(client, input) {
  const result = await client.query(
    `
      INSERT INTO public.conversation_threads (
        workspace_id,
        title,
        metadata
      )
      VALUES ($1, $2, $3::jsonb)
      RETURNING *
    `,
    [input.workspace, input.title, JSON.stringify(input.metadata ?? {})]
  );
  return result.rows[0];
}

async function attachLeadToProvisionalThread(client, threadId, workspace, leadId) {
  const result = await client.query(
    `
      UPDATE public.conversation_threads
      SET lead_id = $3, updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $2
        AND lead_id IS NULL
        AND merged_into_thread_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.conversation_threads AS competing
          WHERE competing.workspace_id = $2
            AND competing.lead_id = $3
            AND competing.merged_into_thread_id IS NULL
        )
      RETURNING *
    `,
    [threadId, workspace, leadId]
  );
  return result.rows[0] ?? null;
}

async function upsertThreadIdentity(client, identity) {
  await client.query(
    `
      INSERT INTO public.conversation_thread_identities (
        workspace_id,
        thread_id,
        lead_id,
        identity_type,
        normalized_value,
        display_value,
        is_primary,
        source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (workspace_id, identity_type, normalized_value, thread_id)
      DO UPDATE SET
        lead_id = COALESCE(EXCLUDED.lead_id, public.conversation_thread_identities.lead_id),
        display_value = EXCLUDED.display_value,
        is_primary = EXCLUDED.is_primary,
        source = EXCLUDED.source,
        updated_at = NOW()
    `,
    [
      identity.workspace,
      identity.threadId,
      identity.leadId,
      identity.type,
      identity.normalizedValue,
      identity.displayValue,
      identity.isPrimary,
      identity.source,
    ]
  );
}

export function createConversationStore(pool) {
  async function resolveThread(input = {}) {
    const workspace = workspaceId(input.workspaceId);
    const leadId =
      typeof input.leadId === 'string' && input.leadId.trim() ? input.leadId.trim() : null;
    const phone = normalizeConversationPhone(input.phone);
    const email = normalizeConversationEmail(input.email);
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const source =
      typeof input.source === 'string' && input.source.trim() ? input.source.trim() : 'bridge';

    return withTransaction(pool, async (client) => {
      await lockConversationResolution(client, workspace, leadId, phone, email);

      const leadCandidate = leadId ? await selectLeadThread(client, workspace, leadId) : null;
      const identityCandidates = await selectIdentityThreads(client, workspace, phone, email);
      const candidateDestinations = await lockCurrentThreadDestinations(client, workspace, [
        leadCandidate?.id,
        ...identityCandidates.map((candidate) => candidate.id),
      ]);
      const identityThreadsById = new Map();
      for (const candidate of identityCandidates) {
        const destination = candidateDestinations.get(candidate.id);
        if (!destination) {
          throw new Error(
            `Conversation identity thread ${candidate.id} has no canonical destination`
          );
        }
        identityThreadsById.set(destination.id, destination);
      }
      const activeIdentityThreads = [...identityThreadsById.values()];
      let thread = leadCandidate ? (candidateDestinations.get(leadCandidate.id) ?? null) : null;

      if (leadId) {
        if (thread?.lead_id && thread.lead_id !== leadId) {
          throw new Error(
            `Conversation lead thread resolves to a different lead on thread ${thread.id}`
          );
        }
        const conflictingThread = activeIdentityThreads.find(
          (candidate) => candidate.lead_id && candidate.lead_id !== leadId
        );
        if (conflictingThread) {
          throw new Error(
            `Conversation identity belongs to a different lead on thread ${conflictingThread.id}`
          );
        }

        if (!thread) {
          thread = activeIdentityThreads.find((candidate) => candidate.lead_id === leadId) ?? null;
        }
        if (!thread) {
          const provisional = activeIdentityThreads.find((candidate) => !candidate.lead_id);
          if (provisional) {
            thread = await attachLeadToProvisionalThread(client, provisional.id, workspace, leadId);
          }
        }
        if (!thread) {
          thread = await insertLeadThread(client, {
            workspace,
            leadId,
            title,
            metadata: input.metadata,
          });
        }
      } else {
        thread = activeIdentityThreads[0] ?? null;
        const conflictingThread = activeIdentityThreads.find(
          (candidate) =>
            thread?.lead_id && candidate.lead_id && candidate.lead_id !== thread.lead_id
        );
        if (conflictingThread) {
          throw new Error(
            `Conversation identity belongs to different leads on threads ${thread.id} and ${conflictingThread.id}`
          );
        }
        if (!thread) {
          thread = await insertProvisionalThread(client, {
            workspace,
            title,
            metadata: input.metadata,
          });
        }
      }

      for (const identityThread of activeIdentityThreads) {
        if (identityThread.id === thread.id) continue;
        thread = await mergeConversationThreadRows(client, thread, identityThread, {
          type: 'system',
          name: 'conversation-resolver',
        });
      }

      if (!thread) throw new Error('Unable to resolve conversation thread');

      const identities = [
        phone
          ? {
              type: 'phone',
              normalizedValue: phone,
              displayValue: typeof input.phone === 'string' ? input.phone.trim() : '',
            }
          : null,
        email
          ? {
              type: 'email',
              normalizedValue: email,
              displayValue: typeof input.email === 'string' ? input.email.trim() : '',
            }
          : null,
      ].filter(Boolean);

      for (const identity of identities) {
        await upsertThreadIdentity(client, {
          ...identity,
          workspace,
          threadId: thread.id,
          leadId: thread.lead_id ?? leadId,
          isPrimary: true,
          source,
        });
      }

      return mapConversationThreadRow(thread);
    });
  }

  async function listThreads(filters = {}) {
    const params = [workspaceId(filters.workspaceId)];
    const conditions = ['t.workspace_id = $1', 't.merged_into_thread_id IS NULL'];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (typeof filters.status === 'string' && filters.status.trim()) {
      conditions.push(`t.status = ${addParam(filters.status.trim())}`);
    }
    if (typeof filters.assignedAgent === 'string' && filters.assignedAgent.trim()) {
      conditions.push(`t.assigned_agent = ${addParam(filters.assignedAgent.trim())}`);
    }
    if (typeof filters.channel === 'string' && filters.channel.trim()) {
      const channelParam = addParam(filters.channel.trim());
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM public.conversation_events AS channel_event
          WHERE channel_event.thread_id = t.id
            AND channel_event.channel = ${channelParam}
        )
      `);
    }
    if (typeof filters.search === 'string' && filters.search.trim()) {
      const searchParam = addParam(filters.search.trim());
      conditions.push(`
        (
          t.title ILIKE '%' || ${searchParam} || '%'
          OR t.assigned_agent ILIKE '%' || ${searchParam} || '%'
          OR COALESCE(t.lead_id, '') ILIKE '%' || ${searchParam} || '%'
          OR EXISTS (
            SELECT 1
            FROM public.conversation_thread_identities AS search_identity
            WHERE search_identity.thread_id = t.id
              AND (
                search_identity.normalized_value ILIKE '%' || ${searchParam} || '%'
                OR search_identity.display_value ILIKE '%' || ${searchParam} || '%'
              )
          )
        )
      `);
    }
    if (typeof filters.unread === 'boolean') {
      conditions.push(filters.unread ? 't.unread_count > 0' : 't.unread_count = 0');
    }
    if (typeof filters.pinned === 'boolean') {
      conditions.push(`t.pinned = ${addParam(filters.pinned)}`);
    }
    if (typeof filters.archived === 'boolean') {
      conditions.push(filters.archived ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL');
    }

    const cursor = decodeThreadCursor(filters.cursor);
    if (cursor.lastEventAt && cursor.id) {
      conditions.push(
        `(
          (t.last_event_at, t.id) < (
            ${addParam(cursor.lastEventAt)}::timestamptz,
            ${addParam(cursor.id)}::uuid
          )
          OR t.last_event_at IS NULL
        )`
      );
    } else if (cursor.lastEventAt === null && cursor.id) {
      conditions.push(`t.last_event_at IS NULL AND t.id < ${addParam(cursor.id)}::uuid`);
    }

    const limit = boundedLimit(filters.limit);
    params.push(limit + 1);
    const result = await pool.query(
      `
        SELECT t.*
        FROM public.conversation_threads AS t
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY t.last_event_at DESC NULLS LAST, t.id DESC
        LIMIT $${params.length}
      `,
      params
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const items = rows.map(mapConversationThreadRow);
    const lastItem = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && lastItem
          ? encodeCursor({ lastEventAt: lastItem.lastEventAt ?? null, id: lastItem.id })
          : null,
    };
  }

  async function getThread(threadId, options = { workspaceId: 'pbk' }) {
    const id = requiredText(threadId, 'threadId');
    const workspace = workspaceId(options?.workspaceId);
    const result = await pool.query(
      `
        SELECT *
        FROM public.conversation_threads
        WHERE id = $1
          AND workspace_id = $2
          AND merged_into_thread_id IS NULL
        LIMIT 1
      `,
      [id, workspace]
    );
    return mapConversationThreadRow(result.rows[0]);
  }

  async function listTimeline(threadId, options = {}) {
    const id = requiredText(threadId, 'threadId');
    const workspace = requiredWorkspaceId(options?.workspaceId);
    const cursor = decodeTimelineCursor(options);
    const includeHidden = Boolean(cursor.includeHidden);
    const params = [id, workspace];
    const conditions = [
      'event.thread_id = $1',
      'thread.workspace_id = $2',
      'thread.merged_into_thread_id IS NULL',
    ];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (!includeHidden) conditions.push('event.hidden_at IS NULL');
    if (cursor.occurredAt && cursor.id) {
      conditions.push(
        `(event.occurred_at, event.id) < (${addParam(cursor.occurredAt)}::timestamptz, ${addParam(
          cursor.id
        )}::uuid)`
      );
    }
    const limit = boundedLimit(cursor.limit);
    params.push(limit + 1);
    const result = await pool.query(
      `
        SELECT event.*
        FROM public.conversation_events AS event
        JOIN public.conversation_threads AS thread
          ON thread.id = event.thread_id
          AND thread.workspace_id = event.workspace_id
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT $${params.length}
      `,
      params
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const items = rows.map(mapConversationEventRow);
    const lastItem = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && lastItem
          ? encodeCursor({
              occurredAt: lastItem.occurredAt,
              id: lastItem.id,
              includeHidden,
            })
          : null,
    };
  }

  async function getThreadContactIdentities(
    threadId,
    options = { workspaceId: 'pbk' }
  ) {
    const id = requiredText(threadId, 'threadId');
    const workspace = requiredWorkspaceId(options?.workspaceId);
    const result = await pool.query(
      `
        SELECT identity.identity_type, identity.normalized_value, identity.display_value
        FROM public.conversation_thread_identities AS identity
        JOIN public.conversation_threads AS thread
          ON thread.id = identity.thread_id
          AND thread.workspace_id = identity.workspace_id
        WHERE identity.thread_id = $1
          AND thread.workspace_id = $2
          AND thread.merged_into_thread_id IS NULL
          AND identity.identity_type IN ('phone', 'email')
        ORDER BY
          CASE identity.identity_type WHEN 'phone' THEN 0 ELSE 1 END,
          identity.created_at,
          identity.normalized_value
      `,
      [id, workspace]
    );
    const contacts = { phone: '', email: '' };
    for (const row of result.rows) {
      if (row.identity_type === 'phone' && !contacts.phone) {
        contacts.phone = normalizeConversationPhone(row.normalized_value || row.display_value || '');
      }
      if (row.identity_type === 'email' && !contacts.email) {
        contacts.email = normalizeConversationEmail(row.normalized_value || row.display_value || '');
      }
    }
    return contacts;
  }

  async function getPreviousSuccessfulSenderIdentityId(
    threadId,
    channel,
    options = { workspaceId: 'pbk' }
  ) {
    const id = requiredText(threadId, 'threadId');
    const workspace = requiredWorkspaceId(options?.workspaceId);
    const normalizedChannel = requiredText(channel, 'channel').toLowerCase();
    if (!['sms', 'email'].includes(normalizedChannel)) {
      throw new Error('channel must be sms or email');
    }
    const result = await pool.query(
      `
        SELECT event.sender_identity_id
        FROM public.conversation_events AS event
        JOIN public.conversation_threads AS thread
          ON thread.id = event.thread_id
          AND thread.workspace_id = event.workspace_id
        WHERE event.thread_id = $1
          AND thread.workspace_id = $2
          AND thread.merged_into_thread_id IS NULL
          AND event.channel = $3
          AND event.direction = 'outbound'
          AND event.sender_identity_id IS NOT NULL
          AND event.hidden_at IS NULL
          AND LOWER(event.status) IN (
            'accepted',
            'completed',
            'delivered',
            'provider_managed',
            'sent'
          )
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT 1
      `,
      [id, workspace, normalizedChannel]
    );
    return result.rows[0]?.sender_identity_id || '';
  }

  async function upsertEvent(event = {}) {
    const threadId = requiredText(event.threadId, 'threadId');
    const eventType = requiredText(event.eventType, 'eventType');
    const workspace = workspaceId(event.workspaceId);
    const occurredAt = event.occurredAt ?? new Date().toISOString();
    const sourceTable = event.sourceTable ?? '';
    const sourceId = event.sourceId ?? '';
    const direction =
      typeof event.direction === 'string' && event.direction.trim()
        ? event.direction.trim()
        : 'internal';

    return withTransaction(pool, async (client) => {
      const sourceKeyed = Boolean(sourceTable && sourceId);
      if (sourceKeyed) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `conversation-event:${workspace}:${sourceTable}:${sourceId}:${eventType}`,
        ]);
      }

      const eventIdentity = {
        workspace,
        sourceTable,
        sourceId,
        eventType,
      };
      const previousEvent = await findSourceEvent(client, eventIdentity);
      const lockedThreadIds = await lockEventThreads(
        client,
        [threadId, previousEvent?.thread_id],
        workspace,
        threadId
      );
      const lockedEvent = await findSourceEvent(client, eventIdentity, { lock: true });
      if (lockedEvent && !lockedThreadIds.includes(lockedEvent.thread_id)) {
        throw new Error('Conversation event moved during lock acquisition; retry the operation');
      }

      const result = await client.query(
        `
          INSERT INTO public.conversation_events (
            workspace_id,
            thread_id,
            lead_id,
            event_type,
            channel,
            direction,
            source_table,
            source_id,
            provider,
            sender_identity_id,
            actor_type,
            actor_name,
            subject,
            body,
            status,
            occurred_at,
            read_at,
            hidden_at,
            spam_reported_at,
            payload
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb
          )
          ON CONFLICT (workspace_id, source_table, source_id, event_type)
          WHERE source_table <> '' AND source_id <> ''
          DO UPDATE SET
            thread_id = EXCLUDED.thread_id,
            lead_id = EXCLUDED.lead_id,
            sender_identity_id = EXCLUDED.sender_identity_id,
            subject = EXCLUDED.subject,
            body = EXCLUDED.body,
            status = EXCLUDED.status,
            occurred_at = EXCLUDED.occurred_at,
            payload = EXCLUDED.payload,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted, public.conversation_events.*
        `,
        [
          workspace,
          threadId,
          event.leadId ?? null,
          eventType,
          event.channel ?? 'system',
          direction,
          sourceTable,
          sourceId,
          event.provider ?? '',
          event.senderIdentityId ?? null,
          event.actorType ?? 'system',
          event.actorName ?? '',
          event.subject ?? '',
          event.body ?? '',
          event.status ?? '',
          occurredAt,
          event.readAt ?? null,
          event.hiddenAt ?? null,
          event.spamReportedAt ?? null,
          JSON.stringify(event.payload ?? {}),
        ]
      );
      const row = result.rows[0];
      if (!row) throw new Error('Unable to persist conversation event');
      const inserted = row.inserted === true || row.inserted === 't';

      await recomputeThreadAggregates(
        client,
        [previousEvent?.thread_id, lockedEvent?.thread_id, row.thread_id],
        workspace
      );

      return { ...mapConversationEventRow(row), inserted };
    });
  }

  async function getEvent(eventId, options = { workspaceId: 'pbk' }) {
    const id = requiredText(eventId, 'eventId');
    const workspace = requiredWorkspaceId(options?.workspaceId);
    const result = await pool.query(
      `
        SELECT event.*
        FROM public.conversation_events AS event
        JOIN public.conversation_threads AS thread
          ON thread.id = event.thread_id
          AND thread.workspace_id = event.workspace_id
        WHERE event.id = $1
          AND thread.workspace_id = $2
          AND thread.merged_into_thread_id IS NULL
        LIMIT 1
      `,
      [id, workspace]
    );
    return mapConversationEventRow(result.rows[0]);
  }

  async function patchEvent(
    eventId,
    patch = {},
    options = { workspaceId: 'pbk' }
  ) {
    const id = requiredText(eventId, 'eventId');
    const workspace = requiredWorkspaceId(options?.workspaceId);
    const allowedFields = new Set(['hiddenAt', 'readAt', 'spamReportedAt', 'payload']);
    const unknownFields = Object.keys(patch).filter((property) => !allowedFields.has(property));
    if (unknownFields.length) {
      throw new Error(`Unknown event patch fields: ${unknownFields.join(', ')}`);
    }
    if (
      Object.hasOwn(patch, 'payload') &&
      (!patch.payload ||
        typeof patch.payload !== 'object' ||
        Array.isArray(patch.payload) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(patch.payload)))
    ) {
      throw new Error('Event payload patch must be a plain object');
    }
    const includedFields = [...allowedFields].filter(
      (property) => Object.hasOwn(patch, property) && patch[property] !== undefined
    );
    if (!includedFields.length) throw new Error('No editable event fields provided');

    return withTransaction(pool, async (client) => {
      const currentResult = await client.query(
        `
          SELECT event.*
          FROM public.conversation_events AS event
          JOIN public.conversation_threads AS thread
            ON thread.id = event.thread_id
            AND thread.workspace_id = event.workspace_id
          WHERE event.id = $1
            AND thread.workspace_id = $2
            AND thread.merged_into_thread_id IS NULL
          LIMIT 1
          FOR UPDATE OF event, thread
        `,
        [id, workspace]
      );
      const current = currentResult.rows[0];
      if (!current) return null;

      const nextPayload = Object.hasOwn(patch, 'payload')
        ? {
            ...jsonValue(current.payload),
            ...jsonValue(patch.payload),
          }
        : jsonValue(current.payload);
      const hiddenAt = Object.hasOwn(patch, 'hiddenAt') ? patch.hiddenAt : current.hidden_at;
      const readAt = Object.hasOwn(patch, 'readAt') ? patch.readAt : current.read_at;
      const spamReportedAt = Object.hasOwn(patch, 'spamReportedAt')
        ? patch.spamReportedAt
        : current.spam_reported_at;
      const result = await client.query(
        `
          UPDATE public.conversation_events
          SET hidden_at = $3,
              read_at = $4,
              payload = $5::jsonb,
              spam_reported_at = $6,
              updated_at = NOW()
          WHERE id = $1
            AND workspace_id = $2
          RETURNING *
        `,
        [id, workspace, hiddenAt, readAt, JSON.stringify(nextPayload), spamReportedAt]
      );
      const row = result.rows[0];
      if (!row) return null;
      if (
        Object.hasOwn(patch, 'hiddenAt') ||
        Object.hasOwn(patch, 'readAt')
      ) {
        await recomputeThreadAggregates(client, [row.thread_id], workspace);
      }
      return mapConversationEventRow(row);
    });
  }

  async function reportEventSpam(
    eventId,
    { workspaceId: workspaceInput, reportedAt = new Date().toISOString() } = {}
  ) {
    const id = requiredText(eventId, 'eventId');
    const workspace = requiredWorkspaceId(workspaceInput);
    return withTransaction(pool, async (client) => {
      const currentResult = await client.query(
        `
          SELECT event.*
          FROM public.conversation_events AS event
          JOIN public.conversation_threads AS thread
            ON thread.id = event.thread_id
            AND thread.workspace_id = event.workspace_id
          WHERE event.id = $1
            AND thread.workspace_id = $2
            AND thread.merged_into_thread_id IS NULL
          LIMIT 1
          FOR UPDATE OF event, thread
        `,
        [id, workspace]
      );
      const current = currentResult.rows[0];
      if (!current) return null;
      const eventResult = await client.query(
        `
          UPDATE public.conversation_events
          SET spam_reported_at = $3,
              updated_at = NOW()
          WHERE id = $1
            AND workspace_id = $2
          RETURNING *
        `,
        [id, workspace, reportedAt]
      );
      const threadResult = await client.query(
        `
          UPDATE public.conversation_threads
          SET spam_reported_at = $3,
              updated_at = NOW()
          WHERE id = $1
            AND workspace_id = $2
            AND merged_into_thread_id IS NULL
          RETURNING *
        `,
        [current.thread_id, workspace, reportedAt]
      );
      return {
        event: mapConversationEventRow(eventResult.rows[0]),
        thread: mapConversationThreadRow(threadResult.rows[0]),
      };
    });
  }

  async function patchThread(threadId, patch = {}, options = { workspaceId: 'pbk' }) {
    const id = requiredText(threadId, 'threadId');
    const workspace = workspaceId(options?.workspaceId);
    const fields = [
      ['status', 'status'],
      ['assignedAgent', 'assigned_agent'],
      ['title', 'title'],
      ['unreadCount', 'unread_count'],
      ['pinned', 'pinned'],
      ['archivedAt', 'archived_at'],
      ['spamReportedAt', 'spam_reported_at'],
      ['metadata', 'metadata'],
    ];
    const allowedFields = new Set(fields.map(([property]) => property));
    const unknownFields = Object.keys(patch).filter((property) => !allowedFields.has(property));
    if (unknownFields.length) {
      throw new Error(`Unknown thread patch fields: ${unknownFields.join(', ')}`);
    }
    const params = [id, workspace];
    const assignments = [];
    for (const [property, column] of fields) {
      if (!Object.hasOwn(patch, property) || patch[property] === undefined) continue;
      const value =
        property === 'metadata' ? JSON.stringify(patch[property] ?? {}) : patch[property];
      params.push(value);
      assignments.push(`${column} = $${params.length}${property === 'metadata' ? '::jsonb' : ''}`);
    }
    if (!assignments.length) throw new Error('No editable thread fields provided');
    const result = await pool.query(
      `
        UPDATE public.conversation_threads
        SET ${assignments.join(', ')}, updated_at = NOW()
        WHERE id = $1
          AND workspace_id = $2
          AND merged_into_thread_id IS NULL
        RETURNING *
      `,
      params
    );
    return mapConversationThreadRow(result.rows[0]);
  }

  async function mergeThreads({
    workspaceId: workspaceInput,
    canonicalThreadId,
    mergedThreadId,
    actor,
  } = {}) {
    const workspace = requiredWorkspaceId(workspaceInput);
    const canonicalId = requiredText(canonicalThreadId, 'canonicalThreadId');
    const mergedId = requiredText(mergedThreadId, 'mergedThreadId');
    if (canonicalId === mergedId)
      throw new Error('Canonical and merged thread IDs must be different');

    return withTransaction(pool, async (client) => {
      const snapshot = await selectMergeLockSnapshot(client, workspace, [canonicalId, mergedId]);
      await lockConversationKeys(
        client,
        conversationLockKeys(snapshot.workspace, {
          identities: snapshot.identities,
          leadIds: snapshot.threads.map((thread) => thread.lead_id),
        })
      );
      const identityDestinationIds = await selectIdentityDestinationThreadIds(
        client,
        snapshot.workspace,
        snapshot.identities
      );
      const locked = await lockConversationThreads(client, workspace, [
        canonicalId,
        mergedId,
        ...identityDestinationIds,
      ]);
      const canonical = locked.find((row) => row.id === canonicalId);
      const merged = locked.find((row) => row.id === mergedId);
      validateMergeLockSnapshot(snapshot, [canonical, merged]);
      const result = await mergeConversationThreadRows(client, canonical, merged, actor);
      return mapConversationThreadRow(result);
    });
  }

  async function listSenderIdentities(filters = {}) {
    const params = [workspaceId(filters.workspaceId)];
    const conditions = ['workspace_id = $1'];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    for (const [property, column] of [
      ['provider', 'provider'],
      ['channel', 'channel'],
      ['lifecycleStatus', 'lifecycle_status'],
      ['healthStatus', 'health_status'],
    ]) {
      if (typeof filters[property] === 'string' && filters[property].trim()) {
        conditions.push(`${column} = ${addParam(filters[property].trim())}`);
      }
    }
    if (typeof filters.search === 'string' && filters.search.trim()) {
      const searchParam = addParam(filters.search.trim());
      conditions.push(`
        (
          address ILIKE '%' || ${searchParam} || '%'
          OR normalized_address ILIKE '%' || ${searchParam} || '%'
          OR label ILIKE '%' || ${searchParam} || '%'
        )
      `);
    }
    params.push(boundedLimit(filters.limit, MAX_PAGE_LIMIT));
    const result = await pool.query(
      `
        SELECT
          id,
          provider,
          channel,
          address,
          label,
          region,
          lifecycle_status,
          health_status,
          health_score,
          is_workspace_default,
          inbound_grace_until,
          retired_at,
          released_at,
          created_at,
          updated_at
        FROM public.communication_sender_identities
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY is_workspace_default DESC, health_score DESC NULLS LAST, id
        LIMIT $${params.length}
      `,
      params
    );
    return result.rows.map(mapSafeSenderIdentityRow);
  }

  async function getSenderIdentity(identityId, options = { workspaceId: 'pbk' }) {
    const id = requiredText(identityId, 'identityId');
    const workspace = requiredWorkspaceId(options.workspaceId);
    const result = await pool.query(
      `
        SELECT *
        FROM public.communication_sender_identities
        WHERE id = $1
          AND workspace_id = $2
        LIMIT 1
      `,
      [id, workspace]
    );
    return mapSenderIdentityRow(result.rows[0]);
  }

  async function getSenderIdentitySummary({ workspaceId: workspaceInput } = {}) {
    const workspace = requiredWorkspaceId(workspaceInput);
    const aggregateResult = await pool.query(
      `
        WITH
          channel_counts AS (
            SELECT channel, COUNT(*)::integer AS count
            FROM public.communication_sender_identities
            WHERE workspace_id = $1
            GROUP BY channel
          ),
          provider_counts AS (
            SELECT provider, COUNT(*)::integer AS count
            FROM public.communication_sender_identities
            WHERE workspace_id = $1
            GROUP BY provider
          ),
          lifecycle_counts AS (
            SELECT lifecycle_status, COUNT(*)::integer AS count
            FROM public.communication_sender_identities
            WHERE workspace_id = $1
            GROUP BY lifecycle_status
          )
        SELECT
          (
            SELECT COUNT(*)::integer
            FROM public.communication_sender_identities
            WHERE workspace_id = $1
          ) AS total,
          COALESCE(
            (SELECT jsonb_object_agg(channel, count) FROM channel_counts),
            '{}'::jsonb
          ) AS by_channel,
          COALESCE(
            (SELECT jsonb_object_agg(provider, count) FROM provider_counts),
            '{}'::jsonb
          ) AS by_provider,
          COALESCE(
            (SELECT jsonb_object_agg(lifecycle_status, count) FROM lifecycle_counts),
            '{}'::jsonb
          ) AS by_lifecycle
      `,
      [workspace]
    );
    const itemResult = await pool.query(
      `
        SELECT
          id,
          channel,
          provider,
          address,
          label,
          lifecycle_status,
          health_status,
          is_workspace_default
        FROM public.communication_sender_identities
        WHERE workspace_id = $1
          AND (
            lifecycle_status = 'active'
            OR is_workspace_default = TRUE
          )
        ORDER BY is_workspace_default DESC, provider, channel, address, id
      `,
      [workspace]
    );
    const counts = aggregateResult.rows[0] ?? {};
    return {
      counts: {
        total: Number(counts.total || 0),
        byChannel: jsonValue(counts.by_channel),
        byProvider: jsonValue(counts.by_provider),
        byLifecycle: jsonValue(counts.by_lifecycle),
      },
      items: itemResult.rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        provider: row.provider,
        address: row.address,
        label: row.label,
        lifecycleStatus: row.lifecycle_status,
        healthStatus: row.health_status,
        isWorkspaceDefault: row.is_workspace_default,
      })),
      itemsTruncated: false,
    };
  }

  async function upsertSenderIdentityWithClient(client, identity = {}) {
    const workspace = workspaceId(identity.workspaceId);
    const provider = requiredText(identity.provider, 'provider');
    const channel = requiredText(identity.channel, 'channel');
    const address = requiredText(identity.address, 'address');
    const normalizedAddress =
      (typeof identity.normalizedAddress === 'string' && identity.normalizedAddress.trim()) ||
      (channel === 'email'
        ? normalizeConversationEmail(address)
        : normalizeConversationPhone(address));
    if (!normalizedAddress) throw new Error('A valid sender address is required');

    const optionalFields = [
      'providerIdentityId',
      'label',
      'region',
      'lifecycleStatus',
      'healthStatus',
      'healthScore',
      'isWorkspaceDefault',
      'inboundGraceUntil',
      'retiredAt',
      'releasedAt',
      'metadata',
    ];
    const provided = optionalFields.map(
      (property) => Object.hasOwn(identity, property) && identity[property] !== undefined
    );

    const result = await client.query(
      `
        INSERT INTO public.communication_sender_identities AS existing (
          workspace_id,
          provider,
          provider_identity_id,
          channel,
          address,
          normalized_address,
          label,
          region,
          lifecycle_status,
          health_status,
          health_score,
          is_workspace_default,
          inbound_grace_until,
          retired_at,
          released_at,
          metadata
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16::jsonb
        )
        ON CONFLICT (workspace_id, provider, channel, normalized_address)
        DO UPDATE SET
          provider_identity_id = CASE
            WHEN $17::boolean THEN EXCLUDED.provider_identity_id
            ELSE existing.provider_identity_id
          END,
          address = EXCLUDED.address,
          label = CASE
            WHEN $18::boolean THEN EXCLUDED.label
            ELSE existing.label
          END,
          region = CASE
            WHEN $19::boolean THEN EXCLUDED.region
            ELSE existing.region
          END,
          lifecycle_status = CASE WHEN $20::boolean THEN EXCLUDED.lifecycle_status
            ELSE existing.lifecycle_status
          END,
          health_status = CASE
            WHEN $21::boolean THEN EXCLUDED.health_status
            ELSE existing.health_status
          END,
          health_score = CASE
            WHEN $22::boolean THEN EXCLUDED.health_score
            ELSE existing.health_score
          END,
          is_workspace_default = CASE
            WHEN $23::boolean THEN EXCLUDED.is_workspace_default
            ELSE existing.is_workspace_default
          END,
          inbound_grace_until = CASE
            WHEN $24::boolean THEN EXCLUDED.inbound_grace_until
            ELSE existing.inbound_grace_until
          END,
          retired_at = CASE
            WHEN $25::boolean THEN EXCLUDED.retired_at
            ELSE existing.retired_at
          END,
          released_at = CASE
            WHEN $26::boolean THEN EXCLUDED.released_at
            ELSE existing.released_at
          END,
          metadata = CASE WHEN $27::boolean THEN EXCLUDED.metadata
            ELSE existing.metadata
          END,
          updated_at = NOW()
        RETURNING *
      `,
      [
        workspace,
        provider,
        identity.providerIdentityId ?? '',
        channel,
        address,
        normalizedAddress,
        identity.label ?? '',
        identity.region ?? '',
        identity.lifecycleStatus ?? 'active',
        identity.healthStatus ?? 'unknown',
        identity.healthScore ?? null,
        identity.isWorkspaceDefault ?? false,
        identity.inboundGraceUntil ?? null,
        identity.retiredAt ?? null,
        identity.releasedAt ?? null,
        JSON.stringify(identity.metadata ?? {}),
        ...provided,
      ]
    );
    return mapSenderIdentityRow(result.rows[0]);
  }

  async function upsertSenderIdentity(identity = {}) {
    return upsertSenderIdentityWithClient(pool, identity);
  }

  async function syncSenderIdentity(identity = {}) {
    const workspace = workspaceId(identity.workspaceId);
    const provider = requiredText(identity.provider, 'provider');
    const channel = requiredText(identity.channel, 'channel');
    const address = requiredText(identity.address, 'address');
    const normalizedAddress =
      (typeof identity.normalizedAddress === 'string' && identity.normalizedAddress.trim()) ||
      (channel === 'email'
        ? normalizeConversationEmail(address)
        : normalizeConversationPhone(address));
    if (!normalizedAddress) throw new Error('A valid sender address is required');

    return withTransaction(pool, async (client) => {
      await lockSenderIdentity(client, workspace, provider, channel, normalizedAddress);
      const existing = await selectSenderIdentityByAddress(
        client,
        workspace,
        provider,
        channel,
        normalizedAddress
      );
      const lifecycleStatus = chooseSyncedLifecycle(existing, identity);
      const existingMetadata = senderIdentityMetadata(existing?.metadata);
      const incomingMetadata = senderIdentityMetadata(identity.metadata);
      const lifecycleSyncHistory = Array.isArray(existingMetadata.lifecycleSyncHistory)
        ? existingMetadata.lifecycleSyncHistory.slice(-49)
        : [];
      lifecycleSyncHistory.push({
        previousLifecycleStatus: existing?.lifecycleStatus || '',
        incomingLifecycleStatus: senderLifecycleStatus(identity.lifecycleStatus),
        chosenLifecycleStatus: lifecycleStatus,
        syncedAt: new Date().toISOString(),
      });
      return upsertSenderIdentityWithClient(client, {
        ...identity,
        workspaceId: workspace,
        provider,
        channel,
        address,
        normalizedAddress,
        lifecycleStatus,
        metadata: {
          ...existingMetadata,
          ...incomingMetadata,
          lifecycleSyncHistory,
        },
      });
    });
  }

  async function patchSenderIdentity(identityId, patch = {}, options = { workspaceId: 'pbk' }) {
    const id = requiredText(identityId, 'identityId');
    const workspace = requiredWorkspaceId(options.workspaceId);
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(patch))
    ) {
      throw new Error('Sender identity patch must be a plain object');
    }
    const fields = [
      ['label', 'label'],
      ['region', 'region'],
      ['lifecycleStatus', 'lifecycle_status'],
      ['healthStatus', 'health_status'],
      ['healthScore', 'health_score'],
      ['isWorkspaceDefault', 'is_workspace_default'],
      ['inboundGraceUntil', 'inbound_grace_until'],
      ['retiredAt', 'retired_at'],
      ['releasedAt', 'released_at'],
      ['metadata', 'metadata'],
    ];
    const allowedFields = new Set(fields.map(([property]) => property));
    const unknownFields = Object.keys(patch).filter((property) => !allowedFields.has(property));
    if (unknownFields.length) {
      throw new Error(`Unknown sender identity patch fields: ${unknownFields.join(', ')}`);
    }
    const providedFields = fields.filter(
      ([property]) => Object.hasOwn(patch, property) && patch[property] !== undefined
    );
    if (!providedFields.length) throw new Error('No editable sender identity fields provided');
    return withTransaction(pool, async (client) => {
      const initial = await selectSenderIdentityById(client, id, workspace);
      if (!initial) return null;
      await lockSenderIdentity(
        client,
        workspace,
        initial.provider,
        initial.channel,
        initial.normalizedAddress
      );
      const current = await selectSenderIdentityById(client, id, workspace, {
        forUpdate: true,
      });
      if (!current) return null;
      if (
        Object.hasOwn(patch, 'lifecycleStatus') &&
        patch.lifecycleStatus !== current.lifecycleStatus &&
        ['release_pending', 'released'].includes(current.lifecycleStatus)
      ) {
        throw Object.assign(
          new Error(
            `Communication identity in ${current.lifecycleStatus} cannot be changed by lifecycle PATCH.`
          ),
          { statusCode: 409 }
        );
      }

      const transactionParams = [id, workspace];
      const transactionAssignments = [];
      for (const [property, column] of providedFields) {
        const value =
          property === 'metadata'
            ? JSON.stringify(mergeSenderIdentityMetadata(current.metadata, patch.metadata))
            : patch[property];
        transactionParams.push(value);
        transactionAssignments.push(
          `${column} = $${transactionParams.length}${property === 'metadata' ? '::jsonb' : ''}`
        );
      }
      const result = await client.query(
        `
          UPDATE public.communication_sender_identities
          SET ${transactionAssignments.join(', ')}, updated_at = NOW()
          WHERE id = $1
            AND workspace_id = $2
          RETURNING *
        `,
        transactionParams
      );
      return mapSenderIdentityRow(result.rows[0]);
    });
  }

  async function reserveSenderIdentityRelease(
    identityId,
    { workspaceId: workspaceInput, approvalId: approvalInput, reason = '', changedAt } = {}
  ) {
    const id = requiredText(identityId, 'identityId');
    const workspace = requiredWorkspaceId(workspaceInput);
    const approvalId = requiredText(approvalInput, 'approvalId');
    const requestedAt = changedAt || new Date().toISOString();

    return withTransaction(pool, async (client) => {
      const initial = await selectSenderIdentityById(client, id, workspace);
      if (!initial) {
        return { identity: null, existingApprovalId: '', reserved: false };
      }
      await lockSenderIdentity(
        client,
        workspace,
        initial.provider,
        initial.channel,
        initial.normalizedAddress
      );
      const current = await selectSenderIdentityById(client, id, workspace, {
        forUpdate: true,
      });
      if (!current) {
        return { identity: null, existingApprovalId: '', reserved: false };
      }

      const currentMetadata = senderIdentityMetadata(current.metadata);
      const existingApprovalId = String(currentMetadata.releaseApprovalId || '').trim();
      if (current.lifecycleStatus === 'release_pending' && existingApprovalId) {
        return {
          identity: current,
          existingApprovalId,
          reserved: false,
        };
      }
      if (!['retired', 'quarantined', 'paused'].includes(current.lifecycleStatus)) {
        throw Object.assign(
          new Error(
            `Communication identity in ${current.lifecycleStatus} cannot request provider release.`
          ),
          { statusCode: 409 }
        );
      }

      const lifecycleHistory = Array.isArray(currentMetadata.lifecycleHistory)
        ? currentMetadata.lifecycleHistory.slice(-49)
        : [];
      lifecycleHistory.push({
        from: current.lifecycleStatus,
        to: 'release_pending',
        reason: reason || '',
        source: 'operator',
        at: requestedAt,
      });
      const metadata = {
        ...currentMetadata,
        operatorManaged: true,
        lifecycleSource: 'operator',
        lifecycleHistory,
        lifecycleChangedAt: requestedAt,
        releaseApprovalId: approvalId,
        releaseRequestedAt: requestedAt,
        releasePreviousLifecycleStatus: current.lifecycleStatus,
        ...(reason ? { lifecycleReason: reason } : {}),
      };
      const result = await client.query(
        `
          UPDATE public.communication_sender_identities
          SET lifecycle_status = $3,
              metadata = $4::jsonb,
              updated_at = NOW()
          WHERE id = $1
            AND workspace_id = $2
          RETURNING *
        `,
        [id, workspace, 'release_pending', JSON.stringify(metadata)]
      );
      return {
        identity: mapSenderIdentityRow(result.rows[0]),
        existingApprovalId: '',
        reserved: true,
      };
    });
  }

  async function cancelSenderIdentityReleaseReservation(
    identityId,
    { workspaceId: workspaceInput, approvalId: approvalInput, changedAt } = {}
  ) {
    const id = requiredText(identityId, 'identityId');
    const workspace = requiredWorkspaceId(workspaceInput);
    const approvalId = requiredText(approvalInput, 'approvalId');
    const canceledAt = changedAt || new Date().toISOString();

    return withTransaction(pool, async (client) => {
      const initial = await selectSenderIdentityById(client, id, workspace);
      if (!initial) return { identity: null, canceled: false };
      await lockSenderIdentity(
        client,
        workspace,
        initial.provider,
        initial.channel,
        initial.normalizedAddress
      );
      const current = await selectSenderIdentityById(client, id, workspace, {
        forUpdate: true,
      });
      if (!current) return { identity: null, canceled: false };

      const currentMetadata = senderIdentityMetadata(current.metadata);
      if (
        current.lifecycleStatus !== 'release_pending' ||
        currentMetadata.releaseApprovalId !== approvalId
      ) {
        return { identity: current, canceled: false };
      }

      const previousLifecycleStatus = ['retired', 'quarantined', 'paused'].includes(
        currentMetadata.releasePreviousLifecycleStatus
      )
        ? currentMetadata.releasePreviousLifecycleStatus
        : 'quarantined';
      const metadata = { ...currentMetadata };
      delete metadata.releaseApprovalId;
      delete metadata.releaseRequestedAt;
      delete metadata.releasePreviousLifecycleStatus;
      const lifecycleHistory = Array.isArray(metadata.lifecycleHistory)
        ? metadata.lifecycleHistory.slice(-49)
        : [];
      lifecycleHistory.push({
        from: 'release_pending',
        to: previousLifecycleStatus,
        reason: 'approval_creation_failed',
        source: 'system',
        at: canceledAt,
      });
      metadata.lifecycleHistory = lifecycleHistory;
      metadata.lifecycleChangedAt = canceledAt;

      const result = await client.query(
        `
          UPDATE public.communication_sender_identities
          SET lifecycle_status = $3,
              metadata = $4::jsonb,
              updated_at = NOW()
          WHERE id = $1
            AND workspace_id = $2
          RETURNING *
        `,
        [id, workspace, previousLifecycleStatus, JSON.stringify(metadata)]
      );
      return {
        identity: mapSenderIdentityRow(result.rows[0]),
        canceled: true,
      };
    });
  }

  return {
    resolveThread,
    listThreads,
    getThread,
    listTimeline,
    getThreadContactIdentities,
    getPreviousSuccessfulSenderIdentityId,
    upsertEvent,
    getEvent,
    patchEvent,
    reportEventSpam,
    patchThread,
    mergeThreads,
    listSenderIdentities,
    getSenderIdentity,
    getSenderIdentitySummary,
    upsertSenderIdentity,
    syncSenderIdentity,
    patchSenderIdentity,
    reserveSenderIdentityRelease,
    cancelSenderIdentityReleaseReservation,
  };
}
