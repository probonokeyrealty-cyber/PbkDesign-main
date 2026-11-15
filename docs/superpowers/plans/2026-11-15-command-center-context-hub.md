# Context-First Command Center Hub Implementation Plan

> **REQUIRED WORKFLOW:** Use superpowers:subagent-driven-development for implementation and obtain fresh-context review before release.

**Goal:** Make every loaded lead reachable in Fleet and preserve exact context and queue return through Workspace.

**Architecture:** Keep the existing React routes and runtime reads. Add bounded navigation-state validation separate from `LeadQueueReturn`, then wire two-way links and full-roster search without changing provider handlers.

**Tech Stack:** Existing React, React Router, TypeScript, PBK CSS, Node tests, Playwright Chromium/WebKit.

**Spec:** `docs/superpowers/specs/2026-11-15-command-center-context-hub-design.md` (user approved).

## Global Constraints

- Local only; no commit, push, deploy, business-record saves, or outreach.
- Preserve exact-ID conversations, manual edits, drafts, blank-only autofill, ARV, sold comps, approval gates, and durable phone safeguards.
- Reuse current PBK tokens, shell, routes, and bridge adapters.
- Leave unrelated privacy guards and other chats' work untouched.

## Review Focus

- Unknown/duplicate/context-mismatched IDs must not substitute another lead or agent.
- A selected record beyond position 25 remains accessible after filtering and return.
- Invalid navigation-state paths must never navigate externally or create Back loops.
- Rapid lead/agent switches must not restore stale previews or queue origin.
- Navigation, reload, search, and focus restoration must not invoke business writes.

## Task 1: Context Validation

Files: create `src/app/utils/fleetContext.ts` and `scripts/fleet-context.node-test.mjs`.

Interfaces: `readFleetRoute(search)`, `fleetHref(leadId, agentId)`, and
`readFleetReturn(value, leadId)`; bounded exact IDs, registry-agent syntax,
search text/scroll state, and optional validated `LeadQueueReturn`.

- [x] Write tests for valid round trips, duplicate/empty/oversized query values,
      mismatched lead IDs, malformed return state, and external queue paths.
- [x] Watch failures against minimal stubs, then implement the validator.
- [x] Run `node --test scripts/fleet-context.node-test.mjs` green.

## Task 2: Fleet And Workspace Handoffs

Files: modify `AgentFleet.tsx`, `LeadPortal.tsx`, `LeadPortalHeader.tsx`; add scoped
context-strip CSS under `src/styles/fleet-context.css`.

- [x] Add an isolated browser test `scripts/fleet-context-browser-smoke.mjs`
      with 60+ synthetic records; verify the missing search/handoff behavior fails.
- [x] Keep the full canonical-ID roster; add labeled search without silent caps.
- [x] Honor exact `leadId` and `agent` URL parameters; block unresolved context.
- [x] Add Workspace `Inspect agent` and Fleet `Open lead workspace`; pass only
      validated return metadata and preserve the original queue item identity.
- [x] Restore agent, selection, search, focus and scroll on explicit return;
      discard origins when explicitly changing leads, and avoid no-queue loops.
- [x] Keep existing handlers and read-only versus approval-backed action meanings.
- [x] Verify browser Back, reload, invalid and duplicate-name IDs, empty/offline
      states and zero navigation writes at desktop, 390px WebKit and 320px.

## Task 3: Regression And Review

- [x] Update the source-level roster test that currently requires the 25-row cap.
- [x] Run focused unit/browser tests, Fleet controls, lead safety, isolated
      approval concurrency, relevant context/draft/Analyzer regressions,
      typecheck, lint, and build; report all failures and do not run unsafe suites.
- [x] Use a local static build if Vite development transforms time out; do not
      change production settings or weaken tests to work around the environment.
- [x] Save and inspect desktop/mobile screenshots of synthetic records.
- [x] Obtain independent review, fix important findings with reproducing tests,
      and leave the implementation local with a usable preview URL.

## Execution Ledger

