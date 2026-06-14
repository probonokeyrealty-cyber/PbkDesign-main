# Skill Outcome Learning

Skill Outcome Learning is how PBK turns real seller reactions into better agent
behavior. Skills should not stay confident because they sound good. They should
earn confidence from appointments, contracts, callbacks, clean exits, and seller
trust.

## What Gets Recorded

Every meaningful skill use should record:

- `skillId` and `skillVersionId`
- `agentId`
- trigger reason
- seller turn that caused the trigger
- selected script or action
- reply mode: deterministic, DeepSeek, fallback, or operator
- seller reaction
- final call outcome
- provider proof or timeline event
- repetition complaint flag
- compliance flag
- human handoff flag

## Final Outcomes

The outcome classifier should map calls and follow-up to these canonical results:

| Outcome       | Meaning                                               |
| ------------- | ----------------------------------------------------- |
| `contract`    | Signed or contract-send path advanced.                |
| `appointment` | Qualified appointment or call-back booked.            |
| `follow_up`   | Specific future action scheduled.                     |
| `ghosted`     | Seller stopped responding after action.               |
| `dnc`         | Seller requested no further contact.                  |
| `complaint`   | Seller complaint, anger escalation, or trust failure. |
| `lost`        | Seller clearly rejected or chose another path.        |
| `neutral`     | No clear positive or negative signal yet.             |

## Confidence Update

Skill confidence should update from outcome quality, not static preference:

- Positive: contract, appointment, qualified callback, trust repaired.
- Neutral: no decision but no complaint or confusion.
- Negative: repetition complaint, wrong objection, DNC, complaint, legal risk.

Confidence should use a decaying window so recent call behavior matters more
than old behavior. A skill with low volume should not be promoted aggressively.

## Promotion And Pause Rules

Promote a skill when:

- It has enough uses.
- It outperforms the previous script for the same trigger.
- It does not increase complaints, DNC, or repetition flags.

Pause a skill when:

- It causes repeated seller confusion.
- It triggers in the wrong context.
- It increases DNC or complaint rate.
- It conflicts with compliance, confidence, or emotion policy.

## Agent Responsibilities

- Ava records skill trigger and immediate seller reaction.
- Script Rotator records selected script and candidate ranking.
- Call Analyzer records final call quality and failure tags.
- Rex reviews weekly skill movement and recommends changes.
- QA Agent flags missing proof, missing outcome, and unsafe promotion.

## Operator View

Skill Studio should show:

- active confidence
- recent outcomes
- sample seller turns
- failure tags
- rollout cohort
- pause/promote recommendation
- last production use

Related files:

- `scripts/production-maturity-loop.mjs`
- `scripts/skill-governance-store.mjs`
- `scripts/ava-governed-skill-router.mjs`
- `scripts/context-aware-script-rotator.mjs`
- `docs/agents/ava/evaluation-scorecard.md`
