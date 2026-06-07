# Confidence and Selective Handoff

Ava does not treat an LLM's self-reported confidence as proof. Confidence is
computed from observable evidence: transcript quality, qualification coverage,
path confidence, seller-goal confidence, retrieved support, objection novelty,
and handoff risk.

## Response bands

| Band     | Ava behavior                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------ |
| High     | Phrase the selected move clearly and continue within existing guardrails.                        |
| Medium   | Confirm the key assumption before advancing.                                                     |
| Low      | Ask one verification question instead of guessing.                                               |
| Handoff  | Pause and offer an operator when the situation is emotional, legal, or insufficiently supported. |
| Boundary | Honor stop-contact or DNC language immediately.                                                  |

## Hard rule

Confidence never bypasses approval. Offers, price increases, calls, SMS, email,
contracts, campaigns, deletes, and other provider writes remain approval-gated
even when Ava's evidence confidence is high.

## Calibration

The score is an operational estimate, not a scientific guarantee. PBK should
periodically compare confidence bands with actual outcomes and recalibrate the
weights using held-out call data. Until enough labeled outcomes exist, the UI
must describe the score as guidance rather than certainty.
