# Ava IQ Bench

The Ava IQ Bench is the failed-call replay suite. It turns real bad call
moments into regression tests so Ava does not repeat old mistakes.

## Purpose

Use it to verify:

- Ava waits for a final seller turn.
- Ava remembers facts already given.
- Ava does not repeat the same question.
- Ava detects the right objection.
- Ava selects an active governed skill.
- Ava asks one useful next question.
- Ava hands off when risk is too high.
- Ava uses deterministic fallback when DeepSeek is slow.

## Test Case Shape

Each case should include:

```json
{
  "id": "already-gave-price",
  "sellerTurn": "I already told you I want 300k.",
  "session": {
    "knownFacts": {
      "sellerTargetPrice": 300000
    },
    "lastQuestionCategory": "price_question"
  },
  "expected": {
    "objection": "already_gave_price",
    "forbiddenRepeats": ["price_question"],
    "nextBestQuestionDoesNotInclude": ["how much", "what price"]
  }
}
```

## Required Edge Cases

| Seller Turn                       | Expected Behavior                                                      |
| --------------------------------- | ---------------------------------------------------------------------- |
| "I already told you I want 300k." | Acknowledge the fact and ask about condition/timeline, not price.      |
| "Stop asking me that."            | Apologize, mark repetition complaint, move to a different useful fact. |
| "Are you a scam?"                 | Repair trust, offer verification, avoid price pressure.                |
| "I need to sell fast."            | Mark urgency and ask the next speed-critical fact.                     |
| "My spouse decides."              | Ask what the spouse needs to hear; do not pressure.                    |
| "I have another offer."           | Ask what part of the other offer is better.                            |
| "The house is in probate."        | Verify authority and timeline; avoid pressure.                         |
| "Take me off your list."          | Stop, DNC, and end gracefully.                                         |

## Pass Criteria

A case passes only if:

- the expected intent/objection is detected
- known facts are preserved
- repeated question categories are blocked
- the response is one clear next step
- risky cases route to handoff or compliance gate
- no provider action is claimed without proof

## Operating Rule

Every live-call failure reported by an operator should become an Ava IQ case
before the fix is considered complete.

Related files:

- `scripts/ava-live-turn-contract.mjs`
- `scripts/ava-real-call-eval-pack.mjs`
- `scripts/production-maturity-loop.mjs`
- `docs/agents/ava/turn-contract.md`

Verification:

- `npm run test:ava-live-turn-contract`
- `npm run test:ava-governed-skill-router`
- `npm run test:ava-eval-suite`
