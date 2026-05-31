# PBK Command Center Safety & Guardrails

PBK is an AI-assisted real estate acquisition command center. It is designed to help operators qualify leads, analyze deals, coordinate follow-up, and prepare approved next steps. The system is not designed to bypass human judgment for high-risk business actions.

## Autonomy Boundaries

- Ava and Rex can analyze, recommend, summarize, and prepare actions.
- Provider writes such as calls, SMS, email, contracts, CRM updates, external campaigns, generated tools, and desktop automation are approval-gated unless explicitly placed in a trusted operating mode.
- Generated tools are stored for review and execution is disabled by default unless the production operator enables it with an explicit environment flag.
- L4-style mission planning is advisory inside PBK. Execution still routes through PBK tools, safety validation, QA, and approvals.

## Tool Risk Classes

- Readonly: analysis, recommendations, memory lookup, diagnostics, metrics, and research-additive planning.
- Medium: external-agent routing, generated tool creation, CRM-like updates, and desktop automation planning.
- High: calls, SMS, email, contracts, generated-tool activation/execution, CLI commands, MCP tool calls, nurture sequence execution, and provider writes.

## Seller & Compliance Safeguards

- DNC, TCPA consent, calling hours, and maximum allowable offer checks are enforced before outreach or offer execution.
- Stop requests should halt outreach and be recorded as compliance events.
- Emotionally sensitive situations such as grief, legal escalation, or seller distress are routed through the stopping-agent advisory layer and can trigger pause or human handoff.
- Ava should truthfully identify herself as PBK's AI acquisition assistant when asked.

## QA & Reliability

- Tool calls run through QA validation where applicable.
- Failed or ambiguous provider results are retried or escalated instead of silently treated as success.
- Event bus failures are dead-lettered for replay.
- AgentOps and observability metrics record tool calls, success, latency, and safety outcomes.

## Desktop Automation

- Desktop Sidecar is the supported automation path.
- ClickUI is optional and is not wired by default.
- Any click/type action must be explicitly approved and must pass through PBK's sidecar command validation.

## Research Additives

PBK includes safe, PBK-native adapters for frontier research patterns:

- ACP/AIP-style agent interoperability.
- EnCompass-style execution path search.
- ToolUniverse-style tool discovery.
- AWM-style workflow induction.
- Stopping-agent strategic guardrails.
- MEM1-style compact seller memory.
- NeuroSkill-style text/voice state inference, with biometrics opt-in only.
- AutoGraph-style deterministic GUI planning.
- MasterAgent-style mission planning.

External models, hardware, or third-party research runtimes remain gated by explicit configuration and do not execute provider writes directly.

## Evaluation

Core safety and readiness checks include:

- `npm run test:safety-validator`
- `npm run test:qa-agent`
- `npm run test:event-bus`
- `npm run test:agent-registry`
- `npm run test:observability`
- `npm run test:research-additives`
- `npm run test:hosted`

PBK should not be represented as fully autonomous for regulated or high-risk actions unless the operator has verified the specific workflow, approval settings, provider credentials, and compliance requirements in production.
