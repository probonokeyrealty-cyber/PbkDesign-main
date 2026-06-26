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

for (const toolName of ['sendSellerDocs', 'startNurtureSequence']) {
  assert(
    safetyValidator.includes(`'${toolName}'`),
    `${toolName} must be classified as a provider write by the safety validator.`
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
  /async function executeManualProviderRouteWithOutbox[\s\S]*providerCircuitBreaker\.execute[\s\S]*executeRouteToolHandler\(\s*toolName[\s\S]*buildRouteToolResponse\(routeTool\)/.test(bridge),
  'Manual provider outbox wrapper must delegate to the shared approval, safety, QA, and response guard.'
);

for (const [toolName, routeName] of [
  ['prepare_and_send_contract', 'contract-send-route'],
  ['sendColdEmail', 'cold-email-route'],
]) {
  assert(
    bridge.includes(`executeRouteToolHandler('${toolName}'`) && bridge.includes(routeName),
    `${toolName} route must use the shared approval, safety, and QA guard.`
  );
}

for (const [toolName, routeName] of [
  ['telnyx_call', 'calls-route'],
  ['telnyx_sms', 'messages-route'],
  ['sendColdEmail', 'messages-route'],
  ['telnyx_sms', 'lead-send-message'],
  ['sendColdEmail', 'lead-send-message'],
  ['sendSellerDocs', 'seller-docs-route'],
]) {
  assert(
    new RegExp(
      `executeManualProviderRouteWithOutbox\\(\\{[\\s\\S]*toolName:\\s*['"]${toolName}['"][\\s\\S]*source:\\s*['"]${routeName}['"]`
    ).test(bridge),
    `${toolName} ${routeName} path must use the manual provider outbox wrapper.`
  );
}

assert(
  /executeManualProviderRouteWithOutbox\(\{[\s\S]*toolName:\s*parsed\.channel === 'sms'\s*\?\s*'telnyx_sms'\s*:\s*'sendColdEmail'[\s\S]*source:\s*'unified-conversation-send'/.test(bridge),
  'Unified conversation sends must route SMS and email through the manual provider outbox wrapper.'
);

assert(
  /pathname === '\/api\/cold-email\/send'[\s\S]*const routeTool = await executeRouteToolHandler\('sendColdEmail'[\s\S]*buildRouteToolResponse\(routeTool\)/.test(bridge),
  'Cold email route must preserve QA and safety metadata in the HTTP response.'
);

assert(
  /pathname === '\/api\/lead\/send-message'[\s\S]*executeManualProviderRouteWithOutbox\(\{[\s\S]*toolName:\s*'telnyx_sms'[\s\S]*\.\.\.send\.response[\s\S]*executeManualProviderRouteWithOutbox\(\{[\s\S]*toolName:\s*'sendColdEmail'[\s\S]*\.\.\.send\.response/.test(bridge),
  'Lead send-message route must preserve QA and safety metadata for SMS and email branches.'
);

assert(
  safetyValidator.includes("'updateCRM'"),
  'CRM writes must be classified as provider writes by the safety validator.'
);

for (const source of ['leads_page_manual', 'call_floor_manual', 'seller_docs_manual']) {
  assert(
    safetyValidator.includes(`'${source}'`),
    `${source} must be recognized as a trusted human/manual source.`
  );
}

assert(
  /QA validation failed closed[\s\S]*ok:\s*false[\s\S]*reason:\s*'qa_runtime_error'/.test(bridge),
  'QA runtime errors must fail closed instead of being treated as successful skipped QA.'
);

console.log('agent-context-safety-smoke: ok');
