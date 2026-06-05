import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const callFloorPanel = read('src/app/components/CallFloorPanel.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const commandRows = dataMap
  .split(/\r?\n/)
  .filter((line) => /\| KPI strip|\| Battlefield ranked queue|\| Lead search\/results/.test(line));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:command-center-lead-roster"'),
  'package.json must expose test:command-center-lead-roster.'
);

assert(
  /export async function fetchLeadsRequest/.test(runtimeBridge) &&
    /path:\s*'\/api\/leads'/.test(runtimeBridge),
  'runtimeBridge must expose fetchLeadsRequest backed by GET /api/leads.'
);

assert(
  /fetchLeadsRequest/.test(commandCenter),
  'Command Center must import and call fetchLeadsRequest for its lead roster.'
);

assert(
  /const snapshotLeadImports =/.test(commandCenter) &&
    /snapshot\?\.leadImports/.test(commandCenter),
  'Command Center must keep snapshot.leadImports as explicit fallback.'
);

assert(
  /const leadImports = useMemo\([\s\S]*bridgeLeadRoster[\s\S]*snapshotLeadImports/.test(
    commandCenter
  ),
  'Command Center leadImports should prefer bridgeLeadRoster, then snapshotLeadImports.'
);

assert(
  /loadCommandLeadRoster/.test(commandCenter) && /leadRosterSource/.test(commandCenter),
  'Command Center must track full roster loading/source state.'
);

assert(
  /<CallFloorPanel[\s\S]*leads=\{leadImports\}[\s\S]*leadSourceEndpoint=\{leadRosterSource\}/.test(
    commandCenter
  ),
  'Command Center must pass full-roster source metadata into CallFloorPanel.'
);

assert(
  /leadSourceEndpoint/.test(callFloorPanel) &&
    /PbkDataSource[\s\S]*endpoint=\{`\$\{leadSourceEndpoint\}/.test(callFloorPanel),
  'CallFloorPanel must render a dynamic source label for its lead feed.'
);

assert(
  commandRows.some(
    (line) =>
      line.includes('| KPI strip') &&
      line.includes('fetchLeadsRequest()') &&
      line.includes('GET /api/leads') &&
      line.includes('Ships')
  ),
  'Data map must document Command Center KPI strip as full-roster backed.'
);

assert(
  commandRows.some(
    (line) =>
      line.includes('| Lead search/results') &&
      line.includes('GET /api/leads') &&
      line.includes('Ships')
  ),
  'Data map must document Call Floor lead search/results as full-roster backed.'
);

console.log('command-center-lead-roster-smoke: ok');
