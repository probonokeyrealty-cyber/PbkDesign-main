import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const agentFleet = read('src/app/routes/AgentFleet.tsx');
const pbkCss = read('src/styles/pbk-components.css');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:agent-health-modern"'),
  'package.json must expose test:agent-health-modern.'
);

assert(
  /fetchAgentHealthRequest/.test(runtimeBridge) && /\/api\/agents\/health/.test(runtimeBridge),
  'runtimeBridge must expose GET /api/agents/health.'
);

assert(
  /AgentFleetMeasurement/.test(runtimeBridge) && /measurement\?: AgentFleetMeasurement/.test(runtimeBridge),
  'runtimeBridge must type stable Agent Fleet measurement evidence.'
);

assert(
  /fetchAgentHealthRequest/.test(agentFleet),
  'AgentFleet must call fetchAgentHealthRequest.'
);

['pbk-agent-health-strip', 'pbk-agent-health-state', 'pbk-agent-health-source'].forEach(
  (className) => {
    assert(agentFleet.includes(className), `AgentFleet must render ${className}.`);
    assert(pbkCss.includes(`.${className}`), `PBK CSS must style .${className}.`);
  }
);

assert(
  /GET \/api\/agents\/health[\s\S]*status="ships"/.test(agentFleet),
  'Agent Fleet source rail must mark GET /api/agents/health as shipped.'
);

assert(
  /GET \/api\/agents\/measurement[\s\S]*status="ships"/.test(agentFleet),
  'Agent Fleet source rail must mark GET /api/agents/measurement as shipped.'
);

assert(
  /Agent health rail[\s\S]*Ships/.test(dataMap),
  'Data map must mark Agent health rail as shipped.'
);

console.log('agent-health-modern-smoke: ok');
