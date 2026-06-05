import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const agentFleet = read('src/app/routes/AgentFleet.tsx');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:agent-registry-canonical"'),
  'package.json must expose test:agent-registry-canonical.'
);

assert(
  /fetchAgentRegistryRequest/.test(runtimeBridge) && /\/api\/agents\/registry/.test(runtimeBridge),
  'runtimeBridge must expose GET /api/agents/registry.'
);

assert(
  /type AgentRegistryResponse/.test(runtimeBridge) && /AgentRegistryRecord/.test(runtimeBridge),
  'runtimeBridge must type the agent registry response.'
);

assert(
  /fetchAgentRegistryRequest/.test(agentFleet),
  'AgentFleet must call fetchAgentRegistryRequest.'
);

assert(
  /normalizeRegistryAgents/.test(agentFleet),
  'AgentFleet must normalize bridge registry records into FleetAgent cards.'
);

assert(
  /const \[agentRegistrySource, setAgentRegistrySource\]/.test(agentFleet),
  'AgentFleet must track whether registry data came from bridge or local fallback.'
);

assert(
  /GET \/api\/agents\/registry[\s\S]*status="ships"/.test(agentFleet),
  'Agent Fleet source rail must mark GET /api/agents/registry as shipped.'
);

assert(
  /Base agent roster[\s\S]*fetchAgentRegistryRequest\(\)[\s\S]*Ships/.test(dataMap),
  'Data map must mark the base agent roster as shipped through fetchAgentRegistryRequest().'
);

console.log('agent-registry-canonical-smoke: ok');
