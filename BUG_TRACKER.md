# PBK Bug Tracker

This tracker separates true production blockers from optional warnings and local-only experiments. Keep it current when a bug is discovered, fixed, or intentionally deferred.

## Open Bugs

| ID | Description | Priority | Root Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| B1 | Live Telnyx to Deepgram transcript proof has not been created | P0 | No answered live outbound proof call with speech has been completed and verified in Supabase | Make one approved outbound call, speak clearly for 10-15 seconds, then verify `pbk_memories.memory_type = 'call_transcript'` and non-empty `pbk_intent_events.transcript_snippet` | Pending operator proof |
| B2 | Sentry production intelligence is unavailable | P1 | Sentry SDK/env/auth are not configured in this repo/session | Install/configure Sentry SDK and set `SENTRY_DSN`, `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` through the correct secret stores | Open |
| B3 | Dashboard profile can show "PBK Bridge key required" | P1 | Browser local storage has bridge endpoint saved but no private bridge API key | Save the private PBK Bridge API key in dashboard Settings for that browser profile | Operator setup |
| B4 | BatchData health warning | P3 | Optional `PBK_BATCHDATA_API_KEY` is not configured | Add the key in Render only if BatchData skip trace is actively used | Deferred optional |
| B5 | BrowserOS/Bytebot hosted health warnings | P3 | Optional automation workers are not intentionally connected to hosted PBK | Ignore until the automation worker lane is promoted into the launch scope | Deferred optional |

## Fixed Bugs - Last 30 Days

| ID | Description | Fix Deployed | Verification |
| --- | --- | --- | --- |
| F1 | Production canonical control routes returned `404` | Added live aliases for analyzer, approvals, contract draft/send/remind/void/pdf and deployed bridge revision `2026-05-14-command-center-route-hardening` | `npm run test:hosted`, `npm run health:weekly:json`, and live route probes passed |
| F2 | Contract send button looked broken in production | Live `settings.ui.operatingMode` was `manual` while system status was `approval`; set UI operating mode back to `approval` | `/api/contracts/:id/send` now returns `202 queued_for_approval` |
| F3 | Hosted bridge could appear to direct-dial local OpenClaw | Hosted bridge now defaults direct gateway URLs to empty, skips loopback probes, and reports heartbeat-only status | `npm run test:live-data-audit` checks heartbeat-only language and absence of "bridge keeps retrying" |
| F4 | Real-time browser WebSocket exposed key/reconnect issues | Browser voice session endpoint is used and direct key-in-URL leaks were removed | Browser console was clean; no WebSocket token URL matches found |
| F5 | Static/mock Agent Fleet examples confused launch status | Agent Fleet defaults now reflect honest Ava/Rex runtime records | `npm run test:live-data-audit` passes Agent Fleet checks |

## Priority Definitions

| Priority | Meaning | Examples |
| --- | --- | --- |
| P0 | Blocks production proof or wholesale execution | Missing live transcript proof |
| P1 | Causes operator confusion, failed actions, or missing observability | Sentry not configured, bridge key missing in a browser |
| P2 | Degrades reliability or speed but does not block launch | Long-idle reconnect polish, compression tuning |
| P3 | Optional provider, cosmetic, or local-only noise | BatchData, BrowserOS, Bytebot, local Ollama |

## Zero Bug Checklist

- [ ] `npm run test:founder` passes locally.
- [ ] `npm run test:hosted` passes against production.
- [ ] `npm run health:weekly:json` returns `ok: true`.
- [ ] Browser console has no red errors during core dashboard flows.
- [ ] All core button routes respond through the bridge.
- [ ] Provider-write buttons queue approval unless explicitly in autopilot.
- [ ] Slack approval approve/deny works for one harmless action.
- [ ] Contract draft, PDF, remind, void, and send approval paths work.
- [ ] Browser voice can create live transcripts.
- [ ] One Telnyx to Deepgram spoken call creates transcript and sentiment rows.

## Verification Queries

```sql
select count(*) as call_transcript_memories
from public.pbk_memories
where memory_type = 'call_transcript';

select count(*) as intent_events_with_transcript
from public.pbk_intent_events
where coalesce(transcript_snippet, '') <> '';

select transcript_snippet, metadata, created_at
from public.pbk_intent_events
where coalesce(transcript_snippet, '') <> ''
order by created_at desc
limit 5;
```
