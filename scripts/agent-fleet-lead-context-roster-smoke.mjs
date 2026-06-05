import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const agentFleet = read('src/app/routes/AgentFleet.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const agentRows = dataMap
  .split(/\r?\n/)
  .filter((line) => /\| Lead context picker|\| Call selected lead/.test(line));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:agent-fleet-lead-context-roster"'),
  'package.json must expose test:agent-fleet-lead-context-roster.'
);

assert(
  /export async function fetchLeadsRequest/.test(runtimeBridge) &&
    /path:\s*'\/api\/leads'/.test(runtimeBridge),
  'runtimeBridge must expose fetchLeadsRequest backed by GET /api/leads.'
);

assert(
  /fetchLeadsRequest/.test(agentFleet),
  'Agent Fleet must import and call fetchLeadsRequest for lead context options.'
);

assert(
  /leadContextSource/.test(agentFleet) && /setLeadContextSource/.test(agentFleet),
  'Agent Fleet must track whether lead context came from full roster or snapshot fallback.'
);

assert(
  /Promise\.allSettled\(\[[\s\S]*fetchLeadsRequest\(\)[\s\S]*fetchRuntimeState\(\)[\s\S]*\]\)/.test(
    agentFleet
  ),
  'Agent Fleet must load full lead roster alongside runtime state.'
);

assert(
  /setLeadOptions\((?:fullRoster|rosterLeads)\.slice\(0,\s*25\)\)/.test(agentFleet),
  'Agent Fleet lead context picker must prefer the full /api/leads roster.'
);

assert(
  /setLeadOptions\(snapshotLeads\.slice\(0,\s*25\)\)/.test(agentFleet),
  'Agent Fleet must keep snapshot.leadImports as explicit fallback only.'
);

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/leads"[\s\S]*status="ships"[\s\S]*lead context picker/.test(
    agentFleet
  ),
  'Agent Fleet source rail must mark GET /api/leads as shipped for lead context picker.'
);

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/state"[\s\S]*snapshot fallback/.test(agentFleet),
  'Agent Fleet source rail must label GET /state as snapshot fallback.'
);

assert(
  agentRows.some(
    (line) =>
      line.includes('| Lead context picker') &&
      line.includes('fetchLeadsRequest()') &&
      line.includes('GET /api/leads') &&
      line.includes('Ships')
  ),
  'Data map must document Agent Fleet lead context picker as shipped through fetchLeadsRequest().'
);

console.log('agent-fleet-lead-context-roster-smoke: ok');
