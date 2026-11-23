# Reviewed Ava first-content timing fingerprint

The bridge diff from `a48d1129c84a51c5473571521cdea63c900b0730` to
`bf0037bcf1f3ad01ae88c6f841daa8d2ad85a719` adds one timing call and its
comment inside the existing assistant operations delivery callback.

The bridge marks first content when its private delivery observer confirms
completion of a JSON or final-only stream response. An earlier streamed
preview retains its timing. Server-side response completion is the measured
event. The callback still requires the existing completion, cancellation,
tool, QA, and safety checks before signing a sample. The reviewed diff leaves
authentication, approvals, provider dispatch, and seller contact gates intact.

## Digest verification

An independent reviewer inspected the exact bridge diff and recomputed the
digest from Git objects. Both calculations used LF normalization, the
maturity-builder and reader-import exclusions, and both Raleigh
public-market replacements as implemented in the existing test.

| Reviewed revision | Bytes hashed | SHA-256 |
| --- | ---: | --- |
| `a48d1129c84a51c5473571521cdea63c900b0730` | 3,558,818 | `4d68113ac4ee67ae453a938a3aa66cd283c9257266305f90fabdbd8f757b44bf` |
| `bf0037bcf1f3ad01ae88c6f841daa8d2ad85a719` | 3,559,002 | `7bb70c4f41d963041a2d2dfef6bcdd283103053aaa7843edac10a11cefae1dc8` |

With the original digest, the wiring suite passed 20 tests and failed the
fingerprint assertion. The refresh updates the expected digest and its
comment. The digest algorithm and existing exclusions are unchanged.

## Local verification

Both fictional final-only cases reproduced the missing timing before the
fix. After the fix, the six focused suites passed all 197 tests. They
covered the actual handler and delivery observer, streamed preview timing,
aborted delivery, and controlled and diagnostic exclusions.

The release qualification, operational audit, and backlog reconciliation
bridge smokes passed in serial isolated runs, and the Render Docker import
check passed. The Node VM Modules warning remained enabled.
