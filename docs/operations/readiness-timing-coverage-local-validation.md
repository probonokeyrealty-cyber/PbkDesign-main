# Local Timing And Coverage Validation

Date: 2026-11-17. Branch: `codex/readiness-timing-coverage`.
Implementation: `36d4e76dd9cb28af6cbad9e8d6b02f5b17e279cc`.
Base: `ca9905846d15045c097cc8c1cb3fc35cd216ba74`.

This is a local build receipt, not deployment, publication, production-collection
or launch approval. Authentication, SSO, approval, provider and RLS gates remain
unchanged. Unknown dispatches stay locked; the four original dead letters remain
open. There were no seller calls/messages, delivery retries or production writes.

## Implementation

The approved length-aware pilot measures fast starts separately from detailed
completion. Signed private timing, exact persisted-write source binding, bounded
transition history, forward-only leased coverage and v2 audit/reference validation
feed the existing readiness path. Collection defaults disabled. See
[the runbook](readiness-timing-coverage.md) for policy and operating boundaries.

All six task reviews passed. Whole-branch review identified missing business
projection linkage, a broken diagnostic benchmark entry and fixture cleanup paths.
One fix wave addressed all three; independent scoped re-review found no remaining
Critical/Important findings or new fix-diff breakage. Coverage never substitutes
for missing approval/seller projection linkage. The fixed read-only benchmark
uses existing founder-only authorization and private server diagnostic context;
ordinary caller diagnostic flags remain powerless.

## Verification

- Final immutable `36d4e76` full Node 22 unit run: 80 suites, 2036 passed,
  12 database-conditional skips, 2048 total, zero failures, 457.943 seconds.
  Runtime DB variables were scrubbed; two recycled workers used a 128 MiB idle
  memory limit. This includes every new regression after the final fix wave.
- Prior packaged `de9e981` full Node 22 unit run: 78 suites, 2024 passed,
  12 database-conditional skips, 2036 total, 438.470 seconds.
- Actual disposable Postgres qualification on `de9e981`: exact six suites,
  all 306 assertions passed, zero skips/failures, 335.500 seconds. The unchanged
  CI JSON assertion body also passed. Final fixes changed no aggregate SQL,
  proof, schema, mapper or qualification semantics; this is preserved evidence,
  not a claim that the database gate was rerun after the fix.
- Targeted actual Postgres proof: 11 passed, zero skips/failures, 207.320 seconds.
  Original migration/idempotence/signed-skip proof, actual source RETURNING/xmin,
  lease/checkpoint rollback and durable reference/audit denial were exercised.
- Full-day cross-engine reader proof used 1441 actual-API-generated PGlite
  checkpoints, copied as 1443 exact bounded signed rows into disposable Postgres.
  This is seeded algorithm/SQL compatibility proof, not 1441 networked Postgres
  append cycles and not real operating history.
- All six created evaluation branches were harness-deleted and independently
  authenticated GET-checked as 404. Fixture and inherited protected-row
  fingerprints remained unchanged; random schemas were removed and queried absent.
- Root typecheck, lint and production build passed under supported Node 22 on
  final implementation `36d4e76`: 1844 modules, 7.98 seconds. MCP typecheck passed
  on `de9e981`; its inputs are unchanged. Owned backend lint/syntax pass; the existing bridge
  baseline remains exactly 12 errors/28 warnings with no new diagnostic messages.
- Final Docker static import closure: 166 imports, 112 reachable runtime files,
  two frontend voice inputs. Package-script validation: 322 entries passed;
  subagent-release alignment and full-branch whitespace checks passed.
- Final fix covering tests: covered collector plus signed-store linkage regression
  passed all four cases; four focused suites passed 21 tests; 43 streaming/Stop
  tests passed. Reply speech rerun passed 12/12, zero skips/failures.
- Isolated extracted and real diagnostic HTTP entries and audit smoke passed.
  The network-denied real bridge returned six model fallbacks, zero model
  completions and budgetProven=false. That proves isolation, not model speed.
  Isolated reconciliation, approval safety, release qualification and core bridge
  smokes also passed. All temporary children/pools/samplers were stopped.

