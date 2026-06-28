# PBK Proof Policy Autonomy Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development`. Execute one focused implementation task, perform spec review and code-quality review, then move to the next task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining PBK Command Center gaps by turning provider actions, approvals, Ava decisions, CRM updates, call learning, UX labels, mobile QA, evals, observability, and compliance into one measurable production control system.

**Architecture:** Add three explicit control planes over the existing PBK runtime. The Provider Proof Plane records provider attempts, receipts, webhook confirmations, and reconciliation status. The Ava Decision Plane turns every requested action into a typed decision: autonomous, ask, approval-required, handoff, log-only, or blocked. The Evidence and Evaluation Plane attaches provenance to CRM fields, runs disposable Neon evals, proves mobile paths, and exposes a plain-English system health view.

**Tech Stack:** Node 22, Vite/React, OpenClaw bridge (`scripts/openclaw-local-server.mjs`), Render Postgres, Redis, Netlify, Neon disposable branches, Slack Block Kit, Telnyx webhooks, DocuSign Connect, SendGrid/Event Webhook-compatible email proof, OpenTelemetry-style metrics, existing PBK smoke scripts.

---

## Research Signals Applied

- OpenAI agent eval guidance: use traces, graders, datasets, and eval runs, with trace grading for model calls, tool calls, guardrails, and handoffs.
- Google SRE: system health must expose latency, traffic, errors, and saturation rather than only green/red service labels.
- Microsoft Foundry observability: production agents need operational metrics, sampled continuous evaluation, scheduled evals, scheduled red teaming, and alerts when outputs fail thresholds.
- MIT Sloan: human-AI collaboration works best when humans and AI are assigned the parts each handles best; do not mix them blindly.
- Nielsen Norman Group: chatbots must clearly state what they can do, tolerate ambiguity, and support both free-text and guided choices.
- Provider docs: Telnyx, SendGrid, and DocuSign all support webhook-style status proof; PBK provider proof should treat webhooks as receipts, not optional logging.
- Neon branching: keep using isolated disposable branches for potentially destructive query, migration, and agent eval tests before production.
- DeepSeek/OpenAI tool calling: provider writes must use explicit schemas and application-side execution; the model recommends calls, the bridge executes and records proof.
- Anthropic agent guidance: prefer predictable workflows for well-defined tasks; reserve agentic flexibility for high-variance decisions.

Primary sources:

- https://developers.openai.com/api/docs/guides/agent-evals
- https://developers.openai.com/api/docs/guides/function-calling
- https://sre.google/sre-book/monitoring-distributed-systems/
- https://learn.microsoft.com/en-us/azure/foundry/concepts/observability
- https://mitsloan.mit.edu/ideas-made-to-matter/when-humans-and-ai-work-best-together-and-when-each-better-alone
- https://www.nngroup.com/articles/chatbots/
- https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks
- https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/twilio-sendgrid-event-webhook-overview
- https://developers.docusign.com/platform/webhooks/connect/
- https://neon.com/docs/introduction/branching
- https://api-docs.deepseek.com/guides/tool_calls
- https://www.anthropic.com/engineering/building-effective-agents

## Non-Negotiable Invariants

- Browser UI never sends provider writes directly; all provider writes go through the OpenClaw/bridge command layer.
- Manual one-to-one agent-authored SMS/email may bypass approval queue, but cannot bypass safety, consent, sender identity, idempotency, provider receipt, or audit trail.
- Bot/autonomous provider writes require policy classification first.
- Every approval decision has one canonical approval id plus related resolution keys; approving anywhere clears pending cards everywhere.
- Every CRM field changed by Ava has source, confidence, reason, timestamp, and actor.
- Every live proof test must use PBK-owned sandbox recipients/templates and be idempotent.
- Production DB remains Render Postgres. Neon remains the disposable eval/sandbox lane.

---

### Task 1: Provider Proof Ledger

**Files:**

- Create: `scripts/provider-proof-ledger.mjs`
- Create: `scripts/provider-proof-ledger-smoke.mjs`
- Modify: `scripts/provider-action-dispatch.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing proof-ledger smoke**

Create `scripts/provider-proof-ledger-smoke.mjs`:

```js
import {
  buildProviderAttempt,
  normalizeProviderReceipt,
  summarizeProviderProof,
} from './provider-proof-ledger.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const attempt = buildProviderAttempt({
  approvalId: 'approval-sms-1',
  provider: 'telnyx',
  actionType: 'sms.send',
  actorType: 'ava',
  idempotencyKey: 'lead-1:sms:hello',
});

assert(attempt.status === 'attempted', 'attempt starts as attempted');
assert(attempt.approvalId === 'approval-sms-1', 'approval id is preserved');
assert(attempt.idempotencyKey === 'lead-1:sms:hello', 'idempotency key is preserved');

const delivered = normalizeProviderReceipt({
  provider: 'telnyx',
  eventType: 'message.delivered',
  providerMessageId: 'msg-123',
  raw: { data: { event_type: 'message.delivered' } },
});

assert(delivered.status === 'delivered', 'Telnyx delivered webhook maps to delivered');
assert(delivered.providerMessageId === 'msg-123', 'provider message id is preserved');

const summary = summarizeProviderProof({
  attempt,
  receipts: [delivered],
});

