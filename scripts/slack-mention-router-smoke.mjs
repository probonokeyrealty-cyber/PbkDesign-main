import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSlackMentionAck,
  classifySlackMentionIntent,
  normalizeSlackMentionText,
} from './slack-mention-router.mjs';

const mentionText = normalizeSlackMentionText(
  '<@UAVA123> prepare a proposal for 123 Main using the last comps'
);
assert.equal(
  mentionText,
  'prepare a proposal for 123 Main using the last comps',
  'Mention normalization should remove the bot mention.'
);

const proposal = classifySlackMentionIntent({
  text: '<@UAVA123> prepare a proposal for 123 Main using the last comps',
  user: 'UFOUNDER',
  channel: 'CDEALS',
  ts: '1717000000.000100',
});
assert.equal(
  proposal.toolName,
  'routeAdminCommand',
  'Proposal requests should route through natural language admin command delegation.'
);
assert.equal(
  proposal.requiresApproval,
  true,
  'Proposal requests can affect provider/business workflow and should stay approval-aware.'
);
assert.match(
  proposal.params.command,
  /prepare a proposal/i,
  'Router should preserve the operator command.'
);
assert.equal(
  proposal.params.requiresApproval,
  true,
  'Classified business workflow params should carry approval awareness into direct tool calls.'
);

[
  '<@UAVA123> launch probate campaign tomorrow',
  '<@UAVA123> pause the probate campaign',
  '<@UAVA123> start outreach to all imported leads',
  '<@UAVA123> approve campaign batch',
].forEach((text) => {
  const route = classifySlackMentionIntent({
    text,
    user: 'UFOUNDER',
    channel: 'CDEALS',
    ts: '1717000000.000150',
  });
  assert.equal(route.toolName, 'routeAdminCommand', `${text} should route to the admin command router.`);
  assert.equal(route.requiresApproval, true, `${text} should be approval-aware.`);
  assert.equal(route.params.requiresApproval, true, `${text} should pass requiresApproval in params.`);
  assert.equal(route.params.approvalRequired, true, `${text} should pass approvalRequired in params.`);
});

const status = classifySlackMentionIntent({
  text: '<@UAVA123> what needs my attention today?',
  user: 'UFOUNDER',
  channel: 'CDEALS',
  ts: '1717000000.000200',
});
assert.equal(
  status.toolName,
  'runCoworkerHeartbeat',
  'Attention/status mentions should route to the heartbeat.'
);
assert.equal(
  status.requiresApproval,
  false,
  'Read-only heartbeat status should not require approval.'
);

const training = classifySlackMentionIntent({
  text: '<@UAVA123> remember this objection: I need to talk to my spouse',
  user: 'UFOUNDER',
  channel: 'CDEALS',
  ts: '1717000000.000300',
});
assert.equal(
  training.toolName,
  'ingestResearchDoc',
  'Memory/coaching mentions should route to Brain ingestion.'
);
assert.match(
  training.params.summary,
  /talk to my spouse/i,
  'Memory route should preserve coaching content.'
);

const ack = buildSlackMentionAck(proposal);
assert.match(ack.text, /Routed to PBK/i, 'Ack should be operator-friendly.');
assert.equal(ack.thread_ts, '1717000000.000100', 'Ack should reply in thread.');

const bridge = readFileSync(resolve(process.cwd(), 'scripts/openclaw-local-server.mjs'), 'utf8');
assert.match(
  bridge,
  /requiresApproval:\s*Boolean\(route\.requiresApproval\)/,
  'Slack app mentions must pass the classified approval requirement into the routed handler.'
);
assert.match(
  bridge,
  /approvalRequired:\s*Boolean\(route\.requiresApproval\)/,
  'Slack app mentions must expose an approvalRequired alias for handlers that use approval-safe routing.'
);

console.log('slack-mention-router smoke passed', {
  proposal: proposal.toolName,
  status: status.toolName,
  training: training.toolName,
});
