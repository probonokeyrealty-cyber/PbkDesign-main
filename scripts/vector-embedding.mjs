import path from 'node:path';

export const EMBEDDING_STORAGE_DIMENSIONS = 1536;
export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

const LOCAL_NATIVE_DIMENSIONS = 384;
const SUPPORTED_PROVIDERS = new Set(['auto', 'openai', 'local_hf']);

let localExtractorPromise = null;

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProvider(value = '') {
  const provider = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (provider === 'huggingface' || provider === 'hf' || provider === 'local') {
    return 'local_hf';
  }
  return SUPPORTED_PROVIDERS.has(provider) ? provider : 'auto';
}

function getRequestedProvider(env = process.env) {
  return String(
    env.PBK_EMBEDDING_PROVIDER ||
      env.EMBEDDING_PROVIDER ||
      'auto'
  )
    .trim()
    .toLowerCase();
}

/**
 * Returns the configured embedding lane without exposing provider secrets.
 */
export function getEmbeddingProviderConfig(env = process.env) {
  const requestedProvider = getRequestedProvider(env);
  const deepSeekRequested = requestedProvider === 'deepseek';
  const provider = deepSeekRequested ? 'local_hf' : normalizeProvider(requestedProvider);
  const openAiModel = String(
    env.PBK_OPENAI_EMBEDDING_MODEL ||
      env.OPENAI_EMBEDDING_MODEL ||
      DEFAULT_OPENAI_EMBEDDING_MODEL
  ).trim();
  const localModel = String(
    env.PBK_LOCAL_EMBEDDING_MODEL ||
      env.LOCAL_EMBEDDING_MODEL ||
      DEFAULT_LOCAL_EMBEDDING_MODEL
  ).trim();
  const localModelLabel = `hf:${localModel}:cosine-repeat-${EMBEDDING_STORAGE_DIMENSIONS}`;

  return {
    requestedProvider,
    provider,
    deepSeekRequested,
    fallbackReason: deepSeekRequested ? 'deepseek_embeddings_unsupported' : '',
    openAiModel,
    localModel,
    localModelLabel,
    storageDimensions: EMBEDDING_STORAGE_DIMENSIONS,
    localNativeDimensions: LOCAL_NATIVE_DIMENSIONS,
    configuredModel: provider === 'local_hf' ? localModelLabel : openAiModel,
  };
}

function normalizeUnitVector(values = []) {
  const vector = Array.from(values, (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  });
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) throw new Error('Embedding model returned a zero vector.');
  return vector.map((value) => value / norm);
}

/**
 * Expands a normalized vector into the existing pgvector dimension while
 * preserving cosine similarity. Repeating a vector N times and scaling each
 * block by 1/sqrt(N) leaves dot products and norms unchanged.
 */
export function projectEmbeddingDimensions(
  values = [],
  targetDimensions = EMBEDDING_STORAGE_DIMENSIONS
) {
  const source = normalizeUnitVector(values);
  if (source.length === targetDimensions) return source;
  if (targetDimensions % source.length !== 0) {
    throw new Error(
      `Cannot project ${source.length} dimensions into ${targetDimensions} without changing cosine geometry.`
    );
  }
  const repeats = targetDimensions / source.length;
  const scale = 1 / Math.sqrt(repeats);
  const projected = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const value of source) projected.push(value * scale);
  }
  return projected;
}

async function getLocalExtractor({
  model = DEFAULT_LOCAL_EMBEDDING_MODEL,
  cacheDir = '',
} = {}) {
  if (!localExtractorPromise) {
    localExtractorPromise = import('@huggingface/transformers')
      .then(async ({ env, pipeline }) => {
        env.cacheDir =
          cacheDir ||
          process.env.PBK_HF_CACHE_DIR ||
          path.resolve(process.cwd(), '.cache', 'pbk-transformers');
        return pipeline('feature-extraction', model, {
          dtype: String(process.env.PBK_LOCAL_EMBEDDING_DTYPE || 'q8').trim(),
        });
      })
      .catch((error) => {
        localExtractorPromise = null;
        throw error;
      });
  }
  return localExtractorPromise;
}

async function createLocalEmbedding(text = '', options = {}) {
  const config = getEmbeddingProviderConfig(options.env || process.env);
  const extractor = await getLocalExtractor({
    model: options.localModel || config.localModel,
    cacheDir: options.cacheDir,
  });
  const output = await extractor(text, {
    pooling: 'mean',
    normalize: true,
  });
  const nativeEmbedding = Array.from(output?.data || []);
  if (nativeEmbedding.length !== LOCAL_NATIVE_DIMENSIONS) {
    return {
      ok: false,
      result: 'dimension_mismatch',
      provider: 'local_hf',
      model: config.localModelLabel,
      nativeDimensions: nativeEmbedding.length,
      dimensions: 0,
      error: `Expected ${LOCAL_NATIVE_DIMENSIONS}-dim local embedding, got ${nativeEmbedding.length || 'none'}.`,
    };
  }
  const embedding = projectEmbeddingDimensions(
    nativeEmbedding,
    EMBEDDING_STORAGE_DIMENSIONS
  );
  return {
    ok: true,
    result: 'live',
    provider: 'local_hf',
    model: config.localModelLabel,
    nativeModel: config.localModel,
    nativeDimensions: nativeEmbedding.length,
    dimensions: embedding.length,
    projection: 'cosine_preserving_repeat',
    embedding,
    usage: null,
  };
}

