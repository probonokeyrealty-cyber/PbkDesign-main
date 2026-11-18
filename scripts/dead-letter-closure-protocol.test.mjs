import { jest } from '@jest/globals';
import { createHmac } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';
import {
  DEAD_LETTER_CLOSURE_POLICY, DEAD_LETTER_CLOSURE_LIMITS, closureBinding,
  validateClosureManifest, createClosureIntent, verifyClosureIntent,
  projectClosureApproval, signClosureReceipt, verifyClosureReceipt,
} from './dead-letter-closure-protocol.mjs';
import { makeClosureFixture } from './fixtures/dead-letter-closure-fixture.mjs';

// Keep plain-object prototypes in Jest's VM realm, as with parsed PG JSON.
const clone = (v) => JSON.parse(JSON.stringify(v));
const guards = { counts: null, noContact: true, providerWritesBlocked: true,
  deliveryRetries: false, providerDeliveryVerified: false, launchQualified: false };
const verify = (f) => verifyClosureReceipt({ row: f.row, secret: f.secret, revision: f.revision, now: f.now });
const verifyIntent = (f, overrides = {}) => verifyClosureIntent({ intent: f.intent, approvalId: f.approvalId,
  secret: f.secret, revision: f.revision, now: f.now, ...overrides });
const create = (f, overrides = {}) => createClosureIntent({ approvalId: f.approvalId, action: f.intent.action,
  recordRef: f.manifest.recordRef, manifest: f.manifest, predecessor: f.intent.predecessor,
  revision: f.revision, createdAt: f.intent.createdAt, secret: f.secret, ...overrides });
function denied(result) {
  expect(result).toEqual({ ok: false, verified: false, result: expect.any(String), ...guards });
}

test('strict shapes and scope', () => {
  const f = makeClosureFixture();
  expect(DEAD_LETTER_CLOSURE_POLICY).toEqual({ version: 'dead-letter-handler-v1',
    requiredSteps: ['qa', 'memory', 'scriptOutcome'], minimumChars: 80, embeddingDimensions: 1536 });
  expect(Object.isFrozen(DEAD_LETTER_CLOSURE_POLICY)).toBe(true);
  expect(Object.isFrozen(DEAD_LETTER_CLOSURE_POLICY.requiredSteps)).toBe(true);
  expect(DEAD_LETTER_CLOSURE_LIMITS).toEqual({ maxRecords: 64, sentinelRecords: 65, maxBytes: 65536,
    queryMs: 2000, collectionMs: 15000, executionMs: 60000, intentAgeMs: 86400000, maxDepth: 16, maxNodes: 10000 });
  expect(Object.isFrozen(DEAD_LETTER_CLOSURE_LIMITS)).toBe(true);
  expect(validateClosureManifest(f.manifest)).toBe(true);
  expect(verifyIntent(f)).toEqual({ ok: true, verified: true, result: 'closure_intent_verified', ...guards, intent: f.intent });
  expect(verify(f)).toEqual({ ok: true, verified: true, result: 'closure_receipt_authenticated', ...guards, receipt: f.report });
  expect(f.intent.expiresAt).toBe('2026-11-18T11:59:50.000Z');
  const { attestation: intentSignature, ...intentBody } = f.intent;
  const intentKey = createHmac('sha256', f.secret).update('pbk.dead-letter-closure.intents.key.v1').digest();
  expect(intentSignature.signature).toBe(createHmac('sha256', intentKey)
    .update(`pbk-dead-letter-closure-intent-v1\n${canonicalJson(intentBody)}`).digest('hex'));
  for (const target of ['intent', 'manifest', 'step', 'predecessor', 'attestation', 'report', 'row', 'guard']) {
    const x = makeClosureFixture({ action: 'revoke_internal' });
    const object = { intent: x.intent, manifest: x.manifest, step: x.manifest.steps[0],
      predecessor: x.intent.predecessor, attestation: x.report.attestation, report: x.report, row: x.row, guard: x.report.guard }[target];
    object.unknown = 'denied';
    denied(verify(x));
  }
  for (const scope of ['row', 'report', 'intent']) {
    const x = makeClosureFixture();
    if (scope === 'row') x.row.tenant_id = 'other';
    else x[scope].tenantId = 'other';
    denied(verify(x));
    if (scope !== 'row') expect(() => signClosureReceipt({ report: x.report, secret: x.secret })).toThrow('dead_letter_closure_invalid');
  }
  const hidden = clone(f.manifest);
  Object.defineProperty(hidden, 'hidden', { value: true });
  expect(validateClosureManifest(hidden)).toBe(false);
  expect(() => signClosureReceipt({ report: { arbitrary: true }, secret: f.secret })).toThrow();
  expect(() => create(f, { action: 'provider_action' })).toThrow();
  expect(() => create(f, { approvalId: 'bad id' })).toThrow();
  expect(() => create(f, { revision: 'short' })).toThrow();
  denied(verifyIntent(f, { unexpected: true }));
  const effectiveStatus = clone(f.report); effectiveStatus.effectiveStatus = 'closed';
  expect(() => signClosureReceipt({ report: effectiveStatus, secret: f.secret })).toThrow();
  for (const key of ['decisionBinding', 'intent', 'manifest', 'guard', 'approvalExpiresAt']) {
    const missing = clone(f.report); delete missing[key];
    expect(() => signClosureReceipt({ report: missing, secret: f.secret })).toThrow();
  }
  expect(() => signClosureReceipt({ report: f.report, secret: f.secret, unknown: true })).toThrow();
  expect(() => createClosureIntent({ approvalId: f.approvalId, action: f.intent.action,
    recordRef: f.manifest.recordRef, manifest: f.manifest, predecessor: null,
    revision: f.revision, createdAt: f.intent.createdAt, secret: f.secret, unknown: true })).toThrow();
});

