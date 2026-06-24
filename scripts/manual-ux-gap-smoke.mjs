import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractObjectBlock(source, id) {
  const idIndex = source.indexOf(`id: '${id}'`);
  assert(idIndex >= 0, `Could not find ${id} companion action.`);
  const start = source.lastIndexOf('{', idIndex);
  const end = source.indexOf('},', idIndex);
  assert(start >= 0 && end > start, `Could not extract ${id} companion action block.`);
  return source.slice(start, end + 2);
}

function extractRouteBlockByAction(source, action) {
  const actionIndex = source.indexOf(`action: '${action}'`);
  assert(actionIndex >= 0, `Could not find ${action} route.`);
  const start = source.lastIndexOf('{', actionIndex);
  const end = source.indexOf('},', actionIndex);
  assert(start >= 0 && end > start, `Could not extract ${action} route block.`);
  return source.slice(start, end + 2);
}

function extractCssBlock(source, selector) {
  const start = source.indexOf(selector);
  assert(start >= 0, `Could not find ${selector} CSS block.`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  assert(open >= 0 && close > open, `Could not extract ${selector} CSS block.`);
  return source.slice(open + 1, close);
}

const avaChat = read('src/app/routes/AvaChat.tsx');
const composer = read('src/app/components/inbox/ConversationComposer.tsx');
const leads = read('src/app/routes/Leads.tsx');
const bridge = read('scripts/openclaw-local-server.mjs');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const styles = read('src/styles/pbk-components.css');
const shellStyles = read('src/styles/index.css');

for (const id of ['send-sms', 'send-email', 'call-seller']) {
  const block = extractObjectBlock(avaChat, id);
  assert(
    /requiresApproval:\s*false/.test(block),
    `${id} must stay in the human/manual lane without approval by default.`
  );
}

for (const action of ['send_email', 'send_sms']) {
  const block = extractRouteBlockByAction(avaChat, action);
  assert(
    /requiresApproval:\s*false/.test(block),
    `Ava Chat typed ${action} commands must route to draft/manual mode without approval.`
  );
}
assert(
  !/Draft seller (?:email|text) and keep sending behind approval/.test(avaChat),
  'Ava Chat must not show old manual-send approval-gate copy.'
);
assert(
  /<AdvancedSettings[\s\S]*compact/.test(avaChat) &&
    /Mobile command settings/.test(avaChat) &&
    /pbk-ava-advanced-settings/.test(avaChat) &&
    /pbk-ava-lane-toggle/.test(avaChat) &&
    /pbk-ava-mobile-settings-popover/.test(avaChat),
  'Ava Chat mobile mode must expose execution lane controls in a compact settings drawer.'
);
assert(
  /\.pbk-ava-chat-action-rail[\s\S]*flex-wrap:\s*wrap/.test(styles) &&
    /\.pbk-ava-chat-action-rail button[\s\S]*flex:\s*1 1 calc\(50% - 6px\)/.test(styles),
  'Ava Chat mobile quick actions must wrap instead of overflowing the viewport.'
);
assert(
  /\.pbk-ava-advanced-settings\.is-compact[\s\S]*overflow:\s*hidden/.test(styles) &&
    /\.pbk-ava-mobile-settings-popover[\s\S]*right:\s*-50px/.test(styles) &&
    /\.pbk-ava-advanced-settings\.is-compact \.pbk-ava-lane-toggle button[\s\S]*text-overflow:\s*ellipsis/.test(
      styles
    ),
  'Ava Chat compact command settings must not bleed segmented controls off mobile viewports.'
);

const contextValueCss = extractCssBlock(styles, '.pbk-lead-context-row strong');
assert(
  !/overflow-wrap:\s*anywhere/.test(contextValueCss),
  'Lead context values must not split short words such as Unknown.'
);
assert(
  /text-overflow:\s*ellipsis/.test(contextValueCss) &&
    /word-break:\s*normal/.test(contextValueCss),
  'Lead context values must truncate or wrap normally instead of fragmenting words.'
);

assert(
  /async function fireWebhook[\s\S]*AbortController[\s\S]*setTimeout\(\(\) => controller\.abort\(\),\s*2500\)/.test(
    bridge
  ),
  'Approval webhook fanout must have a bounded timeout.'
);
assert(
  /const \[fanout, slack\] = await Promise\.all\(\[[\s\S]*approval webhook fanout[\s\S]*postSlackApproval\(approval\)[\s\S]*approval Slack fanout/.test(
    bridge
  ),
  'Approval creation must bound n8n and Slack fanout so UI actions do not time out.'
);
assert(
  /canRetrySend/.test(composer) &&
    /sendMessage\(\{ retry: true \}\)/.test(composer) &&
    /if \(options\.retry \? !canRetrySend : !canSend\) return;/.test(composer) &&
    /setSubmittedFingerprint\(submittedSendFingerprint\)/.test(composer) &&
    /setSubmittedFingerprint\(''\)/.test(composer),
  'Unified Inbox retry must bypass the duplicate-submission fingerprint while preserving send validation.'
);
assert(
  /<form[\s\S]*onSubmit=\{\(event\) => \{[\s\S]*void createLead\(\);[\s\S]*type="submit"[\s\S]*Create lead/.test(
    leads
  ),
  'New PBK Lead must be a real form so Enter and the submit button use the same validation path.'
);
assert(
  /pathname === '\/api\/send-seller-docs'[\s\S]*executeManualProviderRouteWithOutbox\(\{[\s\S]*toolName:\s*'sendSellerDocs'[\s\S]*source:\s*'seller-docs-route'/.test(
    bridge
  ),
  'Seller document sends must use the manual outbox route instead of an approval-only provider route.'
);
assert(
  /export async function sendSellerDocsRequest[\s\S]*manual:\s*body\.manual === false \? false : true[\s\S]*manualSend:\s*body\.manualSend === false \? false : true[\s\S]*source:\s*body\.source \|\| 'seller_docs_manual'/.test(
    runtimeBridge
  ),
  'Seller document sends from the UI must carry human/manual metadata.'
);
assert(
  /export async function planLeadNurtureRequest[\s\S]*source:\s*body\.source \|\| 'leads_page_manual'[\s\S]*manual:\s*body\.manual === false \? false : true[\s\S]*manualSend:\s*body\.manualSend === false \? false : true/.test(
    runtimeBridge
  ),
  'Lead nurture requests from the UI must carry human/manual metadata.'
);
assert(
  /async planLeadNurture[\s\S]*isTrustedManualOperatorAction\(params\)[\s\S]*manual_nurture_plan_saved[\s\S]*queued_for_approval/.test(
    bridge
  ),
  'Manual Add to Nurture must save an operator-owned plan without creating an approval.'
);
assert(
  /\.modal-backdrop,\s*\.drill-backdrop\s*\{[\s\S]*z-index:\s*120/.test(shellStyles),
  'Modal and drilldown overlays must sit above the mobile shell navigation.'
);

console.log('Manual UX gap smoke passed.');
