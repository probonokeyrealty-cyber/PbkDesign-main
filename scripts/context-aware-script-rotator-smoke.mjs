import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const semanticSelection = selectContextAwareScript({
  scripts: [
    {
      id: 'cash-generic',
      pathKey: 'cash_offer',
      title: 'Generic Cash',
      content: 'We can make a clean cash offer.',
      tags: ['cash_offer'],
      embedding: [1, 0, 0],
      learnedWeight: 0,
    },
    {
      id: 'cash-trust-proof',
      pathKey: 'cash_offer',
      title: 'Trust Proof',
      content: 'I can slow down and show you proof before we talk numbers.',
      tags: ['cash_offer'],
      embedding: [0, 1, 0],
      learnedWeight: 0.18,
    },
  ],
  pathKey: 'cash_offer',
  contextEmbedding: [0, 0.97, 0.03],
  sentiment: 0,
  explorationRate: 0,
});

assert.equal(semanticSelection.selectedScript.id, 'cash-trust-proof', 'Embedding similarity and learned weights should influence script selection.');
assert(semanticSelection.reasonCodes.includes('embedding_similarity'), 'Selection should explain embedding similarity scoring.');
assert(semanticSelection.reasonCodes.includes('learned_weight'), 'Selection should explain learned weight scoring.');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bridgeSource = readFileSync(path.resolve(__dirname, './openclaw-local-server.mjs'), 'utf8');
const runtimeBridgeSource = readFileSync(path.resolve(__dirname, '../src/app/utils/runtimeBridge.ts'), 'utf8');
const scriptPanelSource = readFileSync(path.resolve(__dirname, '../src/app/components/ScriptPanel.tsx'), 'utf8');

assert(/\/api\/scripts\/current/.test(bridgeSource), 'Bridge should expose /api/scripts/current for ScriptPanel reconciliation.');
assert(/fetchCurrentScriptRequest/.test(runtimeBridgeSource), 'Runtime bridge should expose a current-script fetch helper.');
assert(
  /normalized === '\/api\/scripts\/current'/.test(runtimeBridgeSource),
  'Current-script reconciliation should be allowed through the local dev proxy without exposing bridge secrets.'
);
assert(/fetchCurrentScriptRequest/.test(scriptPanelSource), 'ScriptPanel should fetch the bridge-selected current script.');

console.log('context-aware-script-rotator smoke passed', {
  lowSentiment: lowSentimentSelection.selectedScript.id,
  objection: objectionSelection.selectedScript.id,
  semantic: semanticSelection.selectedScript.id,
});
