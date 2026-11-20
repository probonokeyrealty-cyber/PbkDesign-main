# Reviewed staging canary baseline — November 20, 2026

This is a local test-guard review, not a deployment or feature-activation approval.

The old guard matched discovery commit `41f6097` after excluding the existing maturity builder and its reader import. The same canonical computation produces:

| Source | SHA-256 of the protected remainder |
| --- | --- |
| `41f6097` | `6f5fb343c4e8ecaa1c40ca85db9c875ed981442080c35fee5c866eafb09f7627` |
| Pre-readiness-fix staging `3aa04c1` | `b14a886b680256d42e00bd47f1926505f720fd1605a624e85544c5f630f1352d` |
| Current staging `5d32b815880794b673383db9352fca7a0ae6551e` | `a6f39aac8bc0959949654e9ad15947329c2bf3c21f20df01305862e06879c048` |

Both the old and current values were independently recomputed. The old fingerprint was already stale before the web-search readiness correction.

The full bridge/Docker diff from `41f6097` to `5d32b815` was reviewed directly and independently. Drift is broader than read-only adapters: it contains restricted Composio adapters and metadata endpoint, a separately authenticated staging QA reader, persisted Rex research handoff and truthful handler failure propagation, an approval-backed E2B public-market branch, and the readiness correction. Existing bearer/TOTP/team authorization, delivery observation, and provider-dispatch modules remain unchanged. E2B additions require a pending-to-approved transition, private capability, sealed payload and durable claim; generic task/payload/callback paths cannot forge that capability. The early metadata/QA endpoints enforce their own restricted authentication. Review found no blocking issue for pinning this already existing staging baseline.

The test retains its exact whole-remainder digest and the same maturity/import exclusions. Its title now describes a reviewed baseline rather than claiming every approval-related line has never changed. Updating this test does not enable an adapter, grant permission, approve cloud execution, alter any native CRM write gate, or establish atomic conditional updates.

The Docker exception permits exactly `COPY scripts/fixtures/public-market-program.mjs ./scripts/fixtures/public-market-program.mjs`. The actual module is a fixed runtime data processor: it reads a bounded fixed input file, formats public market text/citations and computes an unkeyed SHA-256 evidence digest. It contains no test signer, provider call or business write. Canary signer/fixture-directory copies, repository/scripts-wide copies and wildcard copies remain rejected, including quoted and JSON-form negative examples, JSON-escaped fixture segments, bracket globs, repeated dot segments and normalized root copies. An independent follow-up review reproduced rejection of the three reported bypasses and leading-slash/parent-directory variants; the focused suite passed 22/22. Reader/protocol inclusion and signer-import checks remain enforced. No Dockerfile or runtime processor source was changed.
