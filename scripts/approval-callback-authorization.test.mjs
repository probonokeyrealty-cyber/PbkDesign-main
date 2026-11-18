import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual, randomUUID, randomBytes } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { isDeadLetterClosureApproval } from './dead-letter-closure-approval.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = name => ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)?.getText(ast) || '';
const clone = value => JSON.parse(JSON.stringify(value));
function route(fragment) {
  let found;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(ast).includes(fragment)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(found, `Missing route ${fragment}`);
  return found.getText(ast);
}

function harness({ approval = {}, cache = {}, permissions = true, lookup, hosted = true, backend = 'postgres' } = {}) {
  const key = randomBytes(32).toString('hex'), passcode = randomBytes(16).toString('hex');
  const payload = { id: 'authorization-fixture', type: 'offer', status: 'pending',
    workspaceId: 'pbk', offerPrice: 90000, summary: 'Fixture approval', createdAt: new Date().toISOString(), ...approval };
  const raw = { id: payload.id, workspace_id: 'pbk', type: payload.type, status: payload.status,
    payload: clone(payload), decided_at: null, lead_id: '', contract_id: '' };
  const cached = { ...clone(payload), ...cache };
  const state = { approvals: [cached], providerActionDispatches: Array.from({ length: 6 }, (_, i) => ({
    approvalId: `locked-${i}`, status: 'unknown', reclaimable: false,
  })) };
  const calls = { claims: [], forbidden: [], reads: [] };
  const deny = name => () => { calls.forbidden.push(name); assert.fail(`Forbidden side effect: ${name}`); };
  const context = vm.createContext({ Buffer, Date, URL, createHmac, timingSafeEqual, randomUUID, Object,
    state, approvalDecisionLocks: new Map(), BRIDGE_API_KEY: key, TEAM_PASSCODE: passcode,
    TEAM_SESSION_TTL_MS: 3600000, TEAM_APPROVAL_LIMIT: 100000,
    getTeamPermissions: () => ({ canApproveProviderActions: permissions }),
    toNumber: value => Number(value) || 0, currency: value => String(value),
    normalizeApprovalDecisionStatus: value => ({ approve: 'approved', reject: 'rejected', modify: 'needs_revision' }[value]
      || String(value || '').toLowerCase().replaceAll('-', '_')),
    normalizeTenantId: value => value || 'pbk', isoNow: () => new Date().toISOString(),
    IS_HOSTED: hosted, STATE_BACKEND: backend, isDeadLetterClosureApproval,
    queryPgRows: async (...args) => { calls.reads.push(args); return lookup || { ok: true, rows: [{ approval: clone(raw) }] }; },
    claimPendingApprovalDecision: async (target, decision, guard) => {
      calls.claims.push({ target: clone(target), decision, guard });
      // SQL execution is covered separately. Stop at this boundary so authorization
      // tests never enter feedback, leases, senders, commands or retry handlers.
      return { claimed: false, result: { ok: true, result: 'decision_gate_passed', approval: target } };
    },
    handleDeadLetterClosureDecision: deny('closure'),
    persistState: deny('state write'), persistApprovalRecordToPg: deny('approval write'),
    recordPbkFeedbackRecord: deny('feedback'), executeProviderActionWithSharedLease: deny('lease'),
    invokeTool: deny('tool'), executeApprovedCampaign: deny('campaign'),
    projectLiveConversationRecord: deny('conversation'), reconcileSlackApprovalDecisionMessage: deny('Slack'),
    TEAM_PASSCODE_CONFIGURED: true, readBody: async req => req.body,
    buildStateSnapshot: () => state,
    json: (res, status, body) => { res.status = status; res.body = body; },
    matchesPath: (path, paths) => paths.includes(path),
    matchPath: (path, template) => {
      const names = [...template.matchAll(/:([a-z]+)/g)].map(m => m[1]);
      const match = path.match(new RegExp('^' + template.replace(/:[a-z]+/g, '([^/]+)') + '$'));
      return match ? { groups: Object.fromEntries(names.map((name, i) => [name, match[i + 1]])) } : null;
    },
  });
  const functions = ['safeCompareString', 'isTeamPasscodeValid', 'getTeamSessionSecret', 'signTeamSessionPayload',
    'createTeamSessionToken', 'verifyTeamSessionToken', 'hasTeamAuthCredentials', 'getTeamAuthMeta',
    'getTeamApprovalRestriction', 'normalizePgApprovalRecord', 'readCanonicalClosureApproval',
    'authorizeApprovalCallbackDecision', 'isCanonicalApprovalCallbackTarget', 'cacheCanonicalApprovalCallbackTarget',
    'handleEvent', 'handleRuntimeEvent'];
  vm.runInContext(`const closureSlackAuthority = Symbol('verified Slack');\n${functions.map(declaration).join('\n')}`, context);
  const token = context.createTeamSessionToken().token;
  const team = { 'x-pbk-team-token': token };
  const founder = { authorization: `Bearer ${key}` };
  const request = (headers = team) => ({ method: 'POST', headers });
  const decide = (body = {}, authority = { request: request() }) => context.handleEvent('approval-callback', {
    id: payload.id, status: 'approved', actor: 'fixture operator', actedAt: new Date().toISOString(), ...body,
  }, authority);
  const runRoute = async (kind, body = {}, headers = team) => {
    const path = kind === 'events' ? '/api/events' : kind === 'post' ? `/api/approvals/${payload.id}/approve` : `/api/approvals/${payload.id}`;
    const fragment = kind === 'events' ? "['/events', '/api/events']" : kind === 'post' ? 'approvalDecisionMatch &&' : 'approvalMatch &&';
    const fn = vm.runInContext(`(async function(request,response,pathname) {
      const approvalDecisionMatch = matchPath(pathname, '/api/approvals/:id/:decision');
      const approvalMatch = matchPath(pathname, '/api/approvals/:id'); ${route(fragment)} })`, context);
    const response = {};
    await fn({ method: kind === 'put' ? 'PUT' : 'POST', headers,
      body: kind === 'events' ? { eventType: 'approval-callback', payload: { id: payload.id, status: 'approved', ...body } } : { status: 'approved', ...body } }, response, path);
    return response;
  };
  return { context, raw, cached, state, calls, team, founder, token, passcode, decide, runRoute, request };
}

