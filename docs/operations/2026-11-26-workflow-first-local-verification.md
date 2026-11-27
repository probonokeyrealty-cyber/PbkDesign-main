# Workflow-First Local Verification

Date: 2026-11-26. Base: main `3c478c7`.
Branch: `codex/workflow-first-wording-20261126`.
Checkout: `D:/pbk-temp/operator-session-regressions-20261126`.

## Scope

Presentation-only changes to Today, approvals, Inbox, Lead Workspace and Analyzer.
Clearer action labels distinguish approval from delivery. Existing handlers,
routes, draft storage, consent and provider checks remain unchanged. Existing PBK
fonts, palette and navigation remain in place. Touch targets are at least 44px on
the changed action groups; the Analyzer rail uses three columns below 361px so
single-word labels do not split. No lead or business data was edited.

The independent review's accessible-name mismatch on mobile Call prep was fixed
and covered by a failing-then-passing copy assertion. Visual review exposed split
labels at 320px; the new range-based assertion failed before the grid fix and
passed afterward. Claude consultation remains pending; this was repo-backed work.

## Passed

- `npm run build`: exit 0. Existing large-chunk warnings remain.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, zero warnings permitted.
- `node --test scripts/workflow-first-copy.node-test.mjs scripts/operator-session-browseros.node-test.mjs`: 42 passed. The four copy tests were rerun after the accessibility fix.
- `npm run test:analyzer-draft-storage`: 104 passed.
- `node --test scripts/command-center-polish-fixture.node-test.mjs`: four passed.
- `node scripts/operator-copy-smoke.mjs`: passed.
- `node scripts/deal-analyzer-modern-mobile-smoke.mjs`: passed.
- `node scripts/workflow-first-browser-smoke.mjs`: desktop Chromium 1440px,
  mobile Chromium 390px and 320px, mobile WebKit 390px; all passed.
- `node scripts/today-review-browser-smoke.mjs --built`: desktop Chromium 1440px,
  mobile Chromium 390px and mobile WebKit 390px; all passed.
- `git diff --check`: clean.

Workflow browser assertions cover approval review/cancel and focus restoration,
lead edit/cancel, explicit accessible action names, touch sizing, unbroken labels,
page containment, Compose reload and disabled Send, and Analyzer reload with
manual notes, repair values, ARV and saved comp intact. The fictional lead array
is unchanged. Every workflow context asserts zero business-write attempts,
zero external requests and zero page errors. Screenshots in
`output/workflow-first` were inspected, including 320px Analyzer and mobile WebKit.

The existing Today review test also covers polling outage/recovery, failed
preflight, duplicate prevention, changed requests, uncertain decisions and
recorded-decision versus delivery receipts. Its decisions are intercepted sample
responses, never forwarded approvals or provider requests.

## Limitations

Dev-server browser runs stalled at the lazy-loaded Loading screen. The final
matrix uses the actual local production build through the existing read-only
sample preview fixture. The legacy Today runner retains dev-server support and
adds `--built` for this verification. These are browser emulations, not physical
mobile-device or hosted production tests.

An additional `approval-action-safety-smoke.mjs` attempt, including a retry,
timed out during isolated bridge startup at its existing 15-second limit, before
its assertions ran. It is not counted as passing. No bridge code or safety limit
was changed to hide that result. The full Founder suite was not run.

Follow-up: the startup cause was subsequently traced and fixed locally. See
`2026-11-26-bridge-safety-startup-local.md` for the passing reruns and unchanged
deadline. This paragraph preserves the original workflow verification result.

## Boundaries And Preview

Local preview: `http://127.0.0.1:5195`. It serves only the built app plus fictional
sample responses, blocks API mutations, has no live bridge proxy, and restricts
connections/form actions with CSP. No production browser storage was read or
changed. The original dirty C: worktree and its index were left untouched.

Anonymous read-only checks of production `/`, `/leads` and `/settings` each
returned 401. No Netlify visibility setting was changed. The Netlify connector
requires reconnection for a fresh settings-level audit. No deployment, push,
merge, real approval, saved lead edit, call or outbound message occurred.

Changes are intentionally local, uncommitted and unpushed.