test('tampered binding denied', () => {
  const f = makeClosureFixture();
  expect(closureBinding(f.secret, 'manifest', { b: 2, a: 1 })).toBe(closureBinding(f.secret, 'manifest', { a: 1, b: 2 }));
  expect(closureBinding(f.secret, 'manifest', 'x')).not.toBe(closureBinding(f.secret, 'intent', 'x'));
  expect(closureBinding('different test material', 'manifest', 'x')).not.toBe(closureBinding(f.secret, 'manifest', 'x'));
  const expectedKey = createHmac('sha256', f.secret).update('pbk.dead-letter-closure.bindings.key.v1').digest();
  expect(closureBinding(f.secret, 'manifest', { a: 1 })).toBe(createHmac('sha256', expectedKey)
    .update(`pbk.dead-letter-closure.binding.v1\nmanifest\n${canonicalJson({ a: 1 })}`).digest('hex'));
  for (const key of ['recordRef', 'originalBinding', 'manifestBinding', 'approvalRef', 'intentBinding', 'decisionBinding']) {
    const x = makeClosureFixture();
    x.report[key] = '0'.repeat(64);
    denied(verify(x));
  }
  for (const key of ['ordinal', 'admitted_at', 'insert_xid', 'record_ref', 'approval_ref', 'intent_binding', 'action', 'previous_id', 'id']) {
    const x = makeClosureFixture();
    x.row[key] = key === 'previous_id' ? 'receipt_other' : 'changed';
    denied(verify(x));
  }
  for (const path of ['selectionBinding', 'binding', 'signature']) {
    const x = makeClosureFixture();
    if (path === 'selectionBinding') x.manifest.selectionBinding = '0'.repeat(64);
    if (path === 'binding') x.manifest.steps[0].binding = '0'.repeat(64);
    if (path === 'signature') x.report.attestation.signature = '0'.repeat(64);
    denied(verify(x));
  }
  denied(verifyClosureReceipt({ row: f.row, secret: 'wrong test material', revision: f.revision, now: f.now }));
  const x = makeClosureFixture();
  x.manifest.steps[2].binding = '0'.repeat(64);
  expect(() => create(x)).toThrow();
  expect(signClosureReceipt({ report: f.report, secret: f.secret })).toBe(f.report.attestation.signature);
  const unsigned = clone(f.report); delete unsigned.attestation;
  expect(signClosureReceipt({ report: unsigned, secret: f.secret })).toBe(f.report.attestation.signature);
  const key = createHmac('sha256', f.secret).update('pbk.dead-letter-closure.receipts.key.v1').digest();
  expect(f.report.attestation.signature).toBe(createHmac('sha256', key)
    .update(`pbk-dead-letter-closure-v1\n${canonicalJson(unsigned)}`).digest('hex'));
  expect(closureBinding(f.secret, 'intent', f.intent)).not.toBe(f.intent.attestation.signature);
});

