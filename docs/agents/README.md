# PBK Agent Runtime

This folder documents the agent and capability boundaries that are live in PBK. The
canonical runtime catalog is `GET /api/agents/registry`; health is reported by
`GET /api/agents/health`. Agent Fleet should treat those bridge responses as the
source of truth instead of assuming that a locally defined card is callable.
The production dependency map is documented in
[production-architecture.md](../operations/production-architecture.md); every
agent action should flow through the Render OpenClaw Bridge before it reaches a
provider, memory, or durable state.

## Invocation contract

- Local agents use the bridge `/invoke` path and a registered local handler.
- Remote agents are enabled only when a matching `PBK_EXTERNAL_AGENT_*` variable
  contains an `http://` or `https://` endpoint.
- Remote invocation posts JSON to the configured endpoint's `/invoke` route and
  sends `Authorization: Bearer <PBK_BRIDGE_API_KEY>` when the key is available.
- `active` and `standby` agents are routable. Degraded or inactive agents are not.
- Provider actions such as calls, contracts, email, and nurture sends remain
  approval and compliance gated even when an agent recommends them.
- Agent actions should receive the shared
  [PBK Intelligence Context](./pbk-intelligence-context.md) before acting.
- Agent readiness is capability-based, not only online/offline. See
  [agent-fleet-readiness.md](./agent-fleet-readiness.md).
- Skill confidence and rollout decisions should be informed by
  [skill-outcome-learning.md](./skill-outcome-learning.md).
- Cross-agent delegation should follow [agent-handoff.md](./agent-handoff.md).

## Registered agents

| Agent                                               | Supervisor | Runtime role                                     | Primary tools or modules                                                                                    |
| --------------------------------------------------- | ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [Ava](./ava/README.md)                              | -          | Acquisition closer and turn supervisor           | `getAvaConversationIntelligence`, `retrieveClosingIntelligence`, `selectContextAwareScript`, `humanHandoff` |
| [Max](./max.md)                                     | Ava        | Offer recap and contract handoff                 | `prepare_and_send_contract`, `sendDocuSign`, `sendContract`, `sendSellerDocs`                               |
| [Rex](./rex.md)                                     | Ava        | Strategy, research, goals, and revenue alignment | `runRexSkillAutopilot`, `runAutonomousRexGoalDiscovery`, `webSearch`, `recordMarketIntel`                   |
| [Hermes](./hermes.md)                               | Ava        | Suggest-only transcript and pattern analysis     | `pbk_outcome_analyzer`, `pbk_suggestion_engine`, `runSystemAudit`                                           |
| [Call Analyzer](./call-analyzer.md)                 | Rex        | Post-call scoring and coaching                   | `scoreCallQuality`, `upsertCallEmbeddingFromTranscript`, conversation projector                             |
| [Prosody Tuner](./prosody-tuner.md)                 | Rex        | Voice and emotion guidance                       | `getProsodyAdvice`, `detectYelling`, `trainEmotionWorldModel`                                               |
| [Script Rotator](./script-rotator.md)               | Ava        | Context-aware script selection                   | `selectContextAwareScript`, `recordContextAwareScriptOutcome`                                               |
| [BANT Enforcer](./bant-enforcer.md)                 | Ava        | Qualification and goal completeness              | `classifyParticipant`, `getParticipantProfile`, `detectPbkIntent`                                           |
| [QA Agent](./qa-agent.md)                           | Rex        | Provider proof and result validation             | `validateProviderActionSafety`, QA validators and audit records                                             |
| [Nurture Agent](./nurture-agent.md)                 | Ava        | Approval-gated follow-up sequences               | `consultNurtureAgent`, `startNurtureSequence`, `processDueNurtureSteps`                                     |
| [Research Orchestrator](./research-orchestrator.md) | Rex        | Research planning and guarded desktop work       | `webSearch`, `launchBrowserResearch`, `runAgentCommand`, `executeLocalCommand`                              |

Property analysis and offer generation are currently bridge capabilities, not
independently routable agents. See
[property-analysis.md](./property-analysis.md) and
[offer-generation.md](./offer-generation.md).

Ava's deeper seven-figure closer doctrine lives in [ava/](./ava/). It includes
the state machine, turn contract, seller models, negotiation policy, RBP path,
emotion policy, memory governance, tool contracts, compliance, evaluation
scorecard, and call examples. Keep that doctrine aligned with the bridge modules
in `scripts/`.

## Operational checks

1. Confirm `GET /api/agents/registry` includes the expected id and endpoint.
2. Confirm `GET /api/agents/health` has a recent `healthCheckedAt`.
3. Invoke through the bridge tool registry, never directly from the browser.
4. Confirm the resulting provider proof or timeline event before showing success.
5. Keep remote endpoints unset until the remote service has authentication,
   health checks, timeouts, and an owned deployment.

## Verification

- `npm run test:agent-fleet`
- `npm run test:agent-registry`
- `npm run test:agent-context-safety`
- `npm run test:ava-intelligence-unison`
