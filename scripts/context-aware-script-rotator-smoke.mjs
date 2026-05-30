import assert from 'node:assert/strict';
import {
  recordScriptOutcomeStats,
  selectContextAwareScript,
} from './context-aware-script-rotator.mjs';

const scripts = [
  {
    id: 'cash-control',
    pathKey: 'cash_offer',
    title: 'Cash Control',
    content: 'We can make this simple: cash, as-is, no repairs.',
    tags: ['cash_offer', 'close'],
    metadata: { usageCount: 20, conversionCount: 5 },
  },
  {
    id: 'cash-empathy',
    pathKey: 'cash_offer',
    title: 'Cash Empathy',
    content: 'I hear you. If this has been stressful, we can slow down, keep it clean, and make sure you feel safe before we talk numbers.',
    tags: ['cash_offer', 'empathetic', 'trust'],
    metadata: { usageCount: 9, conversionCount: 5 },
  },
  {
    id: 'cash-price',
    pathKey: 'cash_offer',
    title: 'Cash Price Objection',
    content: 'If the price feels low, compare the net: repairs, commissions, time, and certainty. What number would make this worth doing today?',
    tags: ['cash_offer', 'price_too_low', 'objection'],
    metadata: { usageCount: 30, conversionCount: 20 },
  },
];

const lowSentimentSelection = selectContextAwareScript({
  scripts,
  pathKey: 'cash_offer',
  sentiment: -0.72,
  transcript: 'I am worried this might be a scam.',
  leadId: 'lead-1',
  explorationRate: 0,
});

assert.equal(lowSentimentSelection.selectedScript.id, 'cash-empathy', 'Low sentiment should favor empathy/trust script.');
assert(lowSentimentSelection.reasonCodes.includes('sentiment_low'), 'Selection should explain low-sentiment scoring.');

const objectionSelection = selectContextAwareScript({
  scripts,
  pathKey: 'cash_offer',
  sentiment: 0.05,
  lastObjection: 'price_too_low',
  transcript: 'That price is too low.',
  recentScriptIds: ['cash-price'],
  leadId: 'lead-2',
  explorationRate: 0,
});

assert.notEqual(objectionSelection.selectedScript.id, 'cash-price', 'Repeated objection should force a different script after same handler was just used.');
assert(objectionSelection.reasonCodes.includes('anti_repeat'), 'Selection should explain anti-repeat penalty.');

const stats = recordScriptOutcomeStats(scripts[0], { success: true, dealValue: 15000 });
assert.equal(stats.usageCount, 21, 'Outcome stats should increment usage count.');
assert.equal(stats.conversionCount, 6, 'Successful outcome should increment conversion count.');
assert.equal(stats.dealValue, 15000, 'Outcome stats should accumulate deal value.');

console.log('context-aware-script-rotator smoke passed', {
  lowSentiment: lowSentimentSelection.selectedScript.id,
  objection: objectionSelection.selectedScript.id,
});
