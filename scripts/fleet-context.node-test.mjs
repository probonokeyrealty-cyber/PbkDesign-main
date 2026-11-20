import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fleetHref, readFleetReturn, readFleetRoute } from '../src/app/utils/fleetContext.ts';

const queue = {
  path: '/leads',
  search: '?search=Sample',
  scrollY: 320,
  leadId: 'queue-item-4',
  queue: { query: 'Sample', filter: 'hot', page: 2 },
};
const entry = {
  leadId: 'sample-47',
  agentId: 'rex',
  query: 'Sample',
  scrollY: 440,
  workspaceEntry: true,
  restoreFocus: false,
  leadReturn: queue,
};

test('round trips exact URL identity without exposing names or addresses', () => {
  const href = fleetHref('lead/47 + unit', 'rex');
  assert.deepEqual(readFleetRoute(href.slice(href.indexOf('?'))), {
    leadId: 'lead/47 + unit',
    agentId: 'rex',
    explicitLead: true,
    explicitAgent: true,
    invalid: false,
  });
});
test('keeps absent context distinct from invalid explicit context', () => {
  assert.equal(readFleetRoute('').explicitLead, false);
  for (const search of [
    '?leadId=',
    '?leadId=a&leadId=b',
    '?leadId=%00bad',
    '?agent=REX',
    '?leadId=' + 'a'.repeat(257),
    '?agent=ava&agent=rex',
  ]) {
    assert.equal(readFleetRoute(search).invalid, true, search);
  }
  assert.equal(readFleetRoute('?leadId=').explicitLead, true);
});
test('return context retains the queue item identity, filters, page and scroll', () => {
  assert.deepEqual(readFleetReturn(entry, 'sample-47'), entry);
  assert.notEqual(entry.leadReturn.leadId, entry.leadId);
});
test('return context rejects another lead, untrusted paths and malformed values', () => {
  assert.equal(readFleetReturn(entry, 'sample-48'), null);
  for (const change of [
    { leadId: '' },
    { agentId: '../rex' },
    { query: 'x'.repeat(4001) },
    { scrollY: -1 },
    { scrollY: Infinity },
    { workspaceEntry: 'true' },
    { restoreFocus: 1 },
    { leadReturn: { ...queue, path: 'https://example.invalid' } },
    { leadReturn: { ...queue, search: '//example.invalid' } },
  ]) {
    assert.equal(readFleetReturn({ ...entry, ...change }, 'sample-47'), null);
  }
  assert.equal(readFleetReturn(null, 'sample-47'), null);
});
test('no-queue entries have an explicit safe origin and no arbitrary target', () => {
  const result = readFleetReturn(
    { ...entry, leadReturn: null, target: 'https://example.invalid' },
    'sample-47'
  );
  assert.equal(result.workspaceEntry, true);
  assert.equal(result.leadReturn, null);
  assert.equal('target' in result, false);
});
