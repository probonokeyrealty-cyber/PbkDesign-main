import assert from 'node:assert/strict';
import test from 'node:test';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

test('new intake records a reviewable Ava handoff without any outreach', async () => {
  const bridge = await startIsolatedBridge();
  try {
    const request = async (path, body) => {
      const response = await bridge.fetch(bridge.origin + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${bridge.apiKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.ok, true, path);
      return response.json();
    };
    const before = await request('/state');
    const payload = {
      leadId: 'qa-ava-triage-event',
      eventId: 'qa-ava-triage-event-1',
      property: { address: '123 Fixture Ave, Denver CO' },
      seller: { notes: 'Synthetic intake note: executor is coordinating an estate sale.' },
      score: 88,
      source: 'triage-fixture',
    };
    const first = await request('/events', { eventType: 'lead-intake', payload });
    const replay = await request('/events', { eventType: 'lead-intake', payload });
    await request('/events', {
      eventType: 'lead-intake',
      payload: { ...payload, eventId: 'qa-ava-triage-event-2' },
    });
    const manual = await request('/api/leads', {
      leadId: 'qa-ava-triage-manual',
      address: '456 Fixture Ave, Denver CO',
      score: 98,
      dncStatus: 'do_not_contact',
      sellerNotes: 'Executor asked us to stop calling.',
    });
    assert.ok(first.leadTriage?.id, 'Ava should triage intake without an operator prompt');
    assert.equal(replay.leadTriage?.id, first.leadTriage.id);
    assert.ok(manual.leadTriage?.id, 'Staff-created CRM leads should also receive triage');
    assert.match(manual.leadTriage.summary, /do not contact/i);
    assert.equal(manual.leadTriage.metadata.priority, undefined);

    const importedLeadId = 'qa-ava-triage-bulk';
    const batch = {
      toolName: 'import_leads',
      params: {
        source: 'triage-fixture',
        leads: [payload, { leadId: importedLeadId, address: '789 Fixture Ave, Denver CO', score: 74 }],
      },
    };
    const firstBatch = await request('/invoke', batch);
    const repeatedBatch = await request('/invoke', batch);
    assert.equal(firstBatch.result.importedCount, 1);
    assert.equal(firstBatch.result.updatedCount, 1);
    assert.equal(firstBatch.result.triagedCount, 1);
    assert.equal(repeatedBatch.result.importedCount, 0);
    assert.equal(repeatedBatch.result.triagedCount, 0);

    const after = await request('/state');
    const tasks = after.agentTasks.filter(task => task.taskType === 'lead_intake_triage');
    assert.equal(tasks.length, 3);
    const imported = tasks.find(task => task.correlationId === importedLeadId);
    assert.equal(imported.metadata.source, 'bulk-lead-import');
    assert.equal(imported.metadata.priority.level, 'review');
    const recorded = tasks.find(task => task.id === first.leadTriage.id);
    assert.equal(recorded.correlationId, first.leadImport.leadId);
    assert.equal(recorded.fromAgent, 'Ava');
    assert.equal(recorded.providerWrites, 'blocked');
    assert.equal(recorded.metadata.crm.source, 'bridge_state.leadImports');
    assert.ok(recorded.metadata.qualification.missing.includes('authority'));
    assert.deepEqual(recorded.metadata.priority, { source: 'rex-autonomy', level: 'high', score: 88 });
    assert.match(recorded.summary, /prioritize/i);
    assert.match(recorded.summary, /confirm/i);
    assert.match(recorded.summary, /decision-making authority/i);
    const consultations = after.agentTasks.filter(task => task.taskType === 'lead_triage_consultation');
    const handoffs = consultations.filter(task => task.correlationId === payload.leadId);
    assert.equal(handoffs.length, 2);
    assert.deepEqual(handoffs.map(task => task.toAgent).sort(), ['Hermes', 'Rex']);
    assert.deepEqual(recorded.metadata.consultationIds.slice().sort(), handoffs.map(task => task.id).sort());
    for (const task of consultations) {
      assert.equal(task.fromAgent, 'Ava');
      assert.equal(task.status, 'complete');
      assert.equal(task.providerWrites, 'blocked');
      assert.doesNotMatch(JSON.stringify(task), /Synthetic intake note|123 Fixture Ave/);
    }
    assert.deepEqual(consultations.filter(task => task.correlationId === importedLeadId).map(task => task.toAgent), ['Rex']);
    assert.ok(!consultations.some(task => task.correlationId === 'qa-ava-triage-manual'));
    const leadDetail = await request(`/api/leads/${first.leadImport.leadId}/full`);
    assert.equal(leadDetail.activity.filter(item => item.source === 'ava-lead-intake-triage').length, 1);
    for (const key of ['calls', 'messages', 'contracts', 'approvals']) {
      assert.equal(after[key]?.length, before[key]?.length, key);
    }
  } finally {
    await bridge.stop();
  }
});
