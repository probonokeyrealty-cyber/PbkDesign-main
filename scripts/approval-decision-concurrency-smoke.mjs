import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const stateDir = await mkdtemp(join(tmpdir(), 'pbk-approval-qa-'));
let providerRequests = 0;
const slackUpdates = [];
const provider = createServer(async (req, res) => {
  assert.equal(req.method, 'POST');
  if (req.url === '/fixture/slack-update') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    slackUpdates.push(JSON.parse(Buffer.concat(chunks)));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  providerRequests++;
  await delay(200);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'fixture-campaign' }));
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const providerUrl = `http://127.0.0.1:${provider.address().port}`;
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));

// No inherited provider config, Windows user hydration, or external fetches.
const guard = `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const execFileSync = childProcess.execFileSync;
childProcess.execFileSync = (file, ...args) => file === 'powershell.exe'
  ? '{}' : execFileSync(file, ...args);
syncBuiltinESMExports();
const realDate = Date;
let clockOffset = 0;
const fixtureNow = () => realDate.now() + clockOffset;
globalThis.Date = new Proxy(realDate, {
  construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [fixtureNow()], newTarget),
  apply: () => new realDate(fixtureNow()).toString(),
  get: (target, key) => key === 'now' ? fixtureNow : Reflect.get(target, key),
});
process.on('message', (timestamp) => {
  clockOffset = timestamp - realDate.now();
  process.send('clock-updated');
});
const realFetch = globalThis.fetch;
globalThis.fetch = (target, options) => {
  const url = new URL(String(target));
  if (url.href === 'https://slack.com/api/chat.update') {
    return realFetch(${JSON.stringify(providerUrl + '/fixture/slack-update')}, options);
  }
  if (url.origin !== ${JSON.stringify(providerUrl)}) {
    throw new Error('Non-fixture HTTP is disabled in approval QA');
  }
  return realFetch(target, options);
};
`;
const apiKey = 'isolated-approval-smoke-key';
const slackSigningKey = 'isolated-approval-slack-signature';
const child = spawn(process.execPath, [
  '--import', `data:text/javascript,${encodeURIComponent(guard)}`,
  './scripts/openclaw-local-server.mjs',
], {
  env: {
    SystemRoot: process.env.SystemRoot,
    PATH: process.env.PATH,
    TEMP: process.env.TEMP,
    PBK_OPENCLAW_STATE_DIR: stateDir,
    PBK_OPENCLAW_PORT: String(port),
    PBK_BRIDGE_API_KEY: apiKey,
    PBK_INSTANTLY_API_KEY: 'fake',
    PBK_INSTANTLY_BASE_URL: providerUrl,
    PBK_SLACK_BOT_TOKEN: 'fixture',
    PBK_SLACK_SIGNING_SECRET: slackSigningKey,
    PBK_CAMPAIGN_WORKER_ENABLED: 'true',
  },
  stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
});
const closed = once(child, 'close');
let stderr = '';
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-3000); });
const origin = `http://127.0.0.1:${port}`;
async function request(path, method = 'GET', body) {
  const res = await fetch(origin + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  return { status: res.status, ...(await res.json()) };
}

async function createDraft(schedule = {}, id = `campaign-draft-${randomUUID()}`) {
  const response = await request('/api/campaigns', 'POST', {
    id,
    name: 'Fixture draft',
    selectedLeads: [{ leadId: id, leadName: 'Fixture seller', email: 'qa@example.invalid' }],
    schedule,
  });
  assert.equal(response.ok, true);
  assert.equal(response.campaign.id, id);
  assert.equal(response.leads.length, 1);
  return response;
}

function decide(id) {
  return request(`/api/approvals/${id}/approve`, 'POST', { actor: 'QA operator' });
}

function runDue(options) {
  return request('/api/campaigns/run-due', 'POST', options);
}

try {
  for (let attempt = 0; ; attempt++) {
    if (await fetch(origin + '/health').then((res) => res.ok).catch(() => false)) break;
    assert(attempt < 100, `Fixture bridge did not start: ${stderr}`);
    await delay(100);
  }
  const approvalId = 'qa-campaign-approval';
  const approvalPath = `/api/approvals/${approvalId}`;
  assert.equal((await request('/api/approvals', 'POST', {
    id: approvalId, type: 'campaign', leadName: 'QA Lead',
    metadata: { selectedLeads: [{ leadId: 'fixture', leadName: 'QA Lead', email: 'qa@example.invalid' }] },
  })).ok, true);
  const first = request(approvalPath, 'PUT', { status: 'approved', actor: 'QA web' });
  for (let attempt = 0; providerRequests === 0; attempt++) {
    assert(attempt < 150, 'Approved campaign did not reach the fixture provider');
    await delay(20);
  }
  const concurrent = await Promise.all([
    first,
    request(`${approvalPath}/approve`, 'POST', { actor: 'QA second surface' }),
    request(`${approvalPath}/decline`, 'POST', { actor: 'QA stale decline' }),
    request('/api/campaigns/execute-approved', 'POST', { approvalId, actor: 'QA worker' }),
  ]);
  assert.equal(concurrent[0].approval.status, 'approved');
  assert.equal(concurrent[1].replayed, true);
  assert.equal(concurrent[2].status, 409);
  assert.equal(concurrent[2].approval.status, 'approved');
  assert.equal(concurrent[3].ok, true);
  assert.equal(providerRequests, 1, 'Bridge and worker must share one dispatch per approval');
  const state = await request('/state');
  assert.equal(state.approvals.find((item) => item.id === approvalId)?.status, 'approved');

  const slackBody = JSON.stringify({
    actions: [{ action_id: 'pbk_approval_modify', value: approvalId }],
    user: { username: 'fixture-slack-user' },
    channel: { id: 'fixture-channel' },
    message: { ts: '1.0' },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', slackSigningKey)
    .update(`v0:${timestamp}:${slackBody}`).digest('hex');
  const slack = await fetch(origin + '/api/slack/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': `v0=${signature}`,
    },
    body: slackBody,
  });
  assert.equal(slack.status, 200);
  for (let attempt = 0; slackUpdates.length === 0; attempt++) {
    assert(attempt < 150, 'Slack fixture never received the canonical decision');
    await delay(20);
  }
  assert.match(slackUpdates[0].text, /^PBK approval approved:/);
  const reconciled = await request('/state');
  assert.equal(reconciled.approvals.find((item) => item.id === approvalId)?.status, 'approved');

  const nextPath = '/api/approvals/qa-contract';
  assert.equal((await request('/api/approvals', 'POST', { id: 'qa-contract', type: 'contract' })).ok, true);
  assert.equal((await request(nextPath, 'PUT', { status: 'needs-revision' })).approval.status, 'needs_revision');
  assert.equal((await request(nextPath, 'PUT', { status: 'approved' })).status, 409);
  assert.equal(providerRequests, 1);
  console.log('Approval concurrency: one provider request, replay and conflict handled, stale Slack Modify reconciled.');

  await test('A reserved draft ID returns the original campaign and leads on create replay', async () => {
    const { campaign, leads } = await createDraft();
    const replay = await request('/api/campaigns', 'POST', {
      id: campaign.id,
      name: 'Stale retry name',
      selectedLeads: [{ leadId: 'stale', email: 'stale@example.invalid' }],
    });
    assert.equal(replay.ok, true);
    assert.deepEqual(replay.campaign, campaign);
    assert.deepEqual(replay.leads, leads);
  });

  await test('Start request replays preserve one active campaign and its leads', async () => {
    const before = providerRequests;
    const { campaign, leads } = await createDraft();
    const path = `/api/campaigns/${campaign.id}`;
    const [original, concurrentReplay] = await Promise.all([
      request(`${path}/approval`, 'POST', { requestedAction: 'start_campaign' }),
      request(`${path}/actions`, 'POST', { action: 'start' }),
    ]);
    assert.equal(original.ok, true);
    assert.equal(concurrentReplay.ok, true);
    assert.equal(concurrentReplay.approval.id, original.approval.id, 'Concurrent Start aliases must share one approval');
    assert.equal((await decide(original.approval.id)).campaignResult.result, 'live');
    const replay = await request('/api/campaigns', 'POST', {
      id: campaign.id,
      name: 'Stale retry name',
      selectedLeads: [{ leadId: 'stale', email: 'stale@example.invalid' }],
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.campaign.name, campaign.name);
    assert.equal(replay.campaign.status, 'active');
    assert.equal(replay.campaign.approvalId, original.approval.id);
    assert.deepEqual(replay.leads.map((lead) => lead.id), leads.map((lead) => lead.id));
    const restarted = await request(`${path}/approval`, 'POST', { requestedAction: 'start_campaign' });
    assert.equal(restarted.ok, true);
    assert.equal(restarted.campaign.status, 'active');
    const current = await request('/state');
    assert.equal(current.approvals.filter((item) => item.metadata?.campaignId === campaign.id).length, 1);
    assert.equal(providerRequests - before, 1);

    for (const [action, status] of [['pause', 'paused'], ['resume', 'active']]) {
      const lifecycle = await request(`${path}/actions`, 'POST', { action });
      assert.notEqual(lifecycle.approval.id, original.approval.id);
      const approved = await decide(lifecycle.approval.id);
      assert.equal(approved.campaignResult.campaign.status, status);
    }
    assert.equal(providerRequests - before, 1, 'Pause and resume must not create another provider campaign');
  });

  await test('Two approved cards for the same campaign share one provider dispatch', async () => {
    const before = providerRequests;
    const { campaign, leads } = await createDraft();
    const approvals = await Promise.all(['first', 'second'].map((suffix) => request('/api/approvals', 'POST', {
      id: `${campaign.id}-${suffix}`,
      type: 'campaign',
      approvalAction: 'start_campaign',
      leadName: campaign.name,
      metadata: { campaignId: campaign.id, selectedLeads: leads },
    })));
    const results = await Promise.all(approvals.map(({ approval }) => decide(approval.id)));
    assert.deepEqual(results.map(({ campaignResult }) => campaignResult.ok), [true, true]);
    assert.equal(providerRequests - before, 1, 'Different approval IDs must not start the same campaign twice');
    assert.equal(new Set(results.map(({ campaignResult }) => campaignResult.execution.id)).size, 1);
  });

  await test('A scheduled approval waits for its timestamp and a write-enabled due run', async () => {
    const before = providerRequests;
    const firstSendAt = new Date(Date.now() + 86_400_000).toISOString();
    const { campaign } = await createDraft({ firstSendAt });
    const { approval } = await request(`/api/campaigns/${campaign.id}/approval`, 'POST', {});
    const decision = await decide(approval.id);
    assert.equal(decision.approval.status, 'approved');
    assert.equal(decision.campaignResult.result, 'scheduled');
    const execute = () => request('/api/campaigns/execute-approved', 'POST', { approvalId: approval.id });
    assert.equal((await execute()).result, 'scheduled');
    const replay = await request(`/api/campaigns/${campaign.id}/approval`, 'POST', {});
    assert.equal(replay.result, 'scheduled');
    assert.equal(replay.approval.id, approval.id);
    await runDue({ dryRun: false, confirmProviderWrites: true });
    assert.equal(providerRequests, before, 'No route may dispatch before the scheduled time');

    const action = (name) => request(`/api/campaigns/${campaign.id}/actions`, 'POST', { action: name });
    const cancel = await action('cancel');
    assert.equal(cancel.approval.status, 'pending');
    const advanced = once(child, 'message');
    child.send(Date.parse(firstSendAt));
    assert.equal((await advanced)[0], 'clock-updated');
    await runDue({ dryRun: false, confirmProviderWrites: true });
    assert.equal((await execute()).result, 'campaign_start_blocked');
    assert.equal(providerRequests, before, 'A pending cancel must block the scheduled start');
    const denied = await request(`/api/approvals/${cancel.approval.id}/decline`, 'POST', {});
    assert.equal(denied.approval.status, 'rejected');
    const restored = await request(`/api/campaigns/${campaign.id}`);
    assert.equal(restored.campaign.status, 'pending');
    assert.equal(restored.campaign.approvalStatus, 'approved');
    assert.equal(restored.campaign.approvalId, approval.id);
    assert.equal(restored.campaign.schedule.firstSendAt, firstSendAt);

    await runDue({ dryRun: true, confirmProviderWrites: true });
    await runDue({ dryRun: false });
    assert.equal(providerRequests, before, 'Dry-run and unconfirmed workers must not dispatch a due campaign');

    const pause = await action('pause');
    assert.equal((await decide(pause.approval.id)).campaignResult.campaign.status, 'paused');
    assert.equal((await execute()).result, 'campaign_start_blocked');
    assert.equal((await action('start')).result, 'campaign_start_blocked');
    await runDue({ dryRun: false, confirmProviderWrites: true });
    assert.equal(providerRequests, before, 'A paused campaign must not dispatch even when its start is due');

    const resume = await action('resume');
    assert.equal((await decide(resume.approval.id)).campaignResult.campaign.status, 'active');

    const runs = await Promise.all([
      runDue({ dryRun: false, confirmProviderWrites: true }),
      runDue({ dryRun: false, confirmProviderWrites: true }),
    ]);
    assert(runs.every((run) => run.ok));
    const current = await request(`/api/campaigns/${campaign.id}`);
    assert.equal(current.campaign.status, 'active');
    assert.equal((await execute()).ok, true);
    assert.equal(providerRequests - before, 1, 'Overlapping due runs and approval replays must dispatch once');
  });

  await test('Replaying an approved resume cannot restore a cancelled scheduled start', async () => {
    const before = providerRequests;
    const firstSendAt = new Date(Date.now() + 172_800_000).toISOString();
    const { campaign } = await createDraft({ firstSendAt });
    const path = `/api/campaigns/${campaign.id}`;
    const action = (name) => request(`${path}/actions`, 'POST', { action: name });
    const start = await action('start');
    assert.equal((await decide(start.approval.id)).campaignResult.result, 'scheduled');
    for (const name of ['pause', 'resume', 'cancel']) {
      const { approval } = await action(name);
      assert.equal((await decide(approval.id)).campaignResult.ok, true);
      if (name === 'resume') campaign.resumeApprovalId = approval.id;
    }
    const replay = await request('/api/campaigns/execute-approved', 'POST', { approvalId: campaign.resumeApprovalId });
    assert.equal(replay.ok, false);
    assert.equal((await request(path)).campaign.status, 'cancelled');
    const advanced = once(child, 'message');
    child.send(Date.parse(firstSendAt));
    await advanced;
    await runDue({ dryRun: false, confirmProviderWrites: true });
    assert.equal(providerRequests, before);
  });

  await test('A timezone-less legacy schedule cannot silently dispatch', async () => {
    const before = providerRequests;
    const firstSendAt = '2099-01-01T09:00';
    const { campaign } = await createDraft({ firstSendAt });
    const { approval } = await request(`/api/campaigns/${campaign.id}/approval`, 'POST', {});
    const decision = await decide(approval.id);
    assert.equal(decision.campaignResult.result, 'campaign_schedule_invalid');
    assert.equal((await request('/api/campaigns/execute-approved', 'POST', { approvalId: approval.id })).result, 'campaign_schedule_invalid');
    await runDue({ dryRun: false, confirmProviderWrites: true });
    assert.equal(providerRequests, before);
  });

  await test('Direct terminal PATCH revokes a retained resume approval before a due run', async () => {
    const before = providerRequests;
    const firstSendAt = new Date(Date.now() + 259_200_000).toISOString();
    const { campaign } = await createDraft({ firstSendAt });
    const path = `/api/campaigns/${campaign.id}`;
    const action = (name) => request(`${path}/actions`, 'POST', { action: name });
    const start = await action('start');
    assert.equal((await decide(start.approval.id)).campaignResult.result, 'scheduled');
    const pause = await action('pause');
    assert.equal((await decide(pause.approval.id)).campaignResult.campaign.status, 'paused');
    const resume = await action('resume');
    assert.equal((await decide(resume.approval.id)).campaignResult.campaign.status, 'active');
    const cancelled = await request(path, 'PATCH', { status: 'cancelled' });
    assert.equal(cancelled.campaign.approvalId, resume.approval.id);
    const replay = await request('/api/campaigns/execute-approved', 'POST', { approvalId: resume.approval.id });
    assert.equal(replay.result, 'campaign_action_stale');
    const advanced = once(child, 'message');
    child.send(Date.parse(firstSendAt));
    await advanced;
    await runDue({ dryRun: false, confirmProviderWrites: true });
    assert.equal((await request(path)).campaign.status, 'cancelled');
    assert.equal(providerRequests, before);
  });

  await test('Ambiguous legacy start cards block without creating a provider dispatch', async () => {
    const before = providerRequests;
    const { campaign, leads } = await createDraft({}, 'legacy-fixture-campaign');
    const cards = [];
    for (const suffix of ['first', 'second']) {
      const { approval } = await request('/api/approvals', 'POST', {
        id: `${campaign.id}-${suffix}`,
        type: 'campaign',
        approvalAction: 'start_campaign',
        metadata: { campaignId: campaign.id, selectedLeads: leads },
      });
      assert.equal(approval.metadata.campaignStartDispatchVersion, undefined);
      cards.push(approval);
    }
    for (const card of cards) {
      const decision = await decide(card.id);
      assert.equal(decision.campaignResult.result, 'campaign_legacy_approval_conflict');
      assert.equal(decision.campaignResult.providerAttempted, false);
    }
    assert.equal(providerRequests, before);
  });
} finally {
  child.kill();
  await closed;
  await new Promise((resolve) => provider.close(resolve));
  await rm(stateDir, { recursive: true, force: true });
}
