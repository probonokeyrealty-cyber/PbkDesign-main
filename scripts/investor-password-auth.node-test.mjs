import test from 'node:test';
import assert from 'node:assert/strict';
import { portalProfile } from '../supabase/functions/pbk-investor-staging/releaseProfile.mjs';
import { emptyState } from '../supabase/functions/pbk-investor-staging/domain.mjs';

globalThis.Deno = {
  env: { get: (key) => (key === 'SUPABASE_URL' ? 'https://qa-provider.example' : 'fixture-only') },
};
const { createPortalHandler } =
  await import('../supabase/functions/pbk-investor-staging/server.ts');
const profile = portalProfile('live');

async function fixture(run, { approved = true, role = 'investor', valid = true } = {}) {
  let state = emptyState();
  const email = 'buyer@example.invalid';
  state.members.buyer = { email, approved, role };
  const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`;
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, body: init.body, headers: init.headers });
    if (path === '/rest/v1/' + profile.table)
      return Response.json([{ revision: 1, data: structuredClone(state) }]);
    if (path === '/rest/v1/rpc/' + profile.commitRpc) {
      state = JSON.parse(init.body).next_data;
      return Response.json(true);
    }
    if (path === '/auth/v1/token')
      return Response.json(valid ? { access_token: token } : { msg: 'private provider detail' }, {
        status: valid ? 200 : 400,
      });
    if (path === '/auth/v1/user')
      return Response.json({ id: 'buyer', email, email_confirmed_at: '2026-11-15' });
    if (path === '/auth/v1/recover') return Response.json({});
    throw Error(`Unexpected provider path: ${path}`);
  };
  const call = (command, payload = {}, bearer) =>
    createPortalHandler(profile)(
      new Request('https://qa-provider.example/functions/v1/' + profile.functionName, {
        method: 'POST',
        headers: {
          Origin: profile.publicOrigin,
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ command, payload }),
      })
    );
  try {
    await run({ call, calls, token, email });
  } finally {
    globalThis.fetch = original;
  }
}

test('password login uses Auth and registers only an approved investor session', async () =>
  fixture(async ({ call, calls, email }) => {
    const r = await call('authPassword', { email, password: 'fixture-only-password' });
    const data = await r.json();
    assert.equal(r.status, 200, JSON.stringify(data));
    assert.ok(data.token);
    assert.ok(data.expiresIn > 0 && data.expiresIn <= 3600);
    assert.equal(calls.filter((c) => c.path === '/auth/v1/token').length, 1);
    assert.equal((await call('session', {}, data.token)).status, 200);
  }));

for (const options of [{ approved: false }, { role: 'reviewer' }])
  test(`password login cannot bypass approval or staff isolation: ${JSON.stringify(options)}`, async () =>
    fixture(async ({ call, email }) => {
      const r = await call('authPassword', { email, password: 'fixture-only-password' });
      assert.equal(r.status, 403);
      assert.equal((await r.json()).token, undefined);
    }, options));

test('invalid credentials do not disclose provider errors', async () =>
  fixture(
    async ({ call, email }) => {
      const r = await call('authPassword', { email, password: 'wrong-password' });
      assert.equal(r.status, 401);
      assert.doesNotMatch(JSON.stringify(await r.json()), /private provider detail/);
    },
    { valid: false }
  ));

test('recovery is approval-gated and has a generic response for unknown emails', async () =>
  fixture(async ({ call, calls, email }) => {
    const denied = await call('recoverPassword', { email: 'unknown@example.invalid' });
    assert.equal(denied.status, 200);
    assert.equal(calls.filter((c) => c.path === '/auth/v1/recover').length, 0);
    const allowed = await call('recoverPassword', { email });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await denied.json(), await allowed.json());
    assert.equal(calls.filter((c) => c.path === '/auth/v1/recover').length, 1);
  }));

test('setting a password requires a verified approved session and never returns the password', async () =>
  fixture(async ({ call, email, calls }) => {
    assert.equal((await call('setPassword', { password: 'fixture-only-password' })).status, 401);
    const login = await (
      await call('authPassword', { email, password: 'fixture-only-password' })
    ).json();
    assert.equal((await call('setPassword', { password: 'short' }, login.token)).status, 400);
    const result = await call('setPassword', { password: 'fixture-new-password' }, login.token);
    assert.equal(result.status, 200);
    assert.doesNotMatch(JSON.stringify(await result.json()), /fixture-new-password/);
    const write = calls.find((c) => c.path === '/auth/v1/user' && c.method === 'PUT');
    assert.ok(write);
    assert.equal(write.headers.Authorization, `Bearer ${login.token}`);
  }));
