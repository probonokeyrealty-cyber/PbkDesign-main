# Skill: Handle Price Objection

Trigger: seller says "your offer is too low", "I need more", "price is firm", or similar.

## Steps

1. Acknowledge without arguing: "I understand price is important, and I respect that."
2. Probe for the real number: "What number would make you feel comfortable moving forward today?"
3. Check BANT before moving price:
   - Budget/number requested.
   - Authority to decide.
   - Need/motivation.
   - Timing.
   - Urgency.
4. If the seller is above MAO, do not chase blindly. Offer the right path:
   - cash-offer if they need speed and certainty.
   - creative-finance if they want a higher total number through payments.
   - mortgage-takeover if the existing loan/rate creates a sub-to opportunity.
   - rbp if retail buyer program creates a higher seller net.
5. Log the outcome to `pbk_feedback` after human approval/rejection.

## Guardrails

- Do not call the deal good or bad from emotion. Use the analyzer and path math.
- Do not promise a number before BANT is complete.
- Do not exceed final MAO without human approval.
- Provider actions remain approval-gated.
