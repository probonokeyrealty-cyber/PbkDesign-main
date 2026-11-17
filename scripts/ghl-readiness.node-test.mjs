import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, copyFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

let evaluateReadiness;
try { ({ evaluateReadiness } = await import('./lib/ghl-readiness.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

const names = [
  'PBK Property Street Address', 'PBK Property City', 'PBK Property State', 'PBK Property ZIP',
  'PBK Property County', 'PBK Parcel ID (APN)', 'PBK PropStream Property Type',
  'PBK PropStream Record Reference', 'PBK Property Research As Of',
  'PBK Handoff Summary & Next Step', 'PBK Next Step Due Date', 'PBK Next Step Status', 'PBK Next Step Task ID',
];
const values = ['10 Example Lane', 'Example City', 'CA', '90001', 'Example County', '001-002', 'Land',
  'https://example.com/source', '2026-11-16', 'Review the property evidence', '2026-11-17', 'Pending', 'task-a'];
const now = '2026-11-17T02:00:00Z'; // November 16, 6pm in Los Angeles.
function fixture() {
  return {
    contacts: [{ id: 'contact-a', name: 'Sample Seller', email: 'sample@example.com', dnd: true, tags: [] }],
    opportunities: [{ id: 'property-a', contactId: 'contact-a', name: 'Sample property', status: 'open', assignedTo: 'staff-a',
      customFields: names.map((_, i) => ({ id: `field-${i}`, fieldValue: values[i] })) }],
    fieldDefinitions: names.map((name, i) => ({ id: `field-${i}`, name, model: 'opportunity' })),
    tasks: [{ id: 'task-a', contactId: 'contact-a', opportunityId: 'property-a', completed: false,
      assignedTo: 'staff-a', dueDate: '2026-11-17' }], tasksComplete: true,
  };
}
function run(input = fixture(), options = {}) {
  assert.equal(typeof evaluateReadiness, 'function', 'the read-only HighLevel evaluator must exist');
  return evaluateReadiness(input, { now, timeZone: 'America/Los_Angeles', ...options });
}
const row = result => result.records[0];
const set = (s, index, value) => { s.opportunities[0].customFields[index].fieldValue = value; };

test('land gets 11 captured intake checks without inventing bedroom requirements or outreach clearance', () => {
  const result = run();
  assert.deepEqual(row(result).completeness, { captured: 11, total: 11, missing: [], invalid: [] });
  assert.equal(row(result).dnd, 'on');
  assert.equal(row(result).outreachAllowed, false);
  assert.deepEqual(result.writes, []);
  assert.equal(row(result).ownerId, 'staff-a');
  assert.equal(row(result).nextStep.state, 'scheduled');
});

test('unknown placeholders are gaps, numeric zero is preserved, and invalid source dates are not complete', () => {
  const input = fixture(); set(input, 0, 'unknown'); set(input, 5, 0); set(input, 8, '2026-02-30');
  const result = run(input);
  assert.equal(row(result).completeness.captured, 9);
  assert.deepEqual(row(result).completeness.missing, ['Street address']);
  assert.deepEqual(row(result).completeness.invalid, ['Research as of']);
  assert.deepEqual(result.queues.incomplete, ['property-a']);
});

test('QA signals in contact, opportunity, tags, and source each exclude records from operational queues', () => {
  for (const mutate of [
    s => { s.contacts[0].name = 'PBK QA Seller'; },
    s => { s.contacts[0].tags = ['no-outreach-test']; },
    s => { s.opportunities[0].name = 'QA NO OUTREACH property'; },
    s => { s.opportunities[0].source = 'PropStream QA export'; },
    s => { s.contacts[0].isQa = true; },
  ]) {
    const input = fixture(); mutate(input); input.opportunities[0].assignedTo = ''; set(input, 0, '');
    const result = run(input);
    assert.equal(row(result).excludedReason, 'qa');
    assert.deepEqual(result.excluded.qa, ['property-a']);
    for (const ids of Object.values(result.queues)) assert.deepEqual(ids, []);
  }
});

test('DND remains restricted even for complete records and missing DND is unknown rather than cleared', () => {
  const input = fixture(); delete input.contacts[0].dnd;
  const result = run(input);
  assert.equal(row(result).dnd, 'unknown'); assert.equal(row(result).outreachAllowed, false);
  input.contacts[0].dnd = false;
  input.contacts[0].dndSettings = { SMS: { status: 'active' } };
  assert.equal(row(run(input)).dnd, 'restricted');
});

test('native property owner is required; contact owner and accepted-by prose cannot supply it', () => {
  const input = fixture(); delete input.opportunities[0].assignedTo; input.contacts[0].assignedTo = 'staff-a';
  const result = run(input);
  assert.equal(row(result).ownerId, null);
  assert.deepEqual(result.queues.unassigned, ['property-a']);
});

test('date-only due today is not overdue in the property operating timezone', () => {
  const input = fixture(); set(input, 10, '2026-11-16'); input.tasks[0].dueDate = '2026-11-16';
  assert.equal(row(run(input)).nextStep.state, 'due_today');
  assert.deepEqual(run(input).queues.overdue, []);
  assert.equal(row(run(input, { now: '2026-11-17T08:00:00Z' })).nextStep.state, 'overdue');
});

test('mixed due-date precision preserves the calendar-only operand when comparing local days', () => {
  const input = fixture(); input.tasks[0].dueDate = '2026-11-17T09:00:00-08:00';
  assert.ok(!row(run(input)).issues.includes('task_due_mismatch'));
  input.tasks[0].dueDate = '2026-11-16T09:00:00-08:00';
  assert.ok(row(run(input)).issues.includes('task_due_mismatch'));
});

test('offset-free timestamps and impossible calendar dates need review instead of guessed times', () => {
  for (const value of ['2026-11-17T09:30:00', '2026-02-30', '2026-11-16T25:00:00Z', '11/17/2026']) {
    const input = fixture(); set(input, 10, value);
    assert.equal(row(run(input)).nextStep.state, 'invalid_date', value);
    assert.deepEqual(run(input).queues.missingNextStep, ['property-a']);
  }
});

test('explicit instants compare precisely and completed next steps do not appear overdue', () => {
  const input = fixture(); set(input, 10, '2026-11-16T17:00:00-08:00');
  assert.equal(row(run(input)).nextStep.state, 'overdue');
  set(input, 11, 'Completed'); input.tasks[0].completed = true;
  const result = run(input);
  assert.equal(row(result).nextStep.state, 'completed');
  assert.deepEqual(result.queues.overdue, []);
  assert.deepEqual(result.queues.missingNextStep, ['property-a']);
});

test('multiple current tasks and owner disagreement are review issues, not new task proposals', () => {
  const input = fixture(); input.tasks.push({ ...input.tasks[0], id: 'task-b', assignedTo: 'staff-b' });
  const result = run(input);
  assert.ok(row(result).issues.includes('multiple_current_tasks'));
  assert.ok(row(result).issues.includes('task_owner_mismatch'));
  assert.deepEqual(result.queues.accountabilityReview, ['property-a']);
  assert.deepEqual(result.writes, []);
});

test('completed history and unrelated tasks cannot satisfy a current property task', () => {
  const input = fixture(); input.tasks[0].completed = true;
  input.tasks.push({ ...input.tasks[0], id: 'unrelated', opportunityId: 'property-b', completed: false });
  const result = run(input);
  assert.equal(row(result).nextStep.currentTasks, 0);
  assert.ok(row(result).issues.includes('referenced_task_completed'));
});

test('incomplete task snapshots show unknown absence and cannot certify readiness', () => {
  const input = fixture(); input.tasks = []; input.tasksComplete = false;
  const result = run(input);
  assert.equal(row(result).nextStep.currentTasks, null);
  assert.ok(row(result).issues.includes('task_snapshot_incomplete'));
  assert.ok(!row(result).issues.includes('referenced_task_missing'));
});

test('one contact can own multiple distinct properties without cross-linking their tasks', () => {
  const input = fixture();
  input.opportunities.push({ ...structuredClone(input.opportunities[0]), id: 'property-b', assignedTo: 'staff-b' });
  input.opportunities[1].customFields[0].fieldValue = '20 Example Lane';
  input.opportunities[1].customFields[5].fieldValue = '003-004';
  input.opportunities[1].customFields[12].fieldValue = 'task-b';
  input.tasks.push({ ...input.tasks[0], id: 'task-b', opportunityId: 'property-b', assignedTo: 'staff-b' });
  const result = run(input);
  assert.deepEqual(result.records.map(r => r.nextStep.currentTasks), [1, 1]);
  assert.deepEqual(result.queues.duplicateReview, []);
  assert.deepEqual(result.queues.accountabilityReview, []);
});

test('one contact-level task referenced by two active properties cannot count as their individual next steps', () => {
  const input = fixture(); delete input.tasks[0].opportunityId;
  const second = structuredClone(input.opportunities[0]); second.id = 'property-b';
  second.customFields[0].fieldValue = '20 Example Lane'; second.customFields[5].fieldValue = '003-004';
  input.opportunities.push(second);
  const result = run(input);
  for (const record of result.records) {
    assert.equal(record.nextStep.currentTasks, 0);
    assert.ok(record.issues.includes('task_reference_shared_between_properties'));
  }
  assert.deepEqual(result.queues.accountabilityReview, ['property-a', 'property-b']);
});

test('malformed task links and completion flags cannot be treated as absent links or current tasks', () => {
  for (const value of [{ id: 'property-other' }, false, ['property-a']]) {
    const input = fixture(); input.tasks[0].opportunityId = value;
    assert.throws(() => run(input), /task.*opportunityId/i);
  }
  const input = fixture(); input.tasks[0].completed = 'true'; input.tasks[0].status = 'open';
  assert.throws(() => run(input), /task.*completed/i);
});

test('unrecognized next-step status and contradictory task status are explicit review gaps', () => {
  const input = fixture(); set(input, 11, 'garbage');
  const result = run(input);
  assert.equal(row(result).nextStep.state, 'invalid_status');
  assert.deepEqual(result.queues.missingNextStep, ['property-a']);
  const contradictory = fixture(); contradictory.tasks[0].completed = true; contradictory.tasks[0].status = 'open';
  assert.ok(row(run(contradictory)).issues.includes('task_status_conflict'));
});

test('malformed DND channel evidence stays unknown and cannot imply unrestricted channels', () => {
  const input = fixture(); input.contacts[0].dnd = false; input.contacts[0].dndSettings = { SMS: { status: 'garbage' } };
  assert.equal(row(run(input)).dnd, 'unknown');
});

test('repeated identical IDs collapse; conflicting repeated IDs fail instead of losing evidence', () => {
  const input = fixture(); input.contacts.push(structuredClone(input.contacts[0]));
  input.opportunities.push(structuredClone(input.opportunities[0])); input.tasks.push(structuredClone(input.tasks[0]));
  assert.equal(run(input).records.length, 1);
  input.contacts[1].name = 'Different person';
  assert.throws(() => run(input), /Conflicting contact ID/);
});

test('different IDs sharing property identity are quarantined, never merged or queued for sales work', () => {
  const input = fixture(); input.opportunities.push({ ...structuredClone(input.opportunities[0]), id: 'property-b' });
  const result = run(input);
  assert.deepEqual(result.queues.duplicateReview, ['property-a', 'property-b']);
  assert.deepEqual(result.queues.incomplete, []);
  assert.equal(result.records.length, 2);
  assert.equal(row(result).excludedReason, 'potential_duplicate');
});

test('missing IDs, links, field definitions and ambiguous names fail visibly', () => {
  const missing = fixture(); delete missing.opportunities[0].id;
  assert.throws(() => run(missing), /opportunity.*ID/i);
  const orphan = fixture(); orphan.opportunities[0].contactId = 'absent';
  assert.throws(() => run(orphan), /contact.*absent/i);
  const schema = fixture(); schema.fieldDefinitions.pop();
  assert.throws(() => run(schema), /PBK Next Step Task ID/);
  const ambiguous = fixture(); ambiguous.fieldDefinitions.push({ id: 'other', name: names[0], model: 'opportunity' });
  assert.throws(() => run(ambiguous), /Ambiguous/);
});

test('closed properties are excluded and evaluation is deterministic without mutating source', () => {
  const input = fixture(); input.opportunities[0].status = 'abandoned';
  const original = structuredClone(input); const first = run(input);
  assert.equal(row(first).excludedReason, 'not_open');
  assert.deepEqual(first.excluded.notOpen, ['property-a']);
  assert.deepEqual(first, run(input)); assert.deepEqual(input, original);
  assert.throws(() => run(input, { now: 'not-a-date' }), /now/i);
});

const privateRoot = resolve('.pbk-local');
mkdirSync(privateRoot, { recursive: true });
const cliDir = mkdtempSync(join(privateRoot, 'ghl-readiness-test-'));
const inputPath = join(cliDir, 'input.json');
writeFileSync(inputPath, JSON.stringify(fixture()));
const cli = args => spawnSync(process.execPath, ['scripts/preview-ghl-readiness.mjs', ...args], { encoding: 'utf8' });

test('CLI produces deterministic private reports without changing its input or making provider writes', () => {
  const output = join(cliDir, 'reports');
  const before = readFileSync(inputPath, 'utf8');
  const args = ['--input', inputPath, '--output-dir', output, '--now', now];
  const first = cli(args);
  assert.equal(first.status, 0, first.stderr);
  const report = readFileSync(join(output, 'report.json'), 'utf8');
  assert.deepEqual(JSON.parse(report).writes, []);
  assert.equal(cli(args).status, 0);
  assert.equal(readFileSync(join(output, 'report.json'), 'utf8'), report);
  assert.equal(readFileSync(inputPath, 'utf8'), before);
  assert.match(readFileSync(join(output, 'report.md'), 'utf8'), /preview.only/i);
});

test('CLI rejects public output, unknown write flags and invalid snapshots before creating reports', () => {
  const publicOutput = resolve('ghl-public-output-must-not-exist');
  const outside = cli(['--input', inputPath, '--output-dir', publicOutput, '--now', now]);
  assert.notEqual(outside.status, 0); assert.match(outside.stderr, /\.pbk-local/);
  assert.equal(existsSync(publicOutput), false);
  const write = cli(['--input', inputPath, '--output-dir', join(cliDir, 'blocked-write'), '--now', now, '--publish']);
  assert.notEqual(write.status, 0); assert.match(write.stderr, /Unknown argument/);
  assert.equal(existsSync(join(cliDir, 'blocked-write')), false);
  const invalid = join(cliDir, 'invalid.json'); writeFileSync(invalid, '{}');
  const bad = cli(['--input', invalid, '--output-dir', join(cliDir, 'invalid-report'), '--now', now]);
  assert.notEqual(bad.status, 0); assert.equal(existsSync(join(cliDir, 'invalid-report')), false);
});

test('CLI refuses to overwrite source snapshots', () => {
  const source = join(cliDir, 'report.json'); const original = JSON.stringify(fixture()); writeFileSync(source, original);
  const collision = cli(['--input', source, '--output-dir', cliDir, '--now', now]);
  assert.notEqual(collision.status, 0); assert.match(collision.stderr, /source/i);
  assert.equal(readFileSync(source, 'utf8'), original);
});

test('CLI rejects an output junction escaping the private root', t => {
  // A directory inside this repo but outside the allowed private root.
  const target = mkdtempSync(join(resolve('scripts'), '.ghl-output-link-test-'));
  const link = join(cliDir, 'output-junction'); symlinkSync(target, link, 'junction');
  t.after(() => { unlinkSync(link); rmdirSync(target); });
  const result = cli(['--input', inputPath, '--output-dir', link, '--now', now]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /escapes|outside/i);
  assert.equal(existsSync(join(target, 'report.json')), false);
});

test('CLI rejects a private-root junction even if its target is inside the repository public tree', () => {
  // Run an isolated copy to avoid changing this checkout's actual .pbk-local directory.
  const isolated = join(cliDir, 'isolated-repo');
  for (const dir of ['scripts/lib', 'config/ghl', 'public']) mkdirSync(join(isolated, dir), { recursive: true });
  for (const path of ['scripts/preview-ghl-readiness.mjs', 'scripts/lib/ghl-readiness.mjs', 'config/ghl/wholesale-readiness.v1.json']) {
    copyFileSync(resolve(path), join(isolated, path));
  }
  symlinkSync(join(isolated, 'public'), join(isolated, '.pbk-local'), 'junction');
  const result = spawnSync(process.execPath, [join(isolated, 'scripts/preview-ghl-readiness.mjs'), '--input', inputPath,
    '--output-dir', join(isolated, '.pbk-local/reports'), '--now', now], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /private.*root|\.pbk-local.*link/i);
  assert.equal(existsSync(join(isolated, 'public/reports/report.json')), false);
});