- Design approved; native local implementation requested. No additional product
  scope or release authority is inferred from that approval.
- Baseline source checks passed; 8 isolated approval concurrency cases passed.
  Existing development-server browser checks timed out before UI assertions.
- Ruling: implement in the current workspace, scoped to the listed UI/helpers
  and tests, because unrelated edits are known and preserved; no Git operations
  or shared runtime state changes are needed.
- Implemented full loaded-roster search, exact-ID context bands and two-way
  Workspace/Fleet links. Snapshot fallback is explicitly incomplete.
- TDD: helper stubs failed before implementation; five helper cases now pass.
  The first browser test failed on the missing search before UI implementation.
- Independent review found stale-seller handoff during loading, a preview lock,
  Browser Back losing search (including direct entry), and external font access
  in the standalone sample preview. Reproduced each failure, fixed it locally,
  and obtained source-level re-review with no remaining findings in those fixes.
- A nonzero-scroll test exposed the shell scroller versus window mismatch.
  Capture/restore now uses the existing shell container, with a window fallback.
- Final static browser suite passed Chromium 1440px, WebKit 390px, and Chromium
  320px: 65 synthetic leads, duplicate identities, explicit and direct-entry Back,
  Today/filtered Leads origins, exact conversation exclusion, delayed seller
  reads, out-of-order agent/lead previews, nonzero scroll, and zero business writes.
- The same browser suite verifies blank-only listing autofill preserves manually
  entered bedrooms, sold-comp averaging remains 2.5M, and Analyzer address/fields/
  comps persist after the Fleet journeys. No real API, import, or send was used.
- Eight isolated approval/replay/concurrent dispatch cases passed against a
  loopback fake provider. Eleven isolated agent diagnostics passed; these do not
  certify production readiness, real provider delivery, or cross-agent workloads.
- Typecheck, lint, static Vite production build, roster/control/lead-safety source
  checks, Analyzer lead-sync and lead-field-provenance checks passed. A lint
  control-regex failure was fixed without weakening validation.
- An older standalone Apify browser script failed against the static harness
  before fake bridge credentials were persisted for the Analyzer's host adapter.
  No product lookup change was made; the final isolated suite supplies that local
  fixture configuration and verifies the relevant autofill/underwriting behavior.
- Verification used local Node 24.14.1; repository CI targets Node 22.x. No
  dependency installation, production release, or CI run is implied.
- Anonymous Netlify checks returned 401 for Home, Leads and Settings. Protection
  settings were not changed. Unrelated concurrent work remains untouched.
- Read-only synthetic preview started on `http://127.0.0.1:49340/fleet?leadId=sample-47&agent=rex`.
  It serves static assets and sample GET responses only, rejects business writes
  with 405, closes WebSockets, and uses a self-only resource policy. Remote fonts
  fall back locally in this harness; production font configuration is unchanged.

## Release Authorization And Evidence

On November 15 the user separately authorized deployment and an isolated release
worktree. A scoped build on main `c1bc6ca` published as Netlify deploy
`6afa17c25928d85b1ed4c962`. Live Chrome checks at 1440px and 390px loaded all
1,256 leads and verified exact-ID Fleet/Workspace handoffs, Rex selection,
search/focus restoration, disabled messaging without a matching thread, and no
viewport overflow. No save, preview-agent, provider action, or approval decision
was invoked. Existing operator drafts were not edited.

An automatic main deployment then replaced that manual release. The user
explicitly approved pushing only the hub files to main, acknowledging that
existing CI/CD and any connected Render auto-deploy may run. The release worktree
was fast-forwarded to the latest main, retaining other chats' committed work and
excluding their uncommitted changes. Typecheck, isolated bridge/isolation tests,
and all eight isolated approval/concurrency tests passed again. Durable main
release and repeat hosted verification are the remaining release steps.

Pre/post manual-release checks confirmed team-login protection on all deployments
and anonymous HTTP 401 for Home, Leads, and Settings. No access controls changed.
