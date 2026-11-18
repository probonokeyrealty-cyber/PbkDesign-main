# Callback Authorization Parity (Local Repair)

## Scope And Status

Base: `899a538a742178512640825cdd0686f0e25b7fac`.
Branch: `codex/callback-authorization-parity`.
This is a local security repair, not a production release or launch-readiness claim.
No production migration, configuration change, live approval, closure, dispatch
unlock, seller contact, delivery retry or provider operation is authorized here.
User-owned `output/` is excluded.

## Root Cause

The globally authenticated `/events` and `/api/events` routes could forward an
`approval-callback` to the shared handler without the target-specific team policy
used by ordinary approval routes. This was a role-authorization gap, not an
unauthenticated public endpoint. The existing closure lane already required
private out-of-band authority; its stricter policy remains intact.

## Repair

- Reuse `getTeamApprovalRestriction` unchanged at the shared callback boundary.
  Check actual request/body credentials or the existing private verified-Slack
  capability, never actor/source/teamAuth labels supplied in callback JSON.
- A Netlify proxy bearer is not founder authority. A real team session is required,
  and existing amount, action and provider restrictions apply.
- Read the bounded canonical Postgres target before authorization. Reject failed,
  oversized or inconsistent reads. Hosted team decisions require that target.
  Preserve the existing nonhosted file-mode and founder legacy compatibility.
- Replace stale cached descriptors with the authorized canonical snapshot rather
  than retaining omitted stale fields.
- Pin the pending-decision UPDATE to that full snapshot, type and associations.
  Do not recreate a missing target through UPSERT. On a compare-and-swap miss,
  reread and reauthorize before accepting any existing authorized replay.
- Keep ordinary POST/PUT, raw event aliases and Slack transport on the same role
  boundary. Skipped Slack signature verification cannot create Slack authority.
  Existing founder/TOTP, team permissions and verified Slack rules are unchanged.

No sender, delivery lease, retry policy, unknown-dispatch lock, approver list,
credential, authentication setting, approval limit or permission default changes.

## Verification Evidence

TDD evidence before runtime changes:
- New authorization regressions: 10 failures, one passing control.
- Canonical target regressions: three expected failures.
- Real SQL race regression: one expected failure for target recreation/overwrite.

Focused green results:
- Authorization, closure wiring and Netlify proxy/founder boundary: 265 passes
  across four suites, zero failures/skips.
- Isolated actual-HTTP callback smoke passed: direct/proxy team restrictions,
  ordinary POST/PUT parity, forged labels/signatures, allowed team rejection and
  routine approval, founder and verified Slack controls. No sender changes.
- Disposable native Postgres proof: 16 passes, zero failures/skips; max-one pool,
  independent-client canonical races, append-only closure invariants and six
  unchanged unknown-dispatch rows. Network observer recorded zero external
  connections and zero HTTP/provider sender accesses. Owned database/container
  cleanup succeeded, with unrelated resources untouched.
- Review follow-up expanded both PGlite and native race checks with lead-only and
  contract-only association changes (unchanged payload), plus failed canonical
  rereads after a lost claim. These deny without cache or durable-row mutation.
  Expanded authorization suite: 18 passes; expanded native suite: 16 passes.
  The native cache assertion checks the actual current state array, not a stale
  object reference.

One expanded native attempt failed the pre-existing held-transaction audit test
with `closure_cutoff_changed`; all callback cases passed. An observational clock
diagnostic confirmed Docker's database clock can lag Windows (minus 39ms at query
entry in the next passing run). No clock, signed timestamp, runtime guard or
100ms fixture cap was changed. The diagnostic rerun passed all 16 tests and
confirmed cleanup and zero external/sender accesses. Retain this environmental
clock sensitivity as a test limitation, not an unexplained all-green claim.

