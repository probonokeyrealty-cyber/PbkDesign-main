import {
  EMBEDDING_STORAGE_DIMENSIONS,
  getEmbeddingProviderConfig,
  projectEmbeddingDimensions,
} from './vector-embedding.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

const legacyDeepSeekConfig = getEmbeddingProviderConfig({
  EMBEDDING_PROVIDER: 'deepseek',
});
assert(
  legacyDeepSeekConfig.provider === 'local_hf' &&
    legacyDeepSeekConfig.fallbackReason === 'deepseek_embeddings_unsupported',
  'A legacy DeepSeek embedding setting must route to the supported local provider without calling a fictional endpoint.'
);

const left = Array.from({ length: 384 }, (_, index) => (index % 11) - 5);
const right = Array.from({ length: 384 }, (_, index) => (index % 7) - 3);
const leftNorm = Math.sqrt(dot(left, left));
const rightNorm = Math.sqrt(dot(right, right));
const nativeCosine = dot(left, right) / (leftNorm * rightNorm);
const projectedLeft = projectEmbeddingDimensions(left);
const projectedRight = projectEmbeddingDimensions(right);
const projectedCosine = dot(projectedLeft, projectedRight);

assert(
  projectedLeft.length === EMBEDDING_STORAGE_DIMENSIONS &&
    projectedRight.length === EMBEDDING_STORAGE_DIMENSIONS,
  'Local vectors must fit the existing VECTOR(1536) storage contract.'
);
assert(
  Math.abs(projectedCosine - nativeCosine) < 1e-12,
  'Dimension projection must preserve cosine similarity.'
);
assert(
  Math.abs(dot(projectedLeft, projectedLeft) - 1) < 1e-12,
  'Projected vectors must remain unit normalized.'
);

console.log('vector-embedding-smoke: ok');
