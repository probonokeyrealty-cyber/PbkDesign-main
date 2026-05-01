import path from 'node:path';
import {
  DEFAULT_BRAIN_DIR,
  DEFAULT_VECTOR_DIMS,
  buildKnowledgeUnits,
  deriveFormulaUnits,
  extractConversationFragments,
  loadConversationExport,
  parseArgs,
  resolveCliPath,
  writeBrainArtifacts,
} from './pbk-brain-lib.mjs';

const args = parseArgs();
const inputPath = resolveCliPath(args.input || args.i || 'C:\\Users\\Dell\\Downloads\\conversations.json');
const outputDir = resolveCliPath(args.output || args.o || DEFAULT_BRAIN_DIR);
const dims = Number(args.dims || DEFAULT_VECTOR_DIMS);
const includeThink = Boolean(args['include-think']);

if (!inputPath) {
  throw new Error('Missing --input path to conversations.json');
}

const startedAt = new Date();
const { raw, sourceHash, data } = await loadConversationExport(inputPath);
const { fragments, stats } = extractConversationFragments(data, { includeThink });
const { units: baseUnits, redactionTotals } = buildKnowledgeUnits(fragments, {
  dims,
  maxChunkChars: Number(args['max-chars'] || 2800),
  minChunkChars: Number(args['min-chars'] || 80),
});
const formulaUnits = deriveFormulaUnits(baseUnits, { dims });
const units = [...baseUnits, ...formulaUnits];

const topicCounts = countBy(units, 'topic');
const statusCounts = countBy(units, 'status');
const manifest = {
  ok: true,
  generatedAt: startedAt.toISOString(),
  inputPath,
  inputSha256: sourceHash,
  inputBytes: Buffer.byteLength(raw, 'utf8'),
  outputDir,
  vectorDims: dims,
  privacy: {
    cloudUploaded: false,
    thinkFragmentsIncluded: includeThink,
    redactedFields: Object.keys(redactionTotals).sort(),
    note: 'Generated artifacts are local-only and stored under .pbk-local by default.',
  },
  extraction: {
    ...stats,
    knowledgeUnits: units.length,
    baseKnowledgeUnits: baseUnits.length,
    derivedFormulaUnits: formulaUnits.length,
    topics: topicCounts,
    statuses: statusCounts,
    redactions: redactionTotals,
  },
};

const written = await writeBrainArtifacts(outputDir, { units, manifest });

console.log(JSON.stringify({
  ok: true,
  input: path.basename(inputPath),
  outputDir,
  units: units.length,
  conversations: stats.conversations,
  fragments: stats.fragments,
  skippedThinkFragments: stats.skippedThinkFragments,
  redactions: redactionTotals,
  topTopics: Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 8),
  files: written,
}, null, 2));

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || 'unknown';
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}
