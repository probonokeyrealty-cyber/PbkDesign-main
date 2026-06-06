# Unified Conversation and Lead Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a bridge-backed unified seller conversation workspace and durable lead portal while preserving the existing Inbox and Approvals lobby.

**Architecture:** Add an additive Postgres conversation model behind the Render bridge, normalize existing SMS, email, call, DocuSign, approval, and note records into idempotent conversation events, and expose focused REST endpoints through `runtimeBridge.ts`. Keep `/inbox` as the triage lobby, add `/inbox/conversations` as the three-region workspace, and add `/leads/:leadId` as the canonical seller portal. All provider writes continue through existing approval and provider handlers.

**Tech Stack:** React 18, React Router 7, TypeScript, Vite, Tailwind/PBK CSS, Lucide, Node.js 22, Express-style bridge routing, PostgreSQL/Supabase, Jest Node tests, BrowserOS verification.

---

## Delivery Slices

1. **Conversation foundation:** schema, normalization, thread resolution, event store, backfill.
2. **Bridge contract:** thread/timeline/sender APIs, provider identity lifecycle, webhook projection.
3. **Unified Inbox:** triage lobby command, thread rail, timeline, sender-aware composer, mobile flow.
4. **Lead portal:** durable route, complete seller context, unified timeline, call/document integration.
5. **Release:** source map, migration verification, browser fidelity, Render and Netlify rollout.

Each slice must be green before the next slice begins.

## File Structure

### Database and bridge

- Create via Supabase CLI: `supabase/migrations/*_pbk_unified_conversations.sql`
  - Add `conversation_threads`, `conversation_thread_identities`, `conversation_events`, and `communication_sender_identities`.
- Create: `scripts/conversation-schema.mjs`
  - Export the self-ensure SQL and `ensureConversationSchema(pool)`.
- Create: `scripts/conversation-identity.mjs`
  - Normalize phone/email values, choose canonical thread identity, and evaluate sender eligibility.
- Create: `scripts/conversation-store.mjs`
  - Own all SQL reads/writes for threads, events, merges, sender identities, and pagination.
- Create: `scripts/conversation-projector.mjs`
  - Convert existing message/call/contract/approval/activity records into normalized conversation events.
- Create: `scripts/backfill-conversations.mjs`
  - Dry-run and apply the additive backfill.
- Modify: `scripts/openclaw-local-server.mjs`
  - Call schema self-ensure, add conversation routes, project webhook/provider results, and preserve approval gates.

### Frontend

- Modify: `src/app/utils/runtimeBridge.ts`
  - Add conversation, event, and sender identity types and endpoint helpers.
- Create: `src/app/routes/conversationRuntimeLogic.js`
  - Pure view-model helpers for thread ordering, event grouping, sender eligibility, and mobile route state.
- Create: `src/app/routes/conversationRuntimeLogic.d.ts`
  - Type declarations for the pure runtime helpers.
- Create: `src/app/components/inbox/InboxSignalLanes.tsx`
  - Shared icon-led Approvals, Unread, and Scheduled lanes.
- Create: `src/app/components/inbox/ConversationThreadRail.tsx`
- Create: `src/app/components/inbox/ConversationTimeline.tsx`
- Create: `src/app/components/inbox/ConversationComposer.tsx`
- Create: `src/app/components/inbox/SenderIdentitySelect.tsx`
- Create: `src/app/components/inbox/LeadContextInspector.tsx`
- Create: `src/app/components/inbox/LiveCallPip.tsx`
- Create: `src/app/routes/UnifiedInbox.tsx`
- Create: `src/app/routes/LeadPortal.tsx`
- Modify: `src/app/routes/Inbox.tsx`
  - Reuse signal lanes and add `Open Unified Inbox`.
- Modify: `src/app/routes/Leads.tsx`
  - Keep roster/create flow and navigate canonical lead selections to `/leads/:leadId`.
- Modify: `src/app/shell/router.tsx`
  - Add new routes.
- Modify: `src/app/shell/ShellTopbar.tsx`
  - Point lead/message search results at canonical routes.
- Modify: `src/styles/pbk-components.css`
  - Add the accepted workspace, rounded message, sender selector, lead portal, and mobile styles.
- Modify: `src/styles/index.css`
  - Add complete light-theme overrides for new surfaces.

### Tests and documentation

- Create: `scripts/conversation-identity.test.mjs`
- Create: `scripts/conversation-store.test.mjs`
- Create: `scripts/conversation-projector.test.mjs`
- Create: `scripts/conversation-runtime-logic.test.mjs`
- Create: `scripts/unified-conversation-bridge-smoke.mjs`
- Create: `scripts/unified-inbox-ui-smoke.mjs`
- Create: `scripts/lead-portal-route-smoke.mjs`
- Modify: `package.json`
- Modify: `docs/modern-shell-bridge-data-map.md`

## Task 1: Create the Additive Conversation Schema

**Files:**

- Create via CLI: `supabase/migrations/*_pbk_unified_conversations.sql`
- Create: `scripts/conversation-schema.mjs`
- Test: `scripts/conversation-store.test.mjs`

- [ ] **Step 1: Write the failing schema contract test**

```js
import { describe, expect, test } from '@jest/globals';
import { CONVERSATION_SCHEMA_SQL } from './conversation-schema.mjs';

describe('conversation schema', () => {
  test('defines bridge-only conversation tables with RLS and indexes', () => {
    for (const table of [
      'conversation_threads',
      'conversation_thread_identities',
      'conversation_events',
      'communication_sender_identities',
    ]) {
      expect(CONVERSATION_SCHEMA_SQL).toContain(`public.${table}`);
      expect(CONVERSATION_SCHEMA_SQL).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      );
    }
    expect(CONVERSATION_SCHEMA_SQL).toContain('conversation_threads_workspace_lead_uidx');
    expect(CONVERSATION_SCHEMA_SQL).toContain('conversation_events_source_uidx');
    expect(CONVERSATION_SCHEMA_SQL).toContain('conversation_events_thread_occurred_idx');
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-store.test.mjs
```

Expected: FAIL because `scripts/conversation-schema.mjs` does not exist.

- [ ] **Step 3: Generate the migration with the Supabase CLI**

Run:

```powershell
npx --yes supabase@latest migration new pbk_unified_conversations
```

Expected: one new `supabase/migrations/<timestamp>_pbk_unified_conversations.sql` file.

- [ ] **Step 4: Implement the schema SQL once and mirror it into the migration**

`scripts/conversation-schema.mjs` must export:

