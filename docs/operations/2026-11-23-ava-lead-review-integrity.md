# Ava lead review bridge integrity

The independently reviewed bridge change adds a read-only review to the authenticated lead detail GET. The ordinary full lead response still follows its existing path.

| Revision | Reviewed commit | Normalized canary wiring digest |
| --- | --- | --- |
| Base | `90a0c39ce5f66cb07f3e8b621a8722a49ee9a2b7` | `51f5b8e22d41812ca130a813a6e55586a97e204212053f86b246c239de81b6b4` |
| Pilot | `642d9eb89f3ebeaa52c912fa75d63bd66d1822f7` | `ab96f0c7a03d6e492d39d81b7514e8b28d06998e179237ebb19020622f0929d8` |

The bridge diff adds the saved `dnc` field to the existing workspace-scoped profile read. The review variant uses that exact record and honors contact restrictions from either the durable profile or the cached lead. It returns only the evidence flags, missing qualification fields, saved analysis date when available, and an internal recommendation. An unavailable durable read returns 503. An unresolved lead ID returns 404.

The review adds no authentication or approval authority and performs no CRM writes, dispatch, seller contact, or provider requests. Existing provider-action approvals and the JSON chat default stay in place.

The wiring suite reproduced the digest mismatch with the existing pin. The independent reviewer applied the test's existing normalization and exclusions to both revisions. The isolated bridge fixtures cover exact identity, staff authentication, retries, stop-contact requests, conflicting revoked consent, and unchanged lead, task, approval, and outreach records.

## Cold profile compatibility

Release Qualification reproduced a failure when the shared profile read selected a normalized DNC column absent from the cold profile fixture. The corrective commit `0027d301d5fda1c3adfac53f3129f5413d05aa29` restores the original full profile and investor save projections. Only the review checks for the optional DNC field through a JSONB projection on the exact workspace-scoped row.

The independent review reproduced the prior digest `ab96f0c7a03d6e492d39d81b7514e8b28d06998e179237ebb19020622f0929d8` and computed the corrected digest `b45ad034c38768862f21236a3d097a43b1f156c8306986f10518c677a9731977` using the same test normalization. The embedded Postgres regression covers profiles with and without the column and confirms the investor save remains exact and replay-safe. The correction changes no write, approval, dispatch, or authentication path.


## Main branch integration

The PR branch integrates main commit `90318ac9e351c2419870a072593e9cc95d72e9a5` with pilot head `06d97cc88463ac72bf477404bc3892057a09c128` in `5149eaf02da17407b52490f2cd9dd89b88453c44`. The bridge combined cleanly. The integrity test was the only textual conflict, and the test reproduced the expected fingerprint mismatch before the pin was updated.

| Reviewed commit | Normalized canary wiring digest |
| --- | --- |
| Main | `466ebe8a5c1d08ee351352841b81908a777f9609fff45fd103372947624355e1` |
| Pilot | `b45ad034c38768862f21236a3d097a43b1f156c8306986f10518c677a9731977` |
| Combined | `6026802ba37965e2c49e49f078d1de29e5569e557ce374d95da6ed9f9464ebe9` |

The independent review reproduced both prior pins and the combined digest using the existing normalization and exclusions. Main's intake path records internal Rex and Hermes consultations with provider writes blocked and keeps their lead details out of public liveness. The pilot's exact-lead GET reads saved evidence and honors contact restrictions. The integration keeps the existing authentication, approval, and dispatch paths and Ava's JSON default.


## Durable intake integration

The second integration `136547968d4226b727c0258175323f22bb92fb6b` combines main `91c91729db49afa4ce9c424c02bae9812aca0eb1` and the previously verified PR head `bcb015c36be85c174c707b7472510c26a54154a9`. Again, the bridge merged cleanly and the wiring test reproduced the fingerprint mismatch before the pin changed.

| Reviewed commit | Normalized canary wiring digest |
| --- | --- |
| Main | `89acf2ab83e37ddab107c119b5867adfd7c1ceb0679b176687a7788dab38283c` |
| Previous PR head | `6026802ba37965e2c49e49f078d1de29e5569e557ce374d95da6ed9f9464ebe9` |
| Combined | `bb914c03b56182b5fb03889c0ed25ead61147238d2dc32e81d0b3de3ff2df53e` |

Independent review reproduced both parent pins and the combined digest. Main's recovery path reads an exact lead event and linked triage after a lost Postgres acknowledgment. It preserves the existing write retry policy and returns 503 when it cannot confirm the commit. The intake regression and the pilot's read-only route and tests are preserved. The integration changes no authentication, contact, provider approval or dispatch controls, or JSON chat default.
