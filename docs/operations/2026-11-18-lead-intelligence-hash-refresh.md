# Reviewed lead intelligence bridge fingerprint

The founder authorized testing and deploying explicit lead property intelligence to the existing Netlify and Render services. The reviewed base is `df970f95172a3b0f9e5c6573f4887302a86e6c37`; target bridge source is `43c0066eacd792e41837dd20a5a1d641edf48b0c`.

An independent final reviewer inspected the complete outside-builder diff: coordinator import; exact-ID patch matching; optional exact-identity profile persistence; bounded hydration of durable-only imported leads; explicit enrichment composition and save; authenticated enrichment route; and expected-address PATCH identity/persistence guards. Authentication, provider/admin approval gates, dispatch, and outbound contact authority are unchanged. The maturity builder is byte-for-byte unchanged.

The reviewer reproduced the old fingerprint failure (20 wiring tests passed, one fingerprint assertion failed), then independently computed the LF-normalized whole-bridge hash using the wiring test extraction. Root independently reproduced the same digest.

- Old SHA256: `a0ca25e800b8c6d9f02a8a66df1d0f0057d75df518e596414593d071e6b59353`
- New SHA256: `a0b0dad9228d17e3bc382d010577b705730e95c16e7f42fc18259adcc6d1ee55`
- New outside-builder size: 3,487,069 bytes.

Focused persistence tests cover duplicate identity, no invalid provider calls, in-flight address changes/manual edits, deliberate comp clears, partial-source retention, real cache capture dates, and durable imports with 90 newer hot records. Isolated release-qualification, operational-audit, and backlog bridge smokes passed with no provider writes or seller contact. Docker import closure passed (176 imports, 118 files). This is a reviewed source-integrity refresh, not operational canary evidence or a production-readiness claim.

This separately scoped change updates only the fingerprint expectation and this receipt. The wiring/reader safety suites are rerun before release; VM experimental warnings remain visible.
