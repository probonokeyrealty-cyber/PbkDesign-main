# PBK Brain and Call Floor Audit

Date: 2026-05-08

## Brain setup wording

The Brain setup chips explain the Rex strategist loop. Their purpose is:

- Brain bridge keys: let n8n authenticate to the PBK bridge and know which model endpoint Rex should use.
- Rex learning loops: import `rex-strategist` to propose improvements and `rex-outcome-evaluator` to measure whether approved improvements worked.
- Provider safety: keep Instantly, Telnyx, and DocuSign sandboxed until one verified live test passes.
- Approval audit: record Approve, Decline, and Modify decisions so Ava/Rex can learn from founder decisions.

I changed the UI copy from internal shorthand into plain-English operational language so a team member can understand what each setup item does without knowing the infrastructure.

## Call Floor production audit

The backend bridge is already capable of supporting the live Call Floor:

- `GET /api/calls` returns the current call records.
- `POST /api/calls` is approval/provider-gated through `telnyx_call`.
- `POST /api/events` with `call-status`, `call-transcript`, and `call-control` updates the runtime state.
- `POST /api/calls/:id/action` supports direct call-control actions.
- Call records include lead name, address, phone, provider, status, assistant, transcript, sentiment, yell risk, timestamps, and call identifiers.

The dashboard needed a production-facing cleanup:

- The Call Floor HTML contained static Diane/John sample calls.
- The visible page did not clearly distinguish live bridge data from sample seed data.
- The page needed an explicit empty state when no real AI calls are active.

## Changes made

- The Call Floor now hides static sample calls and renders from PBK Brain runtime state.
- Demo/sample calls are filtered out by ID, fake 555 phone ranges, and known seed lead names/addresses.
- If no real active calls exist, the page shows a clear "No AI calls are live right now" state.
- Queued outbound calls render from live bridge state only.
- The summary pill now reads live active/queued counts after bridge sync.
- Call tiles show transcript, sentiment, provider, yell risk, timer, assistant, and takeover controls.
- The existing call-control buttons remain wired to the bridge through `call-control` events and do not trigger provider writes directly.

## Launch readiness

Ready for production display after the browser has the private PBK bridge API key saved in Settings.

Still human/secure by design:

- A real Deepgram phone proof still requires one answered call with speech.
- SMS/email/calls remain approval-gated.
- Provider writes should stay sandboxed until one verified live test passes.

