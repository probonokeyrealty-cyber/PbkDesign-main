# Readiness Timing And Coverage

## Authorization Boundary

This is the founder-approved LOCAL build and disposable-test profile, not release
or production-collection authorization. Nothing here authorizes push, merge,
deployment, provider delivery/retry, seller contact, source replay, memory
backfill, or authentication/approval changes. The Electron command surface and
Slack-first approval lane are unchanged. No UI was added.

Keep unknown dispatches locked and the four original dead letters open. Production
readiness remains blocked until real evidence satisfies every independent gate.

## Pilot Policy

`.env.example` contains the complete non-secret `PBK_AGENT_LATENCY_POLICY_V2` JSON.
The approved values are measurement targets only:

| Channel / milestone | Allowed milliseconds |
| --- | --- |
| Chat / first content token | 1800 |
| Phone / first content token | 1800 |
| Chat and phone / model completion | 3000 + 20 per actual output code point |
| Phone / first outbound speech media | 2500 |
| Phone / final outbound speech media | 2500 + 1.10 x actual media duration + 2000 |
| Research / completion | 120000 + 20 per actual output code point |
| Non-generative provider/internal completion | 30000 |

The bridge requires v2; the old numeric matrix remains legacy-only. A present
invalid or incomplete v2 policy never falls back to v1. Policy hashes bind each
measurement to its actual profile. Scoring uses p95 of distinct per-run
elapsed/allowed ratios, not p95 elapsed divided by p95 output size.

These values do not change generation limits, the existing 900-character phone
cap, request deadlines, stop/cancel behavior, streaming, playback, or provider
timeouts. Missing token/media milestones stay missing. The outbound MP3 lane does
not establish verified PCMU duration or full-reply playback; phone evidence remains
unqualified when required milestones are absent. Final media sent is not proof
that a seller heard it.

## Collection Remains Disabled

`PBK_RUNTIME_COVERAGE_ENABLED=false` is explicit in the example. Do not enable it
or configure production policy as part of this build. A separately authorized
future rollout would also require hosted mode, ready Postgres bootstrap, the
existing signing configuration, six actual health signals, approval mode, and an
uncontrolled server context. Local, diagnostic, controlled, or unready startup
does not start collection.

The fixed policy is 60000 ms sampling, maximum gap 90000 ms, a rolling
86400000 ms window, and at most 2000 checkpoints. A first observation establishes
only its forward anchor. A new boot/revision, gap, failed write/read, invalid
clock, or lease loss cannot inherit a preceding day. Stop is terminal for a
sampler instance; shutdown releases resources and prevents late continuation.

One inherited 15000 ms operation fence and at most 2000 ms per query cover source
admission, checkpoint transaction, commit, and independent readback. A signed
durable lease serializes owners; an advisory transaction lock alone is not a
persistent lease. Source completion, checkpoint, and complete control head commit
atomically. A failed attempt retains pending denial rather than blessing old
coverage. Do not extend these deadlines to make proof pass.

## Evidence And Diagnostics

Source receipts use the actual writer's allowlisted `RETURNING` projection and
private `xmin` write binding. An ID lookup, caller label, copied handle, replayed
handle, changed projection, or identical-value intervening overwrite cannot mint
organic provenance. Unknown/legacy/controlled data never becomes completed
organic work. Receipt failure leaves monitoring unverified without falsifying a
successful business write.

Existing PBK signing material is reused with separate HMAC domains. New proof
stores fixed classifications, aggregate counts, opaque references/bindings and
signatures only. Do not persist raw prompts, answers, audio, seller identities,
contact data, keys, or the private tuple version in proof.

Audit v2 stores a compact signed reference, not a trusted Boolean or an inline
census. Readback reconstructs the historical checkpoint window, checks the current
control/head and fresh source history, and verifies the exact saved reference.
Healthy head advancement can preserve an old fresh audit; missing/tampered current
or historical dependencies cannot. Newest pending/failed/invalid audit admission
blocks fallback to an older pass. Legacy audit v1 remains diagnostic only.

An observed quiet window can verify monitoring with zero business work. Coverage
is sampled collection, not literal uninterrupted uptime. Coverage does not replace
freshness, business-result, organic sample, memory, delivery, independent canary,
database-security, approval, or unresolved-dispatch/dead-letter gates. A virtual
trusted clock over durable SQL proves the algorithm only, never operating history.

## Local Verification

Use supported Node 22.23.5 explicitly; leave default Node 24 unchanged. On this
Windows workspace the supported executable is
`D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe`.
Invoke npm with that executable and
`C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`; prefix PATH only in the
current process so harness children use the same Node. Scrub `PBK_DATABASE_URL`,
`DATABASE_URL`, `SUPABASE_DB_URL`, `PBK_MIGRATION_DATABASE_URL`,
`PBK_TEST_DATABASE_URL`, and `PBK_EVAL_DATABASE_URL` before local unit/smoke runs.

Focused packaging and fixture checks:

```text
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand --runTestsByPath scripts/readiness-timing-packaging.test.mjs scripts/targeted-readiness-wiring.test.mjs scripts/targeted-readiness-eval-guard.test.mjs scripts/release-qualification-ci.test.mjs
node scripts/render-docker-imports-smoke.mjs
```

Disposable targeted Postgres proof uses the existing harness, never a runtime DB:

```text
npm run neon:evaluation -- --ttl-hours 1 --branch-name pbk-eval-targeted-readiness-<unique> -- node --test scripts/targeted-readiness-postgres.node-test.mjs
```

