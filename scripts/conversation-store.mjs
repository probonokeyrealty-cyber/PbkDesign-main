import {
  normalizeConversationEmail,
  normalizeConversationPhone,
} from './conversation-identity.mjs';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

function jsonValue(value) {
  return value ?? {};
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function requiredText(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function workspaceId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'pbk';
}

function boundedLimit(value, fallback = DEFAULT_PAGE_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_PAGE_LIMIT);
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new Error('Invalid cursor');
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      throw new Error('Invalid cursor');
    }
    return cursor;
  } catch {
    throw new Error('Invalid cursor');
  }
}

function decodeTimelineCursor(value) {
  if (!value) return {};
  if (typeof value === 'string') return decodeCursor(value);
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cursor');
  if (!value.cursor) return value;

  const encoded = decodeCursor(value.cursor);
  if (
    Object.hasOwn(value, 'includeHidden') &&
    Boolean(value.includeHidden) !== Boolean(encoded.includeHidden)
  ) {
    throw new Error('Timeline cursor visibility does not match the requested visibility');
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

async function selectLeadThread(client, workspace, leadId) {
  const result = await client.query(
    `
      SELECT *
      FROM public.conversation_threads
      WHERE workspace_id = $1
        AND lead_id = $2
        AND merged_into_thread_id IS NULL
      LIMIT 1
      FOR UPDATE
    `,
    [workspace, leadId]
  );
  return result.rows[0] ?? null;
}

async function selectIdentityThread(client, workspace, phone, email) {
  if (!phone && !email) return null;
  const result = await client.query(
    `
      SELECT t.*
      FROM public.conversation_thread_identities AS identity
      JOIN public.conversation_threads AS t ON t.id = identity.thread_id
      WHERE identity.workspace_id = $1
        AND (
          ($2 <> '' AND identity.identity_type = 'phone' AND identity.normalized_value = $2)
          OR ($3 <> '' AND identity.identity_type = 'email' AND identity.normalized_value = $3)
        )
        AND t.merged_into_thread_id IS NULL
      ORDER BY
        (t.lead_id IS NOT NULL) DESC,
        t.last_event_at DESC NULLS LAST,
        t.id DESC
      LIMIT 1
      FOR UPDATE OF t
    `,
    [workspace, phone, email]
  );
  return result.rows[0] ?? null;
}

async function lockLeadResolution(client, workspace, leadId) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `conversation-thread:${workspace}:${leadId}`,
  ]);
}

async function lockIdentityResolution(client, workspace, phone, email) {
  const lockKeys = [
    email ? `conversation-identity:${workspace}:email:${email}` : '',
    phone ? `conversation-identity:${workspace}:phone:${phone}` : '',
  ]
    .filter(Boolean)
    .sort();

  for (const lockKey of lockKeys) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [lockKey]);
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

