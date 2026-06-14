# PBK Intelligence Context

PBK Intelligence Context is the shared runtime packet every agent should use
before it acts. It prevents Ava, Rex, QA, Nurture, Script Rotator, and the rest
of the fleet from making decisions from different versions of the truth.

## Purpose

The context object makes agent behavior coordinated:

- One seller identity.
- One current conversation state.
- One memory and skill view.
- One freshness and provider-readiness view.
- One auditable result written back to timeline, memory, and outcomes.

If an agent action cannot load this context, it should either use a clearly
labeled degraded path or stop with a visible reason.

## Required Fields

| Field               | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `workspaceId`       | PBK workspace scope.                                                   |
| `leadId`            | Canonical seller/lead id.                                              |
| `threadId`          | Unified conversation thread id when available.                         |
| `callId`            | Live or completed call id when available.                              |
| `identity`          | Normalized phone, email, matched lead, duplicate candidates.           |
| `lead`              | Canonical lead profile and current pipeline status.                    |
| `conversation`      | Recent messages, call turns, transcript snippets, timeline facts.      |
| `memory`            | Seller facts, episodic call memory, coaching memory, RAG recall.       |
| `skills`            | Approved active skills, confidence, recent outcomes, trigger metadata. |
| `turnContract`      | Intent, objection, known facts, missing facts, next question, handoff. |
| `freshness`         | Last read/write times and stale/fallback labels.                       |
| `allowedTools`      | Tools permitted for the current agent/action/risk level.               |
| `providerReadiness` | Telnyx, Deepgram, ElevenLabs, DeepSeek, DocuSign, email, Redis, DB.    |
| `result`            | Action taken, proof, timeline event id, retry/reconcile status.        |

## Mandatory Flow

```text
event
  -> identity match
  -> context load
  -> memory recall
  -> turn contract or agent decision
  -> skill/tool selection
  -> safety/approval/provider gate
  -> result proof
  -> timeline projection
  -> memory and outcome update
  -> fleet health update
```

## Agent Usage

- Ava uses it before live speech or seller messaging.
- Rex uses it before strategy, research, and revenue recommendations.
- QA Agent uses it to validate provider proof and silent-error state.
- Script Rotator uses it to choose scripts without repeating old questions.
- BANT Enforcer uses it to decide which qualification field is missing.
- Nurture Agent uses it to schedule compliant follow-up.
- Call Analyzer writes call summaries, failure tags, and skill outcomes back.
- Prosody Tuner reads emotion and call state before changing voice settings.
- Research Orchestrator uses it for guarded research and planning context.
- Max uses it for offer recap, contract handoff, and seller follow-up.
- Hermes uses it for suggest-only diagnosis and coaching.

## Hard Rules

- Do not create a new seller when normalized phone/email matches an existing
  canonical lead.
- Do not show success until provider proof or a retry/reconcile state exists.
- Do not let stale or fallback lead/deal data drive high-stakes actions.
- Do not let an agent call a provider directly from the browser.
- Do not use memory without provenance, confidence, and expiration awareness.
- Do not bypass DNC, TCPA, offer approval, contract approval, or safety gates.

## Readiness Checks

An intelligence context is ready when:

- Identity has a canonical lead or explicitly states no match.
- Lead/deal freshness is labeled.
- Active skills and their confidence are loaded.
- Memory recall has completed or is labeled degraded.
- Provider circuits are closed or the action avoids open providers.
- The resulting action writes a timeline or runtime archive event.

Related files:

- `scripts/pbk-intelligence-context.mjs`
- `scripts/openclaw-local-server.mjs`
- `scripts/agent-registry.mjs`
- `scripts/ava-live-turn-contract.mjs`
- `docs/agents/agent-fleet-readiness.md`
