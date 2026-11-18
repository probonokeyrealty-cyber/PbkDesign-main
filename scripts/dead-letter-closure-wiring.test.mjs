import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import * as approvalApi from './dead-letter-closure-approval.mjs';
import { makeClosureFixture } from './fixtures/dead-letter-closure-fixture.mjs';
import { closureBinding, createClosureIntent } from './dead-letter-closure-protocol.mjs';
import { buildExecutedReadinessEvidence } from './production-maturity-loop.mjs';
import { DEAD_LETTER_CLOSURE_SQL } from './dead-letter-closure-migration.mjs';
import { executeDeadLetterClosure, readDeadLetterClosures } from './dead-letter-closure-store.mjs';
import { CLOSURE_SOURCE_FIXTURE_SQL, seedClosureSources } from './fixtures/dead-letter-closure-store-fixture.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = name => ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)?.getText(ast) || '';
const clone = x => JSON.parse(JSON.stringify(x));
function route(fragment) {
  let found;
  const visit = n => {
    if (ts.isIfStatement(n) && n.expression.getText(ast).includes(fragment)) found = n;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(ast); assert(found, `Missing route ${fragment}`);
  return found.getText(ast);
}
function harness({ status = 'pending', canonicalChange, cachedChange, claimLocal = false, totp = false } = {}) {
  const f = makeClosureFixture({ now: Date.now() });
  const row = { id: f.approvalId, workspace_id: 'pbk', type: 'admin', status,
    decided_at: status === 'approved' ? f.approval.decided_at : null,
    payload: { ...f.approval.payload, status } };
  if (status === 'pending') { delete row.payload.actedAt; delete row.payload.decidedAt; }
  canonicalChange?.(row);
  const cached = { ...clone(row.payload), actor: 'operator', actedAt: row.decided_at || '' };
  cachedChange?.(cached);
  const calls = { claim: 0, execute: [], reads: 0, persisted: 0, created: [], audit: [], forbidden: [] };
  const deny = name => () => { calls.forbidden.push(name); assert.fail(`Forbidden fallback: ${name}`); };
  const context = vm.createContext({
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [f.now])); } static now() { return f.now; } },
    console: { log() {}, warn() {} }, Buffer, URL, URLSearchParams, setTimeout, clearTimeout, createHmac, timingSafeEqual, randomUUID, closureBinding,
    state: { approvals: [cached] }, approvalDecisionLocks: new Map(),
    process: { env: { RENDER_GIT_COMMIT: f.revision } }, BUILD_REVISION: f.revision, BRIDGE_API_KEY: f.secret,
    runtimeStateBootstrap: { ready: true }, getPgPool: () => ({}),
    TOTP_REQUIRED: totp, TOTP_SECRET: 'fixture-only', verifyTotpCode: code => code === '123456',
    IS_HOSTED: true, STATE_BACKEND: 'postgres', SLACK_SIGNING_SECRET: 'fixture-slack-only',
    TEAM_APPROVAL_LIMIT: 100000, getTeamPermissions: () => ({ canApproveProviderActions: true }),
    toNumber: x => Number(x) || 0, currency: x => String(x),
    hasTeamAuthCredentials: req => Object.hasOwn(req.headers, 'x-pbk-team-token'),
    getTeamAuthMeta: req => ({ ok: req.headers['x-pbk-team-token'] === 'valid-team', role: 'team' }),
    isDirectQualificationFounder: (headers, key) => approvalApi.authorizeClosureProposalRequest({ method: 'POST', search: '', headers, body: {} }, key).ok,
    ...approvalApi,
    authorizeClosureProposalRequest: o => approvalApi.authorizeClosureProposalRequest({ ...o, body: clone(o.body) }, f.secret),
    queryPgRows: async () => { calls.reads++; return { ok: true, rows: [{ approval: clone(row) }] }; },
    normalizePgApprovalRecord: r => ({ ...clone(r.payload), id: r.id, type: r.type, status: r.status, actedAt: r.decided_at || '' }),
    normalizeApprovalDecisionStatus: value => ({ approve: 'approved', reject: 'rejected' }[value] || String(value || '').replaceAll('-', '_')),
    isoNow: () => new Date(f.now).toISOString(),
    claimPendingApprovalDecision: async (a, d, guard) => {
      assert.equal(guard?.closureExpected.id, row.id, 'Internal claim must bind the prechecked canonical pending row');
      calls.claim++; Object.assign(row.payload, clone(a), d); row.status = d.status; row.decided_at = d.actedAt;
      return { claimed: true, local: claimLocal };
    },
    executeDeadLetterClosure: async o => { calls.execute.push(o); return { ok: true, verified: true, result: 'closure_execution_verified' }; },
    persistApprovalRecordToPg: async () => { calls.persisted++; return { ok: true }; },
    persistState: async () => {}, clearBridgeReadCache() {},
    replayApprovalDecision: (a, s) => ({ ok: a.status === s, replayed: true, approval: a }),
    recordPbkFeedbackRecord: deny('feedback'), executeProviderActionWithSharedLease: deny('lease'),
    invokeTool: deny('invoke'), toolHandlers: { telnyx_call: deny('call'), createApprovalTask: async params => {
      calls.created.push(params); row.id = params.id; row.type = params.type; row.status = params.status;
      row.decided_at = null; row.payload = clone(params); return { ok: true, approval: params };
    } },
    addActivity() {}, makeActivity: x => x, projectApprovalEvent: () => ({}),
    reconcileSlackApprovalDecisionMessage: async () => ({ skipped: true }),
    projectLiveConversationRecord: async () => { calls.forbidden.push('conversation'); },
    updateSlackApprovalMessage: async () => ({ ok: true }),
    readRawBodyBuffer: async req => Buffer.from(JSON.stringify(req.body)),
    readBody: async req => req.body || {}, buildStateSnapshot: () => ({}),
    json: (res, code, body) => { res.status = code; res.body = body; },
    matchesPath: (p, paths) => paths.includes(p),
    matchPath: (p, template) => {
      const names = [...template.matchAll(/:([a-z]+)/g)].map(m => m[1]);
      const m = p.match(new RegExp('^' + template.replace(/:[a-z]+/g, '([^/]+)') + '$'));
      return m ? { groups: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) } : null;
    },
  });
  const names = ['getTeamApprovalRestriction', 'readCanonicalClosureApproval', 'authorizeClosureApprovalDecision',
    'handleDeadLetterClosureDecision', 'handleEvent', 'handleRuntimeEvent', 'verifySlackRequestSignature',
    'readSlackInteractionRequest', 'handleSlackApprovalInteraction'];
  vm.runInContext(`const closureSlackAuthority = Symbol('verified Slack');\n${names.map(declaration).join('\n')}`, context);
  const founder = { headers: { authorization: `Bearer ${f.secret}` } };
  const decide = (payload = {}, authority = { request: founder }) => context.handleEvent('approval-callback', {
    id: f.approvalId, status: 'approved', actor: 'operator', actedAt: new Date(f.now).toISOString(), ...payload,
  }, authority);
  const runRoute = async (fragment, path, body = {}, headers = founder.headers, method = 'POST') => {
    const url = new URL(path, 'http://fixture.invalid'), response = {};
    const fn = vm.runInContext(`(async function(request,response,url,pathname) {
      const approvalDecisionMatch = matchPath(pathname, '/api/approvals/:id/:decision');
      const approvalMatch = matchPath(pathname, '/api/approvals/:id');
      ${route(fragment)} })`, context);
    await fn({ method, headers, url: path, body }, response, url, url.pathname.replace(/\/+$/, ''));
    return response;
  };
  return { context, f, row, cached, calls, decide, founder, runRoute };
}

