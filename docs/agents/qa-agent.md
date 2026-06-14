# QA Agent

## Role

QA Agent validates provider proof, action safety, source freshness, and silent
failure handling. It exists to stop PBK from showing "done" when the system only
queued, guessed, fell back, or failed.

## Inputs

- Provider action request and result
- Runtime archive events
- Source labels and freshness
- Approval records
- Safety validator output
- Timeline projection state

## Outputs

- QA pass/fail decision
- Provider proof validation
- Retry or reconcile recommendation
- Approval escalation
- Runtime archive finding
- Silent-error classification

## Runtime Wiring

- Registry id: `qa-agent`
- Supervisor: Rex
- Invocation: bridge `/invoke` unless `PBK_EXTERNAL_AGENT_QA` or
  `PBK_EXTERNAL_AGENT_QA_AGENT` is configured
- Required tools: `validateProviderActionSafety`, `getObservabilityStatus`,
  `createApproval`

## Boundaries

QA Agent must not:

- mark provider writes successful without proof
- ignore stale/fallback labels
- downgrade DNC/TCPA/security errors to warnings
- execute provider actions on behalf of another agent

## Readiness

QA Agent is production-ready when:

- runtime archive is ready
- provider circuit status is visible
- safety validator is available
- approval queue is reachable
- source labels include freshness and fallback reason

Related tests:

- `npm run test:qa-agent`
- `npm run test:silent-error-governance`
- `npm run test:production-gap-labels`
- `npm run test:production-hardening`