The native run initially stopped at Docker preflight before creating any database.
With explicit user approval, stopped the crashed Docker app and preserved only
its inspected zero-byte runtime-socket directories under unique sibling backup
names. No reset, deletion, security-setting change, disk/data modification or
remote database was used. Docker then reported engine `29.4.0`. The test used
cached `pgvector/pgvector@sha256:b513c48566e4777cd3370451400000c78eda6a08131d68f4c31d4a76f27bd8fd`.
Preserved socket-only paths:
- `C:/Users/Dell/AppData/Local/Docker/run.pbk-auth-preserved-60e89522b8a541f589f6c04809c51948`
- `C:/Users/Dell/AppData/Local/docker-secrets-engine.pbk-auth-preserved-c0628acc412f40a897865fb41c2b5722`

Additional fresh local verification:
- Callback HTTP, approval-action safety and dead-letter closure bridge smokes
  passed under network/provider isolation.
- Approval decision concurrency smoke: eight passes, no failures/skips, with
  loopback-only provider fixtures (not real deliveries).
- Typecheck, lint, production build and whitespace check passed.
- Render Docker import/package smoke passed: 192 imports, 121 files checked.
- Refreshed canary exact-source assertion passed in the full regression run.
- Final focused rerun after all reviewed changes: 286 passes across five suites,
  zero failures/skips (authorization, closure wiring, proxy, founder and canary).

Independent security review completed with no actionable runtime findings. The
reviewer independently recomputed both bridge digests and confirmed the maturity
builder is unchanged. A P3 native cache-assertion gap was corrected and rereviewed;
the incremental test edits have no remaining review blocker. Review was read-only
and did not independently rerun the main agent's reported commands.

Full unit run completed (Node 22.23.5, no ambient database URLs or native opt-ins):
97 suites passed, three failed; 3,016 tests passed, five failed and 12 existing
opt-in cases skipped; 2,422.817 seconds. The callback suite (18), closure wiring
(39), Netlify proxy verification (24), founder boundary (184) and provider dispatch
policy/implementation tests passed in that run. The source-hash assertion passed.

Failures outside the callback boundary:
- `operational-audit-coverage.test.mjs`: saved interval verification, concurrent
  newest admission, and genuine new-boot coverage expectations (three failures).
- `bounded-census-scale.test.mjs`: operation abandoned at the existing deadline
  while bootstrapping the 112,693-row fixture (one failure).
- `readiness-postgres-fixtures.test.mjs`: a quiet-day seed checkpoint was not
  verified (one failure).

Those tests and their audit/store/sampler/source dependencies are unchanged from
the base; no modified callback function is exercised by those failing cases.
This is not proof that they are harmless or that production readiness is green.
An isolated rerun of exactly these five cases passed: three suites, five passes,
zero failures, 26 explicitly name-filtered exclusions; 346.854 seconds. No source
or limit changes were made between runs. This suggests resource/ordering
sensitivity but does not establish the precise cause or a clean full-suite pass.
The scale rerun retained 112,693 rows/143,120,110 projected bytes, with unchanged
baseline history; its bounded-operation peak was 7,018 rows/6,003,325 bytes.
No limits, history, source evidence or readiness policy were weakened.

Raw run artifacts remain local and ignored under
`.superpowers/debug/callback-authorization-parity/`: `unit-final.json/.log` and
`coverage-isolated.json/.log`. These are local fixture results, not live evidence.

## Remaining Release Boundary

Local repair and independent security review are complete. Preserve the known
native-clock and full-run reproducibility caveats above for any release review.
Nothing has been pushed, deployed, migrated or applied to live records by this
task. Unknown dispatches remain locked; live readiness is not asserted. A release
requires separate authorization and fresh release verification.

## Canary Integration Baseline

The exact-source assertion is retained, not removed or loosened. Only its reviewed
non-maturity bridge digest changes; the maturity builder and canary gates do not.
The old pin failed as expected (20 passes, one stale-hash failure).

- Old: `b1a7fdf1a0e274422deede7c730b521c4d74e42ff2ba54204c5a055cfb77758a`
- New: `b512d5e45f896beb77cd5383ab1219a047b70c11ba204c9ba23728134c145274`

The fresh security review must examine the scoped bridge diff and this baseline
refresh. Prior closure review reports remain historical; this repair does not
retroactively claim they passed or that the inherited gap is already deployed.
