# Bounded Census Repair

## Release Boundary

This branch is a local build/test of the approved paged-census design. It does not
authorize a production migration, deployment, provider action, delivery retry,
dispatch unlock, history deletion, memory backfill or authentication/approval
change. Existing PBK command surfaces and approval gates are unchanged.

The separate earlier production activation enabled the approved v2 timing policy
and coverage flag. Its whole-source collector remains blocked by the large
archive; this local branch has not changed that hosted behavior.

## Protocol Selection

`PBK_RUNTIME_CENSUS_PROTOCOL=legacy-v1` is the default. Existing whole-source
denials, references and tests remain intact. The new fixed value `paged-v2` is
opt-in and requires the reviewed `20261117-bounded-census.sql` installation.
Unknown values fail before database checkout; there is no silent protocol fallback.

Migration is not run by bridge startup. The checksum-guarded runner ignores all
ambient runtime database URLs. Its CLI is intentionally local-only in this branch.
The exported apply API requires explicit database, role and reviewed SHA256 and
owns its transaction. Any future hosted rollout needs its own authorization and
target review; do not repurpose a local command against production.

## Completeness And Privacy

The four existing source projections are read with opaque keyset pages, not time
filters or a truncated historical sample. The transactional journal observes
inserts, updates, identity/scope changes and deletes without copying source bodies
or raw identifiers. A locked singleton head makes the journal's committed prefix
transactional; allocating a PostgreSQL sequence would not provide that guarantee.

Signed bootstrap state binds cursor progress and observed journal heads. An older
journal entry cannot overwrite a row observed at a newer head. Baseline closure
requires every fixed kind plus complete catch-up to a database-consistent boundary.
Incomplete bootstrap never creates a coverage checkpoint or a previous-day claim.

Copy-on-write signed leaves, branches and roots retain historical manifests.
Generated PostgreSQL body digests bind physical immutable nodes to signed parent
references, allowing bounded metadata dependency checks without transferring all
historical leaf bodies. Missing, altered or cross-bound dependencies fail closed.
Mutable entry caches are not authority and are checked against sealed leaf state
before updating. Journal metadata alone does not establish organic provenance.

Existing source writers retain their permissions: opaque key indexes use immutable
builtins rather than requiring execution of an owner-only census helper. Capture,
immutability and source-TRUNCATE guards are ALWAYS triggers, including replica
sessions. Installation verification checks table and column ACLs against trusted
expectations and refuses unexpected grants; it does not repair existing grants.

Historical manifests may share dependency authentication only within the same
repeatable-read transaction and fence. Readback after COMMIT is fresh and
independent. Batched historical reconstruction must charge unique dependency and
journal observations to that same operation, including serialized metadata bytes.

Historical and journal-only observations remain unknown. They cannot become
completed organic work, successful deliveries, memory recovery, or independent
canary evidence. Controlled qualification and quiet monitoring remain separate.

## Unchanged Limits

- One coverage operation shares 10000 loaded observations and 16777216 bytes
  across page, journal, proof and checkpoint work. Projected source bytes and
  dependency metadata are charged, not hidden behind page boundaries.
- Signed report bodies remain at most 8192 bytes.
- One poisoned 15000-ms fence includes acquisition, source admission, transaction,
  commit and independent readback. Every query remains limited to 2000 ms.
- Sampling stays 60000 ms; gaps above 90000 ms cannot be continuous coverage.
- Qualification still requires a genuine 86400000-ms forward window and at most
  2000 loaded coverage checkpoints. Bootstrap time is not coverage time.
- Large backlogs, individually oversized observations, missing instrumentation,
  lease loss, invalid clocks or aborted work remain blockers, not passing proof.

## Local Verification

Use supported Node 22.23.5 and scrub runtime/test DB URLs for unit and isolated
bridge tests. Do not run new DDL against an application database.

Focused suites:

```text
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand --runTestsByPath scripts/bounded-census-schema.test.mjs scripts/runtime-paged-census.test.mjs scripts/runtime-paged-census-wiring.test.mjs scripts/bounded-census-scale.test.mjs scripts/runtime-paged-coverage-integration.test.mjs
node scripts/render-docker-imports-smoke.mjs
```

The behavioral wiring suite
`scripts/runtime-paged-census-behavioral-wiring.test.mjs` loads the real coverage
store in an isolated VM with mocked core/database boundaries. It checks shared
budget poisoning, late resolved and rejected queries before timeout callbacks run,
post-commit independence and protocol/revision/lease substitution. Fixture-only
mutation mode changes VM source strings, never files or hosted code.

Actual PostgreSQL tests must use the existing authenticated evaluation harness:

```text
node scripts/neon-evaluation-harness.mjs --ttl-hours 1 --branch-name pbk-eval-targeted-readiness-bounded-UNIQUE -- node --test scripts/bounded-census-postgres.node-test.mjs
```

The unchanged target guard checks exact branch/endpoint authority, a fresh
nondefault/nonprotected branch, parent/TTL, TLS/channel binding and scrubbed runtime
URLs before any connection or DDL. The fixture creates a uniquely named empty
database only inside that verified throwaway branch. It runs shipped public-schema
SQL without rewriting function bodies or deleting inherited source/history.
Original database fingerprints must remain unchanged. The fixture closes all
pools, drops only its validated generated database and verifies its absence; the
harness deletes the branch. Independently authenticate a GET and require 404.

The large retained-source fixture proves algorithm/resource behavior at at least
112693 rows and more than 102213520 projected bytes. Its virtual clocks and the
quiet-day fixture are not actual operating history or a production p95. Actual
Postgres concurrency/readback checks are distinct from PGlite proof.

Final pass/fail/skip counts, exact revision/file state, independent security review
and residual limitations must be recorded before describing this branch as ready
for publication. No hosted collection or launch readiness is claimed by these
local commands.