for (const [name, approval, permissions] of [
  ['admin', { type: 'admin', approvalAction: 'admin_update_env_var' }, true],
  ['contract', { type: 'contract', approvalAction: 'sendContract' }, true],
  ['campaign', { type: 'campaign', approvalAction: 'start_campaign' }, true],
  ['above-limit offer', { type: 'offer', offerPrice: 100001 }, true],
  ['disabled provider permission', { type: 'provider-action', approvalAction: 'telnyx_sms' }, false],
]) {
  test(`raw callbacks enforce existing ${name} decision restriction before claim`, async () => {
    const h = harness({ approval, permissions });
    const before = JSON.stringify(h.state);
    const result = await h.decide({ source: 'slack-interaction', actor: 'founder', teamAuth: { role: 'admin' } });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 403);
    assert.equal(h.calls.claims.length, 0);
    assert.equal(JSON.stringify(h.state), before);
    assert.deepEqual(h.calls.forbidden, []);
  });
}

for (const kind of ['events', 'post', 'put']) {
  test(`${kind} authorizes the canonical target rather than a lower-risk stale cache`, async () => {
    const h = harness({ approval: { type: 'admin', approvalAction: 'admin_update_env_var' },
      cache: { type: 'offer', approvalAction: '', offerPrice: 90000 } });
    const before = JSON.stringify(h.state);
    const response = await h.runRoute(kind, {}, { ...h.founder, ...h.team, 'x-pbk-netlify-proxy': '1' });
    assert.equal(response.status, 403);
    assert.equal(response.body.ok, false);
    assert.equal(h.calls.claims.length, 0);
    assert.equal(JSON.stringify(h.state), before);
  });
}

