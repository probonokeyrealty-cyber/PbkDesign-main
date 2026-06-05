import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const leads = read('src/app/routes/Leads.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const leadsRows = dataMap
  .split(/\r?\n/)
  .filter((line) => /\| Lead list \/ pipeline rail|\| Leads cockpit/.test(line));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:leads-full-roster-bridge"'),
  'package.json must expose test:leads-full-roster-bridge.'
);

assert(
  /export async function fetchLeadsRequest/.test(runtimeBridge) && /path:\s*'\/api\/leads'/.test(runtimeBridge),
  'runtimeBridge must expose fetchLeadsRequest backed by GET /api/leads.'
);

assert(
  /fetchLeadsRequest/.test(leads),
  'Leads page must import and call fetchLeadsRequest for the canonical roster.'
);

assert(
  /const snapshotLeads = useMemo/.test(leads) && /snapshot\?\.leadImports/.test(leads),
  'Leads page must keep snapshot.leadImports only as a transparent fallback.'
);

assert(
  /const leads = useMemo\([\s\S]*leadRoster[\s\S]*snapshotLeads/.test(leads),
  'Leads page must derive visible leads from bridge roster first, then snapshot fallback.'
);

assert(
  !/const leads = useMemo\(\s*\(\) => \(Array\.isArray\(snapshot\?\.leadImports\)/.test(leads),
  'Leads page must not keep snapshot.leadImports as the primary roster.'
);

assert(
  /loadLeadRoster/.test(leads) && /leadRosterStatus/.test(leads),
  'Leads page must track canonical roster loading/error state.'
);

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/leads"[\s\S]*status="ships"[\s\S]*full lead roster/.test(
    leads
  ),
  'Leads source rail must mark GET /api/leads as the shipped full lead roster.'
);

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/state"[\s\S]*snapshot fallback/.test(leads),
  'Leads source rail must label GET /state as fallback, not the primary roster.'
);

assert(
  leadsRows.some(
    (line) =>
      line.includes('| Lead list / pipeline rail') &&
      line.includes('fetchLeadsRequest()') &&
      line.includes('GET /api/leads') &&
      line.includes('Ships')
  ),
  'Data map must document Leads pipeline as shipped through fetchLeadsRequest().'
);

console.log('leads-full-roster-bridge-smoke: ok');
