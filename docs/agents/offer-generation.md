# Offer Generation Capability

Offer generation is currently part of PBK's analyzer, script, approval, and
contract workflow. It is not an independently routable agent.

## Inputs

- Analyzer values such as ARV, repairs, MAO, RBP, debt, and seller ask
- Selected deal path
- Seller goals, stage, objections, and approval thresholds
- Current negotiation and contract state

## Outputs

- Recommended offer or negotiation range
- Deal confidence and rationale
- Approval request when the offer crosses policy thresholds
- Contract handoff after approval

## Runtime wiring

- Analysis: `analyzeDeal`, `simulateDealConfidence`
- Negotiation: `selectContextAwareScript`, `avaOverrideOffer`
- Doctrine helpers: `scripts/negotiation-policy.mjs` and
  `docs/agents/ava/negotiation-policy.md`
- Approval: `sendNegotiationApproval`, `createApproval`
- Contract: `prepare_and_send_contract`, `sendDocuSign`, `sendContract`

The browser must never calculate and send an authoritative offer by itself. It
submits operator intent to the bridge, which applies policy and provider checks.

RBP is supported as a doctrine path for high-repair or maximum-net seller cases.
Do not add a standalone offer-generator agent until it has an authenticated
registry entry, health check, timeout, and owned deployment.