test('forged Slack, actor and teamAuth payloads do not replace request authority', async () => {
  const h = harness();
  const result = await h.decide({ source: 'slack-interaction', actor: 'founder',
    teamAuth: { ok: true, role: 'admin' }, request: h.request(h.founder) }, null);
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(h.calls.claims.length, 0);
});

test('Netlify borrowed bearer without a verified team session is not founder authority', async () => {
  const h = harness();
  const result = await h.decide({}, { request: h.request({ ...h.founder, 'x-pbk-netlify-proxy': '1' }) });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(h.calls.claims.length, 0);
});

test('ordinary team offers, founder decisions and verified Slack retain their existing permissions', async () => {
  for (const channel of ['team', 'founder', 'Slack']) {
    const h = harness({ approval: { type: channel === 'team' ? 'offer' : 'admin' } });
    const authority = channel === 'Slack' ? vm.runInContext('closureSlackAuthority', h.context)
      : { request: h.request(channel === 'team' ? h.team : h.founder) };
    const result = await h.decide({}, authority);
    assert.equal(result.ok, true, channel);
    assert.equal(result.result, 'decision_gate_passed');
    assert.equal(h.calls.claims.length, 1);
    assert.deepEqual(h.calls.forbidden, []);
  }
});

test('canonical execution input drops stale cache action and metadata rather than merging them', async () => {
  const h = harness({ cache: { approvalAction: 'admin_update_env_var', metadata: { requestedTool: 'admin_update_env_var' } } });
  const result = await h.decide();
  assert.equal(result.ok, true);
  assert.equal(h.calls.claims[0].target.approvalAction, undefined);
  assert.equal(h.calls.claims[0].target.metadata, undefined);
  assert.equal(h.state.approvals[0].approvalAction, undefined);
});

test('unavailable, oversized, foreign or contradictory canonical targets cannot be decided', async () => {
  for (const mode of ['unavailable', 'oversized', 'foreign', 'wrong-id', 'contradictory-type']) {
    const h = harness({ lookup: mode === 'unavailable' ? { ok: false, reason: 'query_failed', rows: [] }
      : mode === 'oversized' ? { ok: true, rows: [{ approval: null }] } : undefined });
    if (mode === 'foreign') h.raw.workspace_id = 'other';
    if (mode === 'wrong-id') h.raw.payload.id = 'other';
    if (mode === 'contradictory-type') h.raw.type = 'admin';
    const before = JSON.stringify(h.state), result = await h.decide();
    assert.equal(result.ok, false, mode);
    assert.equal(h.calls.claims.length, 0, mode);
    assert.equal(JSON.stringify(h.state), before, mode);
  }
});

test('hosted team decisions need a durable target; existing founder legacy admission remains available', async () => {
  for (const founder of [false, true]) {
    const h = harness({ lookup: { ok: true, rows: [] } });
    const result = await h.decide({}, { request: h.request(founder ? h.founder : h.team) });
    assert.equal(result.ok, founder);
    assert.equal(h.calls.claims.length, founder ? 1 : 0);
  }
});

test('file-mode decisions retain existing team rejection and routine-offer permissions without a database', async () => {
  for (const status of ['approved', 'rejected', 'needs_revision', 'cancelled']) {
    const h = harness({ hosted: false, backend: 'file', lookup: { ok: false, reason: 'no_database', rows: [] },
      approval: { type: status === 'approved' ? 'offer' : 'admin' } });
    const result = await h.decide({ status });
    assert.equal(result.ok, true, status);
    assert.equal(h.calls.claims.length, 1);
  }
});

for (const kind of ['post', 'put']) {
  test(`${kind} retains valid body-based team authentication for routine decisions`, async () => {
    const h = harness();
    const result = await h.runRoute(kind, { teamToken: h.token }, h.founder);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(h.calls.claims.length, 1);
  });
}

