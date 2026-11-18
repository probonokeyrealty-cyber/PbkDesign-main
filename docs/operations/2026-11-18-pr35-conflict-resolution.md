# PR 35 Conflict Resolution

## Authorized Boundary

Resolve conflicts with current main on the existing PR branch, push the result,
and rerun CI. Do not merge the PR into main, deploy, migrate production, contact
sellers, retry delivery, unlock unknown dispatches or change auth/approval policy.
The PR remains draft with no auto-merge. User-owned untracked `output/` is excluded.

## Integration

- PR parent: `b1dc2103b9f5e1eca58433ae425ecc8f4ea1b87f`.
- Incoming main: `9a33295e39553e4c05baa618b179d9a6cc5536db`.
- Integrate main into the PR branch without rebasing or force-pushing history.
- Only text conflict: `scripts/canary-evidence-wiring.test.mjs`, where both parents
  intentionally pinned different reviewed bridge source baselines.

Preserve the callback authorization and append-only closure implementation from
the PR, plus the existing main address/CRM, photo-viewer, publication and regression
work. The runtime auto-merge adds only main's analyzer preview import, duplicate
analyzer-save guard and property-data preview composition relative to the PR
parent. No callback/closure, dispatch, retry or auth-policy resolution edits are
needed. Main's package, Docker and CI changes are retained, not reinvented.

## Exact-Source Assertion

Keep the assertion and extraction logic intact. Normalize LF, exclude the exact
maturity builder and remove the existing canary reader import, then hash UTF-8.
The PR parent's old pin produced the expected RED after integration: 20 passed,
one fingerprint failure. PowerShell SHA256 and the actual Jest assertion both
reported the combined digest below.

| Source | Outside-Builder SHA256 |
| --- | --- |
| PR parent | `b512d5e45f896beb77cd5383ab1219a047b70c11ba204c9ba23728134c145274` |
| Incoming main | `a0ca25e800b8c6d9f02a8a66df1d0f0057d75df518e596414593d071e6b59353` |
| Combined | `8f4c75d02168d6afe84a319c5e399d957d4b6498b08e4a83ed3ad26a17cc3ce1` |

Independent combined-source review found no actionable findings. The reviewer
recomputed all three hashes, verified exact extraction boundaries, confirmed the
maturity builder is AST-identical to the PR parent and checked incoming-only
files plus overlapping bridge/Docker/package changes against both parents.
No changes were dropped and no auth/approval/dispatch/retry boundary changed.
Prior callback/closure results remain historical, not proof of this tree.
The prior full-suite failures and isolated rerun caveat remain in
`2026-11-18-callback-authorization-parity.md`; they are not erased by this merge.

## Verification Status

Fresh local checks on the integrated tree:
- Five focused authorization/closure/proxy/founder/canary suites: 286 passes,
  zero failures/skips, Node 22.23.5.
- Analyzer canonical identity, composed preview, saved evidence and photo-quality
  node tests: 11 passes, zero failures/skips.
- Typecheck, lint and production build passed.
- Actual HTTP callback authorization, approval-action safety and dead-letter
  closure bridge smokes passed under isolated no-contact/provider-write guards.
- Docker import/package smoke: 193 imports/122 files checked, passed.
- Conflict-marker scan and whitespace checks passed.

Branch push and fresh CI observation are the next steps. No production readiness
or clean full-suite claim is made by these local checks. CI status will be recorded
on PR 35 without treating this branch integration as a merge into main or a release.
