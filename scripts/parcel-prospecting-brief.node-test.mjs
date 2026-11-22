import test from 'node:test';
import assert from 'node:assert/strict';
import { createProspectingBrief, createClaudeProspectingReview } from './parcel-prospecting-brief.mjs';

const selection = (status, reasons = []) => ({
  parcel: { properties: { parcelId: 'TEST-1', acres: 0.42, situs: { line1: 'private-test-address' } } },
  match: { status }, eligibility: { reasons: reasons.map(code => ({ code, message: 'private-test-reason' })) },
  contact: { name: 'private-test-name', phoneDisplay: 'private-test-phone' }, createLeadAvailable: status === 'no_match',
});

test('DeepSeek prioritizes approved checks and Claude independently reviews the proposed order', async () => {
  const brief = createProspectingBrief({
    prioritize: async (input) => {
      assert.doesNotMatch(JSON.stringify(input), /private-test|TEST-1/);
      assert.equal(input.facts.match, 'matched');
      return '{"order":["inspect-parcel","review-conversation","verify-contact"]}';
    },
    review: async (input) => {
      assert.deepEqual(input.proposedOrder, ['inspect-parcel', 'review-conversation', 'verify-contact']);
      return '{"order":["verify-contact","review-conversation","inspect-parcel"]}';
    },
  });
  const result = await brief(selection('matched', ['no_phone']));
  assert.equal(result.parcelId, 'TEST-1');
  assert.deepEqual(result.providers, { deepSeek: 'used', claude: 'used' });
  assert.deepEqual(result.steps.map(s => s.id), ['verify-contact', 'review-conversation', 'inspect-parcel']);
});

test('invalid or unavailable model output cannot invent actions or override an outreach hold', async () => {
  const brief = createProspectingBrief({
    prioritize: async () => '{"order":["send-message"]}',
    review: async () => '{"order":["inspect-parcel","review-conversation","hold-outreach"]}',
  });
  const result = await brief(selection('matched', ['dnc']));
  assert.equal(result.steps[0].id, 'hold-outreach');
  assert.deepEqual(result.providers, { deepSeek: 'unavailable', claude: 'used' });
  assert.equal(result.steps.length, 3);

  const fallback = await createProspectingBrief({})(selection('ambiguous'));
  assert.equal(fallback.steps[0].id, 'resolve-match');
  assert.deepEqual(fallback.providers, { deepSeek: 'unconfigured', claude: 'unconfigured' });
});

test('Claude review uses the server credential and returns only the text answer', async () => {
  const review = createClaudeProspectingReview({ apiKey: 'fixture', model: 'fixture-model', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['x-api-key'], 'fixture');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'fixture-model');
    assert.equal(body.messages.length, 1);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ content: [{ type: 'text', text: '{"order":["inspect-parcel"]}' }] });
  }});
  assert.equal(await review({ facts: {} }, Date.now() + 5_000), '{"order":["inspect-parcel"]}');
});
