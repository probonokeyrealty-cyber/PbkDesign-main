export const AVA_COACHING_EMBEDDING_DIMENSIONS = 1536;

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const allowed = [
    'tactic',
    'summary',
    'excerpt',
    'emotion',
    'sentiment',
    'success',
    'path',
    'sourceType',
    'salesMentor',
  ];
  return Object.fromEntries(
    allowed
      .map((key) => [key, metadata[key]])
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

/**
 * Builds the canonical semantic text for an Ava coaching-memory row.
 */
export function buildAvaCoachingEmbeddingText(memory = {}) {
  const metadata = normalizeMetadata(memory.metadata);
  const sections = [
    ['Memory type', memory.memoryType || memory.memory_type],
    ['Objection', memory.objectionTag || memory.objection_tag],
    ['Deal path', memory.pathKey || memory.path_key],
    ['Seller signal', memory.prompt],
    ['Recommended response', memory.response],
    ['Outcome', memory.outcome],
    ['Source', memory.source],
    ['Coaching context', Object.keys(metadata).length ? JSON.stringify(metadata) : ''],
  ]
    .map(([label, value]) => {
      const text = normalizeText(value);
      return text ? `${label}: ${text}` : '';
    })
    .filter(Boolean);

  return sections.join('\n').slice(0, 8000);
}

export function normalizeAvaCoachingMemoryRow(row = {}) {
  return {
    id: String(row.id || ''),
    workspaceId: String(row.workspace_id || row.workspaceId || 'pbk'),
    memoryType: normalizeText(row.memory_type || row.memoryType || 'general'),
    objectionTag: normalizeText(row.objection_tag || row.objectionTag),
    pathKey: normalizeText(row.path_key || row.pathKey),
    prompt: normalizeText(row.prompt),
    response: normalizeText(row.response),
    source: normalizeText(row.source || 'bridge'),
    sourceUrl: normalizeText(row.source_url || row.sourceUrl),
    outcome: normalizeText(row.outcome || 'observed'),
    score: Number(row.score || 0),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    embeddingModel: normalizeText(row.embedding_model || row.embeddingModel),
    embeddingHash: normalizeText(row.embedding_hash || row.embeddingHash),
    hasEmbedding: Boolean(row.has_embedding ?? row.hasEmbedding),
    embeddedAt: row.embedded_at || row.embeddedAt || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}