async function createOpenAiEmbedding(text = '', options = {}) {
  const config = getEmbeddingProviderConfig(options.env || process.env);
  const apiKey = String(options.openAiApiKey || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      result: 'provider_missing',
      provider: 'openai',
      model: options.openAiModel || config.openAiModel,
      error: 'OpenAI embeddings key is not configured.',
    };
  }
  const baseUrl = String(options.openAiBaseUrl || 'https://api.openai.com')
    .trim()
    .replace(/\/+$/g, '');
  const model = String(options.openAiModel || config.openAiModel).trim();
  const controller = new AbortController();
  const timeoutMs = Math.max(50, Math.min(60000, Number(options.timeoutMs || 10000)));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: text.slice(0, 8000),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        result: 'provider_error',
        provider: 'openai',
        model,
        status: response.status,
        error:
          payload?.error?.message ||
          payload?.message ||
          `OpenAI embeddings returned ${response.status}`,
      };
    }
    const embedding = payload?.data?.[0]?.embedding;
    if (
      !Array.isArray(embedding) ||
      embedding.length !== EMBEDDING_STORAGE_DIMENSIONS
    ) {
      return {
        ok: false,
        result: 'dimension_mismatch',
        provider: 'openai',
        model,
        nativeDimensions: Array.isArray(embedding) ? embedding.length : 0,
        dimensions: 0,
        error: `Expected ${EMBEDDING_STORAGE_DIMENSIONS}-dim embedding, got ${Array.isArray(embedding) ? embedding.length : 'none'}.`,
      };
    }
    await options.onUsage?.({
      provider: 'openai',
      model,
      usage: payload?.usage || {},
      responseId: payload?.id || '',
    });
    return {
      ok: true,
      result: 'live',
      provider: 'openai',
      model,
      nativeDimensions: embedding.length,
      dimensions: embedding.length,
      projection: 'none',
      embedding,
      usage: payload?.usage || null,
    };
  } catch (error) {
    return {
      ok: false,
      result:
        error?.name === 'AbortError' ? 'provider_timeout' : 'provider_error',
      provider: 'openai',
      model,
      error:
        error?.name === 'AbortError'
          ? 'OpenAI embedding request timed out.'
          : error?.message || 'OpenAI embedding request failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Creates a production embedding using the configured provider. DeepSeek is
 * deliberately not called because its official API has no embeddings model.
 */
export async function createTextEmbedding(text = '', options = {}) {
  const cleanText = normalizeText(text);
  if (cleanText.length < 12) {
    return {
      ok: false,
      result: 'empty_text',
      error: 'Embedding text was empty.',
    };
  }

  const config = getEmbeddingProviderConfig(options.env || process.env);
  const requestedProvider = String(options.provider || config.provider)
    .trim()
    .toLowerCase();
  const provider =
    requestedProvider === 'deepseek'
      ? 'local_hf'
      : normalizeProvider(requestedProvider);
  if (provider === 'local_hf') {
    return createLocalEmbedding(cleanText, options);
  }

  const openAiResult = await createOpenAiEmbedding(cleanText, options);
  if (provider === 'openai') return openAiResult;
  if (openAiResult.ok) return openAiResult;

  const localResult = await createLocalEmbedding(cleanText, options);
  return {
    ...localResult,
    fallbackFrom: 'openai',
    fallbackReason:
      config.fallbackReason ||
      openAiResult.result ||
      'openai_embedding_unavailable',
    upstreamError: openAiResult.error || '',
  };
}

/**
 * Starts loading the local model without blocking bridge startup.
 */
export async function prewarmEmbeddingProvider(options = {}) {
  const config = getEmbeddingProviderConfig(options.env || process.env);
  if (config.provider === 'openai' && !options.includeFallback) {
    return {
      ok: true,
      result: 'not_required',
      provider: 'openai',
      model: config.openAiModel,
    };
  }
  const extractor = await getLocalExtractor({
    model: options.localModel || config.localModel,
    cacheDir: options.cacheDir,
  });
  return {
    ok: Boolean(extractor),
    result: 'ready',
    provider: 'local_hf',
    model: config.localModelLabel,
    nativeDimensions: LOCAL_NATIVE_DIMENSIONS,
    dimensions: EMBEDDING_STORAGE_DIMENSIONS,
  };
}
