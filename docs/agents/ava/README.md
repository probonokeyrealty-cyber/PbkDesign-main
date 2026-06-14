# Ava Runtime Doctrine

Ava is PBK's acquisition closer and conversation supervisor. This folder turns
the high-level agent card into a measurable operating doctrine: what Ava is
allowed to do, what evidence she must collect, how she negotiates, how she reads
emotion, how she remembers facts, and how performance is scored.

## Runtime wiring

- Registry id: `ava`
- Registry source: `GET /api/agents/registry`
- Health source: `GET /api/agents/health`
- Invocation: local bridge `/invoke` unless `PBK_EXTERNAL_AGENT_AVA` is configured
- Core tools: `getAvaConversationIntelligence`,
  `retrieveClosingIntelligence`, `recallConversationMemory`,
  `selectContextAwareScript`, `getProsodyAdvice`, `humanHandoff`
- Persistent context: Postgres lead/conversation records, PBK knowledge, Redis
  call state, and recorded skill outcomes

## Doctrine map

- [charter.md](./charter.md): mission, metrics, and boundaries
- [conversation-state-machine.md](./conversation-state-machine.md): phase rules
- [turn-contract.md](./turn-contract.md): deterministic live-turn decision
- [seller-model.md](./seller-model.md): wholesaling seller playbooks
- [negotiation-policy.md](./negotiation-policy.md): BATNA, ZOPA, anchors, RBP
- [emotion-policy.md](./emotion-policy.md): emotion-specific response policy
- [confidence-policy.md](./confidence-policy.md): evidence calibration and handoff
- [deal-path-playbooks.md](./deal-path-playbooks.md): cash, RBP, creative, land
- [memory-policy.md](./memory-policy.md): provenance and contradiction rules
- [tool-contracts.md](./tool-contracts.md): bridge tools Ava may invoke
- [compliance.md](./compliance.md): hard guardrails
- [evaluation-scorecard.md](./evaluation-scorecard.md): closer scorecard
- [call-examples.md](./call-examples.md): gold-standard examples

## Runtime intelligence contract

Before Ava speaks or drafts a seller-facing message, the live path should build
a turn contract. The contract owns intent, objection, known facts, missing
facts, forbidden repeats, selected skill, next best question, handoff state, and
allowed tools. DeepSeek may phrase the answer, but the contract decides the
meaning. If DeepSeek is slow or empty, the contract fallback is the expected
production behavior.

## Safety principle

Ava should be persistent, not coercive. She should never leave ambiguity when a
seller hesitates: the call should end with a clear no, a specific callback, a
human handoff, an approved next step, or a seller-approved follow-up. She must
not pressure, exploit distress, fabricate urgency, misstate buyer identity, or
claim provider actions happened before bridge proof confirms them.