Only process-held Neon credentials and the authorized evaluation project are
used. Do not print credentials, connection URIs, or passwords. Do not use
`--inject-runtime-db`. Before any public-schema reset the existing guard verifies
matching exact test/eval URLs, scrubbed runtime targets, authenticated branch and
endpoint metadata, a parent, nondefault/nonprotected status, creation age at most
15 minutes, positive remaining TTL at most 2 hours, and the exact Neon endpoint
host. Driver fields are explicit, with certificate verification and channel binding;
URI/session override parameters are rejected before connecting or resetting.

The original migration/idempotence and signed short-memory-skip proof must remain.
Timing/coverage fixtures are disposable and must snapshot approvals, dispatches,
dead letters and calls before/after; no source recovery or provider work is run.

The targeted day-long fixture is explicitly a seeded cross-engine algorithm and
SQL proof: `operational-audit-test-fixture.mjs` drives the actual sampler/source
APIs through 1441 forward-only PGlite checkpoints with a virtual trusted clock.
Only its exact bounded signed monitoring rows are batch-copied to an empty random
schema on the authenticated disposable Postgres branch. No source rows, raw
content, hand-built signatures, or Boolean verification substitutes are copied.
SQL/JSONB rows are compared exactly after copying; actual Postgres then performs
current/historical reference reconstruction, audit readback, head advancement and
tamper denial. Separate actual Postgres source writes prove RETURNING/xmin and
one-use receipt behavior, competing leases and atomic checkpoint/control/source
rollback. This does not claim 1441 networked Postgres append cycles or operating
history. The post-seed test-only writer continuation uses the genuine predecessor,
secret/revision/boot and clocks; it is not production sampler restart support.

The actual six-suite qualification gate remains mandatory in
`.github/workflows/release-qualification.yml`, with its exact six filenames and
every assertion passed, zero skips/failures, and a machine-readable JSON report.
Conditional local skips are not evidence that Postgres tests executed.

Fresh branches can inherit app data: several original qualification fixtures
use explicitly qualified `public.*` tables rather than isolated schemas. The
guarded `readiness-postgres-qualification.mjs` runner therefore authenticates the
same disposable target BEFORE constructing a pool or issuing DDL, creates one
fixed random schema per suite, and installs `readiness-postgres-schema.jest-fixture.mjs`
only in those exact six Jest suites. The mapper changes the fixed `public.`
namespace and schema-catalog literals, not query parameters, callbacks, driver
options or results. It is not a general-purpose SQL rewriter and has no production
imports. The existing backlog fixture's own namespace mapping is preserved.
Protected inherited row fingerprints are checked before/after, all created
schemas are queried absent after removal, and the unchanged mandatory CI JSON
assertion block remains an additional gate. Runner selector overrides are rejected.

Only the actual disposable Postgres test in `operational-audit-store.test.mjs`
has a 180-second harness timeout to cover genuine PGlite full-day setup and network
overhead. Its assertions are unchanged. This is not a runtime budget extension;
all production audit/coverage/query deadlines stay 60000/15000/2000 ms.
Immediately after that test's PGlite setup, the test-only
`advanceAuditFixtureClock` catches its virtual clock up to wall time using actual
sampler calls in forward steps of at most 60000 ms, bounded by the existing
180-second harness. It does not catch up during the audit: the existing run and
verifier clock advances remain unchanged, so a genuinely late pending interval
still fails the 90000-ms gap rule. This is disposable setup cost accounting, not
operating history or production restart continuity.

The harness deletes each evaluation branch in `finally`. Independently authenticate
a GET for every created branch ID and require HTTP 404 after deletion; do not log
unnecessary identifiers. Verify fixture schema cleanup and close all pools/samplers.
No project-global roles are needed. Network/credential failures are real blockers,
never grounds to bypass the guard.

The expected experimental VM Modules warning is documented, not suppressed.
Whole-bridge ESLint has a pre-existing 12-error/28-warning baseline; owned files
must lint clean. Broad unit/typecheck/lint/build, isolated bridge/approval/voice
smokes, independent review, and final whole-branch qualification remain parent
responsibilities. A focused Task 6 receipt is not a whole-branch completion claim.

## Local Proof Receipt (2026-11-17)

- Focused packaging/guard/fixture regressions: 146 passed, zero skips/failures,
  97.169 seconds. Owned lint clean; static Docker closure covers 165 imports and
  111 files. No Docker image build is claimed.
- Targeted disposable Postgres proof: 11 passed, zero skips/failures,
  207.320 seconds. Includes original DDL/signed-skip proof, actual PG source
  RETURNING/xmin/receipt and lease/atomic rollback tests, plus explicitly seeded
  cross-engine reference/audit proof. The quiet seed contains 1441 API-generated
  checkpoints in 1443 exact proof rows, not 1441 networked PG append cycles.
- Mandatory actual-PG qualification: exact six suites, all 306 assertions passed,
  zero skips/failures, 335.500 seconds. The unchanged CI JSON assertion body was
  also executed verbatim against the local report.

Local artifacts are `.pbk-local/task6-focused-final.json`,
`.pbk-local/task6-postgres-qualification-green.json`, and the targeted proof and
cleanup logs. Protected fixture/inherited rows remained unchanged, random schemas
were removed and queried absent, harness deletion completed, and authenticated
independent branch GETs returned 404. No production operating history, publication
authorization, final immutable whole-unit run, or independent review is inferred.
