import assert from 'node:assert/strict';
import test from 'node:test';
import { readHighLevelLeadTasks } from './highlevel-lead-tasks.mjs';

const options = {
  token: 'fixture',
  locationId: 'staff-location',
  bindings: '{"lead-one":"matched-contact"}',
};

test('reads matched contact tasks and exposes open task metadata only', async () => {
  const result = await readHighLevelLeadTasks('lead-one', {
    ...options,
    async fetchTasks(url, request) {
      assert.equal(url, 'https://services.leadconnectorhq.com/contacts/matched-contact/tasks');
      assert.equal(request.method, 'GET');
      assert.equal(request.redirect, 'error');
      return Response.json({ tasks: [
        { id: 'later', contactId: 'matched-contact', title: 'Later', completed: false, body: 'Private notes' },
        { id: 'first', contactId: 'matched-contact', title: 'Confirm inputs', completed: false, assignedTo: 'staff', dueDate: '2026-11-26T00:00:00Z' },
        { id: 'done', contactId: 'matched-contact', title: 'Done', completed: true },
      ] });
    },
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.writeMode, 'read_only');
  assert.deepEqual(result.tasks, [
    { id: 'first', title: 'Confirm inputs', dueAt: '2026-11-26T00:00:00.000Z', assigned: true },
    { id: 'later', title: 'Later', dueAt: null, assigned: false },
  ]);
});

test('unmatched and misconfigured leads never request provider data', async () => {
  const fetchTasks = () => assert.fail('Unexpected provider request');
  assert.equal((await readHighLevelLeadTasks('lead-two', { ...options, fetchTasks })).status, 'unmatched');
  assert.equal((await readHighLevelLeadTasks('lead-one', { ...options, bindings: '[', fetchTasks })).status, 'not_configured');
});

test('treats upstream errors and wrong-contact data as unavailable', async () => {
  for (const response of [
    new Response(null, { status: 401 }),
    Response.json({ tasks: [{ id: 'foreign', contactId: 'other', completed: false }] }),
  ]) {
    const result = await readHighLevelLeadTasks('lead-one', { ...options, fetchTasks: async () => response });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.tasks, undefined);
  }
});
