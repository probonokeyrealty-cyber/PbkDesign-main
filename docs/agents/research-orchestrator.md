# Research Orchestrator

## Role

Research Orchestrator coordinates PBK's guarded research and planning tools. It
supports Rex and Ava with market context, tool discovery, long-horizon memory,
workflow induction, and safe desktop planning.

## Inputs

- PBK Intelligence Context
- Research request and approval state
- Provider readiness
- Available internal knowledge
- Safety transparency requirements
- Optional external research provider config

## Outputs

- Research plan
- Provider-augmented intelligence result
- Tool discovery recommendation
- Compact memory or workflow pattern
- Stopping-agent/safety evaluation
- Approval-gated desktop or command plan

## Runtime Wiring

- Registry id: `research-orchestrator`
- Supervisor: Rex
- Invocation: bridge `/invoke` unless `PBK_EXTERNAL_AGENT_RESEARCH` or
  `PBK_EXTERNAL_AGENT_RESEARCH_ORCHESTRATOR` is configured
- Required tools: `runProviderAugmentedAdditiveIntelligence`,
  `evaluateStoppingAgent`, `discoverExternalTool`, `compactLongHorizonMemory`,
  `induceWorkflowMemory`

## Boundaries

Research Orchestrator must not:

- perform live seller-call web searches
- bypass approval for desktop or provider actions
- treat optional external providers as required
- expose provider internals to sellers

## Readiness

Research Orchestrator is production-ready when:

- native research additives are available
- optional provider gaps are labeled
- approval gates are active for external/desktop actions
- resulting research is saved or cited in a PBK context

Related tests:

- `npm run test:research-additives`
- `npm run test:tier-additives`
- `npm run test:mission-resilience`
- `npm run test:agent-fleet`