test('forged Slack/source/actor/teamAuth cannot grant raw callback authority before claim', async () => {
  const h = harness();
  const untrusted = await h.context.handleEvent('approval-callback', { id: h.f.approvalId, status: 'approved',
    source: 'slack-interaction', actor: 'founder', teamAuth: { role: 'admin' }, closureAuthority: true });
  assert.equal(untrusted.ok, false); assert.equal(h.calls.claim, 0); assert.equal(h.calls.execute.length, 0);
});
for (const fragment of ["['/events', '/api/events']", 'approvalDecisionMatch &&', 'approvalMatch &&']) {
  test(`team denied existing admin approval rules through ${fragment}`, async () => {
    for (const proxy of [false, true]) {
      const h = harness();
      const event = fragment.startsWith('[');
      const path = event ? '/api/events' : `/api/approvals/${h.f.approvalId}${fragment.startsWith('approvalDecision') ? '/approve' : ''}`;
      const headers = { ...h.founder.headers, 'x-pbk-team-token': 'valid-team', ...(proxy ? { 'x-pbk-netlify-proxy': '1' } : {}) };
      const body = event ? { eventType: 'approval-callback', payload: { id: h.f.approvalId, status: 'approved', source: 'slack-interaction', teamAuth: { role: 'admin' } } } : { status: 'approved', source: 'slack-interaction' };
      const r = await h.runRoute(fragment, path, body, headers, event || fragment.startsWith('approvalDecision') ? 'POST' : 'PUT');
      assert.equal(r.body.ok, false); assert.equal(h.calls.claim, 0); assert.equal(h.calls.execute.length, 0);
    }
  });
}
test('trusted founder internal approval never touches dispatch or generic fallback; ignores overrides', async () => {
  const h = harness();
  const r = await h.decide({ executionParams: { toolName: 'telnyx_call' }, action: 'sendContract', manifest: { forged: true } });
  assert.equal(r.ok, true); assert.equal(h.calls.claim, 1); assert.equal(h.calls.execute.length, 1);
  assert.deepEqual(Object.keys(h.calls.execute[0]).sort(), ['approvalId', 'pool', 'revision', 'secret']);
  assert.equal(h.calls.execute[0].approvalId, h.f.approvalId);
  assert.equal(h.row.status, 'approved'); assert.equal(h.cached.status, 'approved');
  assert.deepEqual(h.calls.forbidden, []);
});
test('canonical status remains approved on exact replay without a second decision claim', async () => {
  const h = harness({ status: 'approved' });
  const r = await h.decide({ actedAt: h.row.decided_at, actor: h.row.payload.actor });
  assert.equal(r.ok, true); assert.equal(h.calls.claim, 0); assert.equal(h.calls.execute.length, 1);
  assert.equal(h.row.status, 'approved'); assert.deepEqual(h.calls.forbidden, []);
});
test('rejected internal decision replays stay isolated and cannot become approved', async () => {
  const h = harness();
  const first = await h.decide({ status: 'rejected' });
  assert.equal(first.ok, true); assert.equal(h.row.status, 'rejected');
  const again = await h.decide({ status: 'rejected' });
  assert.equal(again.ok, true); assert.equal(h.calls.claim, 1); assert.equal(h.calls.execute.length, 0);
  assert.equal((await h.decide()).ok, false); assert.deepEqual(h.calls.forbidden, []);
});
test('cached-only local claim result never reaches the closure writer', async () => {
  const h = harness({ claimLocal: true });
  const r = await h.decide(); assert.equal(r.ok, false); assert.equal(r.statusCode, 503);
  assert.equal(h.calls.execute.length, 0);
});
test('failed internal execution leaves canonical approved decision intact without any fallback', async () => {
  const h = harness(); h.context.executeDeadLetterClosure = async () => ({ ok: false, result: 'closure_readback_failed' });
  const r = await h.decide(); assert.equal(r.ok, false); assert.equal(r.statusCode, 503);
  assert.equal(h.row.status, 'approved'); assert.equal(h.cached.status, 'approved'); assert.deepEqual(h.calls.forbidden, []);
});
test('founder raw events and api/events both carry private request authority', async () => {
  for (const path of ['/events', '/api/events']) {
    const h = harness();
    const r = await h.runRoute("['/events', '/api/events']", path, { eventType: 'approval-callback',
      payload: { id: h.f.approvalId, status: 'approved' } });
    assert.equal(r.status, 200); assert.equal(h.calls.claim, 1); assert.equal(h.calls.execute.length, 1);
  }
});
test('raw event HTTP status behavior for unrelated actions is unchanged', async () => {
  const h = harness(); h.context.handleEvent = async () => ({ ok: false, statusCode: 503, error: 'unrelated failure' });
  const r = await h.runRoute("['/events', '/api/events']", '/events', { eventType: 'unrelated' });
  assert.equal(r.status, 404);
});
test('protected passcode checks remain unchanged and payload passcodes cannot replace trusted decision context', async () => {
  const h = harness(); h.context.PROTECTED_OPS_PASSCODE = 'fixture-protected-code';
  vm.runInContext(['getLearningPasscodeCandidate', 'isProtectedLearningPasscodeValid'].map(declaration).join('\n'), h.context);
  assert.equal(h.context.isProtectedLearningPasscodeValid({ passcode: 'wrong' }), false);
  assert.equal(h.context.isProtectedLearningPasscodeValid({ passcode: 'fixture-protected-code' }), true);
  assert.equal((await h.decide({ passcode: 'fixture-protected-code', teamAuth: { role: 'admin' } }, null)).ok, false);
  assert.equal(h.calls.claim, 0);
});
for (const change of [r => { r.type = 'provider-action'; }, r => { r.payload.approvalAction = 'sendContract'; },
  r => { r.payload.metadata.deadLetterClosureIntent.attestation.signature = '0'.repeat(64); },
  r => { r.payload.leadId = 'seller'; }, r => { r.payload.status = 'approved'; }]) {
  test('canonical internal type/action/intent/association mismatch fails before claim and lease', async () => {
    const h = harness({ canonicalChange: change });
    assert.equal((await h.decide()).ok, false); assert.equal(h.calls.claim, 0);
    assert.equal(h.calls.execute.length, 0); assert.deepEqual(h.calls.forbidden, []);
  });
}
test('cached internal intent mismatch cannot overwrite canonical pending authority', async () => {
  const h = harness({ cachedChange: p => { p.metadata.deadLetterClosureIntent.recordRef = '0'.repeat(64); } });
  assert.equal((await h.decide()).ok, false); assert.equal(h.calls.claim, 0);
});
test('protected TOTP cannot be bypassed by using raw events or ordinary approval routes', async () => {
  const h = harness({ totp: true });
  assert.equal((await h.decide()).ok, false); assert.equal(h.calls.claim, 0);
  assert.equal((await h.decide({}, { request: { headers: { ...h.founder.headers, 'x-pbk-totp': '123456' } } })).ok, true);
});
test('missing durable canonical approval cannot fall back to cached/file authority', async () => {
  const h = harness(); h.context.queryPgRows = async () => ({ ok: false, rows: [] });
  assert.equal((await h.decide()).ok, false); assert.equal(h.calls.claim, 0);
});
test('forged or future decision timestamps fail before durable claim', async () => {
  for (const actedAt of ['not-a-date', '2099-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z']) {
    const h = harness(); assert.equal((await h.decide({ actedAt })).ok, false);
    assert.equal(h.calls.claim, 0); assert.equal(h.calls.execute.length, 0);
  }
});
test('Slack decisions require actual signature and existing supported-action checks', async () => {
  const h = harness();
  const payload = { user: { id: 'slack-operator' }, actions: [{ action_id: 'pbk_approval_approve', value: h.f.approvalId }] };
  const path = '/api/slack/interactions', ts = String(Math.floor(h.f.now / 1000));
  const signature = 'v0=' + createHmac('sha256', 'fixture-slack-only').update(`v0:${ts}:${JSON.stringify(payload)}`).digest('hex');
  const headers = { 'x-slack-request-timestamp': ts, 'x-slack-signature': signature };
  const bad = await h.runRoute("['/api/slack/interactions'", path, payload, { ...headers, 'x-slack-signature': 'forged' });
  assert.equal(bad.status, 401); assert.equal(h.calls.claim, 0);
  const direct = await h.context.handleSlackApprovalInteraction(payload);
  assert.equal(direct.ok, false); assert.equal(h.calls.claim, 0);
  const unsupported = await h.context.handleSlackApprovalInteraction({ actions: [{ action_id: 'execute', value: h.f.approvalId }] });
  assert.equal(unsupported.status, 400); assert.equal(h.calls.claim, 0);
  await h.runRoute("['/api/slack/interactions'", path, payload, headers);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.calls.claim, 1); assert.equal(h.calls.execute.length, 1); assert.deepEqual(h.calls.forbidden, []);
});
test('locally skipped Slack signatures never receive closure decision authority', async () => {
  const h = harness(); h.context.SLACK_SIGNING_SECRET = ''; h.context.IS_HOSTED = false;
  await h.runRoute("['/api/slack/interactions'", '/api/slack/interactions', {
    actions: [{ action_id: 'pbk_approval_approve', value: h.f.approvalId }] }, {});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.calls.claim, 0); assert.equal(h.calls.execute.length, 0);
});
test('server-owned audit closureBoundary alone reaches collector callback', async () => {
  const h = harness(), trusted = { schemaVersion: 'trusted-boundary' };
  h.context.authorizeQualificationRequest = () => ({ ok: true });
  h.context.executeOperationalAudit = async o => { await o.collect({ pool: {}, now: 1, observationNow: () => 2, fence: {}, closureBoundary: trusted }); return { ok: true }; };
  h.context.collectOperationalAudit = async o => { h.calls.audit.push(o); return {}; };
  h.context.runtimeCoverageSampler = {}; h.context.getRuntimeCoverageHealth = () => ({});
  await h.runRoute("pathname === '/api/admin/operational-audit/run'", '/api/admin/operational-audit/run', { closureBoundary: { forged: true } });
  assert.equal(h.calls.audit[0].closureBoundary, trusted);
});

