import test from 'node:test';
import assert from 'node:assert/strict';
import {
  execute,
  emptyState,
  verificationInput,
} from '../supabase/functions/pbk-investor-staging/domain.mjs';

const fixture = () => {
  const s = emptyState();
  s.members = {
    editor: { role: 'editor', approved: true },
    reviewer: { role: 'reviewer', approved: true },
    alice: { role: 'investor', approved: true },
    bob: { role: 'investor', approved: true },
    pending: { role: 'investor', approved: false },
  };
  return s;
};
const data = {
  title: 'Fictional QA house',
  address: '100 Sample Street',
  city: 'Demo City',
  state: 'CA',
  zip: '00123',
  market: 'Demo',
  assetType: 'Single-family',
  askingCents: 25000000,
  beds: 3,
  baths: 2,
  sqft: 1400,
  summary: 'Fictional staging record only',
  source: 'Internal fictional QA',
  checkedAt: '2026-11-13',
  owner: 'QA editor',
  fictional: true,
  internalNotes: 'PRIVATE SELLER NOTE',
  checks: { address: true, sources: true, estimates: true, rights: true, privacy: true },
};
function run(s, uid, command, payload = {}) {
  return execute(s, uid, command, payload);
}
function released() {
  let s = fixture();
  const saved = run(s, 'editor', 'save', { draft: data });
  s = saved.state;
  const id = saved.result.property.id;
  s = run(s, 'reviewer', 'preview', { id }).state;
  s = run(s, 'reviewer', 'release', { id, revision: 1 }).state;
  return { s, id };
}
test('anonymous, pending and unknown actors cannot read inventory', () => {
  const s = fixture();
  for (const uid of [null, 'pending', 'stranger'])
    assert.throws(() => run(s, uid, 'list'), /not approved|Sign in/);
});
test('editor saves persistent draft but cannot release; investor sees no draft', () => {
  let s = fixture();
  const r = run(s, 'editor', 'save', { draft: data });
  s = r.state;
  assert.equal(run(s, 'alice', 'list').result.properties.length, 0);
  assert.throws(() => run(s, 'alice', 'property', { id: r.result.property.id }), /not available/);
  assert.throws(
    () => run(s, 'editor', 'release', { id: r.result.property.id, revision: 1 }),
    /Reviewer/
  );
});
test('release requires preview and checklist; published response omits internal fields', () => {
  let s = fixture();
  const r = run(s, 'editor', 'save', { draft: data });
  s = r.state;
  const id = r.result.property.id;
  assert.throws(() => run(s, 'reviewer', 'release', { id, revision: 1 }), /Preview/);
  s = run(s, 'reviewer', 'preview', { id }).state;
  const released = run(s, 'reviewer', 'release', { id, revision: 1 });
  const body = JSON.stringify(run(released.state, 'alice', 'property', { id }).result);
  assert.ok(!body.includes('PRIVATE SELLER NOTE'));
  assert.ok(!body.includes('internalNotes'));
  assert.ok(!body.includes('owner'));
  assert.equal(JSON.parse(body).property.zip, '00123');
});
test('draft changes do not overwrite published snapshot and stale saves fail', () => {
  let { s, id } = released();
  s = run(s, 'editor', 'save', { id, revision: 2, draft: { ...data, title: 'New draft' } }).state;
  assert.equal(run(s, 'alice', 'property', { id }).result.property.title, data.title);
  assert.throws(() => run(s, 'editor', 'save', { id, revision: 2, draft: data }), /changed/);
});
test('inquiry retries create one record; payload mismatch fails; history is private', () => {
  let { s, id } = released();
  const payload = {
    id,
    version: 1,
    key: 'qa-key-123456789',
    message: 'No-outreach internal QA',
    proposedCents: null,
    timing: '15–30 days',
  };
  const a = run(s, 'alice', 'inquire', payload);
  const b = run(a.state, 'alice', 'inquire', payload);
  assert.equal(a.result.inquiry.id, b.result.inquiry.id);
  assert.equal(Object.keys(b.state.inquiries).length, 1);
  assert.equal(run(b.state, 'bob', 'inquiries').result.inquiries.length, 0);
  assert.throws(
    () => run(b.state, 'alice', 'inquire', { ...payload, message: 'Changed payload' }),
    /different/
  );
});
test('withdraw/revoke remove buyer access and preserve audit and inquiries', () => {
  let { s, id } = released();
  s = run(s, 'alice', 'inquire', {
    id,
    version: 1,
    key: 'qa-key-123456789',
    message: 'No outreach',
  }).state;
  const count = s.audit.length;
  s = run(s, 'reviewer', 'withdraw', { id, revision: 2 }).state;
  assert.equal(run(s, 'alice', 'list').result.properties.length, 0);
  assert.equal(Object.keys(s.inquiries).length, 1);
  assert.ok(s.audit.length > count);
  s.members.alice.approved = false;
  assert.throws(() => run(s, 'alice', 'inquiries'), /not approved/);
});
test('validation rejects unsafe monetary values, invalid sources and HTML is plain text', () => {
  for (const patch of [
    { askingCents: -1 },
    { askingCents: Infinity },
    { checkedAt: 'bad' },
    { source: '' },
  ])
    assert.throws(
      () => run(fixture(), 'editor', 'save', { draft: { ...data, ...patch } }),
      /valid|source|date|price/i
    );
  const r = run(fixture(), 'editor', 'save', {
    draft: { ...data, summary: '<script>bad</script>' },
  });
  assert.equal(r.result.property.draft.summary, '<script>bad</script>');
});
test('investors cannot mutate staff data, member roles or inspect audit', () => {
  let { s, id } = released();
  for (const command of ['save', 'release', 'withdraw', 'preview', 'history', 'members'])
    assert.throws(
      () => run(s, 'alice', command, { id, draft: data, revision: 2 }),
      /Staff|Reviewer/
    );
});

