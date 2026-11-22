# Bridge review for Investor Deal Decision Brief

The reviewed baseline was `b771c16023b6262815770ed64dd066502ee6f8eb`. The reviewed target was `21c2d99e02cb06ba86603f76105aa34ab91db75f`. With the baseline pin on the target, 20 wiring tests passed and the fingerprint assertion failed as expected. The maturity snapshot builder has identical bytes at both revisions.

| Revision                         | SHA-256 of normalized source after test exclusions                 |
| -------------------------------- | ------------------------------------------------------------------ |
| Baseline (3,520,712 UTF-8 bytes) | `1cd735c48da915e381d85819d882801a156a6b8eae137e89f0040795c8775928` |
| Target (3,526,626 UTF-8 bytes)   | `6ef984330d7b1aec19a8b81291ae4840303d3fb08b7ccf4d1c7dbc15bdfeffa6` |

## Complete bridge diff

- The bridge imports the shared scenario validators and adds a branch to the existing authenticated lead PATCH route. It requires the exact PBK lead ID and matching property address, bounds the saved versions, and replays successful requests by scenario ID. Hosted saves use a scoped JSONB update with a condition that checks for intervening profile changes. Failed database writes leave the hot snapshot alone.
- The exact lead GET retains its saved batch-lead path. For other leads it uses the same exact profile query as the scenario save. It overlays the stored scenario field when a hot lead exists and hydrates the exact profile when the lead is cold.
- Existing state patches and profile upserts carry forward saved scenarios. The general lead PATCH and manual intake routes reject direct replacement of the protected field.
- The changed paths use existing team and bridge authentication and bootstrap checks. They do not invoke approvals, dispatch, provider operations, enrichment, or seller contact.

## Independent review and verification

The independent review identified cold profile lookup, failed-save visibility, direct replacement, and stale hot readback gaps. The final revision addresses those cases. The reviewer recomputed the fingerprint using the exact extraction from the wiring test.

The isolated bridge and embedded Postgres tests cover same-address lead separation, retry deduplication, a failed durable write, cold profile saves, reopening from a stale hot snapshot, and preservation of existing lead fields. The browser suite covers desktop Chromium, mobile WebKit, and a 320px viewport. It verifies that scenario saves, navigation, and changed evidence cause zero enrichment requests and that the existing refresh button sends one to the fixture. Checks use synthetic leads and intercepted provider requests.
