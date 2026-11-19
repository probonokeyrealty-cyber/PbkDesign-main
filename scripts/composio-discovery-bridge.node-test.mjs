import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  async discoverExternalTool(params = {}) {');
const end = source.indexOf('\n  async compactLongHorizonMemory', start);
assert.ok(start > 0 && end > start, 'Existing discovery handler is extractable');
function harness(reader) {
  const audits = [], reads = [], local = [];
  const handler = new Function('discoverExternalToolCore', 'discoverComposioResearchTools', 'recordToolUse', 'recordResearchAdditiveRun', 'toolHandlers', `return ({${source.slice(start, end)}}).discoverExternalTool;`)(
    (params) => { local.push(params); return { ok: true, result: 'matched', matches: [{ toolName: 'launchBrowserResearch', risk: 'readonly' }] }; },
    async (...args) => { reads.push(args); return reader(); },
    () => {},
    (...args) => { audits.push(args); return Promise.resolve(); },
    { discoverExternalTool: true },
  );
  return { handler, audits, reads, local };
}
test('legacy local discovery never calls Composio without literal explicit opt-in', async () => {
  const h = harness(() => { throw Error('Must not call provider'); });
  for (const includeComposio of [undefined, false, 'true', 1]) {
    const result = await h.handler({ query: 'public web research', includeComposio });
    assert.equal(result.matches[0].toolName, 'launchBrowserResearch');
    assert.equal(result.composio, undefined);
  }
  assert.equal(h.reads.length, 0);
});
test('explicit catalog inspection forwards no caller data and audits after resolution', async () => {
  let resolve;
  const catalog = { source: 'composio', status: 'matched', discoveryOnly: true, tools: [] };
  const h = harness(() => new Promise(done => { resolve = done; }));
  const pending = h.handler({ query: 'public web research', includeComposio: true, leadId: 'private-lead', endpoint: 'https://untrusted.invalid', tool: 'GMAIL_SEND_EMAIL', accountId: 'private-account' });
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.reads[0], [], 'Provider reader receives no caller-selected tool, account, URL or lead data');
  assert.equal(h.audits.length, 0, 'Audit must receive completed catalog evidence, not a Promise');
  resolve(catalog);
  const result = await pending;
  assert.deepEqual(result.composio, catalog);
  assert.equal(result.matches[0].toolName, 'launchBrowserResearch');
  assert.equal(h.audits.length, 1);
  assert.deepEqual(h.audits[0][3].composio, catalog);
  assert.equal(h.audits[0][4].providerWrites, 'none');
});
test('unavailable catalog metadata retains local advisory matches', async () => {
  const h = harness(() => ({ source: 'composio', status: 'authorization_failed', discoveryOnly: true, tools: [] }));
  const result = await h.handler({ query: 'public web research', includeComposio: true });
  assert.equal(result.matches.length, 1);
  assert.equal(result.composio.status, 'authorization_failed');
});
