import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = read('package.json');
const indexHtml = read('index.html');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const openclawServer = read('scripts/openclaw-local-server.mjs');
const callModeTab = read('src/app/components/CallModeTab.tsx');

const sendDealToAgentMatch = runtimeBridge.match(
  /export async function sendDealToAgent[\s\S]*?\n}\n\nexport type ConversationListResponse/
);
assert(sendDealToAgentMatch, 'runtimeBridge must expose sendDealToAgent.');

const sendDealToAgent = sendDealToAgentMatch[0];
const legacyAnalyzerHandoffMatch = indexHtml.match(
  /async function sendAnalyzerSnapshotToAgent[\s\S]*?\n  }\n\n  function getVisibleAnalyzerFrame/
);
assert(legacyAnalyzerHandoffMatch, 'Legacy embedded analyzer must expose sendAnalyzerSnapshotToAgent.');
const legacyAnalyzerHandoff = legacyAnalyzerHandoffMatch[0];

assert(
  packageJson.includes('"test:analyzer-lead-sync"'),
  'package.json must expose test:analyzer-lead-sync.'
);

assert(
  !/invokeRuntimeTool<[^>]+>\('updateCRM'/.test(sendDealToAgent),
  'Analyzer lead sync must not invoke updateCRM, which creates Slack/admin approvals.'
);

[
  'updateCRM',
  'createApproval',
  'requestAdminAction',
  'postSlackApproval',
  'approvalRequired',
].forEach((blockedToken) => {
  assert(
    !sendDealToAgent.includes(blockedToken),
    `Analyzer lead sync must not touch approval/provider-write token ${blockedToken}.`
  );
});

[
  'updateCRM',
  'createApproval',
  'requestAdminAction',
  'postSlackApproval',
  'approvalRequired',
].forEach((blockedToken) => {
  assert(
    !legacyAnalyzerHandoff.includes(blockedToken),
    `Legacy analyzer handoff must not touch approval/provider-write token ${blockedToken}.`
  );
});

assert(
  /patchLeadRequest\(leadId,\s*{/.test(sendDealToAgent),
  'Analyzer lead sync must PATCH /api/leads/:id through patchLeadRequest.'
);

assert(
  /handleAddToCrm[\s\S]*patchLeadRequest\(leadId,\s*{/.test(callModeTab),
  'Call Mode Add to CRM must use PATCH /api/leads/:id, not approval-gated updateCRM.'
);

assert(
  !/handleAddToCrm[\s\S]*invokeRuntimeTool[^(]*\('updateCRM'/.test(callModeTab),
  'Call Mode Add to CRM must not invoke updateCRM because it creates Slack approval noise.'
);

assert(
  /source:\s*'deal_view_call_mode_manual'/.test(callModeTab) &&
    /actor:\s*'Call Mode'/.test(callModeTab),
  'Call Mode CRM sync must identify itself as a manual lead-profile edit.'
);

assert(
  /requestOpenClawApi\(`\/api\/leads\/\$\{encodeURIComponent\(leadId\)\}`/.test(
    legacyAnalyzerHandoff
  ) &&
    /method:\s*'PATCH'/.test(legacyAnalyzerHandoff),
  'Legacy analyzer handoff must PATCH /api/leads/:id instead of invoking updateCRM.'
);

[
  'const askingPrice = deal.agreedPrice || deal.price || 0',
  'const estimatedRepairs = deal.repairs?.mid || 0',
  'const mao = deal.mao60 || deal.maoRBP || 0',
  'const mortgageBalance = deal.balance || deal.mtBalanceConfirm || 0',
  'askingPrice,',
  'mao,',
  'mao60: deal.mao60',
  'maoRBP: deal.maoRBP',
  'estimatedRepairs,',
  'mortgageBalance,',
].forEach((expected) => {
  assert(sendDealToAgent.includes(expected), `Analyzer lead sync must map live DealData field: ${expected}`);
});

[
  'deal.askingPrice',
  'deal.mao,',
  'deal.repairsMid',
  'deal.repairsHigh',
  'deal.repairsLow',
].forEach((staleToken) => {
  assert(
    !sendDealToAgent.includes(staleToken),
    `Analyzer lead sync must not use stale DealData field ${staleToken}.`
  );
});

assert(
  /source:\s*'analyzer-deal-sync'/.test(sendDealToAgent) &&
    /syncedFrom:\s*'deal-analyzer'/.test(sendDealToAgent),
  'Analyzer lead sync must identify itself as routine analyzer-to-lead profile sync.'
);

assert(
  /source:\s*'analyzer-deal-sync'/.test(legacyAnalyzerHandoff) &&
    /syncedFrom:\s*'deal-analyzer'/.test(legacyAnalyzerHandoff),
  'Legacy analyzer handoff must identify itself as routine analyzer-to-lead profile sync.'
);

assert(
  /deal,/.test(sendDealToAgent) &&
    /agentDealContext,/.test(sendDealToAgent) &&
    /analyzer:/.test(sendDealToAgent),
  'Analyzer lead sync must preserve deal, analyzer, and agent context payloads.'
);

assert(
  /deal,/.test(legacyAnalyzerHandoff) &&
    /agentDealContext,/.test(legacyAnalyzerHandoff) &&
    /analyzer:\s*analyzerPayload/.test(legacyAnalyzerHandoff) &&
    /call_metadata:/.test(legacyAnalyzerHandoff),
  'Legacy analyzer handoff must preserve deal, analyzer, agent context, and call metadata.'
);

[
  'const analyzerPatch =',
  'const dealPatch =',
  'const agentDealContextPatch =',
  'body.call_metadata || body.callMetadata || body.callContext || body.call_context',
  'callContext: callContextPatch',
  'call_context: callContextPatch',
  "persistLeadProfileRowToDb(patched || nextLead, 'lead-detail-edit')",
].forEach((expected) => {
  assert(openclawServer.includes(expected), `PATCH /api/leads/:id must preserve analyzer sync context: ${expected}`);
});

assert(
  /analyzer:\s*Object\.keys\(analyzerPatch\)\.length[\s\S]*existing\?\.analyzer/.test(openclawServer) &&
    /deal:\s*Object\.keys\(dealPatch\)\.length[\s\S]*existing\?\.deal/.test(openclawServer) &&
    /agentDealContext:\s*Object\.keys\(agentDealContextPatch\)\.length[\s\S]*existing\?\.agentDealContext/.test(openclawServer),
  'PATCH /api/leads/:id must merge analyzer, deal, and agentDealContext without wiping existing lead memory.'
);

console.log('analyzer-lead-sync-smoke: ok');
