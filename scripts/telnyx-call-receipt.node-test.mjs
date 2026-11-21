import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { projectCallEvent } from './conversation-projector.mjs';
import { findTelnyxCallEventCompletion, reconcileTelnyxCallProof } from './provider-proof-ledger.mjs';

const callId = 'v3:fixture-control';
const completion = {
  callId, eventId: 'carrier-event-a', occurredAt: '2026-11-21T18:27:20Z',
  hangupCause: 'normal_clearing',
};
const approval = {
  id: 'approval-a',
  status: 'approved',
  metadata: {
    requestedTool: 'pbk_call_operator',
    providerActionResult: { callId, telnyxLive: true },
    providerProof: {
      provider: 'telnyx',
      attempt: { provider: 'telnyx', providerAttemptId: 'attempt-a', status: 'sent' },
      receipts: [],
    },
  },
};

test('historical reconciliation requires a matching carrier hangup on the exact outbound leg', () => {
  const call = {
    telnyxCallControlId: callId, telnyxCallLegId: 'leg-a', telnyxCallSessionId: 'session-a',
    from: '+12025550101', to: '+12025550102', direction: 'outbound', status: 'ended',
  };
  const payload = {
    event_type: 'call.hangup', webhook_id: completion.eventId, created_at: completion.occurredAt,
    payload: {
      call_control_id: callId, call_leg_id: 'leg-a', call_session_id: 'session-a',
      from: call.from, to: call.to, hangup_cause: completion.hangupCause,
    },
  };
  const event = {
    name: 'call.hangup', type: 'webhook', leg_id: 'leg-a', application_session_id: 'session-a',
    payload: JSON.stringify(payload),
  };
  assert.deepEqual(findTelnyxCallEventCompletion(call, [event]), { ...completion, source: 'telnyx_call_events' });
  assert.equal(findTelnyxCallEventCompletion(call, [{ ...event, leg_id: 'different' }]), null);
  assert.equal(findTelnyxCallEventCompletion(call, [{ ...event, payload: { ...payload, payload: { ...payload.payload, to: call.from } } }]), null);
  assert.equal(findTelnyxCallEventCompletion(call, [event, event]), null);
  assert.equal(findTelnyxCallEventCompletion({ ...call, direction: 'inbound' }, [event]), null);
});

test('an exact carrier hangup binds one receipt to the existing attempt', () => {
  const proof = reconcileTelnyxCallProof(approval, completion);
  assert.equal(proof.proofStatus, 'confirmed');
  assert.equal(proof.receipts.length, 1);
  assert.equal(proof.receipts[0].providerAttemptId, 'attempt-a');
  assert.equal(proof.receipts[0].providerMessageId, callId);
  assert.equal(proof.receipts[0].raw.hangupCause, 'normal_clearing');
  const next = { ...approval, metadata: { ...approval.metadata, providerProof: proof } };
  assert.deepEqual(reconcileTelnyxCallProof(next, { ...completion, eventId: 'duplicate' }), proof);
});

test('a receipt cannot bind to a different ID, tool, missing proof, or pending approval', () => {
  assert.equal(reconcileTelnyxCallProof(approval, { ...completion, callId: 'different' }), null);
  assert.equal(reconcileTelnyxCallProof({ ...approval, status: 'pending' }, completion), null);
  assert.equal(reconcileTelnyxCallProof({ ...approval, metadata: { ...approval.metadata, requestedTool: 'telnyx_sms' } }, completion), null);
  assert.equal(reconcileTelnyxCallProof({ ...approval, metadata: { ...approval.metadata, providerProof: null } }, completion), null);
});

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

function fixture({ approvals = [structuredClone(approval)], failFirstProjection = false, carrierEvents = [] } = {}) {
  const phone = '+12025550101';
  const calls = [
    { id: 'other-call', telnyxCallControlId: 'other-call', phone, status: 'queued', direction: 'outbound' },
    { id: callId, telnyxCallControlId: callId, phone, status: 'queued', direction: 'outbound' },
  ];
  const projections = [];
  const persisted = [];
  const carrierRequests = [];
  const state = { calls, approvals };
  const ctx = vm.createContext({
    state, reconcileTelnyxCallProof, findTelnyxCallEventCompletion,
    getCallById: (id) => calls.find((item) => item.id === id),
    fireTelnyxRequest: async (method, path, body, options) => {
      carrierRequests.push({ method, path, body, options });
      assert.equal(method, 'GET');
      assert.equal(path, '/call_events');
      return { ok: true, body: { data: carrierEvents } };
    },
    normalizePhone: (value) => value || '',
    isoNow: () => completion.occurredAt,
    createCallRecord: ({ verifiedTelnyxCompletion: _ignored, ...value }) => value,
    upsertCall: (_, call) => Object.assign(calls.find((item) => item.id === call.id), call),
    addActivity: () => {}, makeActivity: () => ({}), persistState: async () => {},
    persistApprovalRecordToPg: async (value) => { persisted.push(structuredClone(value)); return { ok: true }; },
    projectCallEvent,
    projectLiveConversationRecord: async (projection) => {
      projections.push(projection);
      return failFirstProjection && projections.length === 1
        ? { ok: false, result: 'conversation_projection_failed' }
        : { ok: true };
    },
  });
  for (const entry of ast.statements.filter(ts.isFunctionDeclaration)) {
    if (['handleEvent', 'handleRuntimeEvent', 'handleVerifiedTelnyxEvent', 'reconcileStoredTelnyxCall', 'reconcileTelnyxCallCompletion'].includes(entry.name?.text)) {
      vm.runInContext(entry.getText(ast), ctx);
    }
  }
  const mapped = { eventType: 'call-status', payload: { id: callId, phone, status: 'ended', call_control_id: callId } };
  const webhook = {
    signature: { ok: true, skipped: false },
    payload: { data: { id: completion.eventId, event_type: 'call.hangup', occurred_at: completion.occurredAt, payload: { call_control_id: callId } } },
  };
  return { ctx, state, projections, persisted, mapped, webhook, carrierRequests };
}

