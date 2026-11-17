# Bounded Census Local Validation

Status: local verification complete; independent review passed. Pull request
publication separately authorized on 2026-11-17. Not deployed.

## Scope

Branch `codex/bounded-census-repair` starts from merged PR19 commit
`4358ded80c6302c258912f78f84ac61ce32c6662`. The original validation covered local
implementation and tests only. The founder subsequently authorized pushing this
branch and opening a PR, not merging, deploying, migrating production or activating
the protocol. No dispatch unlock, seller contact or delivery retry is authorized.

The new protocol is explicitly opt-in; `legacy-v1` remains the default. Existing
authentication, approvals, provider gates and source-writer grants are unchanged.
The existing bridge/sampler/audit seams already accept the protocol adapter, so no
additional server route or UI was added. Unrelated `output/` was preserved.

## Frozen Runtime

SHA256 values at qualification:

| File | SHA256 |
| --- | --- |
| `scripts/runtime-paged-census.mjs` | `b2f73e791b193c494bbded5e5e84c53b036e4263ebd691815aeefd230a3cf49b` |
| `scripts/runtime-coverage-store.mjs` | `7e8fa33221c9dbc7880de7b8c822b0969392b1cbabdca90dec5c2d9d9ec508b0` |
| `scripts/runtime-coverage-sampler.mjs` | `734b4196466449887fd2fc10e261cea7b82f49990b1d945f47bc141000fa029d` |
| `scripts/migrations/20261117-bounded-census.sql` | `2dbf207288b3597a7346b3e5d1b75594b8797ac33141a2a8b49d1e66aa518b93` |
| `scripts/bounded-census-migration.mjs` | `967c41f0185ec3bbfab0e209e459aeb86f12a46a0daf68afdb8a3fe472339040` |

## Results

Supported Node 22.23.5; ambient runtime/test database URLs were scrubbed for unit
and isolated bridge runs. Reports are local under `.pbk-local/`.

| Check | Result |
| --- | --- |
| Final schema/core/behavioral-wiring/static-wiring suites | 153 passed, zero failed/skipped; 78.822 s |
| Fresh legacy source/coverage/sampler/CI-reader regressions after deadline repair | 211 passed, zero failed/skipped; 109.731 s |
| Large retained inventory | Passed; 112693 rows, 143120110 projected bytes, 233 bounded operations |
| Large-inventory maximum operation | 7018 loaded rows, 6003325 bytes, 411.072-ms query, 4677.499-ms operation |
| Large-inventory history | Eight checkpoints and five exact historical roots; baseline history and six protected table fingerprints unchanged |
| Virtual 1441-checkpoint day and 240 changed-root/20-ms round-trip reconstruction | Two passed, zero failed/skipped; 319.554 s |
| Virtual-day resource maximum | 1945 rows, 6457253 bytes, 286.245-ms query, 4153.036-ms operation; zero organic completions |
| Changed historical roots | 240 exact roots reconstructed in 14 queries / 1497 ms with a simulated 20-ms round trip |
| Final guarded actual Postgres, including future-clock transition | Four passed, zero failed/skipped; 24.718 s |
| Broader existing baseline before final deadline repair | 80 suites; 2036 passed, 12 guarded Postgres-only cases skipped; zero failures |
| Typecheck, MCP typecheck, repo lint, owned-file lint | Passed |
| Production build | Passed; 1844 modules, 29.27 s |
| Docker import closure | Passed; 169 imports, 114 files |
| Qualification workflow YAML and mandatory proof step | Passed; existing mandatory checks retained |
| Isolated operational-audit, backlog-reconciliation and qualification bridge smokes | Passed; no seller/provider contact or source repair |

The final Postgres branch `br-soft-haze-ajq32uks` contained a uniquely named empty
fixture database. That database was dropped and verified absent; inherited and
protected fingerprints were unchanged. The harness deleted the branch and an
independently authenticated GET returned 404. Evaluation target guards were not
weakened. Earlier denied/failed runs and cleanup receipts remain in the local SDD
ledger; they are not represented as passing results.

## Review And Limits

Independent SQL review passed after repairs for source-writer index permissions,
replica trigger bypass and column ACL verification, with 170 independently rerun
schema/legacy tests. Scoped wiring/deadline review passed. Final bounded-BFS
completeness/security review passed on the frozen hash, with 62 independently
rerun core/behavioral/static-wiring tests and no remaining actionable findings.

The original 10000-observation, 16777216-byte, 8192-byte report, 2000-ms query and
15000-ms operation bounds remain enforced. Initial tests exposed repeated graph
charging and a slow recursive proof query. Bounded metadata batches replaced that
query; late resolved or rejected query results now poison the fence even when an
event-loop stall delays the timeout callback. Partial graph/journal failures do
not publish trusted cache entries.

All measurements above are local/disposable algorithm evidence, not production
latency, actual operating history or launch qualification. A future separately
authorized rollout still needs target review, the targeted migration, explicit
protocol activation and a genuine forward 24-hour collection window. Quiet
monitoring and unknown historical observations cannot qualify organic work or
resolve unknown dispatches, memory, delivery or canary evidence.