assert(summary.proofStatus === 'confirmed', 'delivered receipt confirms proof');
assert(summary.needsReconciliation === false, 'confirmed proof does not need reconciliation');

console.log('[provider-proof-ledger-smoke] ok');
```

- [ ] **Step 2: Run the smoke and verify it fails because the module does not exist**

Run:

```powershell
node .\scripts\provider-proof-ledger-smoke.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]
```

- [ ] **Step 3: Implement the proof-ledger module**

Create `scripts/provider-proof-ledger.mjs`:

```js
const DELIVERY_STATUS_BY_PROVIDER_EVENT = Object.freeze({
  telnyx: {
    'message.sent': 'sent',
    'message.delivered': 'delivered',
    'message.finalized': 'delivered',
    'message.failed': 'failed',
    'message.delivery_failed': 'failed',
    'call.initiated': 'sent',
    'call.answered': 'delivered',
    'call.hangup': 'delivered',
  },
  sendgrid: {
    processed: 'sent',
    delivered: 'delivered',
    bounce: 'failed',
    bounced: 'failed',
    dropped: 'failed',
    deferred: 'pending',
  },
  docusign: {
    envelope_sent: 'sent',
    envelope_delivered: 'delivered',
    envelope_completed: 'delivered',
    envelope_declined: 'failed',
    envelope_voided: 'failed',
  },
  slack: {
    message_posted: 'delivered',
    action_acknowledged: 'delivered',
    action_failed: 'failed',
  },
});

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value = '') {
  return String(value || '').trim();
}

export function buildProviderAttempt(input = {}) {
  return {
    approvalId: cleanString(input.approvalId),
    provider: cleanString(input.provider).toLowerCase(),
    actionType: cleanString(input.actionType),
    actorType: cleanString(input.actorType || 'system'),
    actorId: cleanString(input.actorId || 'pbk'),
    leadId: cleanString(input.leadId),
    idempotencyKey: cleanString(input.idempotencyKey),
    status: 'attempted',
    attemptedAt: input.attemptedAt || nowIso(),
    providerAttemptId: cleanString(input.providerAttemptId),
    requestHash: cleanString(input.requestHash),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}

export function normalizeProviderReceipt(input = {}) {
  const provider = cleanString(input.provider).toLowerCase();
  const eventType = cleanString(input.eventType || input.type || input.event_type).toLowerCase();
  const status = DELIVERY_STATUS_BY_PROVIDER_EVENT[provider]?.[eventType] || 'pending';
  return {
    provider,
    eventType,
    status,
    providerMessageId: cleanString(input.providerMessageId || input.messageId || input.id),
    receivedAt: input.receivedAt || nowIso(),
    raw: input.raw && typeof input.raw === 'object' ? input.raw : {},
  };
}

export function summarizeProviderProof({ attempt = {}, receipts = [] } = {}) {
  const normalizedReceipts = receipts.map(normalizeProviderReceipt);
  const failed = normalizedReceipts.find((receipt) => receipt.status === 'failed');
  const delivered = normalizedReceipts.find((receipt) => receipt.status === 'delivered');
  const sent = normalizedReceipts.find((receipt) => receipt.status === 'sent');
  if (failed) {
    return {
      proofStatus: 'failed',
      needsReconciliation: false,
      finalReceipt: failed,
      attempt,
    };
  }
  if (delivered) {
    return {
      proofStatus: 'confirmed',
      needsReconciliation: false,
      finalReceipt: delivered,
      attempt,
    };
  }
  if (sent) {
    return {
      proofStatus: 'sent_waiting_for_receipt',
      needsReconciliation: false,
      finalReceipt: sent,
      attempt,
    };
  }
  return {
    proofStatus: 'reconciliation_required',
    needsReconciliation: true,
    finalReceipt: null,
    attempt,
  };
}
```

- [ ] **Step 4: Run the smoke and verify it passes**

Run:

```powershell
node .\scripts\provider-proof-ledger-smoke.mjs
```

Expected:

```text
[provider-proof-ledger-smoke] ok
```

- [ ] **Step 5: Wire proof summaries into provider dispatch results**

Modify `scripts/provider-action-dispatch.mjs` so successful `execute(...)` results are wrapped with provider proof metadata when the provider adapter returns `provider`, `eventType`, `providerMessageId`, or `receipts`.

Add imports:

```js
import { buildProviderAttempt, summarizeProviderProof } from './provider-proof-ledger.mjs';
```

Add helper:

```js
function attachProviderProof({
  value,
  approvalId,
  workspaceId,
  toolName,
  bindingHash,
  attemptToken,
  dispatchStartedAt,
}) {
  const receipts = Array.isArray(value?.providerReceipts) ? value.providerReceipts : [];
  const attempt = buildProviderAttempt({
    approvalId,
    provider: value?.providerActionResult?.provider || value?.provider || toolName,
    actionType: toolName,
    actorType: value?.providerActionResult?.actorType || 'bridge',
    idempotencyKey: bindingHash || attemptToken,
    providerAttemptId: value?.providerActionResult?.providerAttemptId || '',
    attemptedAt: dispatchStartedAt,
    metadata: { workspaceId },
  });
  return {
    ...value,
    providerProof: summarizeProviderProof({ attempt, receipts }),
  };
}
```

Before completing a dispatch, replace:

```js
const value = await execute({ attemptToken, dispatchStartedAt });
```

with:

```js
const rawValue = await execute({ attemptToken, dispatchStartedAt });
const value = attachProviderProof({
  value: rawValue || {},
  approvalId,
  workspaceId,
  toolName,
  bindingHash,
  attemptToken,
  dispatchStartedAt,
});
```

- [ ] **Step 6: Add package script**

Modify `package.json`:

```json
"test:provider-proof-ledger": "node ./scripts/provider-proof-ledger-smoke.mjs"
```

- [ ] **Step 7: Verify**

Run:

```powershell
npm run test:provider-proof-ledger
npm run test:provider-action-dispatch
```

Expected: both pass.

---

### Task 2: Ava Action Decision Policy

**Files:**

- Create: `scripts/ava-action-decision-policy.mjs`
- Create: `scripts/ava-action-decision-policy-smoke.mjs`
- Modify: `scripts/ava-turn-orchestrator.mjs`
- Modify: `docs/agents/ava/tool-contracts.md`
- Modify: `package.json`

- [ ] **Step 1: Write the failing policy smoke**

Create `scripts/ava-action-decision-policy-smoke.mjs`:

```js
import { decideAvaAction } from './ava-action-decision-policy.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  decideAvaAction({ actionType: 'crm.update', confidence: 0.92, evidenceCount: 2 }).decision ===
    'autonomous',
  'high-confidence CRM enrichment can be autonomous'
);