test('reviewer approval is email-scoped, cannot create staff, and revocation denies access', () => {
  let s = fixture();
  assert.throws(
    () => run(s, 'editor', 'approveInvestor', { email: 'new@example.com' }),
    /Reviewer/
  );
  s = run(s, 'reviewer', 'approveInvestor', { email: 'new@example.com', role: 'reviewer' }).state;
  assert.equal(s.invitations['new@example.com'].role, 'investor');
  assert.throws(
    () => run(s, 'alice', 'approveInvestor', { email: 'intruder@example.com' }),
    /Reviewer/
  );
  s = run(s, 'reviewer', 'revokeInvestor', {
    email: (s.members.alice.email = 'alice@example.com'),
  }).state;
  assert.throws(() => run(s, 'alice', 'list'), /not approved/);
  assert.ok(s.audit.some((e) => e.action === 'investor_access_revoked'));
});

test('status transitions hide sold inventory and preserve historical inquiry', () => {
  let { s, id } = released();
  s = run(s, 'alice', 'inquire', {
    id,
    version: 1,
    key: 'test-status-key-12345',
    message: 'NO OUTREACH QA',
  }).state;
  assert.throws(
    () => run(s, 'editor', 'status', { id, revision: 2, status: 'Under contract' }),
    /Reviewer/
  );
  s = run(s, 'reviewer', 'status', { id, revision: 2, status: 'Under review' }).state;
  assert.equal(run(s, 'alice', 'list').result.properties.length, 1);
  s = run(s, 'reviewer', 'status', { id, revision: 3, status: 'Under contract' }).state;
  assert.equal(run(s, 'alice', 'list').result.properties.length, 0);
  s = run(s, 'reviewer', 'status', { id, revision: 4, status: 'Sold' }).state;
  assert.equal(run(s, 'alice', 'inquiries').result.inquiries.length, 1);
  assert.ok(s.audit.some((e) => e.action === 'status_changed' && e.detail.to === 'Sold'));
});
test('email verification links are restricted to our auth provider', () => {
  const base = 'https://example.supabase.co';
  assert.deepEqual(verificationInput('TEST@example.com', '123456', base), {
    email: 'test@example.com',
    token: '123456',
    type: 'email',
  });
  assert.deepEqual(verificationInput('', base + '/auth/v1/verify?type=magiclink&token=abc', base), {
    token_hash: 'abc',
    type: 'magiclink',
  });
  assert.throws(
    () =>
      verificationInput('', 'https://evil.example/auth/v1/verify?type=magiclink&token=abc', base),
    /PBK email/
  );
  assert.throws(
    () => verificationInput('', base + '/auth/v1/verify?type=recovery&token=abc', base),
    /PBK email/
  );
});

test('inquiry rejects changed release and original retry survives later release', () => {
  let { s, id } = released();
  const input = { id, version: 1, key: 'version-test-key-12345', message: 'NO OUTREACH' };
  const first = run(s, 'alice', 'inquire', input);
  s = first.state;
  let p = s.properties[id];
  s = run(s, 'editor', 'save', {
    id,
    revision: p.revision,
    draft: { ...data, askingCents: 30000000 },
  }).state;
  s = run(s, 'reviewer', 'preview', { id }).state;
  s = run(s, 'reviewer', 'release', { id, revision: s.properties[id].revision }).state;
  assert.throws(
    () => run(s, 'alice', 'inquire', { ...input, key: 'new-version-key-12345' }),
    /changed|version/i
  );
  assert.equal(run(s, 'alice', 'inquire', input).result.inquiry.id, first.result.inquiry.id);
  assert.throws(
    () => run(s, 'alice', 'inquire', { ...input, key: 'missing-version-key', version: undefined }),
    /version/i
  );
});
test('capacity reserve permits security actions while ordinary writes fail', () => {
  let { s, id } = released();
  s.members.alice.email = 'alice@example.com';
  s.padding = 'x'.repeat(7999900 - JSON.stringify(s).length);
  assert.throws(
    () =>
      run(s, 'alice', 'inquire', {
        id,
        version: 1,
        key: 'capacity-test-key-12345',
        message: 'NO OUTREACH',
      }),
    /capacity/
  );
  const revoked = run(s, 'reviewer', 'revokeInvestor', { email: 'alice@example.com' }).state;
  assert.equal(revoked.members.alice.approved, false);
  const withdrawn = run(s, 'reviewer', 'withdraw', {
    id,
    revision: s.properties[id].revision,
  }).state;
  assert.equal(run(withdrawn, 'alice', 'list').result.properties.length, 0);
});
