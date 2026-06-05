import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const memory = read('src/app/routes/MemoryAnalytics.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const pbkCss = read('src/styles/pbk-components.css');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:memory-prototype-modern"'),
  'package.json must expose test:memory-prototype-modern.'
);

[
  'MemoryHero',
  'MemorySourceRail',
  'MemoryStatRibbon',
  'MemorySkillRow',
  'MemoryExperimentCard',
].forEach((component) => {
  assert(memory.includes(component), `Memory Analytics should include ${component}.`);
});

[
  'pbk-memory-surface',
  'pbk-memory-hero',
  'pbk-memory-source-rail',
  'pbk-memory-grid',
  'pbk-memory-stat',
  'pbk-memory-body',
  'pbk-memory-card',
  'pbk-memory-perf-row',
  'pbk-memory-ab-card',
].forEach((className) => {
  assert(
    memory.includes(className) || pbkCss.includes(`.${className}`),
    `${className} must be implemented.`
  );
});

[
  'GET /api/skills/outcomes',
  'GET /api/skills/trends',
  'GET /api/memory/events',
].forEach((endpoint) => {
  assert(memory.includes(endpoint), `Memory Analytics should surface data source ${endpoint}.`);
});

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/skills\/outcomes"[\s\S]*status="ships"/.test(memory),
  'Memory Analytics must mark GET /api/skills/outcomes as a shipped data source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/skills\/trends"[\s\S]*status="ships"/.test(memory),
  'Memory Analytics must mark GET /api/skills/trends as a shipped data source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/memory\/events"[\s\S]*status="ships"/.test(
    memory
  ),
  'Memory Analytics must mark the premium memory timeline as shipped once the bridge feed exists.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/emotion\/policies\/experiments"[\s\S]*status="ships"/.test(
    memory
  ),
  'Memory Analytics must mark active emotion-policy experiments as a shipped data source.'
);

assert(
  !/Tactical Empathy|Ackerman Negotiation|4,217|Nora|Spanish acquisitions/.test(memory),
  'Memory Analytics must not port prototype sample skills, agents, or metric counts.'
);
assert(
  /fetchSkillOutcomesRequest/.test(memory) &&
    /fetchSkillTrendsRequest/.test(memory) &&
    /fetchMemoryEventsRequest/.test(memory) &&
    /fetchActiveExperimentsRequest/.test(memory),
  'Memory Analytics must keep using real skill outcome, trend, memory-event, and experiment endpoint helpers.'
);
assert(
  runtimeBridge.includes('/api/skills/outcomes') &&
    runtimeBridge.includes('/api/skills/trends') &&
    runtimeBridge.includes('/api/memory/events'),
  'runtimeBridge must contain the Memory Analytics endpoint helpers.'
);
assert(
  dataMap.includes('/api/skills/outcomes') &&
    dataMap.includes('/api/skills/trends') &&
    dataMap.includes('/api/memory/events') &&
    dataMap.includes('/api/emotion/policies/experiments') &&
    dataMap.includes('Active memory experiments'),
  'Bridge data map must document Memory Analytics runtime sources.'
);

[
  '.pbk-memory-hero',
  '.pbk-memory-stat',
  '.pbk-memory-card',
  '.pbk-memory-perf-row',
  '.pbk-memory-ab-card',
].forEach((selector) => {
  assert(pbkCss.includes(selector), `PBK CSS should include ${selector}.`);
});

console.log('memory-prototype-modern-smoke: ok');
