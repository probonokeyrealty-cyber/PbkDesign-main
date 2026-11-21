# Parcel Dialer and Phone Numbers (Phase 1)

Phase 1 adds two operator surfaces inside the existing PBK shell:

- **Settings → Phone numbers**: owned Twilio and Telnyx lines, owned-number import, provider inventory search (local / toll-free), a priced purchase confirmation, approved voice-route commissioning with readback, and caller-ID enablement.
- **Dialer** (left rail, `/dialer`): a map-first parcel view, parcel ID / address lookup, exact CRM match, a contact panel (contact, activity, dial eligibility), and manual one-at-a-time click-to-call from a commissioned Twilio line.

All provider calls run in the bridge (`scripts/phone-numbers.mjs`, `scripts/parcel-dialer.mjs`, routes in `scripts/phone-dialer-routes.mjs`). The browser never sees provider credentials, parcel-source keys or full contact phone numbers; it gets contacts' last four digits only.

## Safety invariants

| Invariant | Where it is enforced |
| --- | --- |
| Selecting or looking up a parcel creates zero calls, call requests or approvals | `createParcelDialer().selectParcel` is read-only |
| Ambiguous matches are rejected: two or more CRM contacts for one parcel, or two or more parcels for one address | `matchParcelToLeads`, `resolveParcel` |
| A call needs `canPlaceCalls`, an exact single CRM match, a non-DNC phone, and a commissioned, caller-ID-enabled **Twilio** line | `eligibility()`, re-checked at dial time |
| Every call needs an approved `dialer_call` approval bound to the exact parcel, lead, numbers and line (SHA-256 binding) | `requestCall` / `placeCall` |
| One request produces at most one call; the call is persisted before Twilio is contacted | `placeCall` |
| Outcome and talk time come only from **signed** Twilio status callbacks (`X-Twilio-Signature`), bound to the exact call SID / parent SID, and deduplicated | `handleStatusCallback` |
| Talk time is the contact leg's `CallDuration`, not the operator leg | `handleStatusCallback` |
| Results are written to the exact CRM lead the call was approved for (`dialerCalls`, `lastCallOutcome`, `lastCallTalkSeconds`) | `recordLeadResult` |
| Purchases need an exact-number quote, a confirmed price that matches the quote, and an admin-approved `phone_number_purchase` approval | `quote`, `createOrder`, `executeOrder` |
| The order is persisted as `submitting` before the provider call. Ambiguous responses (timeout, 5xx, network) are reconciled against owned inventory and the provider order reference before any retry. Retries reuse the same reference, up to 3 attempts | `executeOrder`, `reconcileOrder` |
| Commissioning applies only the admin-approved route (route hash), then reads it back. A mismatch leaves the line disabled | `executeCommission` |
| Caller ID can only be enabled on a commissioned line, after a fresh readback | `setCallerIdEnabled` |
| SMS registration status is separate from voice and is never changed by commissioning | `smsStatusFor` |
| The default caller ID (`PBK_TELNYX_FROM_NUMBER` / bridge default, the 8134 line) is adopted as an existing route, locked, and never re-routed | `ensureLegacyLines`, `default_line_locked` |
| Lines in `PBK_AVA_ELEVENLABS_PHONE_LINES` (the secondary 5307 line) keep Ava on ElevenLabs. Toll-free SMS stays blocked until the line is listed as verified | `decorate`, `smsStatusFor` |

## Permissions

- The bearer (founder/admin) has full access.
- Team sessions:
  - `GET /api/phone-numbers` is allowed (read-only).
  - Every other `/api/phone-numbers/*` route needs `canManagePhoneNumbers` (`PBK_TEAM_CAN_MANAGE_PHONE_NUMBERS=true`; off by default).
  - `/api/dialer/call*` writes need `canPlaceCalls`.
- Approvals:
  - Purchase (`admin_phone_number_purchase`) and voice-route (`admin_voice_route`) approvals are admin-only under the existing `getTeamApprovalRestriction` rule.
  - `dialer_call` approvals follow the existing `canApproveProviderActions` rule.
