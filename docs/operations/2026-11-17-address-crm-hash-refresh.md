# Reviewed address/CRM bridge fingerprint

The founder explicitly authorized deploying the address-to-CRM enhancement.
This receipt follows the independent refresh procedure in
`docs/operations/trusted-canary-evidence.md`. No production deployment is
established by this receipt.

## RED and complete reviewed diff

Founder Verify run `44245127636` on `c6151bbfbccfbba7cd5cda6dfa0d38bc6442ad07`
reported 91 passing suites and one failing suite: 2,611 tests passed, 12 skipped,
and the only failure was the old whole-bridge fingerprint expectation.
An independent reviewer also reproduced wiring RED: 20 passed, one failed.

The complete bridge diff from canonical base
`6a8a6b1878bd45c15dad9bb8ccde47f94a74fe37` to that target is 15 additions and
one deletion. Every outside-builder change was reviewed independently:

1. Import the side-effect-free analyzer property preview composition helper.
2. Reject duplicate `analyzer-save` creates before the commit envelope or mutation.
3. Skip implicit `patchLeadImport` merging for that source; other sources retain
   their existing behavior. Idempotent replay is unchanged.
4. Compose cached listing data and the existing exact-parcel ATTOM read adapter
   when the existing property-data GET receives `includeRecords=true`, with
   `Cache-Control: no-store`. Research-job queuing is explicitly disabled.

These changes do not alter hosted bearer/team authentication, TOTP, bootstrap,
approval, dispatch, or outbound-contact gates. The new composition performs a
configured ATTOM read and does not create CRM records, approvals, research jobs,
messages, calls, or emails. Explicit manual Save uses the existing CRM routes.

## Independent digest verification

Both controller and independent reviewer read Git objects and reproduced the
exact wiring-test LF normalization, maturity-builder extraction, reader-import
removal and UTF-8 SHA256 calculation. The controller additionally required the
excluded text slice to equal the entire TypeScript AST function text for both
revisions. The reviewer independently checked Acorn AST equality and confirmed
that the excluded builder and reader import are unchanged.

| Reviewed revision | Outside-builder bytes | SHA256 |
| --- | ---: | --- |
| Base `6a8a6b1` | 3,483,068 | `6b2373b2587f84c64e4630ae2f5c89e08e6030dd03ceea8603467b87c44bd9e5` |
| Target `c6151bb` | 3,483,835 | `a0ca25e800b8c6d9f02a8a66df1d0f0057d75df518e596414593d071e6b59353` |

The independent review found no auth, approval, outbound-contact or provider-write
boundary relaxation. This scoped refresh changes only the expected digest and
its baseline comment, plus this receipt; extraction and behavioral assertions
remain unchanged. Validation commands and final outcomes belong below.

## Fresh GREEN

Pinned Node `v22.23.5` ran children with an OS/path-only environment allowlist.
No inherited database URLs, provider credentials, application flags or
`NODE_OPTIONS` reached the children, and no environment file was loaded.

The actual wiring, reader, protocol, Postgres observer, production-readiness,
qualification CI reader, bridge call-read, chat-events and progress-reporter
Jest suites passed: **9 suites, 586 tests, zero failures or skips**, in 50.55s.
The standard VM Modules experimental warning was retained; no warnings were suppressed.

The following commands then ran serially and all exited zero:

```text
node scripts/release-qualification-bridge-smoke.mjs
node scripts/operational-audit-bridge-smoke.mjs
node scripts/backlog-reconciliation-bridge-smoke.mjs
node scripts/render-docker-imports-smoke.mjs
```

The guarded bridge smokes confirmed founder-only/no-provider-write behavior,
no seller contact, and no delivery tools or source mutations. Docker closure
checked 174 imports and 117 files. These are isolated/offline results, not live
provider delivery or a production-readiness certification. Bridge source is
unchanged from reviewed target `c6151bb`; only the baseline test and this receipt
form this fingerprint refresh. `git diff --check` and wiring syntax checks passed.
