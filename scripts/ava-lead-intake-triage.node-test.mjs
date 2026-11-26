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
      payload: { ...payload, eventId: 'qa-ava-triage-event-2', score: 30, seller: { notes: 'Routine update.' } },
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
    const reasons = { version: 1, rex: 'elevated_score', hermes: 'probate_or_estate' };
    assert.deepEqual(first.leadTriage.metadata.consultationDecisions, reasons);
    assert.deepEqual(replay.leadTriage.metadata.consultationDecisions, reasons);
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

    const networkBeforeReview = { ...bridge.blockedNetwork };
    const readReview = (leadId) => request(`/api/leads/${encodeURIComponent(leadId)}/full?review=ava`);
    const intakeId = first.leadImport.leadId;
    const review = (await readReview(intakeId)).review;
    assert.equal(review.leadId, intakeId);
    assert.equal(review.writeMode, 'read_only');
    assert.deepEqual(review.consultationDecisions, reasons, 'Review preserves the reasons recorded at intake');
    assert.deepEqual(review.consultationRecords, handoffs.map((task) => ({
      id: task.id, specialist: task.toAgent, status: task.status, summary: task.summary, createdAt: task.createdAt,
    })));
    assert.deepEqual((await readReview(manual.leadId)).review.consultationRecords, []);
    for (const record of review.consultationRecords) {
      const lookup = `/api/leads/${payload.leadId}/full?consultation=${record.id}`;
      assert.deepEqual(await request(lookup), { ok: true, leadId: payload.leadId, consultation: record });
      assert.equal((await bridge.fetch(bridge.origin + lookup)).status, 401);
      const wrongLeadPath = `/api/leads/${manual.leadId}/full?consultation=${record.id}`;
      const wrongLead = await bridge.fetch(bridge.origin + wrongLeadPath, {
        headers: { Authorization: `Bearer ${bridge.apiKey}` },
      });
      assert.equal(wrongLead.status, 404);
    }
    assert.doesNotMatch(JSON.stringify(review), /Synthetic intake note|executor is coordinating/);
    assert.equal(review.evidence.contact.status, 'needs_review');
    assert.equal(review.nextStep.code, 'review_contact');
    assert.deepEqual(review.evidence.property, { recorded: true });
    assert.ok(review.evidence.qualification.missing.includes('authority'));
    assert.deepEqual(review.evidence.underwriting, { recorded: false, recordedAt: null });
    const blocked = (await readReview(manual.leadTriage.correlationId)).review;
    assert.equal(blocked.evidence.contact.status, 'restricted');
    assert.equal(blocked.nextStep.code, 'hold_contact');
    assert.deepEqual(blocked.consultationDecisions, { version: 1, rex: 'contact_restricted', hermes: 'contact_restricted' });
    assert.deepEqual((await readReview(importedLeadId)).review.consultationDecisions, {
      version: 1, rex: 'elevated_score', hermes: 'no_recognized_signal',
    });
    const nonId = await bridge.fetch(`${bridge.origin}/api/leads/${encodeURIComponent(payload.property.address)}/full?review=ava`, {
      headers: { Authorization: `Bearer ${bridge.apiKey}` },
    });
    assert.equal(nonId.status, 404, 'An address must never resolve the review identity');
    const anonymous = await bridge.fetch(`${bridge.origin}/api/leads/${intakeId}/full?review=ava`);
    assert.equal(anonymous.status, 401, 'The review uses the staff lead access boundary');
    const taskPath = `/api/leads/${intakeId}/full?tasks=highlevel`;
    assert.equal((await bridge.fetch(bridge.origin + taskPath)).status, 401);
    assert.deepEqual((await request(taskPath)).taskReview, {
      leadId: intakeId, source: 'highlevel', writeMode: 'read_only', status: 'not_configured',
    });
    const publicHealth = await bridge.fetch(`${bridge.origin}/health`);
    assert.equal(publicHealth.status, 200);
    assert.doesNotMatch(await publicHealth.text(), /consultationDecisions/);
    const repeated = (await readReview(intakeId)).review;
    assert.deepEqual(repeated.evidence, review.evidence);
    assert.deepEqual(repeated.nextStep, review.nextStep);
    assert.deepEqual(bridge.blockedNetwork, networkBeforeReview, 'Review requires no outbound network calls');
    const reviewedState = await request('/state');
    for (const key of ['leadImports', 'calls', 'messages', 'contracts', 'approvals', 'agentTasks', 'analyzerRuns', 'activity']) {
      assert.deepEqual(reviewedState[key], after[key], `Review writes no ${key}`);
    }

    const askAva = (message, leadId, sessionId = 'qa-ava-linked-lead-review') =>
      request('/api/assistant/chat', { sessionId, message, leadId });
    const leadChat = await askAva('Ava, please review this lead.', intakeId);
    assert.equal(leadChat.toolResult?.result, 'ava_lead_review_summary');
    assert.equal(leadChat.toolPlan?.providerWrite, false);
    assert.equal(leadChat.toolResult?.leadId, intakeId);
    assert.deepEqual(leadChat.toolResult?.evidence, review.evidence);
    assert.deepEqual(leadChat.toolResult?.nextStep, review.nextStep);
    assert.match(leadChat.answer, /verify consent and do-not-contact/i);
    assert.doesNotMatch(JSON.stringify(leadChat.toolResult), /Synthetic intake note|123 Fixture Ave|executor is coordinating/);

    // Reuse one chat session deliberately; today's explicitly selected lead wins.
    const restrictedChat = await askAva('What should I do next for this lead?', manual.leadId);
    assert.equal(restrictedChat.toolResult?.leadId, manual.leadId);
    assert.deepEqual(restrictedChat.toolResult?.evidence, blocked.evidence);
    assert.deepEqual(restrictedChat.toolResult?.nextStep, blocked.nextStep);
    assert.match(restrictedChat.answer, /hold outreach/i);
    assert.ok(restrictedChat.suggestions?.includes('Open current lead'));

    const noSelection = await askAva('Review this lead');
    assert.equal(noSelection.toolPlan, null, 'Do not reuse a previously linked lead when none is selected');
    assert.match(noSelection.answer, /open.*lead/i);
    assert.equal(noSelection.activeLeadId, '', 'Missing selection must not attach a past lead to the response');
    assert.equal(noSelection.mission.leadId, '');
    assert.equal(noSelection.controlEnvelope.leadId, '');
    assert.doesNotMatch(noSelection.trace.workingMemory.brief, /456 Fixture Ave|Recent turns:|Known facts:/);
    assert.deepEqual(noSelection.trace.workingMemory.memories, []);
    const notFound = await askAva('Review this lead', 'qa-nonexistent-lead');
    assert.equal(notFound.toolResult?.result, 'ava_lead_review_not_found');
    const addressAsId = await askAva('Review this lead', payload.property.address);
    assert.equal(addressAsId.toolPlan, null, 'Do not look up a lead review by fuzzy address');
    assert.equal(addressAsId.activeLeadId, '');
    assert.doesNotMatch(restrictedChat.trace.workingMemory.brief, /123 Fixture Ave|456 Fixture Ave|Recent turns:|Known facts:/);
    const publicReview = await request('/api/public/ava-chat', {
      sessionId: 'qa-public-lead-review', message: 'Review this lead', leadId: intakeId,
    });
    assert.equal(publicReview.assistantAction, 'blocked_public_private_data');
    assert.equal(publicReview.toolPlan, null);
    const anonymousReview = await bridge.fetch(bridge.origin + '/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Review this lead', leadId: intakeId }),
    });
    assert.equal(anonymousReview.status, 401);

    const reading = await bridge.fetch(bridge.origin + '/api/assistant/chat', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + bridge.apiKey, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ sessionId: 'qa-ava-stream-review', message: 'Review this lead', leadId: manual.leadId }),
    });
    assert.match(reading.headers.get('content-type') || '', /^text\/event-stream/);
    const done = (await reading.text()).split(/\r?\n\r?\n/).find(event => event.startsWith('event: done'));
    assert.ok(done, 'Stream completes with an authoritative review');
    const streamed = JSON.parse(done.split(/\r?\n/).find(line => line.startsWith('data: ')).slice(6));
    assert.equal(streamed.toolResult?.nextStep?.code, 'hold_contact');
    assert.match(streamed.answer, /hold outreach/i);

    const chatState = await request('/state');
    for (const key of ['leadImports', 'calls', 'messages', 'contracts', 'approvals', 'analyzerRuns']) {
      assert.deepEqual(chatState[key], reviewedState[key], 'Chat review writes no ' + key);
    }
    const savedActivityIds = new Set(reviewedState.activity.map(item => item.id));
    assert.deepEqual(chatState.activity.filter(item => savedActivityIds.has(item.id)), reviewedState.activity);
    assert.ok(chatState.activity.filter(item => !savedActivityIds.has(item.id)).every(item =>
      item.source === 'runtime' && ['ASSISTANT', 'PUBLIC_CHAT'].includes(item.category) && !item.leadId
    ), 'Chat adds only generic audit rows, not lead or provider activity');
    const savedTaskIds = new Set(reviewedState.agentTasks.map(task => task.id));
    assert.ok(chatState.agentTasks.filter(task => !savedTaskIds.has(task.id)).every(
      task => task.taskType === 'agent_ops_measurement' && task.providerWrites === 'blocked'
    ), 'Chat review only adds routine timing measurements, not business tasks');
    assert.deepEqual(bridge.blockedNetwork, networkBeforeReview, 'Chat review requires no outbound network calls');

    for (const [id, compliance] of [
      ['requested', { dncStatus: 'requested', tcpaConsent: 'yes' }],
      ['revoked', { dncStatus: 'clear', tcpaConsent: 'yes', consentStatus: 'revoked' }],
    ]) {
      const fixture = await request('/api/leads', {
        leadId: `qa-ava-review-${id}`, address: `${id === 'requested' ? 101 : 202} Fictional Way, Denver CO`, compliance,
      });
      const restricted = (await readReview(fixture.leadTriage.correlationId)).review;
      assert.equal(restricted.evidence.contact.status, 'restricted', id);
      assert.equal(restricted.nextStep.code, 'hold_contact', id);
      const chatRestriction = await askAva('What evidence is missing for this lead?', fixture.leadTriage.correlationId);
      assert.equal(chatRestriction.toolResult?.nextStep?.code, 'hold_contact', id);
    }
    const unscored = await request('/api/leads', {
      leadId: 'qa-ava-unscored-notes', address: '303 Fictional Way, Denver CO', sellerNotes: 'Synthetic tenant signal.',
    });
    assert.deepEqual(unscored.leadTriage.metadata.consultationDecisions, {
      version: 1, rex: 'score_unavailable', hermes: 'tenant_pressure',
    });
  } finally {
    await bridge.stop();
  }
});