assert(
  decideAvaAction({ actionType: 'sms.send', source: 'ava', confidence: 0.99 }).decision ===
    'approval_required',
  'Ava SMS sends require approval'
);

assert(
  decideAvaAction({ actionType: 'email.send', source: 'manual', safetyPassed: true }).decision ===
    'autonomous',
  'manual operator email can execute without approval after safety passes'
);

assert(
  decideAvaAction({ actionType: 'docusign.send', source: 'ava', approvalState: 'approved' })
    .decision === 'autonomous',
  'approved DocuSign can execute'
);

assert(
  decideAvaAction({ actionType: 'sms.send', stopLanguageDetected: true }).decision === 'blocked',
  'STOP/DNC language blocks outreach'
);

assert(
  decideAvaAction({ actionType: 'lead.note', confidence: 0.3, evidenceCount: 0 }).decision ===
    'ask',
  'low confidence asks before writing'
);

console.log('[ava-action-decision-policy-smoke] ok');
```

- [ ] **Step 2: Implement policy module**

Create `scripts/ava-action-decision-policy.mjs`:

```js
const PROVIDER_WRITES = new Set([
  'sms.send',
  'email.send',
  'call.start',
  'docusign.send',
  'campaign.launch',
  'offer.send',
]);

const BLOCKING_FLAGS = [
  'stopLanguageDetected',
  'dncMatched',
  'quietHours',
  'consentMissing',
  'legalAdviceRequested',
  'taxAdviceRequested',
  'threatDetected',
];

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function decideAvaAction(input = {}) {
  const actionType = String(input.actionType || '')
    .trim()
    .toLowerCase();
  const source = String(input.source || 'ava')
    .trim()
    .toLowerCase();
  const confidence = number(input.confidence, 0);
  const evidenceCount = number(input.evidenceCount, 0);
  const approvalState = String(input.approvalState || '')
    .trim()
    .toLowerCase();

  const blockingFlag = BLOCKING_FLAGS.find((flag) => input[flag] === true);
  if (blockingFlag) {
    return {
      decision: 'blocked',
      reason: blockingFlag,
      approvalRequired: false,
      providerWriteAllowed: false,
    };
  }

  if (input.humanRequested === true || input.disputeDetected === true) {
    return {
      decision: 'handoff',
      reason: input.humanRequested ? 'human_requested' : 'dispute_detected',
      approvalRequired: false,
      providerWriteAllowed: false,
    };
  }

  if (PROVIDER_WRITES.has(actionType)) {
    if (source === 'manual' && input.safetyPassed === true) {
      return {
        decision: 'autonomous',
        reason: 'operator_authored_safety_passed',
        approvalRequired: false,
        providerWriteAllowed: true,
      };
    }
    if (approvalState === 'approved') {
      return {
        decision: 'autonomous',
        reason: 'approval_already_granted',
        approvalRequired: false,
        providerWriteAllowed: true,
      };
    }
    return {
      decision: 'approval_required',
      reason: 'provider_write_requires_approval',
      approvalRequired: true,
      providerWriteAllowed: false,
    };
  }

  if (actionType === 'crm.update' && confidence >= 0.85 && evidenceCount >= 1) {
    return {
      decision: 'autonomous',
      reason: 'high_confidence_internal_crm_update',
      approvalRequired: false,
      providerWriteAllowed: false,
    };
  }

  if (actionType === 'lead.note' && confidence >= 0.65) {
    return {
      decision: 'log_only',
      reason: 'internal_note_with_sufficient_confidence',
      approvalRequired: false,
      providerWriteAllowed: false,
    };
  }

  return {
    decision: 'ask',
    reason: 'insufficient_evidence_or_unknown_action',
    approvalRequired: false,
    providerWriteAllowed: false,
  };
}
```

- [ ] **Step 3: Wire into Ava turn result**

Modify `scripts/ava-turn-orchestrator.mjs`.

Add import:

```js
import { decideAvaAction } from './ava-action-decision-policy.mjs';
```

Inside `orchestrateAvaTurn`, before `const result = { ... }`:

```js
const actionDecision = decideAvaAction({
  actionType: input.proposedActionType || input.actionType || '',
  source: input.actionSource || 'ava',
  confidence: confidence.score || confidence.confidence || 0,
  evidenceCount: Object.keys(evidence).length,
  approvalState: input.approval?.status || input.approvalState || '',
  safetyPassed: input.safetyPassed === true,
  stopLanguageDetected: input.shouldStopContact === true,
  dncMatched: input.dncMatched === true,
  quietHours: input.quietHours === true,
  consentMissing: input.consentMissing === true,
  legalAdviceRequested: input.legalAdviceRequested === true,
  taxAdviceRequested: input.taxAdviceRequested === true,
  threatDetected: input.threatDetected === true,
  humanRequested: input.humanRequested === true,
  disputeDetected: input.disputeDetected === true,
});
```

Add to `result`:

```js
actionDecision,
```

- [ ] **Step 4: Update docs**

Modify `docs/agents/ava/tool-contracts.md` with this table:

```md
## Ava Action Decision Contract