test('expiry controls admission not committed receipt lifetime', () => {
  const f = makeClosureFixture();
  const expires = Date.parse(f.intent.expiresAt);
  expect(verifyIntent(f, { now: expires - 1 }).verified).toBe(true);
  denied(verifyIntent(f, { now: expires }));
  denied(verifyIntent(f, { now: Date.parse(f.intent.createdAt) - 1 }));
  f.now = expires + 100 * 86400000;
  expect(verify(f).verified).toBe(true);
  const result = verify(f);
  expect(result).toMatchObject(guards);
  expect(Object.keys(result).sort()).toEqual([...Object.keys(guards), 'ok', 'verified', 'result', 'receipt'].sort());
  expect(result).not.toHaveProperty('handlerReady');
  expect(result).not.toHaveProperty('deliveryReady');
  expect(result.launchQualified).toBe(false);
  // An authenticated historical receipt contains no current source-proof claim.
  expect(result.receipt.manifest.steps[0].executedAt).toBe('2026-11-17T11:59:40.000Z');
  const mutations = [
    (r) => { r.observedAt = r.intent.expiresAt; },
    (r) => { r.admittedAt = r.intent.expiresAt.replace('.000Z', '.000000Z'); },
    (r) => { r.completedAt = r.intent.expiresAt; r.observedAt = '2026-11-18T11:59:49.000Z'; r.admittedAt = '2026-11-18T11:59:50.000001Z'; },
    (r) => { r.completedAt = '2026-11-17T12:01:00.001Z'; },
    (r) => { r.admittedAt = '2026-11-17T11:59:59.999999Z'; },
    (r) => { r.admittedAt = '2026-11-17T12:00:00.500001Z'; },
    (r) => { r.manifest.steps[0].executedAt = '2026-11-17T12:00:00.001Z'; },
  ];
  for (const mutate of mutations) {
    const x = makeClosureFixture(); mutate(x.report);
    expect(() => signClosureReceipt({ report: x.report, secret: x.secret })).toThrow();
    denied(verify(x));
  }
  denied(verifyClosureReceipt({ row: f.row, secret: f.secret, revision: f.revision, now: Date.parse(f.report.completedAt) - 1 }));
  const boundary = makeClosureFixture();
  boundary.report.admittedAt = '2026-11-17T12:00:00.000000Z';
  boundary.report.completedAt = '2026-11-17T12:01:00.000Z';
  boundary.report.attestation.signature = signClosureReceipt({ report: boundary.report, secret: boundary.secret });
  boundary.row.admitted_at = boundary.report.admittedAt;
  boundary.now = Date.parse(boundary.report.completedAt);
  expect(verify(boundary).verified).toBe(true);
});

test('execution metadata is not decision authority', () => {
  const f = makeClosureFixture();
  const projected = projectClosureApproval(f.approval);
  expect(projected).toEqual({ id: f.approvalId, workspaceId: 'pbk', type: 'admin',
    action: 'dead_letter_internal_closure', status: 'approved', decidedAt: f.approval.decided_at, intent: f.intent });
  const changed = clone(f.approval);
  changed.updated_at = '2026-11-18T12:00:00.000Z';
  changed.payload.actor = 'untrusted actor label';
  changed.payload.metadata.executionHistory = [{ status: 'success', providerReady: true }];
  expect(projectClosureApproval(changed)).toEqual(projected);
  expect(closureBinding(f.secret, 'approval-decision', projectClosureApproval(changed))).toBe(f.report.decisionBinding);
  const dated = clone(f.approval);
  for (const key of ['decided_at', 'created_at', 'updated_at']) dated[key] = new Date(dated[key]);
  expect(projectClosureApproval(dated)).toEqual(projected);
  const micro = clone(f.approval); micro.decided_at = '2026-11-17T11:59:55.000000Z';
  expect(projectClosureApproval(micro)).toEqual(projected);
  const mutations = [
    (a) => { delete a.decided_at; }, (a) => { a.decided_at = null; },
    (a) => { a.status = 'pending'; }, (a) => { a.type = 'provider-action'; },
    (a) => { a.workspace_id = 'other'; }, (a) => { a.payload.workspaceId = 'other'; },
    (a) => { a.payload.metadata.tenant_id = 'other'; }, (a) => { a.payload.id = 'another'; },
    (a) => { a.payload.type = 'call'; }, (a) => { a.payload.status = 'pending'; },
    (a) => { a.payload.approvalAction = 'provider_action'; },
    (a) => { a.payload.decidedAt = '2026-11-17T11:59:56.000Z'; },
    (a) => { a.decided_at = '2026-11-17T11:59:55.000001Z'; },
    (a) => { a.lead_id = 'lead'; }, (a) => { a.payload.contractId = 'contract'; },
    (a) => { a.payload.metadata.deadLetterClosureIntent.extra = 'no'; },
    (a) => { a.created_at = new Date(NaN); },
    (a) => { a.payload.metadata.date = new Date(); },
    (a) => { a.payload.actedAt = null; },
    (a) => { delete a.payload.actedAt; },
    (a) => { a.payload.metadata = []; },
    (a) => { a.payload.metadata.deadLetterClosureIntent = null; },
  ];
  for (const mutate of mutations) { const a = clone(f.approval); mutate(a); expect(projectClosureApproval(a)).toBeNull(); }
  const alias = clone(f.approval); alias.payload.decidedAt = alias.payload.actedAt; delete alias.payload.actedAt;
  expect(projectClosureApproval(alias)).toEqual(projected);
  const moved = clone(f.approval);
  moved.decided_at = moved.payload.actedAt = '2026-11-17T11:59:56.000Z';
  expect(closureBinding(f.secret, 'approval-decision', projectClosureApproval(moved))).not.toBe(f.report.decisionBinding);
});

