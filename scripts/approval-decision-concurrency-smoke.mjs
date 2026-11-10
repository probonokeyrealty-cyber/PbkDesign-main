import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  },
  stdio: ['ignore', 'ignore', 'pipe'],
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
} finally {
  child.kill();
  await closed;
  await new Promise((resolve) => provider.close(resolve));
  await rm(stateDir, { recursive: true, force: true });
}
