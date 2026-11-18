import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const child = await startIsolatedBridge({ startupMs: 60000,
  entry: fileURLToPath(new URL('./fixtures/approval-callback-smoke-entry.mjs', import.meta.url)) });
const derive = purpose => createHmac('sha256', child.apiKey).update(purpose).digest('hex');
const founder = { authorization: `Bearer ${child.apiKey}` };
async function request(path, body, headers = founder, method = body === undefined ? 'GET' : 'POST') {
  const response = await child.fetch(child.origin + path, { method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function create(id, params = {}) {
  const result = await request('/api/approvals', { id, type: 'offer', offerPrice: 90000, ...params });
  assert.equal(result.body.ok, true);
  return result.body.approval.id;
}
async function snapshot() { return (await request('/state')).body; }
try {
  const auth = await request('/api/auth/team', { passcode: derive('callback-smoke-team') }, {});
  assert.equal(auth.body.ok, true);
  assert.equal(auth.body.permissions.canApproveProviderActions, false);
  const team = { 'x-pbk-team-token': auth.body.token };
  const guarded = [
    ['callback-admin', { type: 'admin', approvalAction: 'admin_update_env_var' }],
    ['callback-contract', { type: 'contract' }],
    ['callback-campaign', { type: 'campaign' }],
    ['callback-amount', { offerPrice: 100001 }],
    ['callback-provider', { type: 'provider-action', approvalAction: 'telnyx_sms' }],
  ];
  for (const [id, params] of guarded) await create(id, params);
  const before = await snapshot();
  for (const [id] of guarded) {
    for (const path of ['/events', '/api/events']) {
      for (const headers of [team, { ...founder, ...team, 'x-pbk-netlify-proxy': '1' }]) {
        const result = await request(path, { eventType: 'approval-callback', payload: {
          id, status: 'approved', actor: 'founder', source: 'slack-interaction',
          teamAuth: { role: 'admin', ok: true }, request: { headers: founder },
        } }, headers);
        assert.equal(result.status, 403, id);
        assert.equal(result.body.ok, false);
      }
    }
    for (const [path, method] of [[`/api/approvals/${id}/approve`, 'POST'], [`/api/approvals/${id}`, 'PUT']]) {
      const result = await request(path, { status: 'approved', teamToken: auth.body.token }, founder, method);
      assert.equal(result.status, 403, id);
    }
  }
  const after = await snapshot();
  for (const lane of ['approvals', 'calls', 'messages', 'contracts', 'leadImports']) {
    assert.deepEqual(after[lane], before[lane], lane);
  }
  const forged = await request('/api/events', { eventType: 'approval-callback',
    payload: { id: 'callback-admin', status: 'approved', source: 'slack-interaction', teamAuth: { role: 'admin' } } }, {});
  assert.equal(forged.status, 401);
  const borrowed = await request('/api/events', { eventType: 'approval-callback',
    payload: { id: 'callback-admin', status: 'approved' } }, { ...founder, 'x-pbk-netlify-proxy': '1' });
  assert.equal(borrowed.status, 403);
  await create('callback-routine');
  const routine = await request('/api/events', { eventType: 'approval-callback',
    payload: { id: 'callback-routine', status: 'approved' } }, team);
  assert.equal(routine.status, 200); assert.equal(routine.body.approval.status, 'approved');
  const rejected = await request('/api/approvals/callback-admin/decline', {}, team);
  assert.equal(rejected.status, 200); assert.equal(rejected.body.approval.status, 'rejected');
  const founderDecision = await request('/api/approvals/callback-amount/approve', {});
  assert.equal(founderDecision.status, 200); assert.equal(founderDecision.body.approval.status, 'approved');

  await create('callback-signed-slack', { offerPrice: 100001 });
  const slack = { user: { id: 'fixture-slack-reviewer' }, actions: [{ action_id: 'pbk_approval_approve', value: 'callback-signed-slack' }] };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = 'v0=' + createHmac('sha256', derive('callback-smoke-slack'))
    .update(`v0:${timestamp}:${JSON.stringify(slack)}`).digest('hex');
  const invalid = await request('/api/slack/interactions', slack,
    { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': 'invalid' });
  assert.equal(invalid.status, 401);
  const accepted = await request('/api/slack/interactions', slack,
    { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature });
  assert.equal(accepted.status, 200);
  let completed = false;
  for (let i = 0; i < 50; i++) {
    if ((await snapshot()).approvals.find(a => a.id === 'callback-signed-slack')?.status === 'approved') { completed = true; break; }
    await delay(50);
  }
  assert.equal(completed, true, 'Verified Slack decision must complete in the isolated runtime');
  const final = await snapshot();
  for (const lane of ['calls', 'messages', 'contracts', 'leadImports']) assert.deepEqual(final[lane], before[lane], lane);
  console.log('approval-callback-authorization-smoke: ok (existing policies, signed Slack, unchanged delivery lanes; isolated only)');
} finally { await child.stop(); }