test('revoked or changed intent denied', () => {
  const f = makeClosureFixture();
  for (const key of ['action', 'recordRef', 'originalBinding', 'manifestBinding', 'approvalRef', 'revision', 'expiresAt', 'tenantId']) {
    const x = makeClosureFixture(); x.intent[key] = 'changed'; denied(verifyIntent(x)); denied(verify(x));
  }
  denied(verifyIntent(f, { approvalId: 'different_approval' }));
  denied(verifyIntent(f, { revision: 'c'.repeat(40) }));
  denied(verifyClosureReceipt({ row: f.row, secret: f.secret, revision: 'c'.repeat(40), now: f.now }));
  const revoked = clone(f.approval); revoked.status = revoked.payload.status = 'revoked';
  expect(projectClosureApproval(revoked)).toBeNull();
  const withdrawal = makeClosureFixture({ action: 'revoke_internal' });
  expect(verify(withdrawal).verified).toBe(true);
  expect(withdrawal.intent.predecessor).not.toBeNull();
  expect(() => create(withdrawal, { predecessor: null })).toThrow();
  const prior = clone(withdrawal.manifest);
  // Withdrawal needs the prior manifest, not a lookup of still-existing artifacts.
  expect(create(withdrawal, { manifest: prior })).toEqual(withdrawal.intent);
  withdrawal.report.predecessor.hash = '0'.repeat(64);
  denied(verify(withdrawal));
});

test('manifest privacy', () => {
  const f = makeClosureFixture();
  for (const [id, outcome] of [['qa', 'completed'], ['memory', 'completed'], ['memory', 'skipped_short_source'], ['scriptOutcome', 'not_applicable']]) {
    const x = makeClosureFixture({ memory: id === 'memory' ? outcome : 'completed' });
    expect(validateClosureManifest(x.manifest)).toBe(true);
    expect(verify(x).verified).toBe(true);
  }
  const mutations = [
    (m) => { m.source = { transcript: 'private' }; },
    (m) => { m.steps[0].text = 'private'; }, (m) => { m.steps.reverse(); },
    (m) => { m.steps.pop(); }, (m) => { m.steps.push(clone(m.steps[0])); },
    (m) => { m.steps[0].outcome = 'skipped_short_source'; },
    (m) => { m.steps[1].outcome = 'not_applicable'; },
    (m) => { m.steps[2].outcome = 'completed'; },
    (m) => { m.steps[0].artifactRef = null; },
    (m) => { m.steps[1].executedAt = null; },
    (m) => { m.steps[2].artifactRef = 'a'.repeat(64); },
    (m) => { m.steps[2].executedAt = '2026-11-17T11:00:00.000Z'; },
    (m) => { m.originalBinding = 'A'.repeat(64); },
    (m) => { m.steps[0].binding = 'source text'; },
    (m) => { m.selectionBinding = null; },
    (m) => { m.policyVersion = 'other'; },
  ];
  for (const mutate of mutations) {
    const x = clone(f.manifest); mutate(x);
    expect(validateClosureManifest(x)).toBe(false);
    expect(() => create(f, { manifest: x })).toThrow();
  }
  expect(JSON.stringify(f.report)).not.toMatch(/synthetic-record|synthetic-event|transcript|actor|approval_fixture/);
  expect(JSON.stringify(verify(f))).not.toMatch(/secret|approval_fixture/);
});

