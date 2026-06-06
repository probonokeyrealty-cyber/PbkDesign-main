# PBK Unified Conversation and Lead Portal Design

Date: 2026-06-06
Status: Approved design direction, pending implementation-plan review
Visual reference: browser companion session `pbk-unified-workspace-v2.html` plus `approved-direction-v3.html`

## 1. Objective

Turn PBK Inbox and Leads into one coherent seller operating system without removing the current Inbox and Approvals triage page.

The finished product has three connected surfaces:

1. `/inbox` remains the fast triage lobby for approvals, unread seller replies, scheduled messages, and quick compose.
2. `/inbox/conversations` is the full unified conversation workspace.
3. `/leads/:leadId` is the durable lead portal containing the complete seller, property, deal, compliance, call, document, and internal context.

All three surfaces use real bridge and Postgres records. A component does not ship if it lacks a canonical data source or an explicitly labeled fallback.

## 2. Approved Product Decisions

### 2.1 Canonical thread identity

- A known `lead_id` is the canonical conversation identity.
- Normalized E.164 phone numbers and lowercase email addresses are fallback identities.
- An unknown inbound contact creates a provisional thread.
- When that contact is matched to a lead, the provisional thread merges into the lead thread.
- Thread merges preserve every source record, sender identity, provider ID, timestamp, consent fact, and delivery status.

This prevents one seller from appearing as separate SMS, email, call, and DocuSign threads.

### 2.2 Inbox and Approvals remains the front door

The existing modern visual language remains. The lobby contains three icon-led operational lanes:

- Approvals
  - Supporting label: `Ava/Rex waiting`
- Unread
  - Supporting label: `seller replies`
- Scheduled
  - Supporting label: `send later queue`

Each lane has a Lucide icon, count, semantic color, accessible text, and keyboard focus state. The lanes are not generic decorative stat cards.

Primary lobby commands:

- `New message`
- `Open Unified Inbox`
- `Refresh`

`Open Unified Inbox` navigates to `/inbox/conversations`.

### 2.3 Unified conversation workspace

Desktop uses the approved three-region layout:

- Left: seller/thread rail.
- Center: unified chronological timeline and composer.
- Right: lead intelligence inspector.

Mobile uses route-like progressive disclosure:

- Thread list.
- Conversation.
- Lead profile bottom sheet or full page.
- Live-call picture-in-picture remains visible while moving among those states.

### 2.4 Message geometry

- Human and Ava message bubbles use 14-17px radii with asymmetric message tails.
- Timeline events use restrained 8px radii and a semantic left rail.
- Operational panels and repeated data items remain at 8px or less.
- The UI avoids nested card stacks.
- Fraunces is reserved for identity and major totals.
- Geist is used for workflow text.
- JetBrains Mono is used for provider, source, state, timestamp, and compliance truth.

### 2.5 Sender identity is explicit

The composer supports:

- SMS through Telnyx.
- Email through Instantly.
- A visible `From` identity selector.
- Multiple Telnyx phone numbers.
- Multiple Instantly sender inboxes.
- Operator override of Ava's recommendation.

A number or email identity is never silently swapped.

### 2.6 Sender lifecycle

Sender identities use these lifecycle states:

- `active`
- `warming`
- `paused`
- `quarantined`
- `retired`
- `release_pending`
- `released`

Retirement is the normal PBK action when a number should no longer be used.

- Retired identities cannot start new outbound messages or calls.
- Historical events continue to show the exact identity used.
- Inbound handling can remain enabled during a configured grace period.
- Provider release is a separate destructive action.
- Releasing a Telnyx number requires an approval record and explicit confirmation.
- No hard delete is used for identity history.

## 3. Human and AI Operating Model

### 3.1 Human control

The operator always sees:

- Selected channel.
- Selected sender identity.
- Provider and health status.
- Why Ava recommended an identity.
- Whether an identity is restricted.
- Whether an action requires approval.

The operator can override the recommendation when the identity is eligible.

### 3.2 Ava recommendation order

Ava ranks eligible senders in this order:

1. Same identity already used successfully in this thread.
2. Consent and channel eligibility.
3. Identity lifecycle status.
4. Provider health and delivery reputation.
5. Geographic/area-code match.
6. Workspace default.
7. Operator preference.

Ava must not:

- Switch sender identities merely to vary outreach.
- Select warming, quarantined, retired, or released identities.
- Bypass TCPA, DNC, campaign, or provider safety controls.
- Claim a send succeeded before the provider response confirms it.

### 3.3 Voice dictation and refinement

