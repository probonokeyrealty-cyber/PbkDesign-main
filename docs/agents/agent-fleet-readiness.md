# Agent Fleet Readiness

Agent Fleet readiness is not the same thing as an agent being visible in the UI.
An agent is useful only when its tools, data, memory, skills, provider lanes,
and last action proof are available.

## Readiness Levels

| Level              | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `online`           | Agent is registered and visible.                                |
| `routable`         | Agent has a local or authenticated remote `/invoke` path.       |
| `capable`          | Required tools, memory, skills, and providers are ready.        |
| `production_ready` | Recent action proof exists and no blocker is active.            |
| `degraded`         | Agent can answer but at least one dependency is stale/fallback. |
| `blocked`          | Agent should not act until the blocker is resolved.             |

## Required Readiness Evidence

Each canonical agent should expose:

- registry id and name
- endpoint source
- required tools
- active governed skills
- memory availability
- last successful action
- last failure
- provider dependencies
- source freshness
- latency status
- current circuit state

## Canonical Agents

| Agent                 | Readiness Depends On                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Ava                   | lead identity, turn contract, active skills, call state, DeepSeek or contract fallback, Telnyx/Deepgram/ElevenLabs. |
| Max                   | offer/deal state, contract templates, seller identity, approval proof, DocuSign/email readiness.                    |
| Rex                   | brain state, memory, research tools, revenue data, agent outcomes.                                                  |
| Hermes                | transcript/context access, suggestion engine, feedback store.                                                       |
| Call Analyzer         | completed transcript, call metadata, scoring tool, memory write path.                                               |
| Prosody Tuner         | emotion signal, TTS settings, call state, prosody policy.                                                           |
| Script Rotator        | active scripts, objection type, stage, outcome history.                                                             |
| BANT Enforcer         | lead facts, call facts, qualification schema.                                                                       |
| QA Agent              | provider proof, runtime archive, safety validator, observability status.                                            |
| Nurture Agent         | lead identity, consent, DNC, quiet hours, templates, sender identities.                                             |
| Research Orchestrator | approved research tools, provider readiness, guarded command lane.                                                  |

## UI Rule

The Agent Fleet page should never imply an agent can act just because it exists.
Show the readiness level, blocker, last successful action, and required data
source. If no live agent record is loaded, show an honest empty/connection state.

## Runtime Rule

Agent actions should route through the bridge and PBK Intelligence Context. If
an agent bypasses the shared context, its result is not production-ready.

Related files:

- `scripts/agent-registry.mjs`
- `src/app/routes/AgentFleet.tsx`
- `docs/agents/pbk-intelligence-context.md`
- `docs/modern-shell-bridge-data-map.md`
