# BANT Enforcer

## Role

BANT Enforcer tracks seller qualification completeness: budget, authority, need,
timeline, urgency, and deal-path readiness. It helps Ava ask one useful question
instead of drifting or repeating herself.

## Inputs

- Ava turn contract
- Seller fact ledger
- Lead profile
- Conversation transcript
- Participant profile and authority signals
- Current deal path and stage

## Outputs

- Missing qualification fields
- Recommended next qualification question
- Authority or stakeholder warning
- Path-lock readiness signal
- Handoff suggestion for legal/title complexity

## Runtime Wiring

- Registry id: `bant-enforcer`
- Supervisor: Ava
- Invocation: bridge `/invoke` unless `PBK_EXTERNAL_AGENT_BANT` or
  `PBK_EXTERNAL_AGENT_BANT_ENFORCER` is configured
- Required tools: `classifyParticipant`, `getParticipantProfile`,
  `getAvaConversationIntelligence`

## Boundaries

BANT Enforcer must not:

- ask for facts already present in the ledger
- pressure grieving, angry, or overwhelmed sellers
- bypass the state machine to force an offer
- treat incomplete authority as contract-ready

## Readiness

BANT Enforcer is production-ready when:

- lead identity is resolved
- participant profile is available or labeled missing
- current phase is known
- prior questions and known facts are loaded
- anti-repeat policy is active

Related tests:

- `npm run test:ava-live-turn-contract`
- `npm run test:ava-governed-skill-router`
- `npm run test:agent-fleet`
