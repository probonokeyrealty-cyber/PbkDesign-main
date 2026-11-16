# Faster Triage Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development`. Execute one focused implementation task, perform spec review and code-quality review, then move to the next task. Obtain fresh-context review before release; pushing or deployment requires explicit release approval. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved faster-triage Figma concepts in existing Today/Review and Lead Workspace routes, locally only.

**Architecture:** Reuse the loaded lead roster, ranked queue, validated queue-return state, Decision Rail and workspace sections. Add a small pure display resolver for exact-ID joins and stored next-step availability. Presentation and navigation only; no new bridge endpoints or provider handlers.

**Tech Stack:** React, TypeScript, existing PBK CSS/tokens, Lucide, Node tests and isolated Playwright Chromium/WebKit fixtures.

**Spec:** Approved Figma frames 18:181 through 18:184 in CgFlpTt4v29czFbhXB9KMQ; output/design-discovery/faster-triage-review.md.

## Global Constraints

- No deployment, push, messages, production writes, or saved-lead/draft changes.
- Preserve exact IDs, queue return/focus, approval preflight/locking and durable duplicate protection.
- Preserve manual edits, blank-only autofill, ARV/sold comps and existing draft ownership.
- No inferred contact eligibility, priorities, freshness thresholds or draft inventory.
- ATTOM, MLS photos and Zillow link-only remain separate.
- Keep Fraunces/Geist; scope a pinned, licensed JetBrains Mono Nerd Font to operational type, not icon replacement. With no screenshot attachment, use the official JetBrains Mono NL Nerd Font Mono family.

## Review Focus

- Prefix/name/address collisions must never attach another seller's next step.
- Missing fields differ from explicitly empty fields; manual wording is not rewritten.
- Navigation, section jumps and Escape must not save or dispatch; drafts remain unchanged.
- Offline/changed/unknown approval outcomes retain existing guards and never invite blind retry.
- Long next steps and IDs wrap at 320/390px, and jump targets receive keyboard focus without being hidden.

### Task 1: Exact-ID Read-Only Display Resolution

**Files:** src/app/utils/leadTriage.ts; scripts/lead-triage.node-test.mjs.
- [x] Write and run failing cases for canonical ID joins, conflicts, absent/malformed/empty fields and verbatim text.
- [x] Implement pure resolvers without network/storage writes.
- [x] Run unit tests and baseline context tests.

### Task 2: Existing Surface Enhancements

**Files:** src/app/routes/CommandCenter.tsx; src/app/routes/LeadPortal.tsx; src/styles/faster-triage.css; local font assets and attribution.
- [x] Add an isolated browser regression demonstrating the missing subtitle/jump behavior.
- [x] Surface stored next steps in existing ranked rows; move the queue beside existing Review and retain activity below.
- [x] Enhance existing workspace next-step/section links with focus-safe navigation; do not add a workspace approval queue.
- [x] Apply scoped responsive styling and licensed Nerd Font operational typography. Keep Lucide icons.

### Task 3: Verification And Local Preview

**Files:** scripts/faster-triage-browser-smoke.mjs; scripts/faster-triage-local-preview.mjs.
- [x] Test Chromium desktop, 390px Chromium/WebKit and 320px containment using synthetic state; abort every unexpected write and external request.
- [x] Verify same-name/different-ID history isolation, queue focus return, cancelled edits and unsent draft persistence.
- [x] Run existing Today/Review approval double-click/preflight/unknown-outcome regression against mocked providers, context tests, typecheck, scoped lint and build.
- [x] Run a fresh-context final review; fix actionable issues.
- [x] Leave an isolated sample-only local preview running; official font family selected and documented without claiming screenshot identification.

No commits or pushes are part of this local implementation request.

## Subsequent Release Authorization

The founder subsequently approved deployment and pushing only the faster-triage files to main. Before release, this isolated branch was fast-forwarded to current main without replacing other chats' work. Production must retain team-login protection on all deployments. Live verification is read-only: no lead saves, approval decisions, messages, calls or draft clearing.

Release revalidation: production build, MCP typecheck, isolated bridge smoke, 13 context/helper tests, four triage browser viewports and three approval browser cases passed. Typecheck passed on a standalone rerun after local memory pressure. The WebKit approval test's pause target now allows 60 seconds for its browser round trip rather than a race-prone 100ms; no approval runtime code changed. Eight isolated concurrency cases passed with one fake dispatch per approved action.

## Implementation Decisions

- Keep the bridge queue's existing ranking and records. The compact navigation is Work queue / Review section jumps, not a second All / Replies client-side queue.
- Validate ownership before merging either context alias or nested BANT. A foreign alias cannot override an owned manual next step. Resolve the actual bridge `recordKind: lead` / `recordId` shape to an exact workspace route.
- Self-host the existing Geist and Fraunces families for offline fidelity, with upstream OFL licenses; retain their established hierarchy. Pin Nerd Fonts to v3.5.1 for operational text only.
- Existing approval smoke polling checks now account for the hidden-tab 60-second backoff and drive read-retry timers. Runtime approval handlers are unchanged.
- Independent review found the context-ownership and queue-contract issues above; both received failing regression cases and fixes. Final re-review reported no remaining actionable findings.
- Local branch is based on main at `4ad9cbe`. Other chats advanced main during this local-only task; integration with that newer work remains a future release step.

## Final Verification

- `node --test scripts/lead-triage.node-test.mjs scripts/fleet-context.node-test.mjs`: 13 passed.
- `node scripts/faster-triage-browser-smoke.mjs`: Chromium 1440/390/320 and WebKit 390 passed. Exact-ID history, missing/empty states, focus, cancelled manual edits, existing composer draft restoration and containment checked; zero unexpected writes/external requests permitted.
- `node scripts/today-review-browser-smoke.mjs`: desktop Chromium, mobile Chromium and iPhone WebKit passed polling outage/recovery, failed preflight, keyboard cancellation, duplicate decisions and changed/unknown outcomes. Responses simulated; no production approval changed.
- `node scripts/approval-decision-concurrency-smoke.mjs`: 8 passed with an isolated temporary state directory and local fake provider. One simulated dispatch under concurrent/replayed approval attempts. An earlier run hit fixture startup timeout under simultaneous local testing; the rerun passed without changing its guards.
- `node scripts/command-battlefield-ranking-smoke.mjs`, typecheck, scoped ESLint, `git diff --check`, and production build passed.
- The reload browser test now waits for workspace/history rendering before reloading, avoiding an in-flight navigation abort in WebKit; page errors remain asserted empty.
- Chrome visual review confirmed 1440px Today layout and 390px Lead Workspace containment. Temporary viewport override reset. Screenshots are in `output/faster-triage/`.
- Read-only sample preview: http://127.0.0.1:5198/command-center. API writes return 403 and the self-only CSP blocks external connections. The preview does not read saved production leads or drafts.
- No commit, push, deployment, production lead edit, real provider send or Netlify visibility change performed.
