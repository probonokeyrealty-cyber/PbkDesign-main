// Explicit founder-approved first release: carry existing real approvals, never staging data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {
  seedLiveState,
  portalProfile,
} from '../supabase/functions/pbk-investor-staging/releaseProfile.mjs';
const base = process.env.PBK_SUPABASE_URL?.replace(/\/$/, '');
const service = process.env.PBK_SUPABASE_SERVICE_ROLE_KEY;
assert.equal(base, 'https://asumndiooctluuecydhj.supabase.co');
assert.ok(service);
const live = portalProfile('live'),
  staging = portalProfile('staging');
async function provider(path, body) {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      apikey: service,
      Authorization: 'Bearer ' + service,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(r.ok, 'Live bootstrap provider failed: ' + r.status);
  return r.json();
}
const [source] = await provider(
  `/rest/v1/${staging.table}?id=eq.${staging.stateId}&select=revision,data`
);
const [target] = await provider(
  `/rest/v1/${live.table}?id=eq.${live.stateId}&select=revision,data`
);
assert.equal(target.revision, 0, 'Live state is already initialized; never reset a live portal.');
for (const key of ['members', 'properties', 'sessions', 'inquiries'])
  assert.equal(Object.keys(target.data[key] || {}).length, 0, 'Live target must be empty: ' + key);
const data = seedLiveState(source.data);
assert.ok(
  Object.values(data.members).some((m) => m.role === 'reviewer'),
  'An existing approved real reviewer is required.'
);
data.audit.push({
  id: crypto.randomUUID(),
  actor: 'founder-approved-live-release',
  action: 'live_memberships_initialized',
  entityId: 'live',
  at: new Date().toISOString(),
  detail: { members: Object.keys(data.members).length },
});
assert.equal(
  await provider('/rest/v1/rpc/' + live.commitRpc, {
    expected_revision: target.revision,
    next_data: data,
  }),
  true
);
const report = {
  at: new Date().toISOString(),
  liveTable: live.table,
  approvedRealMembers: Object.keys(data.members).length,
  roles: Object.values(data.members).map((m) => m.role),
  propertiesCopied: 0,
  sessionsCopied: 0,
  inquiriesCopied: 0,
  invitationsCopied: 0,
  stagingWritten: false,
};
await fs.writeFile('.pbk-local/investor-live-bootstrap.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