test('canonical lookup passes pg values separately so queryPgRows cannot erase config values', async () => {
  const h = harness();
  h.context.queryPgRows = async (sql, values) => {
    assert.deepEqual(Array.from(values), [h.f.approvalId]); assert.equal(sql.query_timeout, 2000);
    return { ok: true, rows: [{ approval: clone(h.row) }] };
  };
  assert.equal((await h.context.readCanonicalClosureApproval(h.f.approvalId)).id, h.f.approvalId);
});

test('closure durable claim cannot insert missing rows or overwrite concurrently changed pending authority', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE approvals(id text PRIMARY KEY, workspace_id text,type text,status text,
      lead_id text,contract_id text,requested_by text,summary text,risk text,payload jsonb,
      decided_at timestamptz,created_at timestamptz,updated_at timestamptz)`);
    for (const change of ['none', 'missing', 'intent', 'type', 'workspace', 'lead', 'contract']) {
      const h = harness();
      await db.exec('TRUNCATE approvals');
      await db.query(`INSERT INTO approvals(id,workspace_id,type,status,payload) VALUES($1,'pbk','admin','pending',$2)`,
        [h.row.id, JSON.stringify(h.row.payload)]);
      if (change === 'missing') await db.exec('DELETE FROM approvals');
      if (change === 'intent') await db.exec(`UPDATE approvals SET payload=jsonb_set(payload,'{metadata,deadLetterClosureIntent,recordRef}','"changed"')`);
      if (change === 'type') await db.exec(`UPDATE approvals SET type='provider-action'`);
      if (change === 'workspace') await db.exec(`UPDATE approvals SET workspace_id='other'`);
      if (change === 'lead') await db.exec(`UPDATE approvals SET lead_id='seller'`);
      if (change === 'contract') await db.exec(`UPDATE approvals SET contract_id='contract'`);
      const before = (await db.query('SELECT to_jsonb(a) row FROM approvals a')).rows;
      const sql = [];
      h.context.queryPgRows = async (text, values) => {
        const statement = typeof text === 'string' ? text : text.text;
        sql.push(statement); const r = await db.query(statement, values); return { ok: true, rows: r.rows };
      };
      h.context.normalizeTenantId = x => x; h.context.buildApprovalSummary = () => 'Internal';
      vm.runInContext(declaration('writeApprovalRecordToPg'), h.context);
      const r = await h.context.writeApprovalRecordToPg({ ...clone(h.row.payload), status: 'approved',
        actor: 'operator', actedAt: new Date(h.f.now).toISOString() }, true, h.row);
      assert.equal(r.rows.length, change === 'none' ? 1 : 0, change);
      assert(sql.every(s => /^\s*UPDATE\b/.test(s)), 'Closure claims must never UPSERT local/cache-only approvals');
      if (change !== 'none') assert.deepEqual((await db.query('SELECT to_jsonb(a) row FROM approvals a')).rows, before);
    }
  } finally { await db.close(); }
}, 30000);

test('conditional claim miss revalidates closure authority through the real shared helper before replay or cache mutation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE approvals(id text PRIMARY KEY, workspace_id text,type text,status text,
      lead_id text,contract_id text,requested_by text,summary text,risk text,payload jsonb,
      decided_at timestamptz,created_at timestamptz,updated_at timestamptz)`);
    for (const change of ['generic-provider', 'type', 'action', 'intent', 'signature', 'association',
      'status', 'actor', 'time', 'pending', 'missing', 'unavailable', 'oversize', 'exact-approved', 'exact-rejected']) {
      const h = harness();
      await db.exec('TRUNCATE approvals');
      await db.query(`INSERT INTO approvals(id,workspace_id,type,status,payload) VALUES($1,'pbk','admin','pending',$2)`,
        [h.row.id, JSON.stringify(h.row.payload)]);
      let updates = 0, boundedReadbacks = 0;
      h.context.normalizeTenantId = x => x; h.context.buildApprovalSummary = () => 'Internal';
      vm.runInContext(['writeApprovalRecordToPg', 'claimPendingApprovalDecision',
        'normalizePgApprovalRecord', 'replayApprovalDecision'].map(declaration).join('\n'), h.context);
      h.context.queryPgRows = async (config, values) => {
        const sql = typeof config === 'string' ? config : config.text;
        if (sql.startsWith('UPDATE public.approvals')) {
          updates++;
          const p = clone(h.row.payload);
          const at = new Date(h.f.now - (change === 'time' ? 1000 : 0)).toISOString();
          p.status = ['status', 'exact-rejected'].includes(change) ? 'rejected' : 'approved';
          p.actor = change === 'actor' ? 'different-operator' : 'operator'; p.actedAt = at;
          let type = 'admin';
          if (change === 'generic-provider') {
            type = p.type = 'provider-action'; p.approvalAction = 'telnyx_call'; delete p.metadata.deadLetterClosureIntent;
          }
          if (change === 'type') type = 'provider-action';
          if (change === 'action') p.approvalAction = 'telnyx_call';
          if (change === 'intent') p.metadata.deadLetterClosureIntent = createClosureIntent({
            secret: h.f.secret, revision: h.f.revision, approvalId: h.row.id, action: 'close_internal',
            recordRef: h.f.manifest.recordRef, manifest: h.f.manifest, predecessor: null,
            createdAt: new Date(Date.parse(h.f.intent.createdAt) + 1000).toISOString(),
          });
          if (change === 'signature') p.metadata.deadLetterClosureIntent.attestation.signature = '0'.repeat(64);
          if (change === 'oversize') p.notes = 'x'.repeat(65536);
          if (change === 'pending') { p.status = 'pending'; delete p.actedAt; p.notes = 'concurrent edit'; }
          await db.query(`UPDATE approvals SET type=$2,status=$3,payload=$4,decided_at=$5,lead_id=$6 WHERE id=$1`,
            [h.row.id, type, p.status, JSON.stringify(p), change === 'pending' ? null : at,
              change === 'association' ? 'seller' : null]);
          if (change === 'missing') await db.exec('DELETE FROM approvals');
        } else if (updates && sql.includes('octet_length(to_jsonb(a)::text)<=65536')) {
          boundedReadbacks++; assert.equal(config.query_timeout, 2000);
        }
        if (updates && !sql.startsWith('UPDATE') && change === 'unavailable') return { ok: false, rows: [] };
        const r = await db.query(sql, values); return { ok: true, rows: r.rows };
      };
      const r = await h.decide({ status: change === 'exact-rejected' ? 'rejected' : 'approved' });
      const exact = change.startsWith('exact-');
      assert.equal(r.ok, exact, change);
      assert.equal(updates, 1, 'Exercise actual conditional UPDATE and claimPendingApprovalDecision');
      assert.equal(boundedReadbacks, 1, change + ': independently reread bounded canonical authority after miss');
      if (exact) { assert.equal(r.replayed, true); assert.equal(h.cached.status, change.slice(6)); }
      else {
        assert.equal(h.cached.status, 'pending', change + ': failed race cannot replace cached authority');
        assert.equal(h.cached.type, 'admin');
        assert.deepEqual(h.cached.metadata.deadLetterClosureIntent, h.row.payload.metadata.deadLetterClosureIntent);
      }
      assert.equal(h.calls.execute.length, 0); assert.deepEqual(h.calls.forbidden, []);
    }
  } finally { await db.close(); }
}, 60000);

