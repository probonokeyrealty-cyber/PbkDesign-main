# Production public market connection check

This release checks connectivity only. It does not add a job dispatcher,
approve work, execute a Composio tool, or create an E2B sandbox. Previous
completed runs are reported separately.

Set these on the production bridge service only, using Render's protected
environment settings. Do not copy the staging keys or reuse other PBK keys.

| Variable                                    | Value                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PBK_E2B_MARKET_WORKER_API_KEY`             | Dedicated production E2B project key                                                                                                              |
| `PBK_COMPOSIO_MARKET_SEARCH_API_KEY`        | Dedicated production Composio key: Tools read, Session management read, Session tool execution write only; no other scopes                        |
| `PBK_COMPOSIO_MARKET_SEARCH_SESSION_ID`     | Independently approved production public-search session ID                                                                                        |
| `PBK_COMPOSIO_MARKET_SEARCH_USER_ID`        | Pinned production session user                                                                                                                    |
| `PBK_COMPOSIO_MARKET_SEARCH_CONFIG_VERSION` | Exact approved session configuration version                                                                                                      |
| `PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256`  | SHA-256 of canonical JSON for the approved REST tool's `input_parameters`: object keys sorted recursively, array ordering retained, no whitespace |
| `PBK_E2B_MARKET_CONNECTION_CHECK_ENABLED`   | `true` only after the production credential and session pins have been verified                                                                   |

The session must expose exactly `COMPOSIO_SEARCH_WEB`, with no connected
accounts, auth-config pins, or optional execution helpers. The probe makes
three bounded GETs: E2B inventory (one result, discarded), Composio session
metadata, and Composio tool listing. It does not need a database access change.
No provider calls are made when disabled or missing configuration.

In signed-in production Settings, expand **System diagnostics** and refresh.
Both provider checks must pass for **Connected, execution unverified**. The
bridge never reports execution readiness from these checks. Turn the
connection check back off to roll back activation without touching either
provider key, the stored history, or the database allowlist.