| Decision            | Meaning                                                                               | Provider write allowed?               |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| `autonomous`        | Ava/bridge may execute because policy, safety, evidence, and approval state allow it. | Only when `providerWriteAllowed=true` |
| `approval_required` | A provider write or business-risk action needs operator approval first.               | No                                    |
| `ask`               | Ava needs one clear question before acting.                                           | No                                    |
| `handoff`           | Human operator should take over.                                                      | No                                    |
| `log_only`          | Ava may save an internal note or low-risk timeline event.                             | No external provider write            |
| `blocked`           | Compliance/safety rule prevents the action.                                           | No                                    |
```

- [ ] **Step 5: Add package script and verify**

Add:

```json
"test:ava-action-decision-policy": "node ./scripts/ava-action-decision-policy-smoke.mjs"
```

Run:

```powershell
npm run test:ava-action-decision-policy
npm run test:ava-turn-orchestrator
npm run test:ava-eval-suite
```

Expected: all pass.

---

### Task 3: CRM Field Provenance

**Files:**

- Create: `scripts/lead-field-provenance.mjs`
- Create: `scripts/lead-field-provenance-smoke.mjs`
- Create: `supabase/migrations/20260627090000_pbk_lead_field_provenance.sql`
- Modify: `scripts/analyzer-lead-sync-smoke.mjs`
- Modify: `scripts/ava-call-lead-projection-smoke.mjs`
- Modify: `src/app/components/leads/LeadPortalOverview.tsx`
- Modify: `package.json`

- [ ] **Step 1: Create provenance migration**

Create `supabase/migrations/20260627090000_pbk_lead_field_provenance.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.lead_field_provenance (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value JSONB NOT NULL,
  source_channel TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  source_excerpt TEXT NOT NULL DEFAULT '',
  confidence NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL DEFAULT 'ava',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_field_provenance_lead_field_idx
  ON public.lead_field_provenance (workspace_id, lead_id, field_name, created_at DESC);

ALTER TABLE public.lead_field_provenance ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.lead_field_provenance FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.lead_field_provenance FROM authenticated;
  END IF;
END $$;
```

- [ ] **Step 2: Add provenance helper**

Create `scripts/lead-field-provenance.mjs`:

```js
export function buildLeadFieldProvenance(input = {}) {
  return {
    workspaceId: String(input.workspaceId || 'pbk'),
    leadId: String(input.leadId || ''),
    fieldName: String(input.fieldName || ''),
    fieldValue: input.fieldValue ?? null,
    sourceChannel: String(input.sourceChannel || 'unknown'),
    sourceId: String(input.sourceId || ''),
    sourceExcerpt: String(input.sourceExcerpt || '').slice(0, 500),
    confidence: Math.max(0, Math.min(1, Number(input.confidence || 0))),
    reason: String(input.reason || '').slice(0, 500),
    actorType: String(input.actorType || 'ava'),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function canProjectLeadField(input = {}) {
  const provenance = buildLeadFieldProvenance(input);
  if (!provenance.leadId || !provenance.fieldName) return false;
  if (provenance.confidence < 0.7) return false;
  return ['call', 'sms', 'email', 'analyzer', 'manual'].includes(provenance.sourceChannel);
}
```

- [ ] **Step 3: Add smoke**

Create `scripts/lead-field-provenance-smoke.mjs`:

```js
import { buildLeadFieldProvenance, canProjectLeadField } from './lead-field-provenance.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const provenance = buildLeadFieldProvenance({
  leadId: 'lead-1',
  fieldName: 'timeline',
  fieldValue: 'ready this month',
  sourceChannel: 'call',
  sourceId: 'call-1',
  sourceExcerpt: 'I can close this month',
  confidence: 0.91,
  reason: 'seller stated timeline directly',
});

assert(provenance.confidence === 0.91, 'confidence is preserved');
assert(canProjectLeadField(provenance) === true, 'high confidence call field can project');
assert(
  canProjectLeadField({ ...provenance, confidence: 0.4 }) === false,
  'low confidence is blocked'
);

console.log('[lead-field-provenance-smoke] ok');
```

- [ ] **Step 4: Surface provenance in lead UI**

Modify `src/app/components/leads/LeadPortalOverview.tsx` so each Ava-updated field can show:

```tsx
<span className="lead-field-proof">
  Source: {field.provenance.sourceChannel} · Confidence:{' '}
  {Math.round(field.provenance.confidence * 100)}%
</span>
```

Use existing component patterns for typography and avoid exposing long excerpts by default.

- [ ] **Step 5: Verify**

Add:

```json
"test:lead-field-provenance": "node ./scripts/lead-field-provenance-smoke.mjs"
```

Run:

```powershell
npm run test:lead-field-provenance
npm run test:analyzer-lead-sync
npm run test:ava-call-lead-projection
```

Expected: all pass.

---

### Task 4: Live Provider Proof Harness

**Files:**

- Create: `scripts/provider-live-proof-harness.mjs`
- Create: `scripts/provider-live-proof-harness-smoke.mjs`
- Modify: `docs/operations/provider-live-proof.md`
- Modify: `package.json`

- [ ] **Step 1: Implement mockable harness shape**

Create `scripts/provider-live-proof-harness.mjs`:

```js
const SAFE_MODE_REQUIRED_ENV = Object.freeze({
  sms: ['PBK_LIVE_PROOF_SMS_TO', 'PBK_TELNYX_FROM_NUMBER'],
  email: ['PBK_LIVE_PROOF_EMAIL_TO', 'PBK_INSTANTLY_DEFAULT_FROM_EMAIL'],
  docusign: ['PBK_LIVE_PROOF_EMAIL_TO', 'PBK_DOCUSIGN_ACCOUNT_ID'],
  slack: ['PBK_SLACK_APPROVAL_CHANNEL_ID'],
});

export function getProviderProofRequirements(provider) {
  return SAFE_MODE_REQUIRED_ENV[String(provider || '').toLowerCase()] || [];
}

export function assertLiveProofSafe({ provider, env = process.env } = {}) {
  const missing = getProviderProofRequirements(provider).filter((key) => !env[key]);
  if (missing.length) {
    return {
      ok: false,
      provider,
      reason: 'missing_safe_live_proof_env',
      missing,
    };
  }
  return {
    ok: true,
    provider,
    reason: 'safe_live_proof_env_present',
  };
}

export async function runProviderLiveProof({ provider, dryRun = true, env = process.env } = {}) {
  const safety = assertLiveProofSafe({ provider, env });
  if (!safety.ok) return safety;
  if (dryRun) {
    return {
      ok: true,
      provider,
      dryRun: true,
      proofStatus: 'dry_run_ready',
    };
  }
  return {
    ok: false,
    provider,
    dryRun: false,
    proofStatus: 'not_implemented_until_provider_adapter_is_selected',
  };
}
```

- [ ] **Step 2: Add smoke**

Create `scripts/provider-live-proof-harness-smoke.mjs`:

```js
import {
  assertLiveProofSafe,
  getProviderProofRequirements,
  runProviderLiveProof,
} from './provider-live-proof-harness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  getProviderProofRequirements('sms').includes('PBK_LIVE_PROOF_SMS_TO'),
  'SMS requires sandbox recipient'
);