test('unrelated shared claim miss retains its existing status-only replay behavior', async () => {
  const h = harness(); h.context.normalizeTenantId = x => x; h.context.buildApprovalSummary = () => 'Unrelated';
  vm.runInContext(['claimPendingApprovalDecision', 'normalizePgApprovalRecord', 'replayApprovalDecision'].map(declaration).join('\n'), h.context);
  h.context.writeApprovalRecordToPg = async () => ({ ok: true, rows: [] });
  h.context.queryPgRows = async () => ({ ok: true, rows: [{ id: 'generic', workspace_id: 'pbk',
    type: 'offer', status: 'approved', payload: { actor: 'different-operator' } }] });
  const approval = { id: 'generic', type: 'offer', status: 'pending' };
  const r = await h.context.claimPendingApprovalDecision(approval, { status: 'approved', actor: 'operator', actedAt: h.context.isoNow() });
  assert.equal(r.claimed, false); assert.equal(r.result.ok, true); assert.equal(r.result.replayed, true);
  assert.equal(approval.actor, 'different-operator');
});

test('maturity cannot merge closure diagnostics into execution, coverage, canary, fleet or delivery gates', async () => {
  const h = harness(), reads = [];
  const closure = { verified: true, result: 'closure_summary_verified',
    counts: { total: 4, closedInternal: 4, open: 0, invalidated: 0 }, cases: [],
    evidence: { silentErrors: { passed: true } }, ready: true, launchQualified: true, providerDeliveryVerified: true };
  Object.assign(h.context, {
    getRuntimeMeta: () => ({}), getRuntimeEventArchiveStatus: () => ({ ready: true }),
    getProviderCircuitStatus: () => ({ ready: true, openProviders: [] }),
    buildAgentOrchestrationSnapshot: () => ({ measurement: { ready: false } }),
    productionReadinessMonitor: { getSloStatus: () => ({}) }, RELEASE_QUALIFICATION_CASES: [], AVA_REAL_CALL_EVAL_SCENARIOS: [],
    readReleaseQualification: async () => ({ qualification: { ready: false }, evidence: {} }),
    readOperationalAudit: async () => ({ verified: false, audit: { ready: false }, evidence: {} }),
    readBacklogReconciliation: async () => ({ verified: true, reconciliation: { counts: { dispatchesLocked: 6 } } }),
    readCallMemorySkipSummary: async () => ({ verified: false, counts: null }),
    collectBacklogReconciliation: () => assert.fail('Maturity must not execute reconciliation'),
    readDeadLetterClosures: async o => { reads.push(o); return closure; },
    readCanaryEvidence: async () => ({ verified: false, diagnostics: {} }), buildExecutedReadinessEvidence,
  });
  vm.runInContext(declaration('buildProductionMaturitySnapshot'), h.context);
  let r = await h.context.buildProductionMaturitySnapshot();
  assert.equal(r.deadLetterClosures.verified, true); assert.deepEqual(r.deadLetterClosures.counts, closure.counts);
  assert.equal(r.deadLetterClosures.launchQualified, false); assert.equal(r.deadLetterClosures.providerDeliveryVerified, false);
  assert.equal(r.backlogReconciliation.counts.dispatchesLocked, 6); assert.equal(r.backlogReconciliation.memoryPolicyOutcomes.verified, false);
  assert.equal(r.executionEvidence.silentErrorReport.launchReady, false); assert.equal(r.operationalAudit.ready, false);
  assert.equal(r.canaryPromotionGate.ready, false); assert.equal(r.stableAgentFleetMeasurement.ready, false); assert.equal(r.ready, false);
  assert.equal(reads.length, 1); assert.equal(reads[0].secret, h.f.secret); assert.equal(reads[0].revision, h.f.revision);
  closure.verified = false;
  r = await h.context.buildProductionMaturitySnapshot();
  assert.equal(r.deadLetterClosures.counts, null); assert.equal(r.deadLetterClosures.cases.length, 0); assert.equal(reads.length, 2);
});