- Browser speech recognition writes to the draft only.
- Raw dictation is never sent automatically.
- `Refine with Ava` produces an editable alternative.
- The operator chooses raw, refined, or manual text.
- The refinement request includes the current thread context but excludes unrelated seller records.
- Sending still uses the normal approval/provider path.

## 4. Canonical Data Model

### 4.1 `conversation_threads`

Purpose: one durable thread per lead or provisional contact.

Key fields:

- `id UUID PRIMARY KEY`
- `workspace_id TEXT NOT NULL`
- `lead_id TEXT NULL REFERENCES lead_profiles(id)`
- `status TEXT NOT NULL`
- `assigned_agent TEXT`
- `title TEXT`
- `last_event_at TIMESTAMPTZ`
- `last_inbound_at TIMESTAMPTZ`
- `last_outbound_at TIMESTAMPTZ`
- `unread_count INTEGER`
- `pinned BOOLEAN`
- `archived_at TIMESTAMPTZ`
- `spam_reported_at TIMESTAMPTZ`
- `merged_into_thread_id UUID NULL`
- `metadata JSONB`
- timestamps

Constraints:

- One non-merged canonical thread per `(workspace_id, lead_id)` when `lead_id` is present.
- Merged threads are read-only aliases.

### 4.2 `conversation_thread_identities`

Purpose: associate phone/email identities with a conversation.

Key fields:

- `id UUID PRIMARY KEY`
- `thread_id UUID REFERENCES conversation_threads(id)`
- `lead_id TEXT NULL`
- `identity_type TEXT` (`phone` or `email`)
- `normalized_value TEXT`
- `display_value TEXT`
- `is_primary BOOLEAN`
- `verified_at TIMESTAMPTZ`
- `source TEXT`
- timestamps

Unique key:

- `(workspace_id, identity_type, normalized_value, thread_id)`

Indexes support lookup by normalized phone/email.

### 4.3 `conversation_events`

Purpose: one normalized chronological activity object.

Event types include:

- `message.sms`
- `message.email`
- `call.started`
- `call.transcript`
- `call.completed`
- `call.recording`
- `contract.sent`
- `contract.viewed`
- `contract.completed`
- `approval.created`
- `approval.decided`
- `lead.note`
- `lead.updated`
- `system`

Key fields:

- `id UUID PRIMARY KEY`
- `thread_id UUID REFERENCES conversation_threads(id)`
- `lead_id TEXT NULL`
- `event_type TEXT`
- `channel TEXT`
- `direction TEXT`
- `source_table TEXT`
- `source_id TEXT`
- `provider TEXT`
- `sender_identity_id UUID NULL`
- `actor_type TEXT`
- `actor_name TEXT`
- `subject TEXT`
- `body TEXT`
- `status TEXT`
- `occurred_at TIMESTAMPTZ`
- `read_at TIMESTAMPTZ`
- `hidden_at TIMESTAMPTZ`
- `spam_reported_at TIMESTAMPTZ`
- `payload JSONB`
- timestamps

`source_table + source_id + event_type` is idempotent where provider events can retry.

### 4.4 `communication_sender_identities`

Purpose: local lifecycle and policy overlay for Telnyx and Instantly inventory.

Key fields:

- `id UUID PRIMARY KEY`
- `workspace_id TEXT NOT NULL`
- `provider TEXT NOT NULL`
- `provider_identity_id TEXT`
- `channel TEXT NOT NULL`
- `address TEXT NOT NULL`
- `normalized_address TEXT NOT NULL`
- `label TEXT`
- `region TEXT`
- `lifecycle_status TEXT NOT NULL`
- `health_status TEXT`
- `health_score NUMERIC`
- `is_workspace_default BOOLEAN`
- `inbound_grace_until TIMESTAMPTZ`
- `retired_at TIMESTAMPTZ`
- `released_at TIMESTAMPTZ`
- `metadata JSONB`
- timestamps

The bridge refreshes this table from:

- Existing `GET /api/telnyx/numbers`
- Existing `GET /api/instantly/senders`

Provider inventory is not copied into fake frontend constants.

## 5. Thread Resolution

For every inbound or outbound event:

1. Normalize `lead_id`, phone, and email.
2. If `lead_id` exists, find or create its canonical thread.
3. Otherwise look up a thread identity by normalized phone/email.
4. If no match exists, create a provisional thread and identity.
5. Persist the source record.
6. Upsert an idempotent `conversation_event`.
7. Update thread timestamps, unread count, and preview metadata.
8. Broadcast the change through the existing runtime update mechanism.

When a provisional contact is assigned to a lead:

