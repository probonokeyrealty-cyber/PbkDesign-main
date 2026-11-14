import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { buildAgentRuntimeSmokeEnv } from './agent-runtime-smoke-isolation.mjs';

const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const stateDir = await mkdtemp(join(tmpdir(), 'pbk-context-freshness-'));
const apiKey = 'isolated-context-freshness-smoke';
const baseUrl = `http://127.0.0.1:${port}`;
// Only this isolated child reads these fixtures; no hosted state is touched.
const storedAt = new Date().toISOString();
await writeFile(join(stateDir, 'openclaw-state.json'), JSON.stringify({
  leadImports: [{ id: 'context-stored-lead', updatedAt: storedAt }],
  calls: [
    { id: 'context-stored-call', leadId: 'context-old', updatedAt: storedAt },
    { id: 'context-stale-call', leadId: 'context-old', updatedAt: '2026-07-14T12:00:00Z' },
  ],
}));
const child = spawn(process.execPath, [
  '--import', new URL('./agent-runtime-smoke-isolation.mjs', import.meta.url).href,
  'scripts/openclaw-local-server.mjs',
], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...buildAgentRuntimeSmokeEnv(), PBK_AGENT_SMOKE_ISOLATED: '1',
    PORT: String(port), HOST: '127.0.0.1', PBK_BRIDGE_API_KEY: apiKey,
    PBK_OPENCLAW_STATE_DIR: stateDir, PBK_DISABLE_POSTGRES: '1',
    PBK_SUPABASE_ENABLED: '0', PBK_REDIS_ENABLED: '0', PBK_READ_CACHE_AGENT_HEALTH_TTL_MS: '1000',
  },
});
child.stdout.resume();
let errors = '';
child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-4000); });

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response.json();
}

async function invoke(leadId, overrides = {}) {
  const result = await request('/api/agents/invoke', {
    agentId: 'bant-enforcer', payload: {
      leadId, dryRun: true, smoke: true, query: 'Inspect qualification status', ...overrides,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.output.result, 'bant_enforcer_status');
  assert.equal(result.pbkIntelligenceContext.readiness.required.agentCoverage, true);
  return result.pbkIntelligenceContext;
}

try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated bridge exited: ${errors}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* The isolated bridge is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, errors);
  await request('/api/agents/registry/health', { persist: false });
  const healthBefore = await request('/api/agents/health');
  const old = { session: { lastRedisSyncResult: 'redis_call_state_synced', lastRedisSyncAt: Date.parse('2026-07-14T12:00:00Z') } };
  assert.equal((await invoke('context-old', old)).dataFreshnessReady, false, 'A stale source must stay stale through prepare/finalize.');
  assert.equal((await invoke('context-old', old)).dataFreshnessReady, false, 'A second real action must not restamp the stale packet.');
  const fresh = { session: { lastRedisSyncResult: 'redis_call_state_synced', lastRedisSyncAt: Date.now() - 50 } };
  assert.equal((await invoke('context-old', fresh)).dataFreshnessReady, false, 'A caller Redis timestamp cannot assert freshness.');
  assert.equal((await invoke('context-fallback', {
    session: { lastRedisSyncResult: 'redis_unavailable', lastRedisSyncAt: Date.now() },
    call: { updatedAt: new Date(Date.now() - 50).toISOString() },
  })).dataFreshnessReady, false, 'A caller call timestamp cannot assert freshness.');
  const storedCall = await invoke('context-old', { callId: 'context-stored-call' });
  assert.equal(storedCall.dataFreshnessReady, true, 'Matching authoritative call evidence remains usable without Redis.');
  assert.equal(storedCall.dataFreshness.lastSyncAt, storedAt);
  assert.equal(storedCall.dataFreshness.source.recordId, 'context-stored-call');
  assert.equal((await invoke('context-other', { callId: 'context-stored-call' })).dataFreshnessReady, false, 'Stored call evidence must match its lead.');
  assert.equal((await invoke('context-old', { callId: 'context-stale-call', ...fresh })).dataFreshnessReady, false, 'Caller freshness cannot refresh a stale authoritative source.');
  assert.equal((await invoke('context-stored-lead')).dataFreshnessReady, true, 'The canonical leadImports collection supplies authoritative lead evidence.');
  assert.equal((await invoke('context-missing')).dataFreshnessReady, false, 'Missing evidence must not receive a generated timestamp.');
  const diagnostic = await invoke('');
  assert.equal(diagnostic.readiness.required.leadIdentity, false);
  assert.equal(diagnostic.readiness.required.agentCoverage, true);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const healthAfter = await request('/api/agents/health');
  assert.deepEqual(
    healthAfter.agents.map(({ id, ready }) => ({ id, ready })),
    healthBefore.agents.map(({ id, ready }) => ({ id, ready })),
    'A no-seller diagnostic must not downgrade the fleet health probes.'
  );
  assert.equal(healthAfter.measurement.ready, false);
  assert(healthAfter.measurement.agents.some((agent) => agent.blockers.includes('latency_not_sampled')));
  console.log('pbk-intelligence-context-bridge-smoke: authoritative lead/call freshness and forged-source negatives passed; diagnostic health unchanged; latency gaps retained');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  const relativeStateDir = relative(tmpdir(), stateDir);
  assert(!isAbsolute(relativeStateDir) && relativeStateDir.startsWith('pbk-context-freshness-'));
  await rm(stateDir, { recursive: true, force: true });
}