const closureRoute = "pathname === '/api/admin/reconciliation/dead-letters'";
function proposalHarness() {
  const h = harness();
  h.context.prepareDeadLetterClosureProposal = async o => {
    const intent = createClosureIntent({ approvalId: o.approvalId, action: o.action, recordRef: h.f.manifest.recordRef,
      manifest: h.f.manifest, predecessor: o.action === 'revoke_internal' ? { id: 'prior', hash: 'a'.repeat(64) } : null,
      revision: h.f.revision, createdAt: new Date(h.f.now).toISOString(), secret: h.f.secret });
    return { ok: true, params: { id: o.approvalId, type: 'admin', status: 'pending',
      approvalAction: 'dead_letter_internal_closure', metadata: { deadLetterClosureIntent: intent } } };
  };
  h.context.readDeadLetterClosures = async () => ({ ok: true, verified: true, counts: { total: 1 },
    cases: [{ recordRef: h.f.manifest.recordRef, status: 'open' }] });
  h.path = action => `/api/admin/reconciliation/dead-letters/${h.f.manifest.recordRef}/${action}`;
  return h;
}
test('GET preview is read-only, POST routes generate IDs, fix action and confirm exact durable pending intent', async () => {
  const h = proposalHarness();
  const preview = await h.runRoute(closureRoute, h.path('preview'), {}, h.founder.headers, 'GET');
  assert.equal(preview.status, 200); assert.equal(h.calls.created.length, 0);
  for (const action of ['propose', 'propose-revocation']) {
    const r = await h.runRoute(closureRoute, h.path(action));
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true);
    assert.equal(h.row.status, 'pending');
    assert.equal(h.row.payload.metadata.deadLetterClosureIntent.action, action === 'propose' ? 'close_internal' : 'revoke_internal');
    assert.notEqual(r.body.approvalId, h.f.approvalId);
  }
  assert.equal(h.calls.reads, 2); assert.equal(h.calls.execute.length, 0);
});
test('proposal creation cannot report cached-only success or mismatched canonical pending state', async () => {
  for (const change of ['missing', 'approved', 'intent']) {
    const h = proposalHarness();
    h.context.queryPgRows = async () => {
      if (change === 'missing') return { ok: true, rows: [] };
      const r = clone(h.row);
      if (change === 'approved') { r.status = 'approved'; r.payload.status = 'approved'; }
      else r.payload.metadata.deadLetterClosureIntent.recordRef = '0'.repeat(64);
      return { ok: true, rows: [{ approval: r }] };
    };
    const r = await h.runRoute(closureRoute, h.path('propose'));
    assert.equal(r.status, 503, change); assert.equal(r.body.ok, false); assert.equal(h.calls.execute.length, 0);
  }
});
test('founder bearer cannot apply without approval or inject evidence/decision through proposals', async () => {
  const h = proposalHarness();
  for (const action of ['apply', 'execute']) assert.equal((await h.runRoute(closureRoute, h.path(action))).status, 404);
  for (const body of [{ status: 'approved' }, { approvalId: 'caller' }, { manifest: {} }, { action: 'revoke_internal' }]) {
    assert.equal((await h.runRoute(closureRoute, h.path('propose'), body)).status, 400);
  }
  for (const path of [h.path('propose') + '/', h.path('propose') + '?now=0',
    h.path('propose').replace(h.f.manifest.recordRef, 'bad'), h.path('propose').replace('propose', '%70ropose')]) {
    const r = await h.runRoute(closureRoute, path); assert(r.status >= 400, path);
  }
  for (const method of ['PUT', 'PATCH', 'DELETE', 'GET']) assert.equal((await h.runRoute(closureRoute, h.path('propose'), {}, h.founder.headers, method)).status, 400);
  assert.equal(h.calls.created.length, 0); assert.equal(h.calls.execute.length, 0);
});

