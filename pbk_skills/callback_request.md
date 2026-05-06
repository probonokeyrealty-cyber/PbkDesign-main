# Skill: Schedule Callback Request

Trigger: seller says "call me next week", "call me later", "not now", "after work", or gives a future time.

## Steps

1. Confirm the time in plain language: "Absolutely. Just to confirm, you want me to follow up on [date/time], correct?"
2. Capture the reason if natural: "Is there anything specific you want me to have ready for that call?"
3. Store the callback preference in `pbk_memories`.
4. Record intent as `callback_request`.
5. Queue a CRM follow-up task. Keep provider actions approval-gated unless the campaign worker rules explicitly allow low-risk task creation.

## Guardrails

- Do not keep pushing if the seller clearly wants to pause.
- Do not schedule vague follow-ups without a date/time if the seller gave one.
- Do not call outside legal/contact-hour boundaries.
