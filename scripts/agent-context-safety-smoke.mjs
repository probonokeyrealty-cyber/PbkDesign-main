import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const bridge = read('scripts/openclaw-local-server.mjs');
const safetyValidator = read('scripts/safety-validator.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:agent-context-safety"'),
  'package.json must expose test:agent-context-safety.'
);

assert(
  /allowImplicitContext\s*=[\s\S]*params\.allowImplicitContext === true/.test(bridge) &&
    /const fallbackImport = allowImplicitContext/.test(bridge),
  'Lead context must not borrow the first seller unless implicit context is explicitly enabled.'
);

const operatingModeTools =
  bridge.match(/const OPERATING_MODE_GATED_TOOLS = new Set\(\[([^\]]+)\]\);/)?.[1] || '';
const replayableTools =
  bridge.match(/const APPROVAL_REPLAYABLE_PROVIDER_TOOLS = new Set\(\[([^\]]+)\]\);/)?.[1] || '';

for (const toolName of ['scheduleAppointment', 'updateCRM']) {
  assert(
    operatingModeTools.includes(`'${toolName}'`),
    `${toolName} must be protected by the operating-mode approval guard.`
  );
  assert(
    replayableTools.includes(`'${toolName}'`),
    `${toolName} must be replayable after operator approval.`
  );
}

assert(
  /SELLER_BOUND_PROVIDER_TOOLS/.test(bridge) &&
    /seller_context_required/.test(bridge) &&
    /hasExplicitSellerBinding/.test(bridge),
  'Seller-bound provider actions must reject missing lead or conversation identifiers.'
);

assert(
  /invokeToolWithOperatingGuard\('scheduleAppointment'/.test(bridge) &&
    /invokeToolWithOperatingGuard\('updateCRM'/.test(bridge),
  'Natural-language agent routing must use the approval guard for appointments and CRM writes.'
);

assert(
  /executeRouteToolHandler\(\s*['"]scheduleAppointment['"]/.test(bridge),
  'The appointments HTTP route must use the shared approval and QA guard.'
);

assert(
  safetyValidator.includes("'updateCRM'"),
  'CRM writes must be classified as provider writes by the safety validator.'
);

console.log('agent-context-safety-smoke: ok');