async function recomputeThreadAggregates(client, threadIds) {
  const ids = [...new Set(threadIds.filter(Boolean))].sort();
  if (!ids.length) return [];
  const result = await client.query(
    `
      WITH target_threads AS (
        SELECT DISTINCT unnest($1::uuid[]) AS thread_id
      ),
      aggregates AS (
        SELECT
          target.thread_id,
          MAX(event.occurred_at) AS last_event_at,
          MAX(event.occurred_at) FILTER (
            WHERE event.direction = 'inbound'
          ) AS last_inbound_at,
          MAX(event.occurred_at) FILTER (
            WHERE event.direction = 'outbound'
          ) AS last_outbound_at,
          COUNT(event.id) FILTER (
            WHERE event.direction = 'inbound'
              AND event.read_at IS NULL
              AND event.hidden_at IS NULL
          )::integer AS unread_count
        FROM target_threads AS target
        LEFT JOIN public.conversation_events AS event
          ON event.thread_id = target.thread_id
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
      RETURNING thread.*
    `,
    [ids]
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
      let thread = leadId ? await selectLeadThread(client, workspace, leadId) : null;

      if (!thread && (phone || email)) {
        await lockIdentityResolution(client, workspace, phone, email);
        thread = await selectIdentityThread(client, workspace, phone, email);
      }

      if (leadId && (!thread || thread.lead_id !== leadId)) {
        await lockLeadResolution(client, workspace, leadId);
        const canonical = await selectLeadThread(client, workspace, leadId);
        if (canonical) {
          thread = canonical;
        } else if (thread && !thread.lead_id) {
          thread = await attachLeadToProvisionalThread(client, thread.id, workspace, leadId);
          if (!thread) {
            thread =
              (await selectLeadThread(client, workspace, leadId)) ??
              (await insertLeadThread(client, {
                workspace,
                leadId,
                title,
                metadata: input.metadata,
              }));
          }
        } else {
          thread = await insertLeadThread(client, {
            workspace,
            leadId,
            title,
            metadata: input.metadata,
          });
        }
      }

      if (!thread) {
        thread = await insertProvisionalThread(client, {
          workspace,
          title,
          metadata: input.metadata,
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

    const cursor = decodeCursor(filters.cursor);
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

  async function getThread(threadId) {
    const id = requiredText(threadId, 'threadId');
    const result = await pool.query(
      `
        SELECT *
        FROM public.conversation_threads
        WHERE id = $1
          AND merged_into_thread_id IS NULL
        LIMIT 1
      `,
      [id]
    );
    return mapConversationThreadRow(result.rows[0]);
  }

  async function listTimeline(threadId, cursorInput) {
    const id = requiredText(threadId, 'threadId');
    const cursor = decodeTimelineCursor(cursorInput);
    const includeHidden = Boolean(cursor.includeHidden);
    const params = [id];
    const conditions = ['thread_id = $1'];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (!includeHidden) conditions.push('hidden_at IS NULL');
    if (cursor.occurredAt && cursor.id) {
      conditions.push(
        `(occurred_at, id) < (${addParam(cursor.occurredAt)}::timestamptz, ${addParam(
          cursor.id
        )}::uuid)`
      );
    }
    const limit = boundedLimit(cursor.limit);
    params.push(limit + 1);
    const result = await pool.query(
      `
        SELECT *
        FROM public.conversation_events
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY occurred_at DESC, id DESC
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

      await recomputeThreadAggregates(client, [
        previousEvent?.thread_id,
        lockedEvent?.thread_id,
        row.thread_id,
      ]);

      return { ...mapConversationEventRow(row), inserted };
    });
  }

  async function patchThread(threadId, patch = {}) {
    const id = requiredText(threadId, 'threadId');
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
    const params = [id];
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
          AND merged_into_thread_id IS NULL
        RETURNING *
      `,
      params
    );
    return mapConversationThreadRow(result.rows[0]);
  }

  async function mergeThreads({ canonicalThreadId, mergedThreadId, actor } = {}) {
    const canonicalId = requiredText(canonicalThreadId, 'canonicalThreadId');
    const mergedId = requiredText(mergedThreadId, 'mergedThreadId');
    if (canonicalId === mergedId)
      throw new Error('Canonical and merged thread IDs must be different');

    return withTransaction(pool, async (client) => {
      const stableIds = [canonicalId, mergedId].sort();
      const locked = await client.query(
        `
          SELECT *
          FROM public.conversation_threads
          WHERE id = ANY($1::uuid[])
          ORDER BY id
          FOR UPDATE
        `,
        [stableIds]
      );
      const canonical = locked.rows.find((row) => row.id === canonicalId);
      const merged = locked.rows.find((row) => row.id === mergedId);
      if (!canonical || !merged) throw new Error('Both conversation threads must exist');
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

      await client.query(
        `
          DELETE FROM public.conversation_events AS duplicate
          USING public.conversation_events AS kept
          WHERE duplicate.thread_id = $1
            AND kept.thread_id = $2
            AND duplicate.workspace_id = kept.workspace_id
            AND duplicate.source_table <> ''
            AND duplicate.source_id <> ''
            AND duplicate.source_table = kept.source_table
            AND duplicate.source_id = kept.source_id
            AND duplicate.event_type = kept.event_type
        `,
        [mergedId, canonicalId]
      );
      await client.query(
        `
          UPDATE public.conversation_events
          SET
            thread_id = $2,
            lead_id = COALESCE($3, lead_id),
            updated_at = NOW()
          WHERE thread_id = $1
        `,
        [mergedId, canonicalId, canonical.lead_id ?? null]
      );
      await client.query(
        `
          DELETE FROM public.conversation_thread_identities AS duplicate
          USING public.conversation_thread_identities AS kept
          WHERE duplicate.thread_id = $1
            AND kept.thread_id = $2
            AND duplicate.workspace_id = kept.workspace_id
            AND duplicate.identity_type = kept.identity_type
            AND duplicate.normalized_value = kept.normalized_value
        `,
        [mergedId, canonicalId]
      );
      await client.query(
        `
          UPDATE public.conversation_thread_identities
          SET
            thread_id = $2,
            lead_id = COALESCE($3, lead_id),
            updated_at = NOW()
          WHERE thread_id = $1
        `,
        [mergedId, canonicalId, canonical.lead_id ?? null]
      );

      const mergeMetadata = JSON.stringify({
        mergedThreadId: mergedId,
        actor: actor ?? null,
        mergedAt: new Date().toISOString(),
      });
      await client.query(
        `
          UPDATE public.conversation_threads AS canonical
          SET
            metadata = COALESCE(canonical.metadata, '{}'::jsonb)
              || jsonb_build_object('lastMerge', $2::jsonb),
            updated_at = NOW()
          WHERE canonical.id = $1
          RETURNING canonical.*
        `,
        [canonicalId, mergeMetadata]
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
        `,
        [mergedId, canonicalId]
      );

      const mergedAt = JSON.parse(mergeMetadata).mergedAt;
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

      const aggregateRows = await recomputeThreadAggregates(client, [canonicalId]);
      return mapConversationThreadRow(aggregateRows[0]);
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
        SELECT *
        FROM public.communication_sender_identities
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY is_workspace_default DESC, health_score DESC NULLS LAST, id
        LIMIT $${params.length}
      `,
      params
    );
    return result.rows.map(mapSenderIdentityRow);
  }

  async function upsertSenderIdentity(identity = {}) {
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

    const result = await pool.query(
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

  async function patchSenderIdentity(identityId, patch = {}) {
    const id = requiredText(identityId, 'identityId');
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
    const params = [id];
    const assignments = [];
    for (const [property, column] of fields) {
      if (!Object.hasOwn(patch, property) || patch[property] === undefined) continue;
      const value =
        property === 'metadata' ? JSON.stringify(patch[property] ?? {}) : patch[property];
      params.push(value);
      assignments.push(`${column} = $${params.length}${property === 'metadata' ? '::jsonb' : ''}`);
    }
    if (!assignments.length) throw new Error('No editable sender identity fields provided');
    const result = await pool.query(
      `
        UPDATE public.communication_sender_identities
        SET ${assignments.join(', ')}, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      params
    );
    return mapSenderIdentityRow(result.rows[0]);
  }

  return {
    resolveThread,
    listThreads,
    getThread,
    listTimeline,
    upsertEvent,
    patchThread,
    mergeThreads,
    listSenderIdentities,
    upsertSenderIdentity,
    patchSenderIdentity,
  };
}
