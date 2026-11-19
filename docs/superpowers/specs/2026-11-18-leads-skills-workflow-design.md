# Leads And Skill Studio Workflow-First Design

Status: direction selected; independent builder check complete; detailed design
approval pending. Documentation only.
Base: main `5cb15fb69851406126a6faff2d5e0c13f47f8920` (includes PR #38).
Local branch: `codex/leads-skills-workflow-design`.

## Intent And Decision

Help PBK's own operators find the right seller or skill version, understand the
recorded facts, and reach the existing next action with less scanning. Preserve
the Command Center's visual identity and operational safeguards. This is not a
new CRM, learning backend, approval policy, or desktop/browser experience.

The founder selected **workflow-first in-place design** rather than visual-only
polish. Selection of this direction is not approval of this document or of code,
publication, merging, migration, deployment, or live business actions.

Claude's original design conversation supplied the advisory scan-and-act proposal:
[original conversation](https://claude.ai/chat/1f94828f-e766-4a2c-82c7-82463c84b05e).
The source inspection below overrides unverified assumptions in that proposal.

## Approaches

1. **Workflow-first in place (selected):** strengthen existing worklists,
   selection, keyboard movement, truthful labels, evidence hierarchy and action
   discoverability. More interaction testing than a skin change, but useful
   functionality without a new operational backend or navigation model.
2. **Visual-only polish (not selected):** spacing, contrast and typography only.
   Smaller scope, but leaves ambiguous filter labels, weak keyboard movement and
   simulated-versus-recorded evidence distinctions largely unresolved.
3. **Stage lanes and replacement drawers (ruled out):** useful for a different
   product direction, but duplicates present filters, anchors and mobile detail
   handling. Not part of the selected in-place approach.

## Source-Verified Starting Point

| Surface | Existing behavior to enhance, not duplicate |
| --- | --- |
| `src/app/routes/Leads.tsx` | Search/filter loaded leads, paginate with `CompactPager`, select exact IDs, show detail, open the canonical workspace and existing guarded create/edit/call/SMS/nurture/contract paths. The phone filter checks format; the contract filter checks email syntax, not actual readiness. |
| `src/app/routes/LeadPortal.tsx` | Canonical lead context, validated queue/Fleet returns, Next step/Timeline/Numbers/Property anchors and an existing stored-next-step section. |
| `src/app/components/leads/LeadPortalProperty.tsx` | Existing property tabs and recently expanded saved ATTOM records, photos, comps and explicit refresh/save operations. Preserve the PR #38 work. |
| `src/app/routes/SkillStudio.tsx` | Repository/search/lifecycle/agent/risk/performance filters, loaded-result pagination, review queue, selected-version canvas, details inspector, section anchors, lifecycle track, four-step Teach Ava wizard and existing governance confirmations. |
| Skill Studio preview | `buildSkillSimulation` extracts saved instructions and local scenario text. It is not a model evaluation and does not establish outcome, canary or launch evidence. |
| Skill Studio selection | `openSkillVersion` sets local selection and focuses the version heading. Current query handling supports candidate entry; a reliable version deep link is not verified. Do not claim it exists. |
| `src/app/utils/runtimeBridge.ts` | Existing repository/status/outcomes/trends reads and candidate/approve/activate/rollback writes. Approval binds `versionId` and `expectedHash`; activation and rollback have their own current contracts. No replacement client or endpoint. |
| Existing evidence | Repository items type provenance, safety scan, created/approved facts and activation fields. Full approval/rollback history and per-version outcome attribution are not guaranteed by that type. |

Read `AGENTS.md`, `CLAUDE.md`, `DESIGN.md` and `PBK_DESIGN.md` before implementing.
Older context-hub and Skill Studio specs are background, not proof that every
proposed capability shipped. The current source is authoritative.

## Goals And Non-Goals

The first slice improves scan-to-selection, predictable keyboard use, exact-ID
context, legible evidence and existing actions. It preserves every rendered
record's access through pagination and distinguishes missing data from measured
zero. Success means observable workflow improvements, not a new visual theme or
an invented conversion/latency claim.

Do not add a kanban view, global selection store, duplicate composer, mobile
bottom sheet/bar, agent runtime, model evaluator, server-side draft inventory,
automatic research, new history service, database schema or provider connection.
Do not change eligibility, approval thresholds, rollout percentages, DNC/TCPA
logic, dispatch locks, retry behavior, or memory scope. Rex stays in Brain.

PR #35 remains draft and unmerged. Its branch, commits and hold are untouched.
No seller calls, SMS, email, contract delivery, provider lookup, live skill
approval/activation/rollback, delivery retry or dispatch reconciliation is
authorized by this design task.

## Shared Visual And Interaction Contract

- Keep the existing rail width, header, favorite links and mobile navigation.
  The hosted React routes and their Electron presentation remain the working
  surface. Preserve legacy entry links and behavior; do not build a parallel
  legacy UI or a second operational implementation.
- Use existing graphite surfaces, sky selection/action, amber pending, crimson
  failure and lime measured-success tokens. Keep Fraunces, Geist and JetBrains
  Mono. Do not add a palette, gradient decoration, hero, illustration or card wall.
- Preserve existing route grids. Leads currently uses a 280-420px roster track
  and a `minmax(0, 1fr)` detail track. Skill Studio already has repository,
  canvas and inspector tracks. Use zero minimums and wrapping at narrow widths;
  do not introduce Claude's hard-coded 760px detail minimum or 56px shell rail.
- Builder-proposed starting spacing: 12px row gutters, 16px detail padding,
  existing 8px item radii where applicable. Rows have minimum, not fixed, height:
  long seller names, skill names, addresses and IDs must wrap without overlap.
- Controls have at least 44px reachable targets. At 390/320px, keep search
  visible and full width, wrap filters/actions or contain filter scrolling
  within its own region, and retain the current mobile repository/detail flow.
  True data tables may scroll within their own container, never the page.
- Reuse Lucide icons with accessible names/tooltips for unfamiliar commands.
  Use a visible focus outline, selected-row contrast and non-color state text.
  Copy/status/error text is operational, not a feature tutorial.
- Keep native button/link semantics. Existing selection buttons use
  `aria-pressed`; do not apply `aria-selected` to an arbitrary button or impose
  a listbox role around nested call/edit controls.

## Leads And Lead Workspace

### Roster And Filters

Use the existing `SellerRosterIdentity`, pipeline rail, search, pager and
selection state. Put seller identity/address first, with the recorded score,
stage/path and available timestamp in a consistent secondary row. Keep tag,
financial and quick-action information reachable; do not remove existing useful
fields merely to force a two-line row. Add no fabricated draft, approval,
per-number outcome or freshness badge.

Builder-proposed labels are **Phone format OK** and **Email format OK** for the
current `callable` and `contract` filter values. Keep their predicates and stored
filter keys unchanged. This makes the UI describe the actual check without
claiming permission to contact, verified deliverability or contract readiness.
Hot 80+ remains the recorded-score filter, not a readiness signal.

Counts describe the loaded roster, filtered matches and current page separately.
Do not treat a page length, snapshot fallback or capped response as a complete
database total. Do not add a count endpoint or hidden provider fetch.

### Keyboard And Selection

On a roster's main selection button only, Arrow Up/Down and Home/End move focus
among the current page's visible selection buttons. They do not change selected
ID, load another page, open a lead, or clear a draft. Enter/Space retain the
button's existing explicit selection behavior. The existing workspace link
retains normal link activation; Enter must not silently acquire a second meaning.

Do not intercept typing, modified shortcuts, quick-action buttons, input fields,
dialogs or another list. Keep ordinary Tab access to filters, rows and actions.
Search/filter/pager controls retain focus while changing results. If the focused
row disappears, fall back to the current search/heading rather than another ID.

### Detail And Workspace

Keep exact lead identity visible above existing contactability, deal context and
action groups. Reorder existing fields only where needed for scan hierarchy;
do not invent contact-slot data or move identity-bearing actions onto another
record. Preserve existing handlers, confirmations and server error messages.
Separate destructive Delete visually from navigation and outreach commands.

Keep `LeadPortalHeader`, its context strip, existing anchors and Next step
section. Refine spacing, focus and selected-anchor treatment only; no second
next-step panel or unverified manual/timeline provenance label. Anchor offsets
must leave headings visible below the header at all three target widths.

Use current queue/Fleet validators and exact canonical IDs for Open workspace
and Back. Restore the existing query, filter, page, scroll and focus context;
never replace a queue item ID with an address/name or accept an arbitrary return
URL. Do not modify property data, Analyzer drafts, reviewed comps, saved photos,
the newer property-record groups or their explicit refresh/save boundaries.

## Skill Studio

### Repository And Version Identity

Keep repository filters, review queue, pager, local selected-version state and
existing mobile Repository/Inspect controls. Apply the same focus-only keyboard
pattern as Leads, scoped to the skill selection buttons. Display saved name,
version number, agent and exact stored lifecycle state consistently; expose the
exact `versionId` in the existing version header, with an explicit Copy ID command
using the existing clipboard/toast pattern when available. A clipboard failure
reports failure rather than claiming success. No copy runs automatically.

Version-specific URLs, cross-filter recovery and reload persistence are deferred.
Do not add a misleading Copy version link command or silently substitute the
first version for an unresolved explicit version. Ordinary local selection
continues to follow current behavior in this slice.

### Evidence Before Decision, Without New Tabs

The current navigation is **section anchors plus an inspector**, not four
Evidence/Instruction/Preview/Governance tabs. Preserve existing section IDs
(`skill-simulator`, `skill-outcome-proof`, `skill-decision`, inspector targets)
and reorder the existing evidence navigation/sections so recorded outcomes are
easy to reach before the decision. Keep saved instructions as the existing
disclosure and provenance/safety/approval facts in the current inspector.
Do not create duplicate tabs, history panels or policy checklists.

Show each metric only for the selected version and only with the meaning and
period the response actually supplies. Missing uses, success, confidence or
change is **Not recorded**, not zero performance; a genuinely recorded numeric
zero remains zero. A missing period cannot be labeled 30d or weekly by inference.
Implement display normalization separately from existing ranking, training-queue
priority and governance eligibility calculations; this slice must not retune them.

Keep the seven lifecycle positions, highlight the current stored stage and use
neutral earlier-stage markers. Earlier positions are not independent test passes.
Unknown states remain visibly unknown and earn no inferred completed stages.
Preview never changes lifecycle, evidence, readiness, approval or activation.

### Preview, Wizard And Existing Governance

Use the existing simulation-only status and saved response/next-question/risk
sections. Make it clear this is an instruction preview, not a model test, without
adding a new run/evaluate button, score or fake completion receipt.

Retain the Teach Ava wizard's four steps and fields, including source ingestion.
Improve its existing stepper and footer containment rather than adding a second
stepper. Preserve entered values, validation, preview and current submission
contract. Reordering DOM must not remount/reset a current form. Do not promise
new persistence across reload, selection or sign-out. Explicitly selecting another
version retains the current scenario-seeding behavior; focus-only movement must
not trigger that selection effect.

Approve, activate and rollback keep their existing request bodies, target IDs,
content hash, rollout controls, confirmation, busy handling and server authority.
Do not make evidence display or a client checklist a new approval rule. A server
rejection remains a rejection. Never label an approval, queued request or local
preview as delivery, successful canary evidence or production launch readiness.

## State, Identity And Request Boundaries

| State | Required behavior |
| --- | --- |
| Initial load | Stable skeleton/list geometry; unknown counters, not invented zeros; no automatic action or first-record readiness claim. |
| Empty result | Distinguish no loaded records from no matches. Clear existing filters through the current controls; no provider lookup or business write. |
| Updating selection | Every detail, metric and action belongs to its exact current lead/version. Old data may remain under its own labeled identity, never relabeled as the new target. Preserve current stale-response protection. |
| Loading/error with prior data | Label retained data using existing known timestamps or simply Saved/retained if no time exists. Do not invent a last-refreshed date. Existing guards remain; target-changing/confirmation-pending refresh must not enable a stale-target write. |
| Missing evidence | Not recorded/Unknown; no success coloring, completed-stage assertion, zero win rate, fake history or guessed freshness threshold. |
| Busy/confirmation | Preserve current busy and confirmation ownership. Focus/reorder/filter must not retarget a pending action to another record. |
| Offline/read failure | Keep existing read-error and cached-data distinction. Do not claim browser connectivity is proof of bridge availability. No new queue, retry or cache authority. |
| Unsaved input | Do not clear, overwrite or remount existing forms/drafts during new focus/navigation behavior. No blanket persistence promise or destructive sign-out rule. |

Existing roster/detail/repository/status reads, including debounced search and
normal runtime read/session traffic, remain allowed. Newly added focus, display,
copy or anchor behavior must not create provider, business or governance effects.
Changing view/search/sort/selection never initiates property refresh, paid ATTOM
requests, analysis runs, messages, calls, imports, approval entries or activation.
No new endpoint, migration, secret or environment flag is part of this slice.

## Deferred Functional Work

These are proposals, not shipped capabilities or silently approved requirements:

| Proposal | Required investigation before a separate design/build |
| --- | --- |
| Copyable version deep links | Exact-ID URL contract, bounded validation, lookup beyond capped/filtered results, unresolved state and no silent fallback. |
| Draft/in-review chips and Resume | Real lead-indexed draft/approval records, privacy scope, timestamps and persistence contract. |
| Per-number contact/outcome display | Canonical per-number adapter fields and explicit consent/contact-slot semantics. |
| Version-specific outcome and trend integration | Existing wrappers' actual attribution, timestamps, sample/window semantics and missing-data behavior. No claim the whole backend is absent. |
| Independent model practice or canary evidence | Existing eval integration, real execution receipts, rubric/provenance and strict evidence verification; previews never substitute. |
| History and missing-requirement checklists | Only actual returned history/policy facts, not UI-created activation prerequisites or synthetic rollback events. |

## Acceptance And Verification For A Later Build

1. At 1440, 390 and 320px preserve PBK's rail/mobile navigation, readable identity,
   property media and zero horizontal viewport overflow. Targets are at least
   44px and focus is visible; long names, IDs, addresses and errors wrap.
2. Both worklists expose every loaded match through the existing pager. Counts
   distinguish loaded/filtered/page results and retain snapshot caveats. Include
   at least 60 synthetic records to exercise later pages and empty filters.
3. Arrow/Home/End navigation changes focus only. Enter/Space use the current
   selection handler. Quick actions, text inputs and dialogs keep their original
   keys. Back restores the original exact queue identity and focus or safe fallback.
4. Phone/email filter labels accurately describe unchanged syntax predicates;
   missing consent, DNC, contact-slot or contract evidence never becomes clearance.
5. Recorded zero, missing, malformed, percentage/fraction and missing-period
   metric fixtures render honestly without changing ranking/eligibility behavior.
   Preview input/output changes no saved evidence or lifecycle state.
6. Explicit selection and delayed/reversed GET responses never show one lead's
   or version's facts as another's or retarget a confirmation. Preserve existing
   form, preview, property and draft state under their current ownership rules.
7. UI navigation/filter/copy/preview paths produce zero paid-provider lookups and
   zero business/governance writes. Log requests in synthetic isolated fixtures;
   allow only documented existing read/session paths, not broad invoke exemptions.
8. Existing create/edit/SMS/call/contract/approve/activate/rollback paths retain
   their confirmation and rejection behavior in mocked tests. Real delivery and
   live governance mutations are prohibited during verification.
9. Run typecheck, lint and production build after code changes. Reuse and extend
   `scripts/leads-design-browser-smoke.mjs`, `scripts/skill-studio-design-browser-smoke.mjs`,
   `scripts/skill-studio-ui-smoke.mjs`, queue-return, lead-controls, workspace-
   guidance, context-hub and property regressions as applicable. Do not weaken
   existing tests merely to accept a changed label or layout.
10. Browser verification uses synthetic data and denies non-loopback HTTP and
    WebSockets. Follow project hosted/runtime and BrowserOS checks when their
    paths change, with live review read-only and separately scoped; browser access
    or approval trouble must not be bypassed. No real seller data is sent to an
    external design service. Report blocked verification rather than claiming it.

## Builder Decisions And Approval Boundary

The spacing defaults, exact proposed filter labels, focus-only arrow behavior,
section-anchor approach and Copy ID-only first slice are builder proposals in
this document, not previously founder-approved detail. The builder may choose
small page-scoped CSS/component changes and test fixture organization that reuse
existing conventions. No general refactor, shared-state rewrite or new UI kit.

Proposed order after approval: Leads roster/navigation and truthful labels,
then Skill Studio identity/evidence/preview hierarchy, then cross-route/state and
responsive verification. Work is local on a separate branch; pushing, PR creation,
merge, deployment and production testing require their own explicit instruction.

An independent frontend/product builder checked this document and relevant
source and reported no material unanswered planning questions. Document structure,
ASCII encoding and named source/test references were checked locally. Product
code and UI were not changed; build/browser tests have not been run for a new UI.

This document needs founder approval before implementation planning. Approval of
this design would authorize writing a plan,
not live operations. The next artifact is a separately reviewed implementation
plan; no product code, dependency installation or prototype scaffold is part of
the current design-writing step.
