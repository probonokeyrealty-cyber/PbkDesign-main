# Property Evidence Brief Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` for remaining focused work and independent review.

**Goal:** Make the saved property evidence and remaining review work easy to scan without changing the original design or provider/save boundaries.

**Architecture:** A pure React section in the existing Property overview consumes the already address-validated saved record/listing/sales props. Local buttons open the existing Records, Photos and Comps tabs. It has no network, persistence, scoring or underwriting behavior.

**Tech Stack:** Existing React/TypeScript, PBK CSS tokens and Node/browser fixture tests. No dependencies.

**Design / approaches:** Repeated “continue” after the priority question is taken as direction to proceed with the first proposed improvement using judgment. My choice is a compact saved-evidence brief in Overview: Records, Photos and Comp review, source capture times, retained/unavailable dataset counts, and explicit next-review gaps. A new top-level screen would fragment the existing portal; an automated decision score would overstate the evidence. Original shell, artwork, typography and navigation remain intact.

## Global Constraints

- Saved evidence only. Opening the brief or its tabs must not refresh or write.
- Keep subject-address validation in the existing parent and strict hydration seam.
- Suggested sales are not operator-reviewed comps; intentional clears remain unreviewed.
- Retained evidence keeps its original source capture time. Never label it current or fresh.
- No inferred property value, distress finding, offer recommendation or completeness score.
- No overflow at 320px or 390px; keyboard actions focus the destination tab.

## Review Focus

Empty sources, retained/failed datasets, zero/false facts, malformed/duplicate selected sales, and changing leads must not create misleading coverage or carry evidence across subjects.

### Task 1: Saved evidence brief

- [x] Add failing component tests for empty evidence, populated/retained datasets, suggested versus reviewed selections, and local-only navigation.
- [x] Create `src/app/components/leads/PropertyEvidenceBrief.tsx`; consume sanitized snapshots and `RecentSalesResult`, reuse `reviewedCompIds`, show bounded counts and capture times.
- [x] Insert into Overview in `LeadPortalProperty.tsx`, using explicit local tab callbacks and focus refs. Extend `src/styles/property-intelligence.css` with existing tokens and mobile stacking.
- [x] Run component tests, typecheck, lint and build.

### Task 2: Verification and release

- [x] Extend the isolated CRM browser fixture to check initial brief, local navigation with zero provider reads/writes, refreshed/reviewed state, and sibling isolation on desktop/WebKit390/Chromium320.
- [x] Run relevant smoke gates and independent review; fix any findings.
- [ ] Publish a reviewable PR, pass candidate CI, then use the already approved deployment workflow and verify publication. Keep the existing ATTOM credentials and trigger behavior unchanged.

## Execution rulings

- The first implementation was completed inline with independent review. The repository alignment gate requires the subagent workflow for plans, so remaining verification follows that workflow; the original implementation history is unchanged.
- Independent review found that root snapshot times can advance while dataset captures remain older. The brief now explicitly separates Snapshot captured from Oldest retained dataset captured. RED/GREEN tests prove this distinction.
- Incomplete or invalid saved sales are excluded from brief counts using the existing positive-price and strict-date helpers. Suggested candidates remain separate from operator-selected saved IDs.
- Preserve the original gallery-first Overview flow; place the brief below the existing gallery and property-at-a-glance panel.

## Validation receipt

- Seven component tests pass, including RED/GREEN retained timestamp and invalid-comp regressions. Typecheck, lint, production build and the full UI release gate passed.
- Rebuilt desktop Chromium1440, mobile WebKit390 and Chromium320 checks pass: local tab actions and focus, passive zero provider reads/writes, refreshed and reviewed counts, saved source retention, reload and same-address sibling isolation, with no phone overflow.
- Independent task and whole-branch reviews found no remaining blockers. Provider/runtime/CRM persistence code, secrets and underwriting remain unchanged.