```js
export const CONVERSATION_SCHEMA_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS public.conversation_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open',
    assigned_agent TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    last_event_at TIMESTAMPTZ,
    last_inbound_at TIMESTAMPTZ,
    last_outbound_at TIMESTAMPTZ,
    unread_count INTEGER NOT NULL DEFAULT 0,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    spam_reported_at TIMESTAMPTZ,
    merged_into_thread_id UUID REFERENCES public.conversation_threads(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.conversation_thread_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    thread_id UUID NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
    lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
    identity_type TEXT NOT NULL CHECK (identity_type IN ('phone', 'email')),
    normalized_value TEXT NOT NULL,
    display_value TEXT NOT NULL DEFAULT '',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    source TEXT NOT NULL DEFAULT 'bridge',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.communication_sender_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    provider TEXT NOT NULL,
    provider_identity_id TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'call')),
    address TEXT NOT NULL,
    normalized_address TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    lifecycle_status TEXT NOT NULL DEFAULT 'active'
      CHECK (lifecycle_status IN (
        'active', 'warming', 'paused', 'quarantined',
        'retired', 'release_pending', 'released'
      )),
    health_status TEXT NOT NULL DEFAULT 'unknown',
    health_score NUMERIC,
    is_workspace_default BOOLEAN NOT NULL DEFAULT FALSE,
    inbound_grace_until TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.conversation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    thread_id UUID NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
    lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'system',
    direction TEXT NOT NULL DEFAULT 'internal',
    source_table TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    sender_identity_id UUID REFERENCES public.communication_sender_identities(id)
      ON DELETE SET NULL,
    actor_type TEXT NOT NULL DEFAULT 'system',
    actor_name TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    hidden_at TIMESTAMPTZ,
    spam_reported_at TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS conversation_threads_workspace_lead_uidx
    ON public.conversation_threads (workspace_id, lead_id)
    WHERE lead_id IS NOT NULL AND merged_into_thread_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS conversation_thread_identity_uidx
    ON public.conversation_thread_identities
      (workspace_id, identity_type, normalized_value, thread_id);
  CREATE UNIQUE INDEX IF NOT EXISTS sender_identity_provider_address_uidx
    ON public.communication_sender_identities
      (workspace_id, provider, channel, normalized_address);
  CREATE UNIQUE INDEX IF NOT EXISTS conversation_events_source_uidx
    ON public.conversation_events (workspace_id, source_table, source_id, event_type)
    WHERE source_table <> '' AND source_id <> '';
  CREATE INDEX IF NOT EXISTS conversation_events_thread_occurred_idx
    ON public.conversation_events (thread_id, occurred_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS conversation_threads_activity_idx
    ON public.conversation_threads (workspace_id, archived_at, last_event_at DESC);
  CREATE INDEX IF NOT EXISTS conversation_identity_lookup_idx
    ON public.conversation_thread_identities
      (workspace_id, identity_type, normalized_value);

  ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.conversation_thread_identities ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.conversation_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.communication_sender_identities ENABLE ROW LEVEL SECURITY;

  REVOKE ALL ON public.conversation_threads FROM anon, authenticated;
  REVOKE ALL ON public.conversation_thread_identities FROM anon, authenticated;
  REVOKE ALL ON public.conversation_events FROM anon, authenticated;
  REVOKE ALL ON public.communication_sender_identities FROM anon, authenticated;
`;

export async function ensureConversationSchema(pool) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable' };
  await pool.query(CONVERSATION_SCHEMA_SQL);
  return { ok: true, result: 'conversation_schema_ready' };
}
```

Copy the same DDL into the CLI-generated migration file. Do not grant browser roles access; the Render bridge remains the only data-plane client.

- [ ] **Step 5: Run the test and verify it passes**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-store.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the schema**

```powershell
git add scripts/conversation-schema.mjs scripts/conversation-store.test.mjs supabase/migrations
git commit -m "feat: add unified conversation schema"
```

## Task 2: Implement Identity Normalization and Sender Eligibility

**Files:**

- Create: `scripts/conversation-identity.mjs`
- Test: `scripts/conversation-identity.test.mjs`

- [ ] **Step 1: Write failing normalization and lifecycle tests**

```js
import { describe, expect, test } from '@jest/globals';
import {
  normalizeConversationEmail,
  normalizeConversationPhone,
  rankEligibleSenderIdentities,
} from './conversation-identity.mjs';

