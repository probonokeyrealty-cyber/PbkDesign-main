import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createProxyFixture } from './fixtures/netlify-proxy-qa.mjs';

const event = (method = 'GET') => ({
  httpMethod: method,
  path: '/.netlify/functions/pbk-bridge-proxy',
  queryStringParameters: { path: method === 'GET' ? '/api/leads' : '/api/approvals/fixture' },
  headers: { 'x-pbk-team-token': 'fixture-team-session' },
  body: method === 'GET' ? null : JSON.stringify({ status: 'approved' }),
});

test('large lead rosters are serialized compactly without losing records or fields', async () => {
  const leads = Array.from({ length: 1256 }, (_, id) => ({
    id: `lead-${id}`,
    name: `Seller ${id}`,
    notes: 'x'.repeat(1900),
    facts: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, i])),
  }));
  const payload = { ok: true, leads, leadImports: leads };
  const pretty = JSON.stringify(payload, null, 2);
  assert.ok(Buffer.byteLength(pretty) > 6_000_000, 'Fixture must reproduce the oversized transport');
  const handler = createProxyFixture(async target => new Response(
    new URL(target).pathname === '/api/auth/team/verify'
      ? JSON.stringify({ ok: true, permissions: {} }) : pretty,
    { headers: { 'content-type': 'application/json' } },
  ));
  const response = await handler(event());
  assert.equal(response.statusCode, 200);
  assert.ok(Buffer.byteLength(response.body) < 6_000_000, 'Roster must fit the hosted response limit');
  assert.deepEqual(JSON.parse(response.body), payload, 'Keep every lead and compatibility alias');
});

for (const status of [429, 500, 502, 503, 504]) {
  for (const method of ['GET', 'PUT']) test(`${status} verifier outage blocks ${method} without claiming session revocation`, async () => {
    const calls = [];
    const handler = createProxyFixture(async target => {
      calls.push(new URL(target).pathname);
      return new Response('<html>Fixture upstream unavailable</html>', { status });
    });
    const response = await handler(event(method));
    assert.equal(response.statusCode, status);
    assert.equal(JSON.parse(response.body).code, 'team_auth_verification_unavailable');
    assert.deepEqual(calls, ['/api/auth/team/verify'], 'An unverified request must not reach its protected target');
  });
}

for (const payload of [{}, { ok: false }, { ok: 'true' }, null]) {
  test(`malformed 200 verifier response fails closed: ${JSON.stringify(payload)}`, async () => {
    const calls = [];
    const handler = createProxyFixture(async target => {
      calls.push(new URL(target).pathname);
      return Response.json(payload);
    });
    const response = await handler(event());
    assert.equal(response.statusCode, 502);
    assert.equal(JSON.parse(response.body).code, 'team_auth_verification_unavailable');
    assert.deepEqual(calls, ['/api/auth/team/verify']);
  });
}

for (const code of ['team_auth_required', 'invalid_team_session', 'invalid_team_session_payload', 'expired_team_session', 'missing_team_session']) {
  test(`explicit 401 ${code} still rejects the team session`, async () => {
    const handler = createProxyFixture(async () => Response.json({ ok: false, code }, { status: 401 }));
    const response = await handler(event());
    assert.equal(response.statusCode, 401);
    assert.equal(JSON.parse(response.body).code, code);
  });
}

test('upstream bridge-auth failure is not proof that the team session was revoked', async () => {
  const handler = createProxyFixture(async () => Response.json({ ok: false, code: 'unauthorized' }, { status: 401 }));
  const response = await handler(event());
  assert.equal(response.statusCode, 502);
  assert.equal(JSON.parse(response.body).code, 'team_auth_verification_unavailable');
});

test('a positively verified session forwards the protected request exactly once', async () => {
  const calls = [];
  const handler = createProxyFixture(async target => {
    const path = new URL(target).pathname;
    calls.push(path);
    return Response.json(path === '/api/auth/team/verify' ? { ok: true, permissions: {} } : { ok: true, leads: [] });
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, ['/api/auth/team/verify', '/api/leads']);
});
