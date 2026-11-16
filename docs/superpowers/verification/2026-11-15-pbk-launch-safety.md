# PBK Launch Safety Verification

Date: November 15, 2026 (America/Los_Angeles).
Branch: `codex/pbk-launch-safety`, based on `a277e5c` after preserving concurrent
CRM and durable-state serialization changes.

## Implemented Locally

- Removed address-hash ARV/repair estimates from operational analysis. Missing,
  malformed and negative required inputs return `analysis_incomplete` without
  projecting/caching a completed analysis. Explicit zero repairs/fees survive.
  Calculation and cache use the same effective property evidence, including
  nested deal data. Email fallback no longer invents equity, comps or sale dates.
- Provider-action approvals bind the tool, parameters, workspace, resolved
  contacts/content/senders, business context and a 24-hour expiry. Context hashes
  are stable across JSONB object-key ordering and exclude approval-derived
  fallback data. The canonical callback revalidates under the existing shared
  dispatch lease. Direct ID reuse can read a prior bound outcome, not execute a
  new action. Shared dispatch rejects changed tool/binding/workspace identity.
- Negotiation approval must match the lead, amount, workspace and approved
  script; the existing protected admin passcode path remains. Reusing an approval
  returns the existing override instead of recording another one.
- Nurture SMS uses `body`. A conditional durable claim protects dispatch from
  concurrent/restarted processing. Failed, accepted-only, pending-approval and
  unknown outcomes retain the current step and pause without automatic resend.
  STOP can still pause in-flight work. Sequence approval IDs are provenance only;
  child provider actions request their own exact approvals.
- Packaged scenarios and environment/default canary metrics no longer qualify
  as executed release proof. Typed latency observations preserve completion,
  first-token, speech and channel distinctions plus unknown/legacy data. Ava's
  first emitted sanitized answer is measured separately from complete generation.
- Updated stale source assertions for the current streaming Send/Stop composer,
  explicit stale-analysis flags and the existing persistence queue. No UI layout
  or production persistence behavior was changed to satisfy those assertions.
  Added the authorization helper to the Render Docker allowlist and a launch
  safety pre-gate to production hardening.

## Verified

- TDD red/green observed for missing/malformed/nested-cache analysis, unrelated
  approved ID and offer override, changed contact after approval, provider lease
  identity, first-token timing, nurture outcome/claims and executed-evidence gates.
- Full Jest: **54 suites passed, 912 passed, 8 skipped**. Final result artifact:
  `.pbk-local/launch-safety-unit-final.json` (local/ignored).
- Typecheck, lint and production build passed during integration. Broad gate
  reconciliation and the final rerun commands are recorded below.
- Three isolated launch-safety smokes passed; the full isolated bridge smoke,
  property CRM roundtrip and analyzer lead-sync checks passed.
- Postgres runtime regression fixture: **25 passed** after loading the real
  coalescing queue/writer introduced by the concurrent baseline change.
- Docker import closure passed: 115 imports, 93 files, 2 frontend voice inputs.
- Headless Chromium checks passed at **1440px, 390px and 320px**: streaming, Stop,
  interruption, completed-only history, fallback and overflow/control containment.
- Independent source review found action-context, malformed input, stale cache,
  downstream email and nurture-parent-ID issues. All were corrected and scoped
  re-review reported no additional serious findings.

## Verification Limits

- An initial full unit run hit a Windows PGlite initialization/compilation memory
  failure (901 passed, 1 failed). The isolated test and full suite passed using
  the existing bundled Node 24.22.1 runtime with serialized unit execution. No
  test was removed or bypassed to obtain the final unit result.
- The default browser run passed Chromium desktop, then stalled in Windows
  WebKit. Only that owned test process tree was stopped. The subsequent
  `--chromium-only` mode passed all three viewports; default WebKit CI coverage
  remains unchanged and is not claimed as a current local pass.
- Database-dependent tests remained skipped without an explicit disposable test
  database. Local nurture tests use a controlled SQL adapter. Cross-instance
  Postgres lease and live callback delivery still require isolated integration
  qualification; no production credentials were used for these tests.

## Release Conditions

This is not a production deployment or a launch certification.

There is no trusted revision-bound failed-call/canary run reader in the existing
runtime. The bridge explicitly reports `executionEvidence.source: not_configured`
and not-ready instead of trusting settings/invoke input. Unknown per-channel
latency budgets also remain unknown. A versioned, attested qualification source
must be wired and measured before a full readiness claim.

Pending/legacy approvals without the new binding must be recreated/reviewed.
Changed lead/contract context or deployment revision invalidates an unconsumed
approval conservatively. Operators must review expiry and context changes.

Nurture receipt/callback reconciliation is not implemented by this fix. A sequence
awaiting proof remains paused; it must not be manually restarted without checking
the original provider attempt. Automatic reconciliation is a separate reviewed
follow-up, not an implicit retry.

No keys, provider settings, paid services, seller contacts, main-branch pushes,
production deploys or browser voice playback were performed. Authentication,
approval gates, phone budgets and long-chat generation limits remain in place.

## Broad Gate Reconciliation

The founder sequence was checked across resumed runs, with serialized unit tests
to avoid desktop memory pressure. This is not a claim that one uninterrupted
`npm run test:founder` invocation passed. Stale source fixtures discovered during
the release phase were corrected and rerun without weakening the behavioral
browser/approval checks. The final runtime continuation passed.

The last stale fixture expected the pre-streaming Netlify API-v1 `handler`.
`ui-action-wiring-audit.mjs` now requires the API-v2 default `fetchHandler` and
unchanged upstream stream forwarding, while retaining auth/team/binary checks.
Both dedicated Netlify proxy/auth smokes passed after that change.

Commands and results:

- Existing bundled Node 24.22.1, `--experimental-vm-modules
  node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand --json
  --outputFile=.pbk-local/launch-safety-unit-final.json`: 54 suites, 912 passed,
  8 skipped, exit 0 on the final tree.
- Final reruns of `npm run test:launch-safety`, `npm run typecheck`,
  `npm run lint`, `npm run build` and `npm run test:render-docker-imports`:
  all exit 0. The Docker check verified 115 imports across 93 files and two
  frontend voice inputs.
- `npm run validate:scripts`: 314 package scripts checked, exit 0.
- `npm run test:snn`, `test:x-factor`, `test:x-dimensions`, `test:revenue-engine`,
  `test:emotion`, `test:ui-actions` and `test:intelligence-scorecard`: exit 0.
- `npm run test:netlify-bridge-proxy-auth` and
  `npm run test:runtime-bridge-hosted-proxy`: exit 0.
- `npm run test:live-data-audit`: 124 checks, zero failed. This is a source audit,
  not an executed seller/provider qualification drill.
- `node scripts/ava-design-browser-smoke.mjs --chromium-only`: passed at 1440px,
  390px and 320px after a production build. WebKit limitations remain as above.
- Read-only hosted smoke with `PBK_HOSTED_SMOKE_MUTATE=false`: passed for the
  deployed service, not this local branch. It does not certify these changes.

The production-hardening checks also passed across the integration runs,
including the new launch-safety pre-gate. Local logs and test artifacts remain
under ignored `.pbk-local/`; untracked `output/` was preserved.

Final bridge/audit syntax checks and `git diff --check` passed. Git emitted only
the existing LF-to-CRLF notice for the earlier token-streaming plan. At that local
verification handoff, no commit, push, merge, deployment or worktree cleanup had
been performed. The owner subsequently authorized a branch push and PR; this
does not authorize a merge into `main` or deployment. Production qualification
conditions above still apply.