- All approvals appear in the existing PBK approval queue (`/api/approvals`, Inbox, Slack fan-out).

## Configuration boundary

| Variable | Purpose | Default |
| --- | --- | --- |
| `PBK_PHONE_PROVIDER_MODE` | `mock` or `live` | `mock` locally, `live` when hosted |
| `PBK_TWILIO_ACCOUNT_SID`, `PBK_TWILIO_AUTH_TOKEN` | Twilio IncomingPhoneNumbers, AvailablePhoneNumbers, Pricing, Calls, and callback signature validation | unset |
| `PBK_TELNYX_API_KEY`, `PBK_TELNYX_CONNECTION_ID` | existing Telnyx credentials, reused for phone_numbers, available_phone_numbers and number_orders | existing |
| `PBK_PHONE_NUMBER_PURCHASES_ENABLED` | must be `true` for any live purchase to execute | off |
| `PBK_TWILIO_DIALER_ENABLED` | must be `true` for live Twilio click-to-call | off |
| `PBK_DIALER_AGENT_PHONE` | operator phone that rings first (agent-bridge pattern) | unset |
| `PBK_PUBLIC_BASE_URL` | public HTTPS base for the voice route and signed status callbacks (required for live dialing) | existing |
| `PBK_TWILIO_VOICE_URL` | optional override for the Twilio inbound voice URL applied during commissioning | `${PBK_PUBLIC_BASE_URL}/api/webhooks/twilio/voice` |
| `PBK_TOLL_FREE_VERIFIED_LINES`, `PBK_SMS_REGISTERED_LINES` | comma-separated E.164 lines whose SMS registration is complete | unset (SMS blocked) |
| `PBK_PARCEL_SOURCE_URL`, `PBK_PARCEL_SOURCE_KEY`, `PBK_PARCEL_SOURCE_LICENSE` | licensed parcel polygon source; a URL alone does **not** activate it, a license identifier is also required | unset → fixtures |
| `PBK_PARCEL_FIXTURES=off` | hide fixture parcels (coverage reports `unconfigured`) | fixtures on |

### Licensed parcel source contract (HTTP)

The live source must serve GeoJSON with bearer auth:

- `GET {base}/coverage` → `{ status: 'ok' | ..., source, regions[], note }`
- `GET {base}/parcels?bbox=w,s,e,n` → `FeatureCollection`
- `GET {base}/parcels?line1=...&zip=...` → `FeatureCollection` (PBK re-checks exact normalized address equality)
- `GET {base}/parcels/{parcelId}` → `Feature`

Each feature must be a `Polygon` or `MultiPolygon` with `properties.parcelId` and `properties.situs { line1, city, state, zip }`. Features that fail validation are dropped. Coverage states:

- `licensed`: live source, healthy
- `degraded`: live source answered `/coverage` with a non-`ok` status
- `error`: live source unreachable
- `fixture`: development polygons
- `unconfigured`: no source

The map renders the source's own geometry as SVG and uses no third-party tile service.

## What stays fixture-backed or mock in Phase 1

- **Parcels**: 33 generated synthetic polygons in a fictional "Synthetic County" (`buildFixtureParcels`), including one deliberate duplicate address. No licensed source is configured.
- **Contacts**: synthetic CRM contacts with 555-01xx numbers are merged into matching **only in mock mode** and are never written to CRM state. Results for synthetic contacts go to dialer-local activity.
- **Providers**: mock Twilio/Telnyx adapters with synthetic 555 / 888-555 numbers. Nothing is purchased and no call leaves the container.
- **Callbacks**: in mock mode, `POST /api/dialer/calls/:id/simulate` produces correctly signed callbacks with a dev-only signing value and runs them through the same verification path.
- **Legacy engine**: Phase 1 ships in the React shell only. The legacy engine can call the same bridge routes; UI parity is deferred.

## Tests

```bash
npm run test:phone-dialer
```

The suite covers:

- authorization
- quote confirmation
- purchase persistence and ambiguous reconciliation
- commissioning readback
- signed callbacks
- parcel association
- one-contact dial eligibility
- the bridge's own team-permission gate, extracted from `openclaw-local-server.mjs`
