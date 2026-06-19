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
const approvalFanoutWorkflow = readFileSync(
  resolve(root, 'n8n-lite/pbk-approval-fanout.workflow.json'),
  'utf8'
);
const skillGovernanceStore = readFileSync(
  resolve(root, 'scripts/skill-governance-store.mjs'),
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
  /async function persistContractRecordToPg/.test(bridge) &&
    /INSERT INTO public\.contracts/.test(bridge) &&
    /async function upsertContract/.test(bridge) &&
    /await persistContractRecordToPg\(nextContract\)/.test(bridge),
  'Every bridge contract mutation must await canonical Postgres projection.'
);
assert(
  /master_package_query, pdf_generated_at/.test(bridge) &&
    /template_path, template_file, negotiation_file/.test(bridge) &&
    /negotiation_prompt = EXCLUDED\.negotiation_prompt/.test(bridge),
  'Structured contract projection must preserve package, PDF, template, and negotiation metadata.'
);
assert(
  /const deletion = await queryPgRows\(`DELETE FROM public\.contracts/.test(bridge) &&
    /if \(!deletion\.ok && deletion\.reason !== 'no_database'\)/.test(bridge),
  'Contract deletion must fail visibly before removing local state when Postgres rejects the write.'
);
assert(
  /return \{ \.\.\.\(fallback \|\| \{\}\), \.\.\.value \};/.test(bridge) &&
    /callMetadataPatch[\s\S]*bant: parseBantPayload\(callMetadataPatch\.bant, nextBant\)/.test(
      bridge
    ),
  'Human BANT updates must preserve unrepresented keys and merge call metadata.'
);
assert(
  /async function backfillContractRecordsToPg/.test(bridge) &&
    /pathname === '\/api\/contracts\/backfill'/.test(bridge),
  'The bridge must expose an idempotent contract backfill from state into Postgres.'
);
assert(
  /async function loadContractRecordsFromPg/.test(bridge) &&
    /if \(postgresContracts\.ok && postgresContracts\.rows\.length\)/.test(bridge) &&
    /contractsSource: 'postgres:contracts'/.test(bridge) &&
    /contractsSource: 'bridge-state'/.test(bridge),
  'The contracts API must prefer canonical Postgres rows and label bridge-state fallback explicitly.'
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
assert(
  /FOR UPDATE SKIP LOCKED/.test(skillGovernanceStore),
  'Skill projection events must use skip-locked leasing.'
);
assert(
  /dead_lettered_at/.test(skillGovernanceStore),
  'Repeated skill projection failures must enter a dead-letter state.'
);
assert(
  /result: 'skill_authority_unavailable'[\s\S]*failClosed: true/.test(bridge),
  'Skill runtime authority failure must be explicit and fail closed.'
);
assert(
  /function isTransientPostgresConnectionError/.test(bridge) &&
    /withPostgresConnectionRetry/.test(bridge) &&
    /__pgPool\.query = \(\.\.\.args\) => withPostgresConnectionRetry/.test(bridge) &&
    /connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS/.test(bridge) &&
    /max: PG_POOL_MAX/.test(bridge) &&
    /idleTimeoutMillis: PG_IDLE_TIMEOUT_MS/.test(bridge) &&
    /maxLifetimeSeconds: PG_MAX_LIFETIME_SECONDS/.test(bridge) &&
    /keepAlive: true/.test(bridge),
  'Render Postgres transient connection refusals must be retried at the pool boundary.'
);
assert(
  /transientGraceActive/.test(bridge) &&
    /PG_TRANSIENT_GRACE_MS/.test(bridge) &&
    /consecutiveFailures/.test(bridge) &&
    /lastTransientErrorAt/.test(bridge) &&
    /poolMax: postgresHealth\.poolMax/.test(bridge),
  'Render Postgres health must expose transient recovery state without hiding persistent failures.'
);
assert(
  /function isPotentiallyStaleRenderDatabaseHost/.test(bridge) &&
    /staleRenderHost = isPotentiallyStaleRenderDatabaseHost\(host\)/.test(bridge) &&
    !/staleRenderHost = \/[^\n]+dpg-/.test(bridge),
  'Render Postgres stale-host warnings must detect raw IP pins instead of hard-coded DNS hostnames.'
);
assert(
  /function normalizeApprovalCreationResult/.test(bridge) &&
    /const approvalResult = await toolHandlers\.createApproval/.test(bridge) &&
    /const \{ approval, fanout, slack \} = normalizeApprovalCreationResult\(approvalResult\)/.test(bridge) &&
    /approvalFanout: fanout/.test(bridge),
  'Approval guard results must expose approval.id directly while keeping fanout metadata separate.'
);
assert(
  /canPlaceCalls/.test(bridge) &&
    /canSendSms/.test(bridge) &&
    /canSendEmail/.test(bridge) &&
    /canApproveProviderActions/.test(bridge) &&
    /return deny\('canSendSms', 'send SMS messages'\)/.test(bridge) &&
    /return deny\('canSendEmail', 'send emails'\)/.test(bridge) &&
    /return deny\('canPlaceCalls', 'place calls'\)/.test(bridge),
  'Team-auth bridge access must model explicit call/SMS/email permissions for manual operator actions.'
);
assert(
  /status:\s*delivery\?\.ok \? 'sent' : delivery\?\.result === 'provider_missing' \|\| !delivery \? 'provider_missing' : 'failed'/.test(
    bridge
  ) &&
    /status:\s*telnyxMeta\.voiceReady && fromNumber \? 'local_preview' : 'provider_missing'/.test(
      bridge
    ) &&
    /Telnyx voice provider missing - no live call was placed/.test(bridge),
  'Provider-missing manual call/email artifacts must not be labeled queued or live.'
);
assert(
  approvalFanoutWorkflow.includes("const decisionPath = '/webhook/pbk-approval-decision'") &&
    !approvalFanoutWorkflow.includes('approval%2520decision%2520webhook'),
  'n8n approval fanout links must use the canonical decision webhook path without double encoding.'
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
