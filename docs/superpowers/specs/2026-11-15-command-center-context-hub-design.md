# Context-First Command Center Hub

Status: proposed design; approach selected by the user; implementation approval pending.

## Intent

Make Agents and Leads feel like connected workstations inside the existing PBK
Command Center. Operators should choose any available lead, inspect an agent in
that exact context, open the lead workspace, and return without reselecting the
agent, lead, or originating queue. Preserve the current shell and business logic.

The user selected the context-first approach on November 15, 2026. Claude Fable
5.1 in the original "Visualizing your brilliant moments" chat produced a
fictional-data hub wireframe and recommended this incremental approach first.
The repository remains the implementation source of truth; Claude's unverified
backend, DNC, and duplicate-window assumptions are not requirements.

## Approaches

1. **Context-first (selected):** full-roster lead selection and exact-ID handoffs
   inside existing Fleet and Lead Workspace routes. Lower scope, reuses existing
   reads and actions, and provides the context needed for later activity views.
2. **Activity-first (deferred):** agent-on-lead tasks, drafts, and receipt panels.
   Valuable for triage, but first requires verified lead-indexed data and status
   semantics; no new activity dashboard or backend is part of this slice.

## Current Behavior And Evidence

- `AgentFleet.tsx` fetches `GET /api/leads` but slices both the full response and
  snapshot fallback to 25 options. It defaults to the first available lead and
  does not currently initialize the selection from a lead query parameter.
- The bridge's lead roster GET combines saved and applied-batch leads. Retain
  this source; do not substitute the batch import endpoint or import any CSV.
- Fleet already has measured-readiness evidence, stale-preview protection,
  read-only preview, approval-backed call requests, and an Ava Chat link carrying
  `leadId`. Reuse these paths.
- Lead Workspace already matches conversations by exact lead ID and supports
  validated Today/Leads queue returns with filter, page, focus, and scroll state.
  Do not broaden `readLeadQueueReturn` into arbitrary URL navigation.

## First Slice

### Full-Roster Selection

Keep all canonical-ID-bearing records returned by `fetchLeadsRequest`, rather
than truncating the backing collection. Provide a labeled, keyboard-accessible
search and selection control using existing components and PBK tokens. Search
the loaded roster by display name, property address, or exact lead ID. Any
rendered-page limit must expose navigation to every matching record; no silent
25-record cap. Keep the selected record identifiable when the search changes.

Display the source and loaded count honestly. A snapshot fallback is explicitly
incomplete, not a confirmed full roster. Failed or empty reads must not erase or
change saved lead data. Do not invent roster completeness or last-updated times.

### Exact Context

Use `/fleet?leadId=<canonical-id>&agent=<registry-agent-id>` for an explicit Fleet
context. Existing Ava links continue to use their existing `leadId` contract.
Treat query parameters as untrusted, bounded strings; match against canonical
lead IDs and actual registry IDs, never a seller name, address, phone, or array
position. Keep exact IDs in URLs, not seller contact fields.

When an explicit lead ID is missing, unresolved, or absent from an incomplete
fallback, show that state and disable context-dependent actions. Never silently
substitute the first lead. With no explicit context, preserve the existing
direct-entry behavior; the operator can change the selection normally. Unknown
agent IDs are visibly unresolved rather than silently authorizing another agent.
Explicit user selection replaces the unresolved parameter and clears old preview
evidence. Rapid changes retain the existing stale-response guard.

### Two-Way Handoff And Queue Return

The context-preserving entry point is a secondary `Inspect agent` navigation
action in Lead Workspace, beside its existing work links. It opens Fleet with
the exact lead ID and a valid registry agent, carrying the existing Today/Leads
queue return when present. No new Today/Leads queue controls or global sidebar
selection store are needed. A direct sidebar visit to Fleet remains direct entry.
This entry point is the builder's proposed scope choice, not a separate user
request to redesign navigation.

Add an `Open lead workspace` link to Fleet's selected-context area. Open
`/leads/<encoded-canonical-id>` and carry a validated, bounded `fleetReturn`
navigation-state object with the selected agent, exact lead, Fleet search,
scroll position, and optional existing Today/Leads queue-return object.

Use a focused validator alongside the existing queue-return helper; do not
interpret an arbitrary `from` URL or spread unvalidated navigation state.
Accept Fleet return state only when its lead ID matches the workspace lead.
Reject external paths, malformed values, oversized data, and mismatched leads.

Workspace shows `Back to Fleet` only for valid matching Fleet context. Returning
restores Fleet's agent, lead, search, and focus to the workspace-launch control.
Fleet can then return to its original Today/Leads queue using the existing queue
contract. Preserve the original queue's item identity, filter, page, and scroll;
do not replace its item ID with a seller ID. No history-length guessing.