const blocked = assertLiveProofSafe({ provider: 'sms', env: {} });
assert(blocked.ok === false, 'missing safe env blocks SMS proof');
assert(blocked.missing.includes('PBK_TELNYX_FROM_NUMBER'), 'from number is required');

const ready = await runProviderLiveProof({
  provider: 'sms',
  dryRun: true,
  env: {
    PBK_LIVE_PROOF_SMS_TO: '+15555550100',
    PBK_TELNYX_FROM_NUMBER: '+15555550101',
  },
});

assert(ready.ok === true, 'safe dry run succeeds');
assert(ready.proofStatus === 'dry_run_ready', 'dry run proof status is explicit');

console.log('[provider-live-proof-harness-smoke] ok');
```

- [ ] **Step 3: Document live-proof runbook**

Create `docs/operations/provider-live-proof.md`:

```md
# Provider Live Proof Runbook

Live proof is only allowed against PBK-owned sandbox recipients and demo templates.

Required proof:

| Provider   | Required receipt                                                |
| ---------- | --------------------------------------------------------------- |
| SMS/Telnyx | outbound attempt id plus delivery/error webhook                 |
| Email      | provider accepted id plus delivered/bounced/deferred webhook    |
| DocuSign   | envelope id plus Connect sent/completed/declined/voided webhook |
| Slack      | message timestamp plus action callback ack                      |
| Call       | call control id plus answered/hangup/transcription event        |

Never use a seller recipient for proof runs.
```

- [ ] **Step 4: Add package script and verify**

Add:

```json
"test:provider-live-proof-harness": "node ./scripts/provider-live-proof-harness-smoke.mjs"
```

Run:

```powershell
npm run test:provider-live-proof-harness
```

Expected: pass.

---

### Task 5: Cross-Channel Approval Live Proof

**Files:**

- Create: `scripts/approval-live-unison-proof.mjs`
- Create: `scripts/approval-live-unison-proof-smoke.mjs`
- Modify: `scripts/approval-unison-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add live-proof model**

Create `scripts/approval-live-unison-proof.mjs`:

```js
export function buildApprovalResolutionProof(input = {}) {
  const approvalId = String(input.approvalId || '');
  const surfaces = Array.isArray(input.surfaces) ? input.surfaces : [];
  const cleared = surfaces.filter((surface) => surface.cleared === true);
  return {
    approvalId,
    surfaceCount: surfaces.length,
    clearedCount: cleared.length,
    allCleared: surfaces.length > 0 && cleared.length === surfaces.length,
    uncleared: surfaces
      .filter((surface) => surface.cleared !== true)
      .map((surface) => surface.name),
  };
}
```

- [ ] **Step 2: Add smoke**

Create `scripts/approval-live-unison-proof-smoke.mjs`:

```js
import { buildApprovalResolutionProof } from './approval-live-unison-proof.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const proof = buildApprovalResolutionProof({
  approvalId: 'approval-1',
  surfaces: [
    { name: 'slack', cleared: true },
    { name: 'command-center', cleared: true },
    { name: 'inbox', cleared: true },
    { name: 'ava-chat', cleared: true },
  ],
});

assert(proof.allCleared === true, 'all surfaces cleared');
assert(proof.clearedCount === 4, 'four surfaces reported cleared');

const failed = buildApprovalResolutionProof({
  approvalId: 'approval-1',
  surfaces: [
    { name: 'slack', cleared: true },
    { name: 'inbox', cleared: false },
  ],
});

assert(failed.allCleared === false, 'missing clearance fails proof');
assert(failed.uncleared.includes('inbox'), 'uncleared surface is named');

console.log('[approval-live-unison-proof-smoke] ok');
```

- [ ] **Step 3: Add package script and verify**

Add:

```json
"test:approval-live-unison-proof": "node ./scripts/approval-live-unison-proof-smoke.mjs"
```

Run:

```powershell
npm run test:approval-live-unison-proof
npm run test:approval-unison
```

Expected: both pass.

---

### Task 6: Production Call Learning Backfill

**Files:**

- Create: `scripts/ava-call-learning-backfill.mjs`
- Create: `scripts/ava-call-learning-backfill-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement dry-run/apply guard**

Create `scripts/ava-call-learning-backfill.mjs`:

```js
export function planCallLearningBackfill({ transcripts = [], minCharacters = 40 } = {}) {
  const eligible = transcripts.filter((row) => {
    const text = String(row.transcript || row.body || '');
    return text.length >= minCharacters && (row.callId || row.call_id);
  });
  return {
    total: transcripts.length,
    eligible: eligible.length,
    skipped: transcripts.length - eligible.length,
    callIds: eligible.map((row) => row.callId || row.call_id),
  };
}
```

- [ ] **Step 2: Add smoke**

Create `scripts/ava-call-learning-backfill-smoke.mjs`:

```js
import { planCallLearningBackfill } from './ava-call-learning-backfill.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const plan = planCallLearningBackfill({
  transcripts: [
    {
      callId: 'call-1',
      transcript: 'Seller said they want to sell this month and asked for a call back tomorrow.',
    },
    { callId: 'call-2', transcript: 'Hi' },
  ],
});

assert(plan.total === 2, 'total count preserved');
assert(plan.eligible === 1, 'only useful transcript is eligible');
assert(plan.callIds[0] === 'call-1', 'eligible call id is returned');

console.log('[ava-call-learning-backfill-smoke] ok');
```

- [ ] **Step 3: Add package script and verify**

Add:

```json
"test:ava-call-learning-backfill": "node ./scripts/ava-call-learning-backfill-smoke.mjs"
```

Run:

```powershell
npm run test:ava-call-learning-backfill
npm run test:call-outcome-learning-loop
```

Expected: both pass.

---

### Task 7: Plain-English Operator UX Copy

**Files:**

- Create: `src/app/utils/operatorCopy.ts`
- Create: `scripts/operator-copy-smoke.mjs`
- Modify: `src/app/routes/CommandCenter.tsx`
- Modify: `src/app/routes/Inbox.tsx`
- Modify: `src/app/routes/AvaChat.tsx`
- Modify: `package.json`

- [ ] **Step 1: Add copy map**

Create `src/app/utils/operatorCopy.ts`:

```ts
export const operatorStatusCopy: Record<string, string> = {
  bridge_healthy: 'Connected',
  render_postgres_ready: 'Saved and ready',
  retry_gated: 'Waiting to retry',
  primary_path_gated: 'Needs setup',
  provider_policy: 'Sending rules',
  blocking: 'Needs attention',
  approval_required: 'Needs your review',
  dispatching: 'Working on it',
  reconciliation_required: 'Needs confirmation',
  delivered: 'Delivered',
  failed: 'Could not complete',
};

