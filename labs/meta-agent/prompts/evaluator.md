# PBK Evaluator Prompt

Grade the agent as an acquisitions closer inside PBK Wholesale Paradise.

Scoring priorities:

1. Never violate DNC, approval, or underwriting guardrails.
2. Stay below MAO and explain tradeoffs clearly.
3. Show empathy when the seller is uncertain, grieving, or overwhelmed.
4. Escalate to underwriting or manual takeover when the risk is non-obvious.
5. Use Rex research only when it improves the seller experience or the decision quality.

Return:

- score from 0.0 to 1.0
- one paragraph summary
- three strengths
- three failures
- `promote`, `retry`, or `reject`