1. Lock both thread rows.
2. Select the lead thread as canonical.
3. Move identities and events.
4. Mark the provisional thread as merged.
5. Recompute unread count and last-event fields.
6. Record a `system` merge event.

## 6. Bridge API Contract

### Existing endpoints reused

- `GET /state`
- `GET /api/leads`
- `GET /api/leads/:id/full`
- `PATCH /api/leads/:id`
- `GET /api/leads/:id/last-call`
- `GET /api/telnyx/numbers`
- `GET /api/instantly/senders`
- `POST /api/lead/send-message`
- `POST /api/messages`
- `PUT /api/approvals/:id`
- `POST /api/calls/:id/action`
- `GET /api/calls/:id/replay`
- DocuSign, Telnyx, email, and Instantly webhook routes

### New endpoints

#### Threads

- `GET /api/conversations`
  - Cursor pagination.
  - Search by seller, address, phone, email, stage, tag, and event body.
  - Filters for unread, pinned, live, approval-linked, DNC, channel, agent, stage, and SLA.
- `GET /api/conversations/:threadId`
- `GET /api/conversations/:threadId/timeline`
  - Cursor pagination ordered by `occurred_at`.
- `PATCH /api/conversations/:threadId`
  - Mark read/unread, pin, archive, assign, report spam.
- `POST /api/conversations/:threadId/merge`
  - Approval/permission protected.

#### Messaging

- `POST /api/conversations/:threadId/messages`
  - Body includes `channel`, `senderIdentityId`, recipient, message, subject, schedule, and source.
- `POST /api/conversations/:threadId/sender-recommendation`
- `POST /api/conversations/:threadId/refine-draft`
- `PATCH /api/conversation-events/:eventId`
  - Soft hide/delete only.
- `POST /api/conversation-events/:eventId/restore`
- `POST /api/conversation-events/:eventId/report-spam`

#### Sender identity management

- `GET /api/communication-identities`
- `POST /api/communication-identities/sync`
- `PATCH /api/communication-identities/:identityId`
  - Pause, quarantine, retire, restore, set default.
- `POST /api/communication-identities/:identityId/release-request`
  - Creates an approval task.
- `POST /api/communication-identities/:identityId/release`
  - Internal approval execution route only.

## 7. Webhook and Source Wiring

The following paths must append or update conversation events:

- Telnyx inbound SMS.
- Telnyx outbound SMS provider result.
- Telnyx call start, transcript, completion, and recording.
- Instantly reply and delivery/open events when available.
- General email webhook.
- DocuSign sent, delivered, viewed, declined, voided, and completed.
- Approval creation and decision.
- Lead notes and edits.
- Scheduled-message creation and execution.

Provider webhook retries must update the same event rather than duplicate it.

## 8. Inbox and Approvals UX

The lobby keeps:

- Modern PBK hero.
- Approval cards with payload previews.
- Confirmation for high-risk actions.
- Quick compose.
- Bridge error/retry states.

The icon lanes replace generic summary presentation for the three primary signals. On mobile they become compact horizontal rows with icon, copy, and count.

The page adds `Open Unified Inbox` next to `New message`.

## 9. Unified Workspace UX

### Thread rail

- Sticky search.
- Smart filters.
- One row per seller/contact.
- Channel indicators summarize activity without creating channel-specific duplicate threads.
- SLA and unread states use icon plus text, not color alone.
- Unknown contacts can be converted into or merged with a lead.

### Timeline

- Rounded inbound and outbound bubbles.
- Calls, approvals, DocuSign, notes, and system activity use timeline event rows.
- Call transcript can expand inline.
- Transcript words/time blocks can seek playback when timestamps exist.
- Bubble context menu supports:
  - Soft delete with Undo.
  - Report spam.
  - Mark important.
  - Copy.
- Delete never removes provider audit history immediately.

### Composer

- SMS/email segmented control.
- Explicit sender identity picker.
- Recipient comes from the selected thread/lead.
- Subject appears for email.
- Telnyx segment count remains accurate for GSM-7 and UCS-2.
- Voice dictation.
- Ava refine/polish.
- Smart replies.
- Send now and schedule.
- Provider and approval result remains visible until acknowledged.

### Live engagement

- Floating picture-in-picture during live calls.
- Seller/Ava talk-time bars.
- Sentiment direction with textual label.
- Live transcript.
- Mark important, follow-up, and add-note actions.
- Expand to full call pane without losing the conversation draft.

## 10. Lead Portal UX

Every canonical lead gets `/leads/:leadId`.

The portal contains:

