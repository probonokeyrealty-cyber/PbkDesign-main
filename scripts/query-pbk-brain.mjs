import path from 'node:path';
import {
  DEFAULT_BRAIN_DIR,
  parseArgs,
  queryKnowledgeUnits,
  readKnowledgeUnits,
  resolveCliPath,
} from './pbk-brain-lib.mjs';

const args = parseArgs();
const question = String(args._.join(' ') || args.query || args.q || '').trim();
const brainDir = resolveCliPath(args.brain || args.b || DEFAULT_BRAIN_DIR);
const top = Number(args.top || args.k || 3);
const json = Boolean(args.json);

if (!question) {
  throw new Error('Missing query. Example: npm run brain:query -- "What is the flip ROI formula?"');
}

const units = await readKnowledgeUnits(brainDir);
const results = queryKnowledgeUnits(units, question, { top });

if (json) {
  console.log(JSON.stringify({
    ok: true,
    question,
    brainDir,
    results: results.map(({ score, unit }) => ({
      score,
      id: unit.id,
      topic: unit.topic,
      status: unit.status,
      timestamp: unit.timestamp,
      content: unit.content,
      rationale: unit.rationale,
      code_snippet: unit.code_snippet,
      metadata: unit.source,
    })),
  }, null, 2));
} else {
  console.log(`PBK Brain query: ${question}`);
  console.log(`Index: ${path.join(brainDir, 'knowledge-units.json')}`);
  console.log('');
  results.forEach(({ score, unit }, index) => {
    console.log(`${index + 1}. ${unit.topic} (${score.toFixed(3)})`);
    console.log(`   Status: ${unit.status}`);
    console.log(`   Source: ${unit.source.conversationTitle} | ${unit.source.fragmentType} | ${unit.timestamp || 'no timestamp'}`);
    console.log(`   ${clip(unit.content.replace(/\n+/g, ' '), 850)}`);
    if (unit.rationale) console.log(`   Rationale: ${clip(unit.rationale, 320)}`);
    if (unit.code_snippet) console.log(`   Code: ${clip(unit.code_snippet.replace(/\n+/g, ' '), 420)}`);
    console.log('');
  });
}

function clip(value, length) {
  const text = String(value || '').trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length - 3)}...`;
}
