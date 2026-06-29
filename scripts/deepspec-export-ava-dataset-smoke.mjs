import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tempDir = mkdtempSync(path.join(tmpdir(), 'pbk-deepspec-export-'));
const inputPath = path.join(tempDir, 'input.json');
const outPath = path.join(tempDir, 'dataset.jsonl');
const summaryPath = path.join(tempDir, 'summary.json');

writeFileSync(
  inputPath,
  JSON.stringify(
    [
      {
        id: 'feedback-1',
        sourceKind: 'pbk-feedback',
        transcriptSnippet:
          'Seller Jane Smith said call me at +1 (555) 222-3333 about 9008B Bong Loop and email jane@example.com. token=super-secret',
        agentAction:
          'Ava should acknowledge the seller, confirm motivation, and log the follow-up without sending a provider action.',
        metadata: {
          leadName: 'Jane Smith',
          address: '9008B Bong Loop, Moses Lake, WA',
          phone: '+1 (555) 222-3333',
          apiKey: 'sk-live-abc123456789',
        },
      },
      {
        id: 'conversation-1',
        messages: [
          { role: 'system', content: 'Use PBK language.' },
          { role: 'user', content: 'Should Ava send the contract to owner@demo.test for 123 Main Street?' },
          {
            role: 'assistant',
            content:
              'Ava should prepare the contract plan, require the contract approval gate, and explain the next step in plain language.',
          },
        ],
      },
    ],
    null,
    2
  ),
  'utf8'
);

const result = spawnSync(
  process.execPath,
  [
    path.resolve('scripts/deepspec-export-ava-dataset.mjs'),
    '--input',
    inputPath,
    '--out',
    outPath,
    '--summary',
    summaryPath,
    '--limit',
    '10',
  ],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
  }
);

assert.equal(result.status, 0, result.stderr || result.stdout);

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
assert.equal(summary.ok, true, 'export summary should be ok');
assert.equal(summary.examplesWritten, 2, 'smoke input should write two examples');
assert(summary.redactions.email >= 2, 'emails should be redacted');
assert(summary.redactions.phone >= 2, 'phones should be redacted');
assert(summary.redactions.address >= 2, 'addresses should be redacted');
assert(summary.redactions.credential >= 1 || summary.redactions.secret >= 1, 'credentials should be redacted');

const lines = readFileSync(outPath, 'utf8').trim().split(/\r?\n/);
assert.equal(lines.length, 2, 'dataset should contain two JSONL rows');
const rows = lines.map((line) => JSON.parse(line));
for (const row of rows) {
  assert(Array.isArray(row.messages), 'row should include messages');
  assert.equal(typeof row.accepted_answer, 'string', 'row should include accepted_answer');
  assert(row.accepted_answer.length > 20, 'accepted_answer should be useful');
}

const rawOutput = readFileSync(outPath, 'utf8');
assert(!rawOutput.includes('jane@example.com'), 'raw email must not be exported');
assert(!rawOutput.includes('owner@demo.test'), 'conversation email must not be exported');
assert(!rawOutput.includes('555'), 'raw phone digits must not be exported');
assert(!rawOutput.includes('9008B Bong Loop'), 'raw address must not be exported');
assert(!rawOutput.includes('123 Main Street'), 'raw street must not be exported');
assert(!rawOutput.includes('super-secret'), 'raw credential must not be exported');
assert(!rawOutput.includes('sk-live-abc123456789'), 'raw API-like secret must not be exported');

console.log('deepspec-export-ava-dataset-smoke: ok');