- Seller identity and relationship.
- Complete contactability and compliance.
- Property attributes.
- Motivation and timeline.
- ARV, MAO, repairs, ask, mortgage, and selected path.
- Assigned agent and stage.
- Tags.
- Seller notes and internal notes.
- Ava pre-call brief.
- Unified timeline.
- Calls and recordings.
- Documents and DocuSign status.
- Analyzer handoff.
- Contract preparation.

The current new-lead form remains the canonical create flow and writes the same lead record used by the portal.

The existing `/leads?lead=:id` URL continues to work and redirects or normalizes to `/leads/:leadId`.

## 11. Responsive Behavior

### Desktop

- Three-region unified workspace.
- Lead inspector can collapse.
- Thread and profile widths use stable min/max constraints.

### Tablet

- Thread rail plus timeline.
- Lead inspector opens as a drawer.

### Mobile

- Bottom shell navigation always exposes all major pages.
- Thread list and conversation are separate navigation states.
- Back action is always visible.
- Profile opens as a bottom sheet or lead page.
- Composer respects safe-area insets and the software keyboard.
- Live-call PiP remains above composer and bottom navigation.
- Message bubbles cap at 88% width.
- No horizontal page overflow at 320px.

## 12. Accessibility

- All icon-only buttons use Lucide icons and accessible names.
- Lobby lanes include visible labels and supporting text.
- Status is never color-only.
- Timeline uses semantic list/article structure.
- New incoming events use `aria-live="polite"` without interrupting typing.
- Composer validation is associated with the relevant field.
- Menus support keyboard navigation, Escape, focus return, and mobile long-press alternatives.
- Reduced-motion preference disables decorative transitions.

## 13. Security and Compliance

- New Supabase tables enable RLS.
- Service role receives bridge-only write policies.
- Client code does not query privileged tables directly.
- Sender provider secrets remain on Render.
- Phone/email values are masked where full values are unnecessary.
- Provider release, thread merge, and destructive actions are auditable.
- DNC and TCPA checks run before sender recommendation and send.
- Reporting spam does not automatically create a DNC record unless the content is an explicit opt-out or the operator confirms it.
- Released identities remain referenced by historical event snapshots.

## 14. Failure Behavior

- If Postgres conversation tables are unavailable, `/inbox` continues using current runtime data.
- `/inbox/conversations` shows a transparent degraded-mode banner and can derive a temporary read-only thread view.
- Sending continues through existing bridge routes only when the operator has a valid selected identity.
- Provider inventory failure shows existing defaults only if clearly labeled as fallback.
- No fake sender, thread, transcript, contract, or lead data is introduced.

## 15. Migration and Backfill

The migration is additive.

Backfill order:

1. Create canonical lead threads.
2. Link normalized lead phone/email identities.
3. Backfill `unified_messages`.
4. Backfill calls and recordings.
5. Backfill contracts/DocuSign lifecycle.
6. Backfill lead-scoped `activity_log`.
7. Recompute thread previews, unread counts, and last activity.

The bridge self-ensure hook mirrors the migration so a newly deployed container can create missing structures safely.

## 16. Testing and Release Gates

Required automated coverage:

- Phone/email normalization.
- Thread creation and identity fallback.
- Provisional thread merge.
- Webhook idempotency.
- Sender recommendation policy.
- Retired/warming identity exclusion.
- Release approval flow.
- Unified timeline ordering.
- Soft delete and Undo restore.
- Spam reporting.
- Mobile route transitions.
- Composer channel and identity switching.
- Lead portal source integrity.
- Accessibility smoke tests.

Required verification:

- Typecheck, lint, build, existing PBK smoke tests.
- Supabase migration in a non-production branch/project first.
- Bridge endpoint smoke tests.
- BrowserOS desktop, tablet, and 320px mobile passes.
- Visual comparison against the approved browser companion and legacy PBK prototype.
- Netlify preview before production publish.
- Render health/log verification after bridge deployment.

## 17. Explicit Non-Goals

- No channel-specific duplicate inboxes.
- No hard deletion of communication history by default.
- No automatic number release.
- No fake live transcripts or provider health.
- No rewrite of Deal Analyzer calculations.
- No replacement of existing approval safety gates.

## 18. Success Criteria

The modernization is complete when:

- One seller appears once in the thread rail.
- SMS, email, calls, DocuSign, approvals, and notes appear chronologically.
- The operator can see and choose the exact Telnyx/Instantly sender.
- Retired identities cannot send but remain historically visible.
- Inbox and Approvals remains a fast, familiar triage page.
- Every lead opens a complete, mobile-usable portal.
- Ava uses the same seller context as the operator.
- Every displayed operational record is traceable to a real endpoint or database source.