test('invalid clocks and hostile objects denied', () => {
  const f = makeClosureFixture();
  const getter = jest.fn(() => { throw new Error('getter executed'); });
  const accessor = {}; Object.defineProperty(accessor, 'report', { enumerable: true, get: getter });
  const proxied = new Proxy({}, { ownKeys: getter, get: getter, getPrototypeOf: getter });
  const cycle = {}; cycle.self = cycle;
  let deep = {}; for (let i = 0; i < 18; i++) deep = { child: deep };
  const hidden = {}; Object.defineProperty(hidden, 'hidden', { value: 1 });
  const symbol = { [Symbol('no')]: 1 };
  const toJSON = { toJSON: getter };
  const sparse = []; sparse.length = 5;
  const hostile = [accessor, proxied, cycle, deep, hidden, symbol, toJSON, NaN, Infinity, undefined,
    new Date(), Object.create(null), new Map(), sparse, 'x'.repeat(65537), Array(10001).fill(null),
    { first: 'x'.repeat(40000), second: 'x'.repeat(40000) }, { ['k'.repeat(65537)]: true }];
  for (const value of hostile) {
    expect(validateClosureManifest(value)).toBe(false);
    expect(() => closureBinding(f.secret, 'test', value)).toThrow();
    expect(projectClosureApproval(value)).toBeNull();
    denied(verifyClosureReceipt({ row: value, secret: f.secret, revision: f.revision, now: f.now }));
    denied(verifyClosureIntent({ intent: value, approvalId: f.approvalId, secret: f.secret, revision: f.revision, now: f.now }));
    expect(() => signClosureReceipt({ report: value, secret: f.secret })).toThrow();
  }
  for (const input of [accessor, proxied, null, cycle]) {
    denied(verifyClosureReceipt(input)); denied(verifyClosureIntent(input));
    expect(() => signClosureReceipt(input)).toThrow(); expect(() => createClosureIntent(input)).toThrow();
  }
  const arrayAccessor = clone(f.manifest);
  Object.defineProperty(arrayAccessor.steps, '0', { get: getter, enumerable: true });
  expect(validateClosureManifest(arrayAccessor)).toBe(false);
  for (const value of [accessor, proxied, cycle, hidden, symbol, toJSON]) {
    const raw = clone(f.approval); raw.payload.metadata.extra = value;
    expect(projectClosureApproval(raw)).toBeNull();
    const row = clone(f.row); row.report.manifest.steps[0].binding = value;
    denied(verifyClosureReceipt({ row, secret: f.secret, revision: f.revision, now: f.now }));
  }
  expect(getter).not.toHaveBeenCalled();
  for (const now of [NaN, Infinity, '2026-11-17', 1.5, 8640000000000001, undefined]) {
    denied(verifyIntent(f, { now }));
    denied(verifyClosureReceipt({ row: f.row, secret: f.secret, revision: f.revision, now }));
  }
  for (const createdAt of ['2026-02-30T12:00:00.000Z', '2026-11-17T12:00:00Z', '2026-11-17T12:00:00.000000Z', 'bad', NaN]) {
    expect(() => create(f, { createdAt })).toThrow();
  }
  for (const admittedAt of ['2026-02-30T12:00:00.000000Z', '2026-11-17T12:00:00.100Z', '2026-11-17T12:00:00.100000+00:00']) {
    const r = clone(f.report); r.admittedAt = admittedAt;
    expect(() => signClosureReceipt({ report: r, secret: f.secret })).toThrow();
  }
  for (const [key, values] of [['ordinal', ['0', '01', '-1', '9223372036854775808', '1'.repeat(21), 1]],
    ['insertXid', ['0', '01', '-1', '18446744073709551616', '1'.repeat(21), 1]]]) {
    for (const value of values) { const r = clone(f.report); r[key] = value; expect(() => signClosureReceipt({ report: r, secret: f.secret })).toThrow(); }
  }
  for (const secret of ['', null, 'x'.repeat(4097)]) {
    expect(() => closureBinding(secret, 'test', {})).toThrow(); denied(verifyIntent(f, { secret }));
  }
  const maxima = clone(f.report);
  maxima.ordinal = '9223372036854775807'; maxima.insertXid = '18446744073709551615';
  expect(signClosureReceipt({ report: maxima, secret: f.secret })).toMatch(/^[0-9a-f]{64}$/);
  expect(closureBinding(f.secret, 'test', 'x'.repeat(65534))).toMatch(/^[0-9a-f]{64}$/);
  expect(() => closureBinding(f.secret, 'test', 'x'.repeat(65535))).toThrow();
  for (const domain of ['', 'bad\ndomain', 'x'.repeat(121)]) expect(() => closureBinding(f.secret, domain, {})).toThrow();
});