When Fleet was entered from Workspace without a queue, its outer Back returns
to that exact Workspace route without a `fleetReturn` descriptor, preventing a
Back loop. With neither a valid Workspace entry nor a queue, its fallback is
Leads. Entry descriptors are validated against the currently selected exact lead;
they are discarded when the user explicitly selects a different lead. Ordinary
browser Back still follows browser history without dispatching work.

URL context survives a Fleet reload. Browser navigation state may preserve the
return descriptor through reload; if absent, the safe fallback is the existing
Leads route, not another lead or a guessed origin. Do not introduce a global
last-selected-lead store that can override explicit route context across tabs.

### Visual And Responsive Behavior

Use a compact context strip within the current Fleet and Workspace structures:
lead label, a copyable/readable canonical ID, selected agent where applicable,
existing source/readiness status, and the relevant navigation command. No new
shell, marketing hero, giant metrics, duplicate composer, or approval queue.

At 1440px keep the existing roster/details arrangement. At 390px and 320px wrap
the strip and controls above the existing bottom navigation; preserve readable
text and reachable actions. Use existing Fraunces/Geist/mono fonts and PBK tokens.
Do not add a new mobile bottom sheet in this slice.

Search changes do not steal focus. Route transitions focus the relevant page
heading; explicit Back restores the originating control after data loads, with
a safe heading fallback if that control no longer exists. Loading, no matches,
unresolved context, snapshot fallback, and offline states must be distinct.

## Safety And Non-Goals

- No calls, texts, emails, agent runs, approval entries, saves, imports, or
  provider writes from selection, search, mount, refresh, or navigation.
- Keep existing action handlers, server approval gates, pending locks,
  idempotency, and per-number DNC/consent/contact-slot checks unchanged. Do not
  infer permission from another phone's status or introduce a retry window.
- Do not touch manual edits, unsent drafts, ATTOM preview application, MLS/photo
  separation, blank-only autofill, Analyzer ARV calculations, or sold comps.
- Exact-ID conversation matching remains unchanged. No new thread binding.
- Do not show cross-route approval counts, freshness, or completed-task claims
  unless backed by an existing verified source; omit unavailable facts.
- No deployment, push, merge, real-provider test, or privacy weakening.

## Acceptance And Verification

Use synthetic data only, block non-loopback HTTP and WebSockets, and deny or
record all unexpected writes. Include at least 60 fictional roster records and
an explicitly linked record beyond index 25.

1. Search/select a lead beyond index 25 and retain its exact ID through Fleet,
   Workspace, Fleet, and reload; changing filters does not select a different lead.
2. Preserve agent selection, original queue/filter/page/item, focus, and scroll
   on explicit return; direct entry and invalid-return state fall back safely.
   Cover Today -> Workspace -> Fleet -> Workspace -> Fleet -> Today and the
   equivalent filtered Leads journey; also test Workspace -> Fleet without a queue.
3. Unknown/deleted IDs, duplicate names/phones/addresses, malformed parameters,
   out-of-order preview responses, offline reads, and incomplete fallbacks never
   substitute another seller or enable context-dependent actions.
4. Navigation/search/reload produce zero business writes. Existing draft,
   manual-field, exact-thread, ARV, and sold-comp regression suites remain green.
5. Existing fixture call requests still force approval, and isolated concurrent
   approval/replay tests still produce one fixture dispatch, never a real send.
6. Check keyboard flow, accessible labels, focus restoration, and zero viewport
   overflow in desktop Chromium and 390px WebKit; include a 320px containment check.
7. Run focused tests, typecheck, lint, and build. Record failures honestly.

Baseline on November 15: roster/control/lead-safety source tests and isolated
approval concurrency tests passed (8 concurrency cases). Fleet and Workspace
browser baselines timed out during local Vite navigation before UI assertions.
Resolve the local verification environment before claiming responsive behavior
or implementation readiness; do not unprotect production to work around it.

## Builder Decisions And Approval

The builder may choose the existing accessible search/select component, helper
names, and test file structure. Keep the write scope limited to Fleet, its
Workspace return integration, small context validation/presentation helpers,
existing PBK styles, and focused tests. No backend schema or provider adapter
changes are expected.

This document is not approval to implement. After the user approves the design,
write the implementation plan, build locally, verify with isolated fixtures and
responsive screenshots, and obtain independent safety review. Do not commit or
deploy this proposal without a separate instruction.

Builder review identified the missing context-preserving Fleet entry point; the
Workspace `Inspect agent` action and explicit no-queue Back behavior above resolve
that question without expanding the global navigation or changing backend logic.
