# Reviewed Hermes prospecting bridge fingerprint

The last passing Founder Verify on `main` ran on
`3dc70bad65f231505a44b425fe55c1d6380b0e4b`. PR #91 changed the bridge, and
Founder Verify on `d4cc86c22e6222e4762a34fa2679dc72e2f7b477` failed the existing
SHA-256 assertion. On that exact revision, the author and an independent
reviewer each reproduced 20 passing wiring tests and one fingerprint mismatch.
[Last passing run](https://github.com/probonokeyrealty-cyber/PbkDesign-main/actions/runs/45028496119) ·
[Failing main run](https://github.com/probonokeyrealty-cyber/PbkDesign-main/actions/runs/45071374414)

## Complete bridge diff

The independent review covered all nine hunks (48 additions, eight deletions)
in `scripts/openclaw-local-server.mjs` between those commits.

1. The bridge imports the Hermes parcel prospecting adapter and registers four
   staff POST routes for search, CRM match, approval request, and save. The
   existing Netlify proxy session verification and bridge bearer, team, TOTP,
   and bootstrap checks apply.
2. Approval creation gains an internal notification option that defaults to
   the existing behavior. A prospecting approval starts pending and suppresses
   Slack and webhook fanout. The server signs the exact approval ID, parcel ID,
   and situs binding. A save requires that binding and approved status.
3. The exact-parcel save invokes the canonical manual CRM path with the
   `hermes-prospecting` intake and audit source and analyzer queuing disabled. The adapter
   validates county evidence, rechecks CRM matches and ambiguity, and reuses
   the existing durable retry behavior. This path writes the approved property
   lead. It queues no analyzer and carries no seller contact data.
4. When configured, the ranking adapter sends indexed property features to
   DeepSeek and validates the returned order. The ranker has no approval,
   dispatch, dialing, or seller-contact authority.

The review also covered the imported adapter, proxy, and Dockerfile copy
step. The later City GIS fallback requires one exact named feature with usable
boundary rings. It stops before county search or save if both city sources fail.
The review found the existing authorization, provider dispatch, and
seller-contact boundaries intact.

## Independent digest verification

Both reviewers reproduced the SHA-256 calculation from Git objects using the
test's LF normalization, maturity-builder and reader-import exclusions, and
the two existing Raleigh public-market replacements for the helper import and
projection call. The excluded builder matched the full parsed function in both
revisions and had identical source.

| Reviewed revision | Bytes hashed | SHA-256 |
| --- | ---: | --- |
| `3dc70bad65f231505a44b425fe55c1d6380b0e4b` | 3,526,626 | `6ef984330d7b1aec19a8b81291ae4840303d3fb08b7ccf4d1c7dbc15bdfeffa6` |
| `d4cc86c22e6222e4762a34fa2679dc72e2f7b477` | 3,529,357 | `8330fbb688a4d8567c2e6e2cd4aa2f8a111b1e2735ab1c3d7771dc5ae1360dcb` |

The fingerprint change updates the expected digest and its comment. The
bridge source and fingerprint projection retain their reviewed versions.

## Local verification

Node v24.14.1 ran with an OS and path environment allowlist. No runtime
database or provider configuration was passed to the test processes. The
standard Node VM Modules warning remained enabled.

- Six Jest suites passed all 431 wiring, reader, protocol, proxy, and
  provider authorization and dispatch tests.
- The Hermes prospecting and parcel dialer suites passed all 22 fixture tests.
- The release qualification, operational audit, and backlog reconciliation
  bridge smokes passed in serial isolated runs. The Render Docker import check
  also passed.

## Approval smoke assertions

The first Founder Verify on the refresh passed all 92 Jest suites, then
stopped at the Manual UX Gap smoke. Its source matcher expected unconditional
approval notifications. The Postgres No Fallback smoke also failed locally
because its method locator expected the old single-parameter signature.
[First CI run](https://github.com/probonokeyrealty-cyber/PbkDesign-main/actions/runs/45074850331)

The independently reviewed smoke updates locate the existing approval handler
and check the concurrent n8n and Slack notification calls with their
3,000 ms and 3,500 ms timeouts. The Postgres smoke still requires the durable
approval row write before the state snapshot. Both smokes passed locally.
In-memory variants confirmed the tests still reject changed timeouts, loss of
concurrent execution, and omission of the durable write.

## Sync with main

PR #97 added a staff read of the decision on an exact parcel approval and
updated the fingerprint on `main` to
`8e44fa430013f7677fcca62d3bbd6c56c1219c148b751b551643df5e72b88adf`.
PR #96 adopts that existing fingerprint unchanged from
`b62eb6513a4f3c2b7479852dd469a4b0614040e4`. The digest above records
the earlier revision reviewed for this PR.

The merged notification smoke preserves the checked skip result from
`main` and checks both bounded calls inside the concurrent notification
branch. The durable approval write check continues to cover the current
handler signature.
