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
const bridge = read('scripts/openclaw-local-server.mjs');
const styles = read('src/styles/pbk-components.css');

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

console.log('Manual UX gap smoke passed.');