test('the real conditional claim cannot recreate or replace a target changed after authorization', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.approvals(id text PRIMARY KEY,workspace_id text,type text,status text,
      lead_id text,contract_id text,requested_by text,summary text,risk text,payload jsonb,
      decided_at timestamptz,created_at timestamptz,updated_at timestamptz);
      CREATE TABLE public.provider_action_dispatches(id text,status text,locked boolean);
      INSERT INTO public.provider_action_dispatches SELECT 'unknown-'||n,'unknown',true FROM generate_series(1,6) n`);
    const dispatchBefore = JSON.stringify((await db.query('SELECT * FROM public.provider_action_dispatches ORDER BY id')).rows);
    for (const mode of ['missing', 'admin', 'amount', 'descriptor', 'lead', 'contract', 'reread-failure', 'already-admin', 'exact-replay']) {
      const h = harness();
      const cacheBefore = JSON.stringify(h.state);
      await db.exec('TRUNCATE public.approvals');
      await db.query(`INSERT INTO public.approvals(id,workspace_id,type,status,lead_id,contract_id,payload)
        VALUES($1,'pbk','offer','pending','','',$2)`, [h.raw.id, JSON.stringify(h.raw.payload)]);
      let injected = false, expected;
      const decision = { status: 'approved', actor: 'fixture operator', actedAt: new Date().toISOString() };
      h.context.queryPgRows = async (query, values = []) => {
        const text = typeof query === 'string' ? query : query.text;
        if (!injected && /^(?:INSERT INTO|UPDATE) public\.approvals/.test(text)) {
          injected = true;
          if (mode === 'missing') await db.query('DELETE FROM public.approvals WHERE id=$1', [h.raw.id]);
          else {
            const next = { ...h.raw.payload,
              ...(mode === 'admin' || mode === 'already-admin' ? { type: 'admin', approvalAction: 'admin_update_env_var' } : {}),
              ...(mode === 'amount' ? { offerPrice: 100001 } : {}),
              ...(mode === 'descriptor' || mode === 'reread-failure' ? { offerPrice: 90001 } : {}),
              ...(mode === 'already-admin' || mode === 'exact-replay' ? decision : {}) };
            await db.query('UPDATE public.approvals SET type=$2,status=$3,payload=$4 WHERE id=$1',
              [h.raw.id, next.type, next.status, JSON.stringify(next)]);
            if (mode === 'lead' || mode === 'contract') {
              await db.query(`UPDATE public.approvals SET ${mode === 'lead' ? 'lead_id' : 'contract_id'}=$2 WHERE id=$1`,
                [h.raw.id, 'changed-association']);
            }
          }
          expected = JSON.stringify((await db.query('SELECT to_jsonb(a) row FROM public.approvals a ORDER BY id')).rows);
        }
        if (mode === 'reread-failure' && injected && /^SELECT CASE/.test(text)) {
          return { ok: false, reason: 'query_failed', rows: [] };
        }
        const result = await db.query(text, values);
        return { ok: true, rows: result.rows };
      };
      vm.runInContext(['buildApprovalSummary', 'writeApprovalRecordToPg', 'replayApprovalDecision',
        'claimPendingApprovalDecision'].map(declaration).join('\n'), h.context);
      const claim = await h.context.claimPendingApprovalDecision(h.cached, decision,
        { decisionExpected: h.raw, decisionContext: { request: h.request() } });
      assert.equal(injected, true, mode);
      assert.equal(claim.claimed, false, mode);
      assert.equal(claim.result.ok, mode === 'exact-replay', mode);
      if (mode === 'admin' || mode === 'amount' || mode === 'already-admin') assert.equal(claim.result.statusCode, 403, mode);
      if (mode === 'reread-failure') assert.equal(claim.result.statusCode, 503, mode);
      if (mode !== 'exact-replay') assert.equal(JSON.stringify(h.state), cacheBefore, mode);
      assert.equal(JSON.stringify((await db.query('SELECT to_jsonb(a) row FROM public.approvals a ORDER BY id')).rows), expected, mode);
      assert.equal(JSON.stringify((await db.query('SELECT * FROM public.provider_action_dispatches ORDER BY id')).rows), dispatchBefore);
      assert.deepEqual(h.calls.forbidden, []);
    }
  } finally { await db.close(); }
});