describe('conversation identity', () => {
  test('normalizes US phone and email identities', () => {
    expect(normalizeConversationPhone('(614) 555-0199')).toBe('+16145550199');
    expect(normalizeConversationEmail(' Seller@Example.COM ')).toBe('seller@example.com');
  });

  test('excludes restricted senders and favors a prior successful sender', () => {
    const ranked = rankEligibleSenderIdentities(
      [
        { id: 'prior', lifecycleStatus: 'active', healthScore: 82, address: '+16145550101' },
        { id: 'retired', lifecycleStatus: 'retired', healthScore: 100, address: '+16145550102' },
        { id: 'healthy', lifecycleStatus: 'active', healthScore: 98, address: '+16145550103' },
      ],
      { previousSenderIdentityId: 'prior' }
    );
    expect(ranked.map((item) => item.id)).toEqual(['prior', 'healthy']);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-identity.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal identity functions**

```js
const BLOCKED_LIFECYCLE = new Set([
  'warming',
  'paused',
  'quarantined',
  'retired',
  'release_pending',
  'released',
]);

export function normalizeConversationPhone(value = '') {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

export function normalizeConversationEmail(value = '') {
  return String(value).trim().toLowerCase();
}

export function rankEligibleSenderIdentities(identities = [], context = {}) {
  return identities
    .filter((identity) => !BLOCKED_LIFECYCLE.has(identity.lifecycleStatus))
    .map((identity) => ({
      ...identity,
      recommendationScore:
        (identity.id === context.previousSenderIdentityId ? 1000 : 0) +
        Number(identity.healthScore || 0) +
        (identity.isWorkspaceDefault ? 10 : 0),
    }))
    .sort((a, b) => b.recommendationScore - a.recommendationScore);
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-identity.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/conversation-identity.mjs scripts/conversation-identity.test.mjs
git commit -m "feat: normalize conversation identities"
```

## Task 3: Build the Conversation Store and Canonical Thread Resolver

**Files:**

- Create: `scripts/conversation-store.mjs`
- Modify: `scripts/conversation-store.test.mjs`

- [ ] **Step 1: Add failing tests for lead-first resolution and idempotent events**

Add tests that use a recording pool:

```js
import {
  createConversationStore,
  mapConversationEventRow,
  mapConversationThreadRow,
} from './conversation-store.mjs';

test('resolves by lead before phone or email', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM public.conversation_threads') && params[1] === 'lead-1') {
        return { rows: [{ id: 'thread-1', workspace_id: 'pbk', lead_id: 'lead-1' }] };
      }
      return { rows: [] };
    },
  };
  const store = createConversationStore(pool);
  const thread = await store.resolveThread({
    workspaceId: 'pbk',
    leadId: 'lead-1',
    phone: '+16145550199',
  });
  expect(thread.id).toBe('thread-1');
  expect(queries[0].params).toEqual(['pbk', 'lead-1']);
});

test('maps snake-case rows into frontend-safe records', () => {
  expect(
    mapConversationEventRow({
      id: 'event-1',
      event_type: 'message.sms',
      occurred_at: '2026-06-06T00:00:00.000Z',
    })
  ).toMatchObject({
    id: 'event-1',
    eventType: 'message.sms',
    occurredAt: '2026-06-06T00:00:00.000Z',
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-store.test.mjs
```

Expected: FAIL because store exports are missing.

- [ ] **Step 3: Implement the store interface**

`createConversationStore(pool)` must expose:

```js
{
  resolveThread(input),
  listThreads(filters),
  getThread(threadId),
  listTimeline(threadId, cursor),
  upsertEvent(event),
  patchThread(threadId, patch),
  mergeThreads({ canonicalThreadId, mergedThreadId, actor }),
  listSenderIdentities(filters),
  upsertSenderIdentity(identity),
  patchSenderIdentity(identityId, patch),
}
```

Use parameterized SQL only. `resolveThread()` must:

1. Query the canonical lead thread when `leadId` exists.
2. Query normalized phone/email identities when no lead thread exists.
3. Insert a canonical or provisional thread.
4. Upsert phone/email identity rows.
5. Return a camel-case mapped thread.

`upsertEvent()` must use:

```sql
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
RETURNING *
```

After event upsert, update thread activity timestamps and increment unread only for a newly inserted inbound event.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-store.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/conversation-store.mjs scripts/conversation-store.test.mjs
git commit -m "feat: resolve canonical conversation threads"
```

## Task 4: Project Existing PBK Records into Conversation Events

**Files:**

- Create: `scripts/conversation-projector.mjs`
- Test: `scripts/conversation-projector.test.mjs`

- [ ] **Step 1: Write failing projection tests**

```js
import { describe, expect, test } from '@jest/globals';
import {
  projectApprovalEvent,
  projectCallEvent,
  projectContractEvent,
  projectMessageEvent,
} from './conversation-projector.mjs';

test('projects an SMS without losing provider identity', () => {
  expect(
    projectMessageEvent({
      id: 'sms-1',
      leadId: 'lead-1',
      channel: 'sms',
      direction: 'outbound',
      fromPhone: '+16145550101',
      toPhone: '+16145550199',
      provider: 'telnyx',
      body: 'Hello',
      status: 'sent',
    })
  ).toMatchObject({
    eventType: 'message.sms',
    sourceTable: 'unified_messages',
    sourceId: 'sms-1',
    provider: 'telnyx',
    senderAddress: '+16145550101',
  });
});

test('projects DocuSign viewed as a timeline event', () => {
  expect(
    projectContractEvent({
      id: 'contract-1',
      leadId: 'lead-1',
      status: 'viewed',
      envelopeId: 'envelope-1',
      documentTitle: 'Probate Contract',
    })
  ).toMatchObject({
    eventType: 'contract.viewed',
    sourceTable: 'contracts',
    sourceId: 'contract-1',
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-projector.test.mjs
```

Expected: FAIL because the projector does not exist.

- [ ] **Step 3: Implement projectors**

Implement pure functions that return the store event input shape:

```js
{
  workspaceId,
  leadId,
  eventType,
  channel,
  direction,
  sourceTable,
  sourceId,
  sourceKey: `${sourceTable}:${sourceId}:${eventType}`,
  provider,
  senderAddress,
  recipientAddress,
  actorType,
  actorName,
  subject,
  body,
  status,
  occurredAt,
  payload,
}
```

Map:

- SMS/email records to `message.sms` or `message.email`.
- Calls to `call.started`, `call.transcript`, `call.recording`, or `call.completed`.
- Contracts to `contract.sent`, `contract.viewed`, `contract.completed`, or `system`.
- Approvals to `approval.created` or `approval.decided`.
- Activity notes to `lead.note`, `lead.updated`, or `system`.

- [ ] **Step 4: Verify GREEN**

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-projector.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/conversation-projector.mjs scripts/conversation-projector.test.mjs
git commit -m "feat: normalize seller timeline events"
```

## Task 5: Wire Schema Self-Ensure and Read APIs into the Bridge

**Files:**

- Modify: `scripts/openclaw-local-server.mjs`
- Create: `scripts/unified-conversation-bridge-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing bridge source smoke test**

Assert that the server:

- imports `ensureConversationSchema` and `createConversationStore`;
- calls `ensureConversationSchema(pool)` from `ensurePbkOperationalTables`;
- handles:
  - `GET /api/conversations`
  - `GET /api/conversations/:threadId`
  - `GET /api/conversations/:threadId/timeline`
  - `PATCH /api/conversations/:threadId`
  - `POST /api/conversations/:threadId/merge`.

- [ ] **Step 2: Verify RED**

```powershell
node scripts/unified-conversation-bridge-smoke.mjs
```

Expected: FAIL because the imports and routes are absent.

- [ ] **Step 3: Add imports and self-ensure**

At the top of `scripts/openclaw-local-server.mjs`:

```js
import { ensureConversationSchema } from './conversation-schema.mjs';
import { createConversationStore } from './conversation-store.mjs';
```

Inside `ensurePbkOperationalTables(pool)`:

```js
await ensureConversationSchema(pool);
```

- [ ] **Step 4: Add read and thread-state routes**

Create one store per request from `getPgPool()` and return explicit degraded responses:

```js
const conversationStore = createConversationStore(getPgPool());
```

Route behavior:

- `GET /api/conversations`: cursor pagination, search, unread, pinned, channel, stage, and agent filters.
- `GET /api/conversations/:threadId`: thread plus lead summary and sender summary.
- `GET /api/conversations/:threadId/timeline`: ordered timeline with `nextCursor`.
- `PATCH /api/conversations/:threadId`: allow only `read`, `unread`, `pinned`, `archived`, `assignedAgent`, and `spam`.
- `POST /api/conversations/:threadId/merge`: require explicit canonical and merged IDs, record actor, and reject self-merge.

When Postgres is unavailable, return:

```js
{
  ok: false,
  result: 'postgres_unavailable',
  degraded: true,
  error: 'Unified conversations require the Postgres conversation schema.'
}
```

- [ ] **Step 5: Add the package script**

```json
"test:unified-conversation-bridge": "node ./scripts/unified-conversation-bridge-smoke.mjs"
```

- [ ] **Step 6: Verify GREEN**

```powershell
npm run test:unified-conversation-bridge
npm run typecheck
```

Expected: both pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/openclaw-local-server.mjs scripts/unified-conversation-bridge-smoke.mjs package.json
git commit -m "feat: expose unified conversation reads"
```

## Task 6: Sync Telnyx and Instantly Sender Identities

**Files:**

- Modify: `scripts/conversation-store.mjs`
- Modify: `scripts/openclaw-local-server.mjs`
- Modify: `scripts/conversation-identity.test.mjs`

- [ ] **Step 1: Add failing lifecycle tests**

Add cases asserting:

- Telnyx number records normalize to `channel: 'sms'`.
- Instantly senders normalize to `channel: 'email'`.
- `retired`, `quarantined`, `warming`, `release_pending`, and `released` cannot send.
- retiring an identity preserves its row and timestamps.
- provider release is not performed by a lifecycle PATCH.

- [ ] **Step 2: Verify RED**

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-identity.test.mjs
```

Expected: FAIL for missing provider normalization/lifecycle functions.

- [ ] **Step 3: Add provider normalization and sync**

Extend `conversation-identity.mjs` with:

```js
export function normalizeTelnyxSenderIdentity(record, defaultNumber = '') {
  const address = normalizeConversationPhone(record.phoneNumber || record.phone_number);
  return {
    provider: 'telnyx',
    providerIdentityId: String(record.id || address),
    channel: 'sms',
    address,
    normalizedAddress: address,
    label: record.label || record.customerReference || 'Telnyx number',
    region: record.region || '',
    lifecycleStatus: 'active',
    healthStatus: record.status || 'unknown',
    isWorkspaceDefault: address === normalizeConversationPhone(defaultNumber),
    metadata: record,
  };
}

export function normalizeInstantlySenderIdentity(record, defaultEmail = '') {
  const address = normalizeConversationEmail(record.email);
  return {
    provider: 'instantly',
    providerIdentityId: String(record.id || address),
    channel: 'email',
    address,
    normalizedAddress: address,
    label: record.label || address,
    region: '',
    lifecycleStatus: /warm/i.test(record.status || '') ? 'warming' : 'active',
    healthStatus: record.status || 'unknown',
    isWorkspaceDefault: address === normalizeConversationEmail(defaultEmail),
    metadata: record,
  };
}
```

- [ ] **Step 4: Add identity routes**

Implement:

- `GET /api/communication-identities`
- `POST /api/communication-identities/sync`
- `PATCH /api/communication-identities/:identityId`
- `POST /api/communication-identities/:identityId/release-request`
- internal `POST /api/communication-identities/:identityId/release`

The sync route calls existing `getTelnyxNumberOptions()` and `getInstantlySenderOptions()`, then upserts the normalized records.

The lifecycle PATCH accepts only:

```js
new Set(['active', 'paused', 'quarantined', 'retired']);
```

The release-request route creates an approval with:

```js
{
  type: 'provider_identity_release',
  approvalAction: 'release_communication_identity',
  payload: { identityId, provider, address }
}
```

The internal release route must verify an approved approval record before calling a provider release operation. If no provider release implementation exists, return `501 provider_release_not_configured` and leave the identity at `release_pending`.

- [ ] **Step 5: Verify GREEN**

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-identity.test.mjs
npm run test:unified-conversation-bridge
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/conversation-identity.mjs scripts/conversation-identity.test.mjs scripts/conversation-store.mjs scripts/openclaw-local-server.mjs
git commit -m "feat: manage messaging sender identities"
```

## Task 7: Add Conversation Sends, Recommendations, Refinement, and Event Actions

**Files:**

- Modify: `scripts/openclaw-local-server.mjs`
- Modify: `scripts/conversation-store.mjs`
- Modify: `scripts/conversation-identity.mjs`
- Modify: `scripts/unified-conversation-bridge-smoke.mjs`

- [ ] **Step 1: Extend the failing smoke test**

Assert handlers exist for:

- `POST /api/conversations/:threadId/messages`
- `POST /api/conversations/:threadId/sender-recommendation`
- `POST /api/conversations/:threadId/refine-draft`
- `PATCH /api/conversation-events/:eventId`
- `POST /api/conversation-events/:eventId/restore`
- `POST /api/conversation-events/:eventId/report-spam`

- [ ] **Step 2: Verify RED**

```powershell
npm run test:unified-conversation-bridge
```

Expected: FAIL for missing write routes.

- [ ] **Step 3: Implement sender recommendation**

Load eligible sender identities for the requested channel, previous successful sender ID, provider health, workspace default, and lead region. Return:

```js
{
  ok: true,
  recommended: ranked[0] || null,
  alternatives: ranked.slice(1),
  reasonCodes: [
    'same_thread_identity',
    'eligible_channel',
    'provider_healthy'
  ]
}
```

Never return a restricted identity in `recommended` or `alternatives`.

- [ ] **Step 4: Implement conversation send**

Validate:

- thread exists;
- channel is SMS or email;
- sender identity exists and matches channel;
- sender is eligible;
- recipient exists on the thread/lead;
- DNC/TCPA checks pass;
- body is non-empty;
- scheduled time is valid when supplied.

For immediate SMS, call existing `executeRouteToolHandler('telnyx_sms', ...)` with the selected sender address as `from` and `fromNumber`.

For immediate email, call existing `executeRouteToolHandler('sendColdEmail', ...)` with the selected sender address as `fromEmail` and `senderEmail`.

For scheduled sends, persist through the existing scheduling path and include `senderIdentityId` in payload.

Project the provider or approval result into `conversation_events` before responding.

- [ ] **Step 5: Implement Ava draft refinement**

Call the existing configured LLM provider through the bridge helper, with this fixed instruction:

```text
You are Ava, PBK's sales assistant. Rewrite only the operator's draft.
Preserve factual claims, numbers, consent boundaries, and requested channel.
Improve grammar, warmth, clarity, and persuasion without inventing promises.
Return only the revised draft.
```

Include at most the latest 12 visible thread events and the selected lead's first name/address. Return both `rawDraft` and `refinedDraft`. Never send automatically.

- [ ] **Step 6: Implement event actions**

- Soft delete: set `hidden_at`, preserve source/provider audit.
- Restore: clear `hidden_at`.
- Report spam: set `spam_reported_at`; create DNC only when payload confirms explicit opt-out.
- Mark important: store `payload.important = true`.

- [ ] **Step 7: Verify GREEN**

```powershell
npm run test:unified-conversation-bridge
npm run test:safety-validator
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add scripts/openclaw-local-server.mjs scripts/conversation-store.mjs scripts/conversation-identity.mjs scripts/unified-conversation-bridge-smoke.mjs
git commit -m "feat: send and manage conversation events"
```

## Task 8: Project Live Provider and PBK Events

**Files:**

- Modify: `scripts/openclaw-local-server.mjs`
- Modify: `scripts/conversation-projector.test.mjs`

- [ ] **Step 1: Add failing idempotency tests**

Add tests for repeated Telnyx, Instantly, DocuSign, call transcript, approval, and note events producing the same source identity:

```js
expect(first.sourceKey).toBe(second.sourceKey);
```

- [ ] **Step 2: Verify RED**

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-projector.test.mjs
```

Expected: FAIL for missing stable source-key behavior.

- [ ] **Step 3: Project events at existing persistence boundaries**

After successful existing persistence:

- `persistUnifiedMessageRecord()` projects message/recording events.
- Telnyx webhook call start/transcript/completion projects call events.
- Instantly/email webhooks project email delivery/reply events.
- DocuSign webhook projects envelope lifecycle events.
- Approval create/decision projects approval events.
- `POST /api/leads/add-note` projects `lead.note`.
- lead PATCH projects `lead.updated`.

Projection failure logs a structured warning and does not cause the already-successful provider webhook to return a failure.

- [ ] **Step 4: Verify GREEN**

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-projector.test.mjs
npm run test:bridge
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/openclaw-local-server.mjs scripts/conversation-projector.test.mjs
git commit -m "feat: project provider events into seller timelines"
```

## Task 9: Add Dry-Run Backfill

**Files:**

- Create: `scripts/backfill-conversations.mjs`
- Create: `scripts/backfill-conversations.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing planning tests**

Test that backfill order is:

```js
['lead_profiles', 'unified_messages', 'calls', 'contracts', 'activity_log'];
```

and that the default mode is dry-run.

- [ ] **Step 2: Verify RED**

```powershell
npm run test:unit -- --runTestsByPath scripts/backfill-conversations.test.mjs
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement dry-run and apply modes**

CLI behavior:

```powershell
node scripts/backfill-conversations.mjs
node scripts/backfill-conversations.mjs --apply
```

Dry-run prints counts and planned inserts without writing. Apply mode:

1. creates canonical lead threads;
2. creates phone/email identities;
3. projects messages;
4. projects calls;
5. projects contracts;
6. projects lead activity;
7. recomputes thread preview/unread fields.

Use idempotent event upserts so rerunning is safe.

- [ ] **Step 4: Add package scripts**

```json
"conversations:backfill:dry": "node ./scripts/backfill-conversations.mjs",
"conversations:backfill": "node ./scripts/backfill-conversations.mjs --apply"
```

- [ ] **Step 5: Verify GREEN**

```powershell
npm run test:unit -- --runTestsByPath scripts/backfill-conversations.test.mjs
npm run conversations:backfill:dry
```

Expected: test passes; dry-run exits zero and prints counts or `postgres_unavailable` without writing.

- [ ] **Step 6: Commit**

```powershell
git add scripts/backfill-conversations.mjs scripts/backfill-conversations.test.mjs package.json
git commit -m "feat: backfill unified seller conversations"
```

## Task 10: Add Typed Frontend Bridge Helpers

**Files:**

- Modify: `src/app/utils/runtimeBridge.ts`
- Create: `scripts/conversation-runtime-bridge-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing helper smoke test**

Assert `runtimeBridge.ts` exports:

```text
fetchConversationsRequest
fetchConversationRequest
fetchConversationTimelineRequest
patchConversationRequest
sendConversationMessageRequest
fetchSenderIdentitiesRequest
syncSenderIdentitiesRequest
patchSenderIdentityRequest
requestSenderReleaseRequest
fetchSenderRecommendationRequest
refineConversationDraftRequest
patchConversationEventRequest
restoreConversationEventRequest
reportConversationEventSpamRequest
```

- [ ] **Step 2: Verify RED**

```powershell
node scripts/conversation-runtime-bridge-smoke.mjs
```

Expected: FAIL for missing exports.

- [ ] **Step 3: Add exact frontend types**

Add:

```ts
export type ConversationThread = {
  id: string;
  leadId?: string | null;
  title?: string;
  status?: string;
  assignedAgent?: string;
  lastEventAt?: string | null;
  unreadCount?: number;
  pinned?: boolean;
  archivedAt?: string | null;
  seller?: Record<string, unknown>;
  property?: Record<string, unknown>;
  identities?: ConversationThreadIdentity[];
  latestEvent?: ConversationEvent | null;
};

export type ConversationEvent = {
  id: string;
  threadId: string;
  leadId?: string | null;
  eventType: string;
  channel?: string;
  direction?: string;
  provider?: string;
  senderIdentityId?: string | null;
  actorName?: string;
  subject?: string;
  body?: string;
  status?: string;
  occurredAt: string;
  readAt?: string | null;
  hiddenAt?: string | null;
  payload?: Record<string, unknown>;
};

export type CommunicationSenderIdentity = {
  id: string;
  provider: 'telnyx' | 'instantly' | string;
  channel: 'sms' | 'email' | 'call';
  address: string;
  label?: string;
  region?: string;
  lifecycleStatus: string;
  healthStatus?: string;
  healthScore?: number | null;
  isWorkspaceDefault?: boolean;
};
```

- [ ] **Step 4: Add helpers through `bridgeRequest` only**

No component may call `fetch` directly. Cursor and search parameters use `URLSearchParams`.

- [ ] **Step 5: Verify GREEN**

```powershell
node scripts/conversation-runtime-bridge-smoke.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/utils/runtimeBridge.ts scripts/conversation-runtime-bridge-smoke.mjs package.json
git commit -m "feat: add conversation runtime client"
```

## Task 11: Extract the Inbox Signal Lanes and Add the Workspace Entry

**Files:**

- Create: `src/app/components/inbox/InboxSignalLanes.tsx`
- Modify: `src/app/routes/Inbox.tsx`
- Create: `scripts/unified-inbox-ui-smoke.mjs`

- [ ] **Step 1: Write the failing lobby smoke test**

Assert:

- exact visible copy:
  - `Approvals` / `Ava/Rex waiting`
  - `Unread` / `seller replies`
  - `Scheduled` / `send later queue`
- `Open Unified Inbox` exists;
- the button navigates to `/inbox/conversations`;
- the shared component uses Lucide icons and accessible labels.

- [ ] **Step 2: Verify RED**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
```

Expected: FAIL because the shared lanes and route command do not exist.

- [ ] **Step 3: Implement `InboxSignalLanes`**

Props:

```ts
type InboxSignalLanesProps = {
  approvals: number;
  unread: number;
  scheduled: number;
  onSelect?: (lane: 'approvals' | 'unread' | 'scheduled') => void;
};
```

Render three buttons, each with an icon, label, supporting copy, count, and `aria-label` that includes the count.

- [ ] **Step 4: Replace duplicate lane markup and add navigation**

Use `useNavigate()` in `Inbox.tsx`:

```tsx
<button type="button" onClick={() => navigate('/inbox/conversations')}>
  <MessagesSquare aria-hidden="true" />
  Open Unified Inbox
</button>
```

Keep `New message` and `Refresh`.

- [ ] **Step 5: Verify GREEN**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
npm run test:inbox-prototype-modern
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/components/inbox/InboxSignalLanes.tsx src/app/routes/Inbox.tsx scripts/unified-inbox-ui-smoke.mjs
git commit -m "feat: open unified inbox from triage"
```

## Task 12: Implement Pure Unified Inbox View Logic

**Files:**

- Create: `src/app/routes/conversationRuntimeLogic.js`
- Create: `src/app/routes/conversationRuntimeLogic.d.ts`
- Create: `scripts/conversation-runtime-logic.test.mjs`

- [ ] **Step 1: Write failing tests**

Cover:

- one thread row per seller;
- newest activity ordering;
- hidden events excluded by default;
- timeline grouping by calendar day;
- selected channel filters sender identities;
- restricted sender identities remain visible but disabled;
- mobile state transitions `threads -> conversation -> profile`.

- [ ] **Step 2: Verify RED**

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-runtime-logic.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure helpers**

Export:

```js
normalizeConversationThreads;
sortConversationThreads;
groupConversationEventsByDay;
filterVisibleConversationEvents;
filterSenderIdentitiesForChannel;
getSenderRestrictionReason;
getConversationMobileState;
getConversationPreview;
```

The helpers accept records and return new arrays; they do not mutate bridge data.

- [ ] **Step 4: Verify GREEN**

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-runtime-logic.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/routes/conversationRuntimeLogic.js src/app/routes/conversationRuntimeLogic.d.ts scripts/conversation-runtime-logic.test.mjs
git commit -m "feat: add unified inbox view logic"
```

## Task 13: Build the Unified Inbox Read Experience

**Files:**

- Create: `src/app/components/inbox/ConversationThreadRail.tsx`
- Create: `src/app/components/inbox/ConversationTimeline.tsx`
- Create: `src/app/components/inbox/LeadContextInspector.tsx`
- Create: `src/app/routes/UnifiedInbox.tsx`
- Modify: `src/app/shell/router.tsx`
- Modify: `src/styles/pbk-components.css`
- Modify: `src/styles/index.css`
- Modify: `scripts/unified-inbox-ui-smoke.mjs`

- [ ] **Step 1: Extend the failing UI smoke test**

Assert:

- lazy route `/inbox/conversations`;
- components exist;
- source labels name `GET /api/conversations`, `GET /api/conversations/:threadId/timeline`, and `GET /api/leads/:id/full`;
- no mock people or fake messages;
- rounded bubble selectors exist;
- 320px mobile rules exist.

- [ ] **Step 2: Verify RED**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
```

Expected: FAIL.

- [ ] **Step 3: Build `ConversationThreadRail`**

Include:

- sticky search;
- filters for unread, pinned, live, approvals, SMS, email, and calls;
- one row per thread;
- seller, address, channel summary, preview, unread count, and SLA text;
- cursor-based `Load more`;
- unknown-contact action that opens lead matching.

For unknown contacts, query the existing fuzzy lead search endpoint, show the ranked matches, and call `POST /api/conversations/:threadId/merge` only after the operator confirms the selected lead thread.

- [ ] **Step 4: Build `ConversationTimeline`**

Render:

- inbound and outbound messages as rounded bubbles;
- calls, DocuSign, approvals, notes, and system events as compact timeline rows;
- expandable transcripts;
- transcript timestamp controls that set the recording player's current time when word/block timing exists;
- persistent delivery/approval status;
- loading skeleton, error retry, empty state, and load-more control.

Message bubbles use:

```css
.pbk-conversation-bubble {
  max-width: min(76%, 46rem);
  border-radius: 17px 17px 17px 6px;
}

.pbk-conversation-bubble.outbound {
  margin-left: auto;
  border-radius: 17px 17px 6px 17px;
}
```

Mobile caps bubbles at 88% width.

- [ ] **Step 5: Build `LeadContextInspector`**

Load the selected lead with `fetchLeadFullRequest()` and show:

- identity/contactability;
- property;
- motivation/timeline;
- ARV, MAO, repairs, ask, mortgage;
- path, stage, assigned agent, tags;
- compliance;
- quick actions linking to `/leads/:leadId` and `/deal`.

The inspector collapses on desktop and becomes a drawer/bottom sheet on tablet/mobile.

- [ ] **Step 6: Compose `UnifiedInbox`**

Data flow:

1. fetch thread page;
2. select URL thread ID or first row;
3. fetch selected timeline;
4. load lead detail when thread has `leadId`;
5. mark the selected thread read through `patchConversationRequest()` after its timeline succeeds;
6. preserve selected thread in the URL;
7. poll only the selected timeline and thread summary;
8. expose transparent degraded mode when conversation Postgres is unavailable.

- [ ] **Step 7: Add the route**

```tsx
const UnifiedInbox = lazy(() =>
  import('../routes/UnifiedInbox').then((module) => ({ default: module.UnifiedInbox }))
);

{ path: 'inbox/conversations', element: <UnifiedInbox /> },
```

- [ ] **Step 8: Verify GREEN**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/app/components/inbox src/app/routes/UnifiedInbox.tsx src/app/shell/router.tsx src/styles/pbk-components.css src/styles/index.css scripts/unified-inbox-ui-smoke.mjs
git commit -m "feat: add unified seller inbox"
```

## Task 14: Build the Sender-Aware Composer and Event Menus

**Files:**

- Create: `src/app/components/inbox/SenderIdentitySelect.tsx`
- Create: `src/app/components/inbox/ConversationComposer.tsx`
- Modify: `src/app/components/inbox/ConversationTimeline.tsx`
- Modify: `src/app/routes/UnifiedInbox.tsx`
- Modify: `src/styles/pbk-components.css`
- Modify: `scripts/unified-inbox-ui-smoke.mjs`

- [ ] **Step 1: Extend the failing smoke test**

Assert:

- SMS/email segmented control;
- explicit `From` sender selector;
- Telnyx/Instantly provider labels;
- sender recommendation;
- schedule control;
- voice dictation and `Refine with Ava`;
- bridge-backed smart replies from the existing reply-template endpoint;
- event menu actions and Undo;
- no automatic send after speech recognition/refinement.

- [ ] **Step 2: Verify RED**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
```

Expected: FAIL.

- [ ] **Step 3: Build `SenderIdentitySelect`**

Show:

- address and label;
- provider;
- lifecycle state;
- health text;
- default/recommended indicator;
- restriction reason.

Restricted identities remain visible but disabled so the operator understands why history cannot be continued from that identity.

- [ ] **Step 4: Build `ConversationComposer`**

State:

```ts
{
  channel: 'sms' | 'email';
  senderIdentityId: string;
  recipient: string;
  subject: string;
  body: string;
  sendLater: boolean;
  scheduledFor: string;
  refining: boolean;
  sending: boolean;
}
```

Behavior:

- load sender identities and recommendation;
- require explicit selected sender;
- use existing GSM-7/UCS-2 segment logic;
- browser speech recognition writes only into the body;
- refinement returns an editable alternative;
- smart-reply buttons load from `fetchReplyTemplatesRequest()` using the selected channel, seller, property, and latest inbound body;
- send calls `sendConversationMessageRequest`;
- keep approval/provider result visible until acknowledged;
- disable send for invalid recipient, body, sender, DNC, or schedule.

- [ ] **Step 5: Add event context actions**

Use Radix Dropdown Menu and existing `toastUndo()`:

- soft delete;
- restore through Undo;
- report spam with confirmation;
- mark important;
- copy.

Long press on touch opens the same menu.

- [ ] **Step 6: Verify GREEN**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
npm run test:ui-accessibility-confirmation
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/components/inbox src/app/routes/UnifiedInbox.tsx src/styles/pbk-components.css scripts/unified-inbox-ui-smoke.mjs
git commit -m "feat: add sender-aware conversation composer"
```

## Task 15: Add the Live Call Picture-in-Picture

**Files:**

- Create: `src/app/components/inbox/LiveCallPip.tsx`
- Modify: `src/app/routes/UnifiedInbox.tsx`
- Modify: `src/styles/pbk-components.css`
- Modify: `scripts/unified-inbox-ui-smoke.mjs`

- [ ] **Step 1: Write failing UI assertions**

Assert:

- live call widget derives from real `snapshot.calls`;
- talk-time and sentiment have text labels;
- transcript is expandable;
- actions call existing call/note/follow-up helpers;
- mobile safe-area styles keep the PiP above composer/navigation.

- [ ] **Step 2: Verify RED**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement the PiP**

Use `useRuntimeSnapshot()` only for active calls matching the selected lead/phone. Provide:

- elapsed time;
- Ava/seller talk-time bars;
- sentiment direction plus text;
- latest transcript lines;
- expand;
- mark important;
- add note;
- follow-up;
- mute/takeover/end through `controlRuntimeCall`.

If talk-time or sentiment is absent, show `Not available` rather than inventing values.

- [ ] **Step 4: Verify GREEN**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
npm run test:shell-callmode-callfloor
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/components/inbox/LiveCallPip.tsx src/app/routes/UnifiedInbox.tsx src/styles/pbk-components.css scripts/unified-inbox-ui-smoke.mjs
git commit -m "feat: add live call inbox companion"
```

## Task 16: Build the Canonical Lead Portal Route

**Files:**

- Create: `src/app/routes/LeadPortal.tsx`
- Create: `src/app/components/leads/LeadPortalHeader.tsx`
- Create: `src/app/components/leads/LeadPortalOverview.tsx`
- Create: `src/app/components/leads/LeadPortalContactability.tsx`
- Create: `src/app/components/leads/LeadPortalProperty.tsx`
- Create: `src/app/components/leads/LeadPortalDealContext.tsx`
- Create: `src/app/components/leads/LeadPortalTimeline.tsx`
- Modify: `src/app/routes/Leads.tsx`
- Modify: `src/app/shell/router.tsx`
- Modify: `src/app/shell/ShellTopbar.tsx`
- Create: `scripts/lead-portal-route-smoke.mjs`

- [ ] **Step 1: Write the failing lead portal smoke test**

Assert:

- `/leads/:leadId` lazy route exists;
- `GET /api/leads/:id/full` is canonical;
- unified timeline is loaded from the conversation endpoints;
- `/leads?lead=:id` normalizes to the canonical route;
- no fake seller/property values;
- all quick actions use existing bridge helpers.

- [ ] **Step 2: Verify RED**

```powershell
node scripts/lead-portal-route-smoke.mjs
```

Expected: FAIL.

- [ ] **Step 3: Build the portal**

Sections:

- identity/relationship header;
- contactability and TCPA/DNC;
- property facts;
- motivation/timeline;
- ARV, MAO, repairs, ask, mortgage, lead score;
- path, stage, assigned agent, tags;
- seller notes/internal notes;
- Ava pre-call brief;
- unified seller timeline;
- calls/recordings;
- documents/DocuSign;
- analyzer and contract actions.

Edits use `patchLeadRequest()`. Calls, contracts, notes, and messages use existing bridge helpers or the new conversation send helper.

- [ ] **Step 4: Normalize old deep links**

In `Leads.tsx`, when `searchParams.get('lead')` exists:

```tsx
navigate(`/leads/${encodeURIComponent(leadId)}`, { replace: true });
```

Keep `?new=1` on `/leads` for the creation flow.

Update ShellTopbar lead results to `/leads/:leadId` and message results to `/inbox/conversations?thread=...` when thread ID is present.

- [ ] **Step 5: Verify GREEN**

```powershell
node scripts/lead-portal-route-smoke.mjs
npm run test:leads-new-lead-portal
npm run test:mobile-wiring-lead-portal
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/routes/LeadPortal.tsx src/app/components/leads src/app/routes/Leads.tsx src/app/shell/router.tsx src/app/shell/ShellTopbar.tsx scripts/lead-portal-route-smoke.mjs
git commit -m "feat: add canonical seller lead portal"
```

## Task 17: Finish Responsive and Theme Fidelity

**Files:**

- Modify: `src/styles/pbk-components.css`
- Modify: `src/styles/index.css`
- Modify: `scripts/unified-inbox-ui-smoke.mjs`
- Modify: `scripts/lead-portal-route-smoke.mjs`

- [ ] **Step 1: Add failing responsive/theme assertions**

Require:

- desktop three-region layout;
- tablet two-region plus drawer;
- mobile thread/conversation/profile states;
- composer safe-area inset;
- no horizontal overflow at 320px;
- explicit light and dark surfaces;
- message bubbles remain rounded in both themes;
- reduced motion support.

- [ ] **Step 2: Verify RED**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
node scripts/lead-portal-route-smoke.mjs
```

Expected: FAIL for incomplete responsive/theme selectors.

- [ ] **Step 3: Implement responsive rules**

Required breakpoints:

- `min-width: 1200px`: three regions.
- `768px-1199px`: thread rail plus timeline; inspector drawer.
- `max-width: 767px`: one active region at a time.
- `max-width: 360px`: compact controls and stable typography.

Use:

```css
padding-bottom: calc(var(--composer-height) + env(safe-area-inset-bottom));
```

for the mobile timeline and:

```css
@media (prefers-reduced-motion: reduce) {
  .pbk-unified-inbox *,
  .pbk-lead-portal * {
    scroll-behavior: auto;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Verify GREEN**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
node scripts/lead-portal-route-smoke.mjs
npm run test:ui-feedback-truncation-responsive
npm run test:ui-accessibility-confirmation
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/styles/pbk-components.css src/styles/index.css scripts/unified-inbox-ui-smoke.mjs scripts/lead-portal-route-smoke.mjs
git commit -m "fix: polish unified inbox mobile themes"
```

## Task 18: Document Every Source and Remove Fake-Code Escape Hatches

**Files:**

- Modify: `docs/modern-shell-bridge-data-map.md`
- Modify: `src/app/routes/Inbox.tsx`
- Modify: `src/app/routes/UnifiedInbox.tsx`
- Modify: `src/app/routes/LeadPortal.tsx`

- [ ] **Step 1: Add source-map assertions**

Extend UI smoke tests to require shipped source labels for:

- `GET /api/conversations`
- `GET /api/conversations/:threadId/timeline`
- `POST /api/conversations/:threadId/messages`
- `GET /api/communication-identities`
- `POST /api/conversations/:threadId/sender-recommendation`
- `GET /api/leads/:id/full`

- [ ] **Step 2: Verify RED**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
node scripts/lead-portal-route-smoke.mjs
```

Expected: FAIL until source labels and documentation are complete.

- [ ] **Step 3: Update the bridge data map**

Document component, endpoint, bridge handler, database source, degraded behavior, and ship status. Mark no new component as shipped unless its endpoint helper and server handler both exist.

- [ ] **Step 4: Verify GREEN**

```powershell
node scripts/unified-inbox-ui-smoke.mjs
node scripts/lead-portal-route-smoke.mjs
npm run test:live-data-audit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add docs/modern-shell-bridge-data-map.md src/app/routes/Inbox.tsx src/app/routes/UnifiedInbox.tsx src/app/routes/LeadPortal.tsx
git commit -m "docs: map unified seller data sources"
```

## Task 19: Run Full Verification and Visual Fidelity Review

**Files:**

- No production file changes unless verification finds a defect.

- [ ] **Step 1: Run the focused automated suite**

```powershell
npm run test:unit -- --runTestsByPath scripts/conversation-identity.test.mjs scripts/conversation-store.test.mjs scripts/conversation-projector.test.mjs scripts/backfill-conversations.test.mjs scripts/conversation-runtime-logic.test.mjs
npm run test:unified-conversation-bridge
node scripts/conversation-runtime-bridge-smoke.mjs
node scripts/unified-inbox-ui-smoke.mjs
node scripts/lead-portal-route-smoke.mjs
```

Expected: all pass.

- [ ] **Step 2: Run PBK regression checks**

```powershell
npm run typecheck
npm run lint
npm run build
npm run test:inbox-prototype-modern
npm run test:leads-prototype-modern
npm run test:leads-new-lead-portal
npm run test:mobile-wiring-lead-portal
npm run test:ui-accessibility-confirmation
npm run test:ui-error-loading-validation
npm run test:ui-feedback-truncation-responsive
npm run test:safety-validator
```

Expected: all pass with no warnings introduced by this feature.

- [ ] **Step 3: Run the local bridge and app**

Use separate terminals:

```powershell
npm run openclaw:local
npm run dev -- --host 127.0.0.1
```

Open the Vite URL in BrowserOS.

- [ ] **Step 4: Verify desktop workflows**

Check:

1. Inbox lanes and `Open Unified Inbox`.
2. One thread row per seller.
3. SMS/email switch and explicit sender selection.
4. restricted sender visibility and disabled send.
5. message send/approval result.
6. soft delete and Undo.
7. call/DocuSign timeline events.
8. lead portal edits and quick actions.

- [ ] **Step 5: Verify mobile workflows**

At 390x844 and 320x700:

1. all shell pages remain reachable;
2. thread list opens conversation;
3. back action returns to thread list;
4. profile opens without covering composer permanently;
5. keyboard does not hide send controls;
6. PiP stays above composer and bottom navigation;
7. no horizontal overflow.

- [ ] **Step 6: Perform visual comparison**

Compare the implementation screenshot with:

- `.superpowers/brainstorm/687-1780732138/content/approved-direction-v3.html`
- `.superpowers/brainstorm/687-1780732138/content/pbk-unified-workspace-v2.html`

Use `view_image` on the accepted concept capture and the implementation capture. Record at least:

- lobby lane anatomy;
- bubble radii/alignment;
- three-region proportions;
- typography hierarchy;
- dark/light palette;
- mobile navigation/composer spacing.

Fix every material mismatch before continuing.

- [ ] **Step 7: Commit verification repairs**

```powershell
git add src scripts docs package.json supabase
git commit -m "fix: complete unified seller workflow verification"
```

Skip the commit only when verification produced no file changes.

## Task 20: Apply, Backfill, Deploy, and Observe

**Files:**

- No source changes unless deployment verification reveals a defect.

- [ ] **Step 1: Apply the migration to a non-production Supabase branch/project**

Use the authenticated Supabase connector or SQL editor. Verify:

```sql
SELECT to_regclass('public.conversation_threads');
SELECT to_regclass('public.conversation_events');
SELECT relrowsecurity
FROM pg_class
WHERE oid = 'public.conversation_events'::regclass;
```

Expected: both tables exist and `relrowsecurity` is true.

- [ ] **Step 2: Run database advisors**

Run Supabase database/security advisors. Fix any missing index, exposed-table, or RLS warning attributable to these tables.

- [ ] **Step 3: Run dry-run and apply backfill**

```powershell
npm run conversations:backfill:dry
npm run conversations:backfill
```

Verify one canonical non-merged thread per lead and no duplicate source events.

- [ ] **Step 4: Push the completed branch**

```powershell
git status --short
git push origin main
```

Do not add `.tmp-cdp-pages.json` or `PBK_UNIFIED_PRODUCTION_PATCH_2026-05-23.patch`.

- [ ] **Step 5: Deploy the bridge to Render**

Deploy the latest commit and verify:

- `/health` returns success;
- schema self-ensure is green;
- no repeated SQL errors;
- conversation routes return authenticated responses;
- Telnyx/Instantly sync is healthy or transparently provider-missing.

- [ ] **Step 6: Deploy the frontend to Netlify preview**

Verify the preview against the hosted Render bridge before production publish.

- [ ] **Step 7: Publish production**

Publish only after:

- Render health is green;
- Supabase migration/backfill is verified;
- Netlify mobile and desktop checks pass;
- no fake fallback records appear.

- [ ] **Step 8: Observe the first production cycle**

Watch:

- Render errors and route latency;
- webhook event duplication;
- thread creation/merge counts;
- sender recommendation exclusions;
- message provider/approval outcomes;
- Netlify browser errors.

Roll back the frontend independently if visual or client defects appear. Keep the additive schema in place; it is backward compatible with the existing Inbox.

## Final Acceptance Checklist

- [ ] `/inbox` remains the familiar modern triage lobby.
- [ ] The three icon lanes use the exact approved labels.
- [ ] `Open Unified Inbox` opens `/inbox/conversations`.
- [ ] One seller appears once in the thread rail.
- [ ] SMS, email, calls, DocuSign, approvals, and notes are chronological.
- [ ] Every outbound message shows and uses an explicit sender identity.
- [ ] Restricted identities cannot send.
- [ ] Provider release remains separately approval-gated.
- [ ] Rounded messages and compact operational events match the approved design.
- [ ] `/leads/:leadId` contains the full durable seller context.
- [ ] Mobile navigation, composer, profile, and live-call PiP work at 320px.
- [ ] Every shipped component names a real endpoint.
- [ ] Deal Analyzer calculations remain unchanged.
