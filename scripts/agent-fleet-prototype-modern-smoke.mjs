import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const agentFleet = read('src/app/routes/AgentFleet.tsx');
const pbkCss = read('src/styles/pbk-components.css');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:agent-fleet-prototype-modern"'),
  'package.json must expose test:agent-fleet-prototype-modern.'
);

[
  'AgentFleetHero',
  'AgentFleetCard',
  'AgentDetailPanel',
  'AgentFleetSourceRail',
].forEach((component) => {
  assert(agentFleet.includes(component), `Agent Fleet should include ${component}.`);
});

[
  'pbk-fleet-surface',
  'pbk-fleet-hero',
  'pbk-fleet-layout',
  'pbk-agent-grid',
  'pbk-agent-card',
  'pbk-agent-activity',
  'pbk-agent-detail-panel',
  'pbk-dp-head',
  'pbk-skill-row',
].forEach((className) => {
  assert(
    agentFleet.includes(className) || pbkCss.includes(`.${className}`),
    `${className} must be implemented.`
  );
});

[
  'GET /api/agents/registry',
  'GET /api/tooling/status',
  'GET /api/agents/health',
  'GET /state',
  'GET /api/agents/snn-status',
  'POST /invoke: previewAgentDealContext',
  'POST /invoke: pbk_transfer_agent_skill',
  'POST /invoke: telnyx_call',
  'POST /api/agents/deploy',
].forEach((endpoint) => {
  assert(agentFleet.includes(endpoint), `Agent Fleet should surface data source ${endpoint}.`);
});

assert(
  /PbkDataSource[\s\S]*GET \/api\/agents\/registry[\s\S]*status="ships"/.test(agentFleet),
  'Agent Fleet must mark the canonical agent registry as a shipped data source.'
);
assert(
  /PbkDataSource[\s\S]*GET \/api\/agents\/snn-status[\s\S]*status="ships"/.test(agentFleet),
  'Agent Fleet must mark durable SNN status as a shipped data source.'
);
assert(
  /PbkDataSource[\s\S]*POST \/api\/agents\/deploy[\s\S]*status="ships"/.test(agentFleet) &&
    /Request deployment/.test(agentFleet),
  'Agent Fleet must expose a shipped approval-gated deploy request action.'
);
assert(
  !/Diane Kowalski|Probate Warm-up|Nora|Spanish Acquisitions/.test(agentFleet),
  'Agent Fleet must not port prototype sample agents or sellers.'
);
assert(
  dataMap.includes('/api/agents/registry') &&
    dataMap.includes('/api/tooling/status') &&
    dataMap.includes('pbk_transfer_agent_skill'),
  'Bridge data map must document Agent Fleet runtime sources.'
);

[
  '.pbk-fleet-hero',
  '.pbk-agent-card',
  '.pbk-agent-activity',
  '.pbk-agent-detail-panel',
  '.pbk-skill-row',
].forEach((selector) => {
  assert(pbkCss.includes(selector), `PBK CSS should include ${selector}.`);
});

console.log('agent-fleet-prototype-modern-smoke: ok');
