import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { classifyAvaConversationalIntent } from './ava-intent-router.mjs';

const conversationalSamples = ['hello', 'hey', 'why', 'no'];
for (const sample of conversationalSamples) {
  const result = classifyAvaConversationalIntent(sample);
  assert.equal(result.action, 'chat', `${sample} should stay conversational.`);
  assert.equal(result.needsApproval, false, `${sample} should not create an approval request.`);
  assert.equal(result.risk, 'low', `${sample} should be low risk.`);
}

const research = classifyAvaConversationalIntent('What is wholesaling and how does a cash offer work?');
assert.equal(research.action, 'research', 'Research questions should route to research.');
assert.equal(research.needsApproval, false, 'Research should not need approval.');

const leadSearch = classifyAvaConversationalIntent('Search lead Diane Kowalski.');
assert.equal(leadSearch.action, 'search_leads', 'Lead search should keep the dedicated command-center route.');
assert.equal(leadSearch.needsApproval, false, 'Lead search should not need approval.');

const draft = classifyAvaConversationalIntent('Draft an email to Diane about our offer.');
assert.equal(draft.action, 'draft_email', 'Drafting should not be classified as a send.');
assert.equal(draft.needsApproval, false, 'Drafting should not need approval.');

const manualSms = classifyAvaConversationalIntent('Send SMS to Diane: call me back.', {
  source: 'manual',
});
assert.equal(manualSms.action, 'send_sms', 'Manual SMS should still classify as a provider send.');
assert.equal(manualSms.needsApproval, false, 'Manual SMS from trusted source should bypass approval.');

const nonManualSms = classifyAvaConversationalIntent('Send SMS to Diane: call me back.');
assert.equal(nonManualSms.action, 'send_sms', 'Non-manual SMS should classify as a provider send.');
assert.equal(nonManualSms.needsApproval, true, 'Non-manual provider sends stay approval-gated.');

const screenshot = classifyAvaConversationalIntent('Take a screenshot of the desktop.');
assert.equal(screenshot.action, 'screenshot', 'Screenshots should remain local-control actions.');
assert.equal(screenshot.needsApproval, true, 'Local desktop control must require approval.');

const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
assert.match(bridge, /function isTrustedManualProviderSendCommand/);
assert.match(bridge, /manual_provider_send/);
assert.match(bridge, /const manualProviderSend = isTrustedManualProviderSendCommand/);
assert.match(
  bridge,
  /conversationalIntent\.matched[\s\S]*\['chat', 'research', 'draft_email', 'draft_sms'\]\.includes\(conversationalIntent\.action\)[\s\S]*return 'llm_query'/,
  'Bridge must execute conversational semantics through the existing llm_query lane.'
);

console.log('ava-intent-router-smoke: ok');