Machine-readable receipts remain local under `.pbk-local/`, including
`timing-coverage-36d4e76-node22-unit.json`,
`task6-postgres-qualification-green.json` and the final implementation unit report.
No skipped local test is counted as executed Postgres proof. The full founder
command chain, Docker image execution and audible browser playback are not claimed.
Expected VM/MockTimers and inherited pg SSL compatibility warnings were documented,
not suppressed.

## Remaining Live Gates

No production policy or sampler setting was applied. A separately authorized
rollout must collect a genuine forward-only 24-hour window and independently meet
freshness, organic samples, business results, memory, canary and delivery gates.
No memory history, source history or delivery result was repaired by relabeling.

The existing phone path still clips output at 900 characters, uses MP3 rather than
verified outbound PCMU, and lacks authoritative full-playback milestones. These
remain explicit limitations of this measurement-only build. Browser streaming
speech regression tests are not an audible playback claim; the user owns playback.

## Controller Decisions And Costs

Decisions are listed in the order made; none authorizes additional production work.

1. Reused the established subagent/task/review workflow under local-build approval.
   If wrong: additional local rework; no extra publication authority.
2. Inherited the session model rather than overriding it without a user request.
   If wrong: review cost or routing efficiency, not a changed permission boundary.
3. Added first-actual-observation anchors for unknown changes and tombstones,
   never retrospective write/provenance proof. If wrong: coverage must be rebuilt.
4. Kept legacy/stale timing diagnostic, while recent invalid v2/latest actions
   block. If wrong: invalid cohort acceptance or unnecessary readiness blocking.
5. Left absent token/phone milestones unverified. If wrong: avoidable blocking;
   missing observations still cannot be invented.
6. Did not relabel MP3/inbound audio as outbound PCMU. If wrong: phone readiness
   stays blocked until a separately authorized measurable transport is available.
7. Added bounded authenticated transition history and a transaction/deadline-aware
   snapshot primitive. If wrong: lost failures or invalid atomic coverage proof.
8. Retained 48 hours for the 24-hour window plus 24-hour audit freshness, with all
   row/byte caps unchanged. If wrong: fresh saved audits fail or evidence overflows.
9. Allowed new forward observations after abandoned admission, preserving signed
   gaps and distinguishing contention. If wrong: invalid continuity or denial.
10. Added bounded internal saved-reference verification while keeping current-head
    freshness strict. If wrong: stale proof acceptance or healthy-audit rejection.
11. Required opaque one-use exact SQL RETURNING/xmin write bindings. If wrong:
    an intervening overwrite could receive another writer's provenance.
12. Allowed a shared test-only durable audit fixture, with no runtime import or
    pass override. If wrong: duplicated or unrepresentative test evidence.
13. Added the real audit-pool VM fixture binding and untracked the accidentally
    committed generated report without rewriting history. If wrong: fixture drift;
    user files and history were preserved.
14. Updated obsolete wiring assertions to require explicit v2 options, preserving
    policy/budget checks. If wrong: regression coverage would be weakened.
15. Used guarded per-suite random Postgres schemas and unchanged exact-six/
    zero-skip CI checks, preserving parameters/results and protected fingerprints.
    If wrong: qualification evidence is invalid and must be rerun.
16. Increased only the disposable audit test's harness timeout from 30 to 180
    seconds. Production 60s/15s/2s fences remain. If wrong: slower hung-test detection.
17. Seeded actual Postgres readers with exact rows generated through real PGlite
    sampler APIs, separately testing actual Postgres writers/leases/rollback.
    If wrong: cross-engine proof is invalid; it never counts as operating history.
18. Caught up only the test setup clock through actual sampler calls in forward
    steps of at most 60 seconds, preserving the 90-second gap rule. If wrong:
    simulated history must be regenerated; production history is unaffected.
19. Restored the benchmark through a fixed read-only server-owned entry using
    existing founder authorization, not caller diagnostic claims. If wrong:
    diagnostic contamination or excess authority; denial/exclusion tests guard it.

## Local Handoff

Keep this named branch and existing worktree. No push, pull request, merge,
deployment, migration or collection activation is authorized by this receipt.
Unrelated `output/` files and the Analyzer base changes are preserved.