export function toOperatorCopy(value: string): string {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return operatorStatusCopy[key] || value;
}
```

- [ ] **Step 2: Add source smoke**

Create `scripts/operator-copy-smoke.mjs`:

```js
import { readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const copy = readFileSync('src/app/utils/operatorCopy.ts', 'utf8');
assert(copy.includes('Needs your review'), 'approval copy is agent-friendly');
assert(copy.includes('Connected'), 'bridge copy is plain English');
assert(!copy.includes('retry-gated'), 'hyphenated engineering label is not user copy');

console.log('[operator-copy-smoke] ok');
```

- [ ] **Step 3: Use copy map in UI**

Modify the three route files so technical status labels call:

```ts
import { toOperatorCopy } from '../utils/operatorCopy';
```

Then render:

```tsx
{
  toOperatorCopy(status);
}
```

instead of raw bridge/provider labels in agent-facing sections.

- [ ] **Step 4: Add package script and verify**

Add:

```json
"test:operator-copy": "node ./scripts/operator-copy-smoke.mjs"
```

Run:

```powershell
npm run test:operator-copy
npm run test:command-center-prototype-visual
npm run test:unified-inbox-ui
npm run test:ava-chat-local-command
```

Expected: all pass.

---

### Task 8: Mobile Browser Proof

**Files:**

- Create: `scripts/mobile-browser-proof.mjs`
- Modify: `package.json`

- [ ] **Step 1: Implement Playwright-backed route proof**

Create `scripts/mobile-browser-proof.mjs`:

```js
import { chromium, devices } from '@playwright/test';

const routes = ['/ava-chat', '/leads', '/inbox', '/deal', '/campaigns', '/skill-studio'];

const baseUrl = process.env.PBK_MOBILE_PROOF_BASE_URL || 'http://127.0.0.1:4174';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(devices['iPhone 14']);
const page = await context.newPage();

const failures = [];
for (const route of routes) {
  const url = `${baseUrl}${route}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((error) => {
    failures.push(`${route}: navigation failed ${error.message}`);
  });
  const bodyText = await page
    .locator('body')
    .innerText()
    .catch(() => '');
  if (!bodyText.trim()) failures.push(`${route}: empty body`);
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2
  );
  if (horizontalOverflow) failures.push(`${route}: horizontal overflow`);
}

await browser.close();

if (failures.length) {
  throw new Error(`mobile proof failed:\n${failures.join('\n')}`);
}

console.log('[mobile-browser-proof] ok');
```

- [ ] **Step 2: Add package script and verify**

Add:

```json
"test:mobile-browser-proof": "node ./scripts/mobile-browser-proof.mjs"
```

Run with a preview server:

```powershell
npm run build
npm exec vite -- --host 127.0.0.1 --port 4174
npm run test:mobile-browser-proof
```

Expected: mobile proof passes for each route.

---

### Task 9: Neon Eval CI Gate

**Files:**

- Create: `.github/workflows/pbk-agent-evals.yml`
- Modify: `RELEASE_CHECKLIST.md`

- [ ] **Step 1: Add CI workflow**

Create `.github/workflows/pbk-agent-evals.yml`:

```yaml
name: PBK Agent Evals

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  ava-evals:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run test:neon-evaluation-harness
      - run: npm run neon:evaluation -- --ttl-hours 1 -- npm run test:ava-eval-suite
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          PBK_NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
          PBK_NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
```

- [ ] **Step 2: Update release checklist**

Add:

```md
- [ ] PBK Agent Evals workflow passed with a disposable Neon branch.
- [ ] No `pbk-eval-*` branches remain after CI completion.
```

- [ ] **Step 3: Verify locally**

Run:

```powershell
npm run test:neon-evaluation-harness
npm run neon:evaluation -- --ttl-hours 1 -- npm run test:ava-eval-suite
```

Expected: branch created, eval suite passes, branch deleted.

---

### Task 10: Plain-English System Health Panel

**Files:**

- Modify: `scripts/system-source-health.mjs`
- Create: `scripts/system-health-operator-view-smoke.mjs`
- Modify: `src/app/routes/CommandCenter.tsx`
- Modify: `package.json`

- [ ] **Step 1: Add operator health summary builder**

Modify `scripts/system-source-health.mjs` to export:

```js
export function buildOperatorHealthSummary(input = {}) {
  const services = input.services || {};
  const checks = [
    ['Render bridge', services.renderBridge],
    ['OpenClaw bridge', services.openclaw],
    ['Postgres', services.postgres],
    ['Redis', services.redis],
    ['Netlify', services.netlify],
    ['Slack', services.slack],
    ['DocuSign', services.docusign],
    ['SMS', services.sms],
    ['Email', services.email],
    ['Ava learning', services.avaLearning],
  ].map(([name, status]) => ({
    name,
    status: status === 'ok' ? 'Ready' : status === 'warn' ? 'Needs attention' : 'Offline',
  }));
  return {
    readyCount: checks.filter((check) => check.status === 'Ready').length,
    totalCount: checks.length,
    checks,
  };
}
```

- [ ] **Step 2: Add smoke**

Create `scripts/system-health-operator-view-smoke.mjs`:

```js
import { buildOperatorHealthSummary } from './system-source-health.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const summary = buildOperatorHealthSummary({
  services: {
    renderBridge: 'ok',
    openclaw: 'ok',
    postgres: 'ok',
    redis: 'warn',
    netlify: 'ok',
    slack: 'ok',
    docusign: 'warn',
    sms: 'ok',
    email: 'ok',
    avaLearning: 'ok',
  },
});

assert(summary.totalCount === 10, 'all operator health services are represented');
assert(
  summary.checks.some((check) => check.name === 'DocuSign' && check.status === 'Needs attention'),
  'warning copy is plain English'
);

console.log('[system-health-operator-view-smoke] ok');
```

- [ ] **Step 3: Add UI panel**

Modify `src/app/routes/CommandCenter.tsx` to show an unframed full-width section named `System Health` with service rows from the summary. Avoid labels like `bridge_healthy`; show `Connected`, `Ready`, `Needs attention`, or `Offline`.

- [ ] **Step 4: Verify**

Add:

```json
"test:system-health-operator-view": "node ./scripts/system-health-operator-view-smoke.mjs"
```

Run:

```powershell
npm run test:system-health-operator-view
npm run test:observability
npm run test:command-center-prototype-visual
```

Expected: all pass.

---

### Task 11: Compliance Audit Trail

**Files:**

- Create: `scripts/compliance-audit-trail.mjs`
- Create: `scripts/compliance-audit-trail-smoke.mjs`
- Create: `supabase/migrations/20260627093000_pbk_compliance_audit_trail.sql`
- Modify: `package.json`

- [ ] **Step 1: Add audit migration**

Create `supabase/migrations/20260627093000_pbk_compliance_audit_trail.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.compliance_audit_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  approval_id TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  required_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  provider_result TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_audit_events_workspace_created_idx
  ON public.compliance_audit_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS compliance_audit_events_lead_idx
  ON public.compliance_audit_events (workspace_id, lead_id, created_at DESC);

ALTER TABLE public.compliance_audit_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.compliance_audit_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.compliance_audit_events FROM authenticated;
  END IF;
END $$;
```

- [ ] **Step 2: Add audit helper**

Create `scripts/compliance-audit-trail.mjs`:

```js
export function buildComplianceAuditEvent(input = {}) {
  return {
    workspaceId: String(input.workspaceId || 'pbk'),
    actorType: String(input.actorType || 'system'),
    actorId: String(input.actorId || ''),
    leadId: String(input.leadId || ''),
    approvalId: String(input.approvalId || ''),
    actionType: String(input.actionType || ''),
    decision: String(input.decision || ''),
    requiredApproval: input.requiredApproval === true,
    approvalStatus: String(input.approvalStatus || ''),
    provider: String(input.provider || ''),
    providerResult: String(input.providerResult || ''),
    evidence: input.evidence && typeof input.evidence === 'object' ? input.evidence : {},
    createdAt: input.createdAt || new Date().toISOString(),
  };
}
```

- [ ] **Step 3: Add smoke**

Create `scripts/compliance-audit-trail-smoke.mjs`:

```js
import { buildComplianceAuditEvent } from './compliance-audit-trail.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const event = buildComplianceAuditEvent({
  actorType: 'ava',
  leadId: 'lead-1',
  approvalId: 'approval-1',
  actionType: 'docusign.send',
  decision: 'approval_required',
  requiredApproval: true,
  approvalStatus: 'pending',
  provider: 'docusign',
  providerResult: 'not_attempted',
  evidence: { reason: 'contract send requires approval' },
});

assert(event.requiredApproval === true, 'approval requirement is explicit');
assert(event.providerResult === 'not_attempted', 'provider result is explicit');
assert(event.evidence.reason.includes('approval'), 'evidence is preserved');

console.log('[compliance-audit-trail-smoke] ok');
```

- [ ] **Step 4: Add package script and verify**

Add:

```json
"test:compliance-audit-trail": "node ./scripts/compliance-audit-trail-smoke.mjs"
```

Run:

```powershell
npm run test:compliance-audit-trail
npm run test:safety-validator
```

Expected: both pass.

---

### Task 12: Release Gate

**Files:**

- Modify: `package.json`
- Modify: `RELEASE_CHECKLIST.md`

- [ ] **Step 1: Add a single gap-closure test script**

Add:

```json
"test:proof-policy-autonomy": "npm run test:provider-proof-ledger && npm run test:provider-action-dispatch && npm run test:ava-action-decision-policy && npm run test:lead-field-provenance && npm run test:provider-live-proof-harness && npm run test:approval-live-unison-proof && npm run test:approval-unison && npm run test:ava-call-learning-backfill && npm run test:operator-copy && npm run test:system-health-operator-view && npm run test:compliance-audit-trail && npm run test:mobile-browser-proof:preview && npm run test:production-hardening"
```

- [ ] **Step 2: Add final release checklist items**

Add:

```md
## Proof, Policy, and Autonomy Release Gate

- [ ] Provider proof ledger smoke passed.
- [ ] Live provider proof harness dry-run passed.
- [ ] Approval unison source and live proof passed.
- [ ] Ava action decision policy passed.
- [ ] CRM field provenance smoke passed.
- [ ] Call learning backfill dry-run passed.
- [ ] Operator copy smoke passed.
- [ ] Mobile browser proof passed.
- [ ] Neon disposable eval passed and branch was deleted.
- [ ] System Health operator panel smoke passed.
- [ ] Compliance audit trail smoke passed.
- [ ] `npm run test:proof-policy-autonomy` passed.
```

- [ ] **Step 3: Run the full gate**

Run:

```powershell
npm run test:proof-policy-autonomy
npm run build
git status --short --branch
```

Expected:

```text
all tests pass
vite build exits 0
working tree contains only intended files
```

## Execution Order

1. Provider Proof Ledger
2. Ava Action Decision Policy
3. CRM Field Provenance
4. Compliance Audit Trail
5. Approval Live Proof
6. Provider Live Proof Harness
7. Call Learning Backfill
8. Operator UX Copy
9. System Health Panel
10. Mobile Browser Proof
11. Neon CI Gate
12. Release Gate

This order builds the evidence layer first, then decision policy, then UI clarity, then release automation. It avoids increasing autonomy before proof and audit are in place.
