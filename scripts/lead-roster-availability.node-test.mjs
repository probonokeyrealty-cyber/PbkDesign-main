import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadAppliedBatchLeads } from './batch-apply.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const start = source.indexOf(
  "    if (request.method === 'GET' && matchesPath(pathname, ['/api/leads', '/api/leads/import']))"
);
const end = source.indexOf(
  "    if (request.method === 'POST' && pathname === '/api/lead/generate-message')",
  start
);
assert.ok(start > 0 && end > start);

async function rosterResponse(
  query,
  { hosted = true, pool = {}, runtime = [{ id: 'sample-runtime' }] } = {}
) {
  let result;
  const headers = {};
  await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
    request: { method: 'GET' },
    pathname: '/api/leads',
    matchesPath: (value, paths) => paths.includes(value),
    state: { leadImports: runtime },
    IS_HOSTED: hosted,
    getPgPool: () => pool,
    loadAppliedBatchLeads,
    queryPgRows: query,
    response: {
      setHeader: (name, value) => {
        headers[name] = value;
      },
    },
    json: (_response, status, body) => {
      result = { status, body: JSON.parse(JSON.stringify(body)), headers };
    },
  });
  return result;
}

test('the actual hosted roster route returns 503, never a successful seed-only list, when durable reads fail', async () => {
  const result = await rosterResponse(async () => ({ ok: false, reason: 'query_failed' }));
  assert.equal(result.status, 503);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.complete, false);
  assert.equal(result.body.code, 'lead_roster_unavailable');
  assert.equal(result.body.leads, undefined);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('local deliberately unconfigured sample mode does not query a nonexistent database', async () => {
  const result = await rosterResponse(
    async () => {
      throw new Error('Must not query');
    },
    { hosted: false, pool: null }
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.complete, true);
  assert.deepEqual(result.body.leads, [{ id: 'sample-runtime' }]);
});

test('confirmed durable and runtime leads are returned without dropping manual facts or DNC', async () => {
  const result = await rosterResponse(async () => ({
    ok: true,
    rows: [{ id: 'sample-durable', raw: { note: 'manual', dnc: true } }],
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.complete, true);
  assert.equal(result.body.leads.length, 2);
  assert.equal(result.body.leads[1].note, 'manual');
  assert.equal(result.body.leads[1].dnc, true);
});

test('a failed durable query cannot masquerade as an empty lead roster', async () => {
  await assert.rejects(
    loadAppliedBatchLeads(async () => ({
      ok: false,
      reason: 'query_failed',
      error: 'sample internal SQL failure',
    })),
    (error) => {
      assert.equal(error.code, 'lead_roster_unavailable');
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /SQL/);
      return true;
    }
  );
});

test('confirmed empty and populated durable queries retain their meaning', async () => {
  assert.deepEqual(await loadAppliedBatchLeads(async () => ({ ok: true, rows: [] })), []);
  let requested;
  const records = await loadAppliedBatchLeads(async (sql, params) => {
    requested = { sql, params };
    return {
      ok: true,
      rows: [
        {
          id: 'sample-exact',
          raw: { note: 'manual sample note', dnc: true },
          phone: '+12025550123',
          source: 'batch-review',
        },
      ],
    };
  }, 'sample-exact');
  assert.deepEqual(requested.params, ['sample-exact']);
  assert.match(requested.sql, /AND id = \$1/);
  assert.equal(records[0].note, 'manual sample note');
  assert.equal(records[0].dnc, true);
  assert.equal(records[0].id, 'sample-exact');
});

const fullStart = source.indexOf('function getLeadActivityItems(');
const fullEnd = source.indexOf('function summarizeTranscriptForLead(', fullStart);
const ownedContextSource = source.slice(
  source.indexOf('function getLeadOwnedCallContext('),
  source.indexOf('function buildLeadLastCallDetails(')
);
test('the full seller view excludes shared-contact history belonging to another exact lead', () => {
  const lead = {
    id: 'sample-a',
    leadId: 'sample-a',
    seller: { name: 'Shared Sample', phone: '+12025550123', email: 'sample@example.invalid' },
    property: { address: '10 Fictional Way' },
    call_context: { leadId: 'sample-b', summary: 'Foreign saved recap', last_offer: 99000 },
    callContext: { leadId: 'sample-a' },
  };
  const own = { id: 'own', leadId: 'sample-a' };
  const foreign = {
    id: 'foreign',
    leadId: 'sample-b',
    phone: lead.seller.phone,
    email: lead.seller.email,
    leadName: lead.seller.name,
    address: lead.property.address,
    text: 'Shared Sample at 10 Fictional Way',
  };
  const state = Object.fromEntries(
    ['calls', 'messages', 'contracts', 'analyzerRuns', 'activity'].map((key) => [
      key,
      [foreign, own],
    ])
  );
  const buildFull = vm.runInNewContext(
    `${ownedContextSource}\n${source.slice(fullStart, fullEnd)}\nbuildLeadFullView`,
    {
      state,
      sortNewest: (values) => values,
      plainRecord: (value) => value || {},
      inferLeadSelectedPath: () => 'cash',
      getPathDisplayLabel: () => 'Cash Offer',
      getPathDocuSignTemplateName: () => 'sample-template',
      normalizeBantInfo: (value) => value,
      normalizePhone: (value) => value,
      findLeadContext: (value) => value,
    }
  );
  const full = buildFull(lead);
  assert.notEqual(full.lead.callContext.summary, 'Foreign saved recap');
  for (const key of ['calls', 'messages', 'contracts', 'analyzerRuns', 'activity']) {
    assert.deepEqual(
      Array.from(full[key], (item) => item.id),
      ['own'],
      `${key} must be exact-ID only`
    );
  }
});

test('durable roster overflow fails explicitly instead of certifying a truncated result', async () => {
  let readSql;
  await assert.rejects(
    loadAppliedBatchLeads(async (sql) => {
      readSql = sql;
      return { ok: true, rows: Array.from({ length: 10001 }, (_, id) => ({ id: `sample-${id}` })) };
    }),
    (error) => error.code === 'lead_roster_unavailable' && error.status === 503
  );
  assert.match(readSql, /LIMIT 10001/);
});

const fullRouteStart = source.indexOf(
  "    const leadFullMatch = matchPath(pathname, '/api/leads/:id/full');"
);
const fullRouteEnd = source.indexOf('    const leadLastCallMatch =', fullRouteStart);
async function fullResponse(id, query) {
  let result;
  await vm.runInNewContext(`(async () => { ${source.slice(fullRouteStart, fullRouteEnd)} })()`, {
    pathname: `/api/leads/${encodeURIComponent(id)}/full`,
    request: { method: 'GET' },
    matchPath: (path) => path.match(/^\/api\/leads\/(?<id>[^/]+)\/full$/),
    response: { setHeader() {} },
    IS_HOSTED: true,
    getPgPool: () => ({}),
    queryPgRows: query,
    loadAppliedBatchLeads,
    decodeURIComponent,
    state: {
      leadImports: [{ id: 'sample-a', leadId: 'sample-a', email: 'sample@example.invalid' }],
    },
    buildLeadFullView: (lead) => ({
      ok: true,
      lead: typeof lead === 'object' ? lead : { id: 'sample-a', leadId: 'sample-a' },
    }),
    json: (_response, status, body) => {
      result = { status, body };
    },
  });
  return result;
}
test('the full lead route fails unavailable rather than converting a query outage to missing history', async () => {
  const result = await fullResponse('sample-a', async () => ({ ok: false }));
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'lead_roster_unavailable');
});
test('the full lead route never treats a contact address as a canonical lead ID', async () => {
  const result = await fullResponse('sample@example.invalid', async () => ({ ok: true, rows: [] }));
  assert.equal(result.status, 404);
  assert.equal(result.body.ok, false);
});
