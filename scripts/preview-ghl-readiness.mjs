import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, lstatSync, renameSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { evaluateReadiness } from './lib/ghl-readiness.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateRoot = join(repoRoot, '.pbk-local');
const inside = (base, path) => { const rel = relative(base, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)); };
const cell = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\r\n]+/g, ' ');

function argsFrom(argv) {
  const accepted = new Set(['--input', '--output-dir', '--now']);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!accepted.has(key)) throw new Error(`Unknown argument: ${key}`);
    if (args[key]) throw new Error(`Repeated argument: ${key}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key] = argv[i + 1];
  }
  for (const key of accepted) if (!args[key]) throw new Error(`Required argument: ${key}`);
  return args;
}

function markdown(report) {
  return [
    '# PBK HighLevel readiness preview', '',
    '**Preview only. No CRM records, workflows, owners, tasks, DND settings, or outreach were changed.**', '',
    `As of: ${report.asOf} · ${report.timeZone}`, '', report.coverageLabel, '',
    '## Internal review queues', '',
    '| Queue | Properties |', '| --- | ---: |',
    ...Object.entries(report.queues).map(([key, ids]) => `| ${key} | ${ids.length} |`), '',
    `QA excluded: ${report.excluded.qa.length}. Non-open excluded: ${report.excluded.notOpen.length}.`, '',
    'DND records are restricted to internal data review. These queues never authorize outreach.', '',
    '## Record diagnostics', '',
    '| Property ID | Coverage | Owner ID | Next step | DND | Exclusion | Issues |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.records.map(row => `| ${cell(row.opportunityId)} | ${row.completeness.captured}/${row.completeness.total} | ${cell(row.ownerId)} | ${cell(row.nextStep.state)} | ${cell(row.dnd)} | ${cell(row.excludedReason)} | ${cell([...row.completeness.missing, ...row.completeness.invalid.map(f => `${f} (invalid)`), ...row.issues].join('; '))} |`), '',
    'All source facts remain unchanged. Potential duplicates require human review; no records are merged. A complete snapshot is required before task absence can be established.', '',
  ].join('\n');
}

function run() {
  const args = argsFrom(process.argv.slice(2));
  const input = realpathSync(resolve(args['--input']));
  const output = resolve(args['--output-dir']);
  if (!inside(privateRoot, output)) throw new Error('Private reports must stay beneath this repo .pbk-local directory');
  const destinations = ['report.json', 'report.md'].map(name => join(output, name));
  if (destinations.some(path => resolve(input).toLowerCase() === path.toLowerCase())) throw new Error('Output would overwrite the source snapshot');
  // Validate/evaluate everything before creating report directories or touching old reports.
  const report = evaluateReadiness(JSON.parse(readFileSync(input, 'utf8')), { now: args['--now'] });
  if (existsSync(privateRoot) && lstatSync(privateRoot).isSymbolicLink()) throw new Error('Private output root .pbk-local must not be a link or junction');
  mkdirSync(privateRoot, { recursive: true });
  const rootReal = realpathSync(privateRoot);
  if (!inside(realpathSync(repoRoot), rootReal)) throw new Error('.pbk-local resolves outside the workspace');
  let ancestor = output;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (!inside(rootReal, realpathSync(ancestor))) throw new Error('Output link escapes .pbk-local');
  mkdirSync(output, { recursive: true });
  if (!inside(rootReal, realpathSync(output))) throw new Error('Output resolves outside .pbk-local');
  for (const path of destinations) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Report file links are not allowed');
    if (existsSync(path) && realpathSync(path).toLowerCase() === input.toLowerCase()) throw new Error('Output would overwrite the source snapshot');
  }
  for (const [index, content] of [JSON.stringify(report, null, 2) + '\n', markdown(report)].entries()) {
    const path = destinations[index];
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, content, { flag: 'wx' });
    renameSync(temporary, path);
  }
  console.log(`Read-only preview: ${report.records.length} existing properties; ${report.excluded.qa.length} QA excluded; 0 provider writes. Reports saved beneath .pbk-local.`);
}

try { run(); }
catch (error) { console.error(`Preview failed: ${error.message}`); process.exitCode = 1; }
