# PBK Command Center Architectural Debug Reference

This is the durable source-of-truth contract for validating PBK Command Center controls, Ava/Rex behavior, OpenClaw gateway health, WebSockets, and production wiring.

## Button And Route Contract

### Lead Table

| Control | Expected route | Expected behavior |
| --- | --- | --- |
| Search leads | `GET /api/leads?search={query}` | Filter visible lead rows against live lead data. |
| Score filter | `GET /api/leads?min_score=70` | Show leads with score greater than or equal to the threshold. |
| Status filter | `GET /api/leads?status=negotiating` | Show leads matching the selected status. |
| Delete lead | `DELETE /api/leads/{id}` | Confirm, delete, toast success, remove from table and database-backed state. |
| Edit lead | `PATCH /api/leads/{id}` | Populate modal, save changes, toast success, update table and state. |
| Add lead | `POST /api/leads` | Insert a lead and render it in the live table. |

### Approval Queue

| Control | Expected route | Expected behavior |
| --- | --- | --- |
| Approve | `POST /api/approvals/{id}/approve` | Record approval, log feedback, execute approved action when eligible. |
| Deny | `POST /api/approvals/{id}/deny` | Record rejection, cancel action, log feedback. |
| View details | UI modal | Show lead, offer, repair, and approval context without side effects. |

### Contracts

| Control | Expected route | Expected behavior |
| --- | --- | --- |
| New contract | `POST /api/contracts/draft` | Prepare a draft contract record from PBK templates. |
| Send | `POST /api/contracts/{id}/send` | Send or queue DocuSign through approval/provider guardrails. |
| Remind | `POST /api/contracts/{id}/remind` | Record a reminder request and surface it in runtime activity. |
| Void | `POST /api/contracts/{id}/void` | Mark contract void through contract-status handling. |
| Download PDF | `GET /api/contracts/{id}/pdf` | Return a generated contract PDF. |
| Tab filter | `GET /api/contracts?status=draft` | Filter contract records by runtime stage/status. |

### Analyzer

| Control | Expected route | Expected behavior |
| --- | --- | --- |
| Run analysis | `POST /api/analyzeDeal` | Return ARV, repairs, MAO, target offer, and profit analysis. |
| Load lead | `GET /api/leads/{id}/full` | Populate analyzer context from selected live lead. |
| Save to lead | `PATCH /api/leads/{id}` | Persist analyzer-selected deal path and notes back to lead state. |

### Brain Ingestion

| Control | Expected route | Expected behavior |
| --- | --- | --- |
| Upload URL | `POST /api/brain/ingest` | Fetch or register content and store facts in PBK knowledge. |
| Upload PDF/file | `POST /api/attachments` | Store attachment metadata and ingest supported text. |
| Library filter | `GET /api/brain/query` | Return matching knowledge/library items. |

### Agent Console

| Control | Expected route/socket | Expected behavior |
| --- | --- | --- |
| Send chat | WebSocket/runtime command | Route to Ava/Rex through `agent_brain` and stream response. |
| Microphone | `POST /api/ws/browser/session` then `WS /ws/browser` | Stream browser audio to Deepgram, route transcripts to Ava, play ElevenLabs TTS. |
| Stop listening | Browser voice interrupt | Stop recording and interrupt TTS playback. |
| Take over live call | `POST /api/calls/{id}/action` | Transfer or control active Telnyx call only when a real call id exists. |

## Ava Behavior Contract

Ava is the executor. She is conversational, warm, direct, and approval-gated. She should greet, ask one discovery question at a time, teach value, present numbers only after analysis, handle objections with empathy and reframing, and close by asking for the next logistical step.

Ava must use tools proactively: `search_leads`, `analyzeDeal`, `remember_personal_fact`, `pbk_recall_memory`, `pbk_send_approval`, and `telnyx_call`. She must never exceed MAO, send contracts, delete leads, or trigger provider writes without the required confirmation or approval path.

## Rex Behavior Contract

Rex is the research analyst. He starts with a conclusion, gives one or two supporting facts, avoids raw data dumps, and ends with a useful follow-up question unless the user asked for a final answer. Rex uses web/property/knowledge tools to synthesize market context and comps.

## OpenClaw Gateway Contract

The local gateway should run on loopback by default. Render must not direct-dial `localhost`, `127.0.0.1`, `::1`, or the local OpenClaw port. Cloud status comes from local-to-cloud heartbeat and persistent outbound gateway signaling.

Expected checks:

- `openclaw gateway status`
- `node scripts/openclaw-gateway-heartbeat.mjs --once`
- `openclaw mcp list`
- `openclaw logs --level debug --tail 50`

## WebSocket Contract

`/ws/browser` must accept a browser session token from `/api/ws/browser/session`, emit a ready message, accept binary WebM audio chunks, forward them raw to Deepgram, return transcript/status events, and avoid exposing bridge API keys in the URL.

Telnyx media sockets are internal to live calls. A valid call must answer, start media streaming, forward audio to Deepgram, persist transcript snippets and sentiment metadata, and clean up the live-call UI when the call ends.

## Observability Contract

Use `/health`, `/api/providers/status`, `/api/gateway/status`, Render logs, Supabase logs, browser console/network, and Sentry when configured. Sentry requires `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` locally or connector login before issues can be queried.

## Go/No-Go Contract

Production is proven only when:

- `npm run test:founder` passes.
- `npm run test:hosted` passes.
- `npm run health:weekly:json` passes.
- `npm run test:e2e:browseros` passes.
- Dashboard has no fresh console errors in a clean production tab.
- `/ws/browser` connects without API-key query leakage.
- Ava/Rex route through `agent_brain` and preserve approvals.
- One real Telnyx to Deepgram spoken call creates transcript and sentiment rows in `pbk_intent_events` and a `call_transcript` memory in `pbk_memories`.

