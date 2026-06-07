# Rex

## Role

Rex is PBK's strategist. He turns call outcomes, pipeline state, research, failure
tags, and revenue targets into prioritized goals and operator recommendations.

## Inputs

- Call and lead outcome records
- Failure tags and skill performance
- Pipeline and revenue metrics
- Market research and saved PBK memory
- Agent and provider health

## Outputs

- KPI snapshots and revenue-aligned goals
- Proactive lead actions
- Skill promotion or coaching recommendations
- Research and market-intelligence records

## Runtime wiring

- Registry id: `rex`
- Invocation: local bridge `/invoke` unless `PBK_EXTERNAL_AGENT_REX` is configured
- Core modules: `scripts/rex-autonomy.mjs`
- Core tools: `runRexSkillAutopilot`, `runAutonomousRexGoalDiscovery`,
  `handleRexLeadImported`, `recordMarketIntel`, `webSearch`
- Learning data: call analyses, tool usage, skill outcomes, market intelligence,
  and nightly learning jobs

## Boundaries

Rex recommends and prioritizes. Provider actions still pass through the same
approval, compliance, QA, and provider-proof gates as operator actions.
