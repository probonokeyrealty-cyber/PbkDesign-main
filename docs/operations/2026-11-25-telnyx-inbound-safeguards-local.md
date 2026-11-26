# Local Telnyx Inbound Safeguards

Status: prepared for draft review; not deployed. No provider settings,
lead data, saved notes/comps, browser drafts or approval records changed.

## Recording

- Automatic inbound audio-file recording defaults off. Unknown flag values do
  not enable it.
- Even an explicit `PBK_TELNYX_RECORD_INBOUND_CALLS=true` cannot bypass the block:
  it returns `recording_consent_required` without a provider request.
- No recording-consent capture/verification pipeline currently exists. Incoming
  webhook fields, an environment flag, general SMS consent or a fabricated
  approval identifier cannot stand in for call-scoped recording consent.
- The unguarded `recordTelnyxCall`/`record_start` path was removed. This change
  does not implement a consent UI or authorize future recording.
- Existing live speech-to-text and transcript behavior is unchanged. This is an
  audio-file recording safeguard, not a claim that all voice data collection or
  privacy/legal requirements have been reviewed.
- After-hours callers use the existing Ava assistance path instead of being
  asked to leave a voicemail that cannot safely be recorded. No callback is
  promised and no new automated follow-up is scheduled.

## Human Transfer

- A shared strict target normalizer rejects missing, malformed, short and
  overlength numeric destinations before transfer dispatch.
- Inbound Jordan/underwriting routes fall back to Ava when a target is absent,
  the provider rejects transfer, or a wrapper skips the request.
- No imminent-transfer announcement is made before acceptance. Operator alerts
  distinguish a requested transfer from continuing with Ava.
- A failed fallback stream reports `provider_missing`, not a successful live
  route merely because the answer action succeeded.
- Successful configured transfers remain on the existing Call Control path;
  they do not start a competing assistant.
- The existing human-handoff tool returns truthful queued/unavailable copy when
  a transfer cannot be made or was not requested. Provider acceptance is not
  described as a completed transfer.
- Existing approval, DNC and provider dispatch gates are not relaxed.

## Independent Review Follow-Up

- Controlled-timing regressions reproduced a hangup being overwritten by delayed
  transfer registration, plus loss of transcript/summary updates that arrived
  during that request. Inbound routing now rechecks the exact call at asynchronous
  control boundaries, stops after a terminal event, and preserves current call
  metadata when registering. A call with the same phone but a different ID is not
  used as terminal evidence.
- Constructor-shaped callback tests also ensure provisional lead IDs, provider
  defaults and blank scripts cannot replace resolved identity or routing context.
- When fallback media fails, caller copy now states the connection is unavailable
  instead of offering assistance that cannot hear the caller. Operator alerts
  report the failure and no second assistant is started on the failed stream.
- A separate reviewer found no actionable issues in the recording-consent,
  source-audit/fingerprint or test-isolation scope at `add5265c`.
- The reviewer confirmed the follow-up metadata correction against the real call
  constructor: resolved identity/provider/prompt remain intact in returned,
  stored and projected records while transcript/summary enrichment survives.

## Verification

The new regression file extracts real bridge functions into a VM. All provider,
storage, notification and speech dependencies are sample-only stubs. The VM has
no host process, real network, provider SDK, filesystem or real timers.

`npm run test:ava-live-call-resilience` now runs the existing resilience smoke
and `scripts/telnyx-inbound-safety.node-test.mjs`, including in the existing
production-hardening verification chain.

The tests cover default-off recording, forged consent, both missing transfer
destinations, rejected/skipped/accepted transfers, fallback media failure,
after-hours behavior, exact lead/call identity and preservation of sample lead
data, notes, draft and saved comp. Tests first reproduced the unsafe behavior
before the local fixes.

Focused verification after the review fixes: 26 inbound safety regressions,
17 adjacent call-receipt/sender/voice regressions and 35 targeted Jest tests
passed. One database-only Jest test was skipped. The 124 source-audit checks
and bridge syntax check passed. AST comparison confirms that only
`handleAvaInboundRoute` changed among bridge declarations after `add5265c`.
These are isolated local results, not proof of new hosted behavior or a full
unit-suite run.

Production remains unchanged until a separately authorized release. Do not
remove SMS holds, invent transfer destinations or enable recording to test this.
