# Production Readiness

Production readiness means the bridge, agents, providers, data sources, and
silent-error controls agree that PBK can safely operate.

## Core Endpoints

| Endpoint                        | Purpose                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `GET /health`                   | Overall bridge and provider readiness.                     |
| `GET /api/production/maturity`  | Runtime archive, provider circuits, eval/canary readiness. |
| `GET /api/runtime/archive`      | Runtime incident archive status.                           |
| `POST /api/runtime/archive`     | Manual incident archive entry.                             |
| `GET /api/circuit/status`       | Provider circuit state.                                    |
| `GET /api/agents/registry`      | Canonical agent roster.                                    |
| `GET /api/agents/health`        | Agent readiness overlay.                                   |
| `GET /api/system/source-labels` | Data freshness and source truth labels.                    |

## Architecture Map

Use [production-architecture.md](./production-architecture.md) to separate
required production dependencies from optional future providers. Solid-line
dependencies must be healthy or honestly degraded before launch; dotted optional
providers are never launch blockers.

## Required Readiness

Production is ready only when:

- bridge is healthy
- Postgres state backend is available
- Redis live state is available or degraded honestly
- DeepSeek strategist is configured or contract fallback is ready
- Telnyx, Deepgram, and ElevenLabs are ready for live calls
- DocuSign and email providers are ready before contract/email actions
- runtime archive is writable or fallback buffer is visible
- provider circuits are closed or action avoids open providers
- no launch-blocking silent-error finding exists
- schema migrations are current
- source labels show authoritative or labeled fallback data

## Runtime Archive

The runtime archive records production incidents to durable activity state with a
fallback buffer. It is non-blocking: provider actions should not fail only
because incident archival failed, but the fallback buffer must be visible.

Use it for:

- provider timeouts
- provider unknown delivery
- stale data incidents
- duplicate identity incidents
- fallback activation
- circuit open/close events
- manual operator incidents

## Provider Circuits

Circuit breakers protect production from repeated provider failures. Watched
providers include:

- `deepseek`
- `telnyx`
- `deepgram`
- `elevenlabs`
- `docusign`
- `instantly`

If a circuit is open, the UI should show the reason and use a fallback, retry, or
manual path instead of pretending the action succeeded.

## Canary And Eval Readiness

Canary/eval readiness confirms that core behavior still works before promotion:

- founder tests pass
- production hardening tests pass
- governed skill router tests pass
- silent-error governance tests pass
- production gap labels pass
- failed-call evaluation gate is ready

## Release Rule

Do not push high-risk provider or live-call changes unless:

- local tests pass
- GitHub checks pass after push
- hosted `/health` is ready
- hosted `/api/production/maturity` is ready

Use [launch-checklist.md](./launch-checklist.md) for the exact command order
and expected outputs.

Related files:

- `scripts/production-maturity-loop.mjs`
- `scripts/production-maturity-loop-smoke.mjs`
- `scripts/silent-error-governance.mjs`
- `docs/operations/production-architecture.md`
- `docs/operations/runbook.md`
