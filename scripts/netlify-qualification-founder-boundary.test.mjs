import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createFetchProxyFixture, createProxyFixture } from './fixtures/netlify-proxy-qa.mjs';

const founderPaths = ['/api/agents/controlled-qualification', '/api/admin/qualification/run'];
const elevatedPermissions = {
  canDeleteLeads: true,
  canDeleteData: true,
  canSendContracts: true,
  canSendSms: true,
  canSendEmail: true,
  canPlaceCalls: true,
  canApproveProviderActions: true,
  canToggleKillSwitch: true,
  canManageSkills: true,
  canChangeGuardrails: true,
};

function fixture(permissions, modern = true) {
  const calls = [];
  const create = modern ? createFetchProxyFixture : createProxyFixture;
  const handler = create(async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method });
    return Response.json(path === '/api/auth/team/verify'
      ? { ok: true, permissions }
      : { ok: true, result: 'fixture_target_reached' });
  });
  return { handler, calls };
}

for (const path of founderPaths) {
  for (const [role, permissions] of [['restricted', {}], ['elevated', elevatedPermissions]]) {
    for (const method of ['POST', 'GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
      test(`${role} team cannot delegate ${method} ${path} through the Fetch proxy`, async () => {
        const f = fixture(permissions);
        const response = await f.handler(new Request(`https://proxy-fixture.invalid${path}?runId=fixture-run`, {
          method,
          headers: { 'x-pbk-team-token': 'fixture-team-session', 'content-type': 'application/json' },
          ...(['GET', 'HEAD'].includes(method) ? {} : { body: '{}' }),
        }));
        assert.equal(response.status, 403);
        assert.deepEqual(f.calls, [], 'Founder-only routes must not verify or forward a delegated request');
        if (method !== 'HEAD') assert.equal((await response.json()).code, 'qualification_founder_auth_required');
      });
    }
  }

  for (const target of [path, `${path}/`, `${path}?runId=fixture-run`, path.replaceAll('/', '%2F')]) {
    test(`legacy proxy rejects elevated team delegation of normalized ${target}`, async () => {
      const f = fixture(elevatedPermissions, false);
      const response = await f.handler({
        httpMethod: 'POST',
        path: '/.netlify/functions/pbk-bridge-proxy',
        queryStringParameters: { path: target },
        headers: { 'x-pbk-team-token': 'fixture-team-session' },
        body: '{}',
      });
      assert.equal(response.statusCode, 403);
      assert.equal(JSON.parse(response.body).code, 'qualification_founder_auth_required');
      assert.deepEqual(f.calls, []);
    });
  }

  test(`a caller-supplied bearer cannot enable Netlify delegation of ${path}`, async () => {
    const f = fixture(elevatedPermissions);
    const response = await f.handler(new Request(`https://proxy-fixture.invalid${path}`, {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-client-authority' },
      body: '{}',
    }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'qualification_founder_auth_required');
    assert.deepEqual(f.calls, []);
  });
}

for (const path of ['/api/agents/controlled-qualification-history', '/api/admin/qualification/runs']) {
  test(`qualification boundary does not block adjacent route ${path}`, async () => {
    const f = fixture(elevatedPermissions);
    const response = await f.handler(new Request(`https://proxy-fixture.invalid${path}`, {
      method: 'POST',
      headers: { 'x-pbk-team-token': 'fixture-team-session' },
      body: '{}',
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(f.calls.map(call => call.path), ['/api/auth/team/verify', path]);
  });
}