test('historical repair reads one carrier event and updates the approval and inbox on replay', async () => {
  const from = '+12025550101';
  const to = '+12025550102';
  const carrierEvents = [{
    type: 'webhook', name: 'call.hangup', leg_id: 'leg-a', application_session_id: 'session-a',
    payload: {
      event_type: 'call.hangup', webhook_id: completion.eventId, created_at: completion.occurredAt,
      payload: { call_control_id: callId, call_leg_id: 'leg-a', call_session_id: 'session-a', from, to },
    },
  }];
  const { ctx, state, projections, persisted, carrierRequests } = fixture({ carrierEvents });
  Object.assign(state.calls[1], {
    provider: 'Telnyx', status: 'ended', telnyxCallLegId: 'leg-a', telnyxCallSessionId: 'session-a', from, to,
  });
  assert.equal((await ctx.reconcileStoredTelnyxCall(callId)).ok, true);
  assert.equal((await ctx.reconcileStoredTelnyxCall(callId)).ok, true);
  assert.equal(carrierRequests.length, 1);
  assert.equal(carrierRequests[0].options.query['filter[leg_id]'], 'leg-a');
  assert.equal(projections.length, 1);
  assert.equal(persisted.at(-1).metadata.providerProof.receipts.length, 1);
  assert.equal(persisted.at(-1).metadata.providerProof.receipts[0].raw.source, 'telnyx_call_events');
});

test('verified hangup preserves the receipt on an inbox conflict and retries projection without dispatch', async () => {
  const { ctx, state, projections, persisted, mapped, webhook } = fixture({ failFirstProjection: true });
  const first = await ctx.handleVerifiedTelnyxEvent(mapped, webhook);
  assert.equal(first.receiptReconciliation.retryable, true);
  assert.equal(persisted[0].metadata.providerProof.proofStatus, 'confirmed');
  assert.equal(persisted[0].metadata.telnyxCallProjection.status, 'needs_review');
  assert.equal(state.calls[0].status, 'queued');
  const retry = await ctx.handleVerifiedTelnyxEvent(mapped, webhook);
  assert.equal(retry.replayed, true);
  assert.equal(retry.receiptReconciliation.status, 'projected');
  assert.equal(projections[1].record.approvalId, approval.id);
  assert.equal(projections[1].record.providerReceiptId, persisted[1].metadata.providerProof.receipts[0].receiptId);
  const event = projectCallEvent(projections[1].record, projections[1].kind);
  assert.equal(event.eventType, 'call.completed');
  assert.equal(event.payload.approvalId, approval.id);
  assert.equal(event.payload.providerReceiptId, projections[1].record.providerReceiptId);
  await ctx.handleVerifiedTelnyxEvent(mapped, webhook);
  assert.equal(projections.length, 2);
  assert.equal(persisted.at(-1).metadata.providerProof.receipts.length, 1);
});

test('a late ringing event cannot reopen a call with a verified terminal receipt', async () => {
  const { ctx, mapped, webhook } = fixture();
  await ctx.handleVerifiedTelnyxEvent(mapped, webhook);
  const late = await ctx.handleEvent(mapped.eventType, { ...mapped.payload, status: 'ringing' });
  assert.equal(late.call.status, 'ended');
});

test('internal or unsigned status input cannot create carrier proof', async () => {
  const { ctx, persisted, mapped, webhook } = fixture();
  await ctx.handleEvent(mapped.eventType, { ...mapped.payload, verifiedTelnyxCompletion: completion });
  await ctx.handleVerifiedTelnyxEvent(mapped, { ...webhook, signature: { ok: true, skipped: true } });
  assert.equal(persisted.length, 0);
});

test('a verified hangup can be reconciled after its dispatch result arrives', async () => {
  const { ctx, state, projections, mapped, webhook } = fixture({ approvals: [] });
  const received = await ctx.handleVerifiedTelnyxEvent(mapped, webhook);
  assert.equal(received.receiptReconciliation.status, 'approval_not_bound');
  state.approvals.push(structuredClone(approval));
  const result = await ctx.reconcileTelnyxCallCompletion(state.calls[1], { projectUnbound: false });
  assert.equal(result.status, 'projected');
  assert.equal(projections.at(-1).record.approvalId, approval.id);
});