test('real isolated approval service -> durable pending -> protected claim -> closure/readback/replay/revoke lifecycle', async () => {
  const db = new PGlite(), h = harness();
  try {
    await db.exec(`CREATE ROLE lifecycle_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE,CREATE ON SCHEMA public TO lifecycle_owner; SET ROLE lifecycle_owner;`);
    await db.exec(CLOSURE_SOURCE_FIXTURE_SQL);
    await db.exec(`ALTER TABLE approvals ADD COLUMN lead_id text, ADD COLUMN contract_id text,
      ADD COLUMN requested_by text, ADD COLUMN summary text, ADD COLUMN risk text;`);
    await db.exec(DEAD_LETTER_CLOSURE_SQL);
    await seedClosureSources((sql, values) => db.query(sql, values));
    const pool = { query: async (sql, values) => {
      const r = await db.query(typeof sql === 'string' ? sql : sql.text, values || sql.values);
      return { rows: r.rows, rowCount: r.affectedRows };
    }, connect: async () => ({ query: async c => pool.query(c), release() {} }) };
    const a = { pool, secret: h.f.secret, revision: h.f.revision };
    const current = await readDeadLetterClosures(a);
    assert.equal(current.verified, true, JSON.stringify(current));
    const base = `/api/admin/reconciliation/dead-letters/${current.cases[0].recordRef}`;
    Object.assign(h.context, {
      Date, state: { approvals: [] }, getPgPool: () => pool,
      isoNow: () => new Date().toISOString(), markPostgresHealth() {}, normalizeTenantId: x => x,
      buildApprovalSummary: () => 'PBK internal recovery', recordToolUse() {},
      addApproval: (state, approval) => state.approvals.push(approval), isCampaignStartApproval: () => false,
      projectLiveConversationRecord: async () => {},
      APPROVAL_WEBHOOK_URL: '', fireWebhook: async () => ({ ok: false, skipped: true }),
      postSlackApproval: async () => ({ ok: false, skipped: true }), withTimeout: promise => promise,
      fetch: () => assert.fail('All network denied in lifecycle VM'),
      prepareDeadLetterClosureProposal: o => approvalApi.prepareDeadLetterClosureProposal({ ...a,
        recordRef: o.recordRef, action: o.action, approvalId: o.approvalId }),
      readDeadLetterClosures: () => readDeadLetterClosures(a),
      executeDeadLetterClosure: o => executeDeadLetterClosure({ ...a, approvalId: o.approvalId }),
    });
    vm.runInContext(['queryPgRows', 'writeApprovalRecordToPg', 'persistApprovalRecordToPg',
      'claimPendingApprovalDecision', 'normalizePgApprovalRecord'].map(declaration).join('\n'), h.context);
    const methods = [];
    const visit = n => {
      if (ts.isMethodDeclaration(n) && ['createApproval', 'createApprovalTask'].includes(n.name?.getText(ast))) methods.push(n.getText(ast));
      ts.forEachChild(n, visit);
    };
    visit(ast); assert.equal(methods.length, 2);
    h.context.toolHandlers = vm.runInContext(`({ ${methods.join(',\n')} })`, h.context);
    const originals = async () => JSON.stringify((await db.query('SELECT to_jsonb(d) row FROM event_dead_letters d')).rows);
    const original = await originals();
    const proposal = await h.runRoute(closureRoute, base + '/propose');
    assert.equal(proposal.status, 200, JSON.stringify(proposal.body));
    const approvalId = proposal.body.approvalId;
    for (const path of ['/events', '/api/events']) {
      const denied = await h.runRoute("['/events', '/api/events']", path, { eventType: 'approval-callback',
        payload: { id: approvalId, status: 'approved', source: 'slack-interaction', teamAuth: { role: 'admin' } } },
      { ...h.founder.headers, 'x-pbk-team-token': 'valid-team' });
      assert.equal(denied.status, 403);
    }
    assert.equal((await db.query('SELECT status FROM approvals WHERE id=$1', [approvalId])).rows[0].status, 'pending');
    const decided = await h.runRoute('approvalDecisionMatch &&', `/api/approvals/${approvalId}/approve`, { actor: 'lifecycle-operator' });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.deadLetterClosure.verified, true);
    const p = (await db.query('SELECT status,payload FROM approvals WHERE id=$1', [approvalId])).rows[0];
    assert.equal(p.status, 'approved');
    const replay = await h.context.handleEvent('approval-callback', { id: approvalId, status: 'approved',
      actor: p.payload.actor, actedAt: p.payload.actedAt }, { request: h.founder });
    assert.equal(replay.deadLetterClosure.replayed, true, JSON.stringify(replay));
    assert.equal((await db.query('SELECT count(*)::int n FROM pbk_dead_letter_closure_ledger')).rows[0].n, 1);
    await db.exec('DELETE FROM call_embeddings');
    const revocation = await h.runRoute(closureRoute, base + '/propose-revocation');
    assert.equal(revocation.status, 200, JSON.stringify(revocation.body));
    const revoked = await h.runRoute('approvalMatch &&', `/api/approvals/${revocation.body.approvalId}`, { status: 'approved' }, h.founder.headers, 'PUT');
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal(revoked.body.deadLetterClosure.cases[0].reason, 'revoked');
    assert.equal((await db.query('SELECT count(*)::int n FROM pbk_dead_letter_closure_ledger')).rows[0].n, 2);
    assert((await db.query('SELECT status FROM approvals')).rows.every(r => r.status === 'approved'));
    assert.equal(await originals(), original);
    assert.deepEqual((await db.query('SELECT payload FROM provider_action_dispatches')).rows, [{ payload: { state: 'unknown' } }]);
  } finally { await db.close(); }
}, 60000);
