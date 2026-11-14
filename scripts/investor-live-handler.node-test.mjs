import test from 'node:test';
import assert from 'node:assert/strict';
import { portalProfile } from '../supabase/functions/pbk-investor-staging/releaseProfile.mjs';
import { emptyState, execute } from '../supabase/functions/pbk-investor-staging/domain.mjs';
globalThis.Deno = {
  env: { get: (key) => (key === 'SUPABASE_URL' ? 'https://qa-provider.example' : 'test-only') },
};
const { createPortalHandler } =
  await import('../supabase/functions/pbk-investor-staging/server.ts');
test('live handler uses only live state and bucket for real multipart upload', async () => {
  const profile = portalProfile('live');
  let state = emptyState();
  state.members.staff = { role: 'reviewer', email: 'staff@example.com', approved: true };
  let r = execute(state, 'staff', 'save', {
    draft: {
      title: 'Fictional handler QA',
      address: '100 QA St',
      city: 'Demo City',
      state: 'CA',
      zip: '00123',
      market: 'QA',
      owner: 'QA staff',
      assetType: 'Single-family',
      source: 'Owned QA data',
      checkedAt: '2026-11-14',
      fictional: true,
      checks: {},
    },
  });
  state = r.state;
  const property = r.result.property;
  const token = 'qa-handler-token';
  const hash = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  ).toString('hex');
  state.sessions = { [hash]: { uid: 'staff', expiresAt: Date.now() + 60000 } };
  const original = globalThis.fetch,
    routes = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    routes.push(path);
    if (path === '/rest/v1/' + profile.table)
      return Response.json([{ revision: 0, data: structuredClone(state) }]);
    if (path === '/rest/v1/rpc/' + profile.commitRpc) {
      state = JSON.parse(options.body).next_data;
      return Response.json(true);
    }
    if (path === '/auth/v1/user') return Response.json({ id: 'staff', email: 'staff@example.com' });
    if (path.startsWith('/storage/v1/object/' + profile.bucket + '/'))
      return Response.json({ Key: 'qa' });
    throw Error('Unexpected provider route: ' + path);
  };
  try {
    const body = new FormData();
    body.set('id', property.id);
    body.set('revision', String(property.revision));
    body.set(
      'file',
      new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], { type: 'image/png' }),
      'qa.png'
    );
    body.set('rights', 'PBK-owned QA');
    body.set('alt', 'QA image');
    body.set('buyerVisible', 'true');
    const response = await createPortalHandler(profile)(
      new Request('https://qa-provider.example/functions/v1/' + profile.functionName, {
        method: 'POST',
        headers: { Origin: profile.staffOrigin, Authorization: 'Bearer ' + token },
        body,
      })
    );
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.property.assets.length, 1);
    assert(routes.every((p) => !p.includes('staging')));
    assert(routes.some((p) => p.startsWith('/storage/v1/object/' + profile.bucket + '/')));
    assert.equal(Object.keys(state.pendingUploads).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
