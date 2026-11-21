# PBK Proof-First Analytics

Status: approved by the founder for local implementation on 2026-11-21. No push or deployment authorized.

## Intent

Make PBK's results defensible before using the Command Center as its own case study. Repair analytics truth first, then polish the existing Analytics-to-lead inspection workflow. Keep PBK's current shell, assets, typography, and controls.

## Approaches

- Proof-first reporting, then workflow polish: selected by the founder. Correct the reporting chain before adding visual emphasis.
- Workflow-first polish: considered, but would leave misleading revenue and cost labels in place.
- External SaaS readiness first: considered, but tenant/billing expansion is outside this local PBK operating slice.

## Reporting Rules

1. Match canonical deal stages exactly, including only explicitly documented terminal aliases. Assigned, unsigned, signed-contract, incomplete, and unknown stages must not become closed deals through substring matching. Signing a contract alone is not a funded closing.
2. Keep recorded revenue separate from projected profit, uncollected assignment fees, purchase price, and generic contract amounts. Neither the bridge nor the frontend may silently promote those values into revenue.
3. Only explicit revenue fields on qualifying closed/funded records may contribute to recorded revenue. Describe that value as recorded revenue, not independently verified cash receipts. Payment verification is not invented by this change.
4. Preserve the difference between an explicit zero and missing or invalid financial evidence. Missing evidence displays as unavailable, not verified zero.
5. Remove fixed per-row channel rates from amounts labeled spend. A drilldown row is not proof of a billed call minute, delivered SMS segment, or email unit. Show supplied costs with their basis, or show cost unavailable.
6. Separate estimated cost inputs from recorded cost inputs in read-only reporting. Do not imply that recorded tool costs cover all provider invoices or acquisition expenses.
7. Withhold a revenue/cost ratio when the numerator, denominator, basis, or required coverage is unsupported. When a ratio is supported, name the denominator precisely; revenue divided by AI cost is not net business ROI.
8. Use the same definitions in headline metrics, charts, drilldowns, and CSV exports. Keep period and source/fallback labels visible, and preserve the existing YTD confirmation guard.

## Narrow Bridge Boundary

The bridge currently converts estimated profit and generic contract amounts into its revenue fields and uses broad stage matching. The fix must cover those read-only analytics builders as well as the frontend; a label-only frontend change is insufficient.

Keep existing routes and bridge adapters. Use focused pure reporting helpers where they remove duplicated definitions between layers. No migration, database write, state reset, provider invocation, dispatch, approval-handler change, or financial backfill is allowed. Existing raw financial facts remain stored exactly as they are.

## Workflow Polish in This Slice

- Improve the existing Analytics summary, source/evidence status, and inspect-result-to-lead flow, not the global navigation or other page systems.
- Make recorded, estimated, missing, stale, loading, and failed states distinguishable in text as well as color.
- Retain exact lead IDs in links; do not resolve by similar names or addresses.
- Preserve the selected range and the existing drilldown focus/return behavior.
- Keep secondary evidence details expandable rather than adding another dashboard or dense explanatory copy.
- Reuse PBK's existing components, Fraunces/Geist/JetBrains Mono hierarchy, graphite surfaces, sky signals, amber caution states, and local assets.
- Verify wrapping, reachable controls, visible focus, and no viewport overflow at 320px and 390px as well as desktop.

Later workflow polish across Today, Lead Workspace, Fleet, and Analyzer is a separate follow-on slice after this reporting/inspection flow is validated. No new scheduling, billing, tenancy, or case-study publishing system is included here.

## Safeguards

- Work in the isolated local export; preserve unrelated dirty-worktree changes.
- Use synthetic fixtures and temporary test/browser storage only.
- Block provider and lead writes in browser fixtures; prevent access to the live bridge during local tests.
- Do not open or overwrite an operator's existing browser draft/profile.
- Preserve approvals, duplicate-send protection, notes, saved comps, lead records, and all existing draft stores.
- Do not push, merge, deploy, change Netlify visibility, send communications, or invoke live models/providers.

## Acceptance Evidence

- Add regression cases before implementation for assigned/unsigned/incomplete stage collisions, signed-but-not-closed contracts, estimated-profit-only records, purchase-price-only records, explicit recorded revenue, explicit zero versus missing, invalid/negative cost handling, and mixed estimated/recorded cost coverage.
- Test the bridge reporting path and frontend normalization together using isolated sample state. Reads must leave protected data fingerprints unchanged.
- Test CSV and headline/drilldown consistency, empty/partial/stale/error results, exact-ID lead navigation, and range preservation.
- Run the focused analytics and safeguard suites, typecheck, and production build.
- Capture fresh desktop and mobile screenshots from a local synthetic preview. Chromium and WebKit proof must report separately; name any unavailable engine or browser-control blocker rather than claiming a pass.

## Decisions Proposed by the Builder

Treat missing financial provenance conservatively, even if that reduces displayed metrics. Do not add a payout ledger or infer cash receipt verification from generic legacy fields. Limit the first workflow-polish pass to Analytics and its existing lead-inspection handoff so the change is reviewable and does not disturb other operators' drafts.
