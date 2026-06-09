import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyDocuSignConnectSignature } from './docusign-webhook-auth.mjs';

const root = process.cwd();
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const runtimeBridge = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');
const fleet = readFileSync(resolve(root, 'src/app/routes/AgentFleet.tsx'), 'utf8');
const netlify = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
const render = readFileSync(resolve(root, 'render.yaml'), 'utf8');
const workflow = readFileSync(
  resolve(root, '.github/workflows/tooling-verify.yml'),
  'utf8'
);

const publicReadBlock =
  bridge.match(/const PUBLIC_READ_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
assert(
  !publicReadBlock.includes('/api/leads/stages') &&
    !publicReadBlock.includes('/api/deals/timeline'),
  'Seller stage and deal timeline analytics must require bridge authentication.'
);

const authOptionalBlock =
  runtimeBridge.match(/function isAuthOptionalRuntimePath[\s\S]*?\n}\n/)?.[0] || '';
assert(
  !authOptionalBlock.includes('/api/leads/stages') &&
    !authOptionalBlock.includes('/api/deals/timeline'),
  'The browser client must require authentication for seller analytics.'
);

assert(
  /if \(\['queued', 'pending'\]\.includes\(normalized\)\) return 'pending';/.test(bridge),
  'Queued or pending local commands must not normalize to approved.'
);
assert(
  /result: 'local_command_not_found'[\s\S]*refusing to create a completion record/.test(bridge),
  'Unknown local command completions must fail closed.'
);
assert(
  /safety validation failed closed[\s\S]*blocked: true[\s\S]*providerWrite: true/.test(bridge),
  'Safety runtime failures must block provider writes.'
);
assert(
  /const status = 'draft';/.test(bridge) &&
    /requestedStatus === 'active'[\s\S]*current\.approvalStatus[\s\S]*current\.approvalId/.test(
      bridge
    ),
  'Campaign create and activation paths must preserve the approval boundary.'
);
assert(
  /const envelope = await bridgeRequest<[\s\S]*Object\.prototype\.hasOwnProperty\.call\(envelope, 'result'\)[\s\S]*return result as T/.test(
    runtimeBridge
  ),
  'Runtime tool calls must unwrap the bridge invoke envelope.'
);
assert(
  /const text = await response\.text\(\);[\s\S]*finally \{\s*clearTimeout\(timeoutId\);/.test(
    runtimeBridge
  ),
  'The bridge timeout must remain active while the response body is read.'
);
assert(
  /function isRegistryBackedSource/.test(fleet) &&
    fleet.includes("normalized !== 'bridge registry empty'") &&
    fleet.includes('live status unavailable') &&
    fleet.includes("'catalog'") &&
    fleet.includes("'tools unknown'"),
  'Agent Fleet fallback records must be labeled as catalog data, not live health.'
);
assert(
  /from = "\/\*"[\s\S]*to = "\/index\.shell\.html"/.test(netlify),
  'Unknown production routes must remain inside the modern React shell.'
);
assert(
  /verifyDocuSignConnectSignatureCore[\s\S]*secret: DOCUSIGN_CONNECT_HMAC_SECRET[\s\S]*requireSignature: IS_HOSTED/.test(
    bridge
  ) &&
    /pathname === '\/api\/webhooks\/docusign'[\s\S]*readDocuSignWebhookRequest/.test(
      bridge
    ),
  'The public DocuSign Connect webhook must verify the raw payload HMAC.'
);
assert(
  render.includes('PBK_DOCUSIGN_CONNECT_HMAC_SECRET'),
  'Render must declare the DocuSign Connect HMAC secret.'
);
assert(
  workflow.includes('npm run test:founder') &&
    !workflow.includes('npm run test:tooling'),
  'GitHub CI must run the complete founder release gate.'
);

const docusignSecret = 'pbk-docusign-test-secret';
const docusignPayload = Buffer.from(
  JSON.stringify({ event: 'envelope-completed', envelopeId: 'test-envelope' })
);
const docusignSignature = createHmac('sha256', docusignSecret)
  .update(docusignPayload)
  .digest('base64');
assert.equal(
  verifyDocuSignConnectSignature({
    headers: { 'x-docusign-signature-1': docusignSignature },
    rawBody: docusignPayload,
    secret: docusignSecret,
  }).ok,
  true,
  'A valid DocuSign Connect signature must be accepted.'
);
assert.equal(
  verifyDocuSignConnectSignature({
    headers: { 'x-docusign-signature-1': docusignSignature },
    rawBody: Buffer.from(`${docusignPayload.toString('utf8')} `),
    secret: docusignSecret,
  }).ok,
  false,
  'A signature must fail if the raw request body changes.'
);
assert.equal(
  verifyDocuSignConnectSignature({
    headers: {},
    rawBody: docusignPayload,
    secret: docusignSecret,
  }).status,
  401,
  'A signed DocuSign webhook configuration must reject a missing signature.'
);

console.log('production-hardening-smoke: ok');
