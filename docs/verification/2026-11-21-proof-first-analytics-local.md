# Proof-First Analytics Local Verification

Date: 2026-11-21. Base: main export `3646f00`. Local-only; no commit, push, deploy, send, live lead edit, or live draft access.

## Delivered

- Exact terminal-stage matching: assigned/signed/incomplete are not closed.
- Only explicit nonnegative recorded revenue; purchase amounts, forecast profit, and assignment fees are not substituted.
- Cost evidence honors recorded/estimated/unsupported bases. Missing estimates remain unavailable rather than zero.
- Coverage, source, period, and date basis are disclosed. Contract creation cohorts are not closing-period results, so their ratio is withheld.
- Every selected range requires response confirmation. Stale range responses cannot replace the current snapshot.
- Campaign fixed-rate spend removed; only supplied, labeled costs are displayed.
- CSV retains evidence status, source, warnings, date basis and period; performance measurements do not occupy revenue columns. Formula-like text is neutralized.
- Exact lead handoff uses the existing bounded return adapter. Unlinked/deleted contracts do not become false lead links. Returning restores Analytics range and focus.

## Verification

- `npm run test:analytics-live-data`: 21 evidence/SQL/return tests and existing wiring/model smoke passed. Wired into the existing Founder test path; no hosted run requested.
- `node --test scripts/fleet-context.node-test.mjs`: five context/identity tests passed.
- `node scripts/analytics-range-bridge-smoke.mjs`: isolated rolling/YTD, explicit revenue, signed exclusion and unchanged protected-state fingerprints passed.
- `node scripts/approval-action-safety-smoke.mjs`: isolated approval binding, altered request rejection, replay/no-provider protection passed. Initial concurrent startup timed out at the unchanged 15-second guard; serial rerun passed.
- Analytics prototype and campaign attribution wiring smokes passed.
- `npm run typecheck`, `npm run build`, and bridge syntax check passed.
- Browser suite passed Chromium 1440x900, Chromium 320x740 and iPhone/WebKit 390x844: ranges, mismatched periods, held response race, cohort disclosure, drills, CSV, degraded/error state, exact-ID handoff/back, byte-identical synthetic drafts, no page errors, no horizontal overflow, zero write requests. External requests and WebSockets blocked.
- Screenshots saved under `output/proof-first-analytics`; desktop, narrow mobile and WebKit drill images inspected.
- Anonymous HEAD to Netlify `/analyzer`: `401`; no visibility settings changed.
- Parent dirty worktree status remained unchanged. A direct baseline blob comparison found only the 12 tracked files listed below modified and no missing baseline files. Parent-index-based diffs are not reliable for this export.

## Independent Review

One independent read-only agent reviewed the complete change. All six findings received regression coverage: cost basis, creation-cohort semantics, requested period, missing lead associations, absent estimates and CSV provenance. Additional local checks cover nonfinite ratios and safe CSV text. This reviewer was not Claude or DeepSeek; those earlier browser consultations did not complete.

## Changed Files

Tracked changes: `package.json`; `scripts/analytics-design-browser-smoke.mjs`, `analytics-live-data-smoke.mjs`, `analytics-range-bridge-smoke.mjs`, `openclaw-local-server.mjs`; `src/app/routes/Analytics.tsx`, `LeadPortal.tsx`, `analyticsRuntimeLogic.js`, `analyticsRuntimeLogic.d.ts`; `src/app/utils/leadQueueReturn.ts`, `runtimeBridge.ts`; `src/styles/pbk-components.css`.

New implementation/test files: `src/app/utils/analyticsEvidence.mjs`; `scripts/analytics-evidence.node-test.mjs`, `analytics-proof-bridge.node-test.mjs`, `analytics-return.node-test.mjs`, `analytics-proof-preview.mjs`; `scripts/fixtures/analytics-proof-range-entry.mjs`. Approved spec, implementation plan, ledger and this verification note accompany the work.

## Preview and Limits

Preview: http://127.0.0.1:5199/analytics. Fictional sample data only; CSP limits connections to this origin, bridge configuration points to the sample origin, and non-GET/HEAD requests return 403. Preview PID at launch: 53492. Logs: `output/proof-first-analytics/preview.stdout.log` and `preview.stderr.log`.

Recorded revenue is not verified cash. Recorded tool usage cost is not a provider invoice or full business expense ledger. No backfill/migration or provider/admin write handler was changed. Real production behavior and the entire Founder suite are not certified by these focused local tests.
