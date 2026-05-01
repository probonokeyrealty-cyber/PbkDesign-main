import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const DEFAULT_BRAIN_DIR = path.resolve(process.cwd(), '.pbk-local', 'brain');
export const DEFAULT_VECTOR_DIMS = 384;

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'i',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'this',
  'to',
  'was',
  'we',
  'with',
  'you',
  'your',
]);

const TOPIC_PATTERNS = [
  ['Contract Lawyer Agent', /contract lawyer|docusign|underwriting|envelope|prepare_contract|sendforunderwriting|signed pdf|purchase agreement/i],
  ['Role Detection', /role detection|classify_participant|seller vs agent|novice|expert|participant/i],
  ['Cold Email Shark', /cold email|instantly|sendgrid|resend|warm email|email shark|opens|clicks/i],
  ['Reply Intent And Booking', /reply intent|booking|appointment|calendar|cal\.com|warm reply|call-now|google calendar/i],
  ['Streak CRM Sync', /streak|crm sync|pipeline key|box|stage transition/i],
  ['Telnyx Voice Agent', /telnyx|voice agent|caller id|live call|cold call|call controls|from number/i],
  ['Render And Netlify Deployment', /render|netlify|deploy|deployment|production|health endpoint|hosted smoke/i],
  ['Supabase Database', /supabase|postgres|rls|migration|database|storage|auth|table|schema/i],
  ['BrowserOS And E2E', /browseros|browser os|browser-use|e2e|playwright|click audit|mcp-server\/http/i],
  ['Mobile UI And Modern UX', /mobile|overflow|responsive|ui\/ux|modern ui|figma|homepage|cards|media quer/i],
  ['Deal Analyzer Formulas', /analyzer|mao|arv|repair|offer|flip roi|holding cost|exit cost|equity|deal path/i],
  ['Investor Yield CF MT', /investor yield|cash on cash|coc|dscr|cap rate|creative finance|mortgage takeover|\bCF\b|\bMT\b|seller carry|wrap/i],
  ['PDF Generation', /pdf|jspdf|page break|master deal package|download pdf|bracket filling/i],
  ['Scripts And Objections', /script|opener|objection|pass-off|acquisitions|homeowner|agent opener|tone/i],
  ['Master Document Repository', /master document repository|training manual|protocol|deal path contracts|folder repository/i],
  ['Supermemory And Design System', /supermemory|persistent memory|design\.md|pbk_design|awesome design|memory layer/i],
  ['Security And Secret Rotation', /secret|api key|token|rotate|revok|webhook key|bridge api key|credential/i],
  ['Uptime Guardian', /uptime guardian|self-heal|monitor|health check|restart service|heartbeat/i],
  ['OpenClaw MCP Rex', /openclaw|rex|mcp|admin command|local fallback|ollama|gpt-5\.5|gemma|qwen/i],
  ['BatchData Property Research', /batchdata|skip-tracing|property research|zillow|redfin|property cache|comps/i],
  ['GitHub CI Worker', /github|workflow|actions|founder verify|agent planner|away-mode|scheduled task|worker/i],
  ['SaaS Pricing And Packaging', /pricing|saas|users|arr|mrr|tier|starter|enterprise/i],
];

const ISSUE_PATTERNS = [
  ['dead-buttons', /dead button|mock|not clickable|wired|static data/i],
  ['mobile-overflow', /overflow|clip|mobile|responsive/i],
  ['secret-exposure', /exposed key|rotate|secret|api key|token/i],
  ['provider-auth', /auth failed|missing auth|credential|bearer auth/i],
  ['deployment-gap', /not deployed|stale html|repo repoint|mirror repo/i],
  ['calendar-gap', /calendar webhook|access token|calendar sync/i],
  ['contract-gap', /contract lawyer|template selection|docusign final/i],
  ['role-detection-gap', /role detection|classify_participant/i],
  ['e2e-confidence', /e2e|full loop|sanity check|click audit/i],
];

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i];
    if (!entry.startsWith('--')) {
      args._.push(entry);
      continue;
    }
    const [rawKey, inlineValue] = entry.slice(2).split(/=(.*)/s).filter(Boolean);
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[rawKey] = next;
      i += 1;
    } else {
      args[rawKey] = true;
    }
  }
  return args;
}

export function resolveCliPath(value, fallback = '') {
  const candidate = String(value || fallback || '').trim();
  if (!candidate) return '';
  return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}

export async function loadConversationExport(inputPath) {
  const raw = await readFile(inputPath, 'utf8');
  return {
    raw,
    sourceHash: crypto.createHash('sha256').update(raw).digest('hex'),
    data: JSON.parse(raw),
  };
}

export function extractConversationFragments(data, options = {}) {
  const conversations = Array.isArray(data) ? data : [data];
  const includeThink = Boolean(options.includeThink);
  const fragments = [];
  const stats = {
    conversations: conversations.length,
    messages: 0,
    fragments: 0,
    skippedThinkFragments: 0,
    skippedEmptyFragments: 0,
  };

  conversations.forEach((conversation, conversationIndex) => {
    const nodes = Object.values(conversation?.mapping || {}).sort(compareNodesByTime);
    nodes.forEach((node, nodeIndex) => {
      const message = node?.message;
      if (!message?.fragments?.length) return;
      stats.messages += 1;
      message.fragments.forEach((fragment, fragmentIndex) => {
        const type = String(fragment?.type || 'UNKNOWN').toUpperCase();
        if (type === 'THINK' && !includeThink) {
          stats.skippedThinkFragments += 1;
          return;
        }
        const content = fragmentToText(fragment);
        if (!content.trim()) {
          stats.skippedEmptyFragments += 1;
          return;
        }
        stats.fragments += 1;
        fragments.push({
          conversationId: conversation?.id || `conversation-${conversationIndex}`,
          conversationTitle: conversation?.title || 'Untitled conversation',
          conversationIndex,
          nodeId: node?.id || `node-${nodeIndex}`,
          nodeIndex,
          fragmentIndex,
          fragmentType: type,
          timestamp: message?.inserted_at || conversation?.updated_at || conversation?.inserted_at || null,
          model: message?.model || null,
          rawContent: content,
        });
      });
    });
  });

  return { fragments, stats };
}

export function buildKnowledgeUnits(fragments, options = {}) {
  const maxChunkChars = Number(options.maxChunkChars || 2800);
  const minChunkChars = Number(options.minChunkChars || 80);
  const dims = Number(options.dims || DEFAULT_VECTOR_DIMS);
  const units = [];
  const redactionTotals = {};
  let sequence = 0;

  for (const fragment of fragments) {
    const { text: redacted, counts } = redactSensitiveText(fragment.rawContent);
    mergeCounts(redactionTotals, counts);

    const chunks = chunkText(redacted, { maxChunkChars, minChunkChars });
    chunks.forEach((chunk, chunkIndex) => {
      const trimmed = chunk.trim();
      if (!trimmed) return;
      const topic = inferTopic(trimmed, fragment.conversationTitle);
      const rationale = extractRationale(trimmed);
      const codeSnippet = extractCodeSnippet(trimmed);
      const status = inferStatus(trimmed);
      const relatedIssues = inferRelatedIssues(trimmed);
      const context = [
        fragment.conversationTitle,
        fragment.fragmentType,
        fragment.timestamp ? `timestamp ${fragment.timestamp}` : '',
      ].filter(Boolean).join(' | ');
      const searchableText = [
        topic,
        context,
        trimmed,
        rationale ? `Rationale: ${rationale}` : '',
        codeSnippet ? `Code: ${codeSnippet}` : '',
      ].filter(Boolean).join('\n');

      const id = stableId([
        fragment.conversationId,
        fragment.nodeId,
        fragment.fragmentIndex,
        chunkIndex,
        searchableText.slice(0, 400),
      ].join('|'));

      units.push({
        id,
        sequence,
        topic,
        context,
        content: trimmed,
        rationale,
        code_snippet: codeSnippet,
        related_issues: relatedIssues,
        status,
        timestamp: fragment.timestamp,
        source: {
          conversationId: fragment.conversationId,
          conversationTitle: fragment.conversationTitle,
          nodeId: fragment.nodeId,
          fragmentIndex: fragment.fragmentIndex,
          fragmentType: fragment.fragmentType,
          chunkIndex,
        },
        text: searchableText,
        embedding: embedText(searchableText, dims),
      });
      sequence += 1;
    });
  }

  return { units, redactionTotals };
}

export function deriveFormulaUnits(units, options = {}) {
  const dims = Number(options.dims || DEFAULT_VECTOR_DIMS);
  const derived = [];
  let sequence = units.length;
  for (const unit of units) {
    const snippet = String(unit.code_snippet || '');
    if (!snippet || !looksFormulaRelated(snippet, unit)) continue;
    const lines = snippet
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(if|else|for|while|switch|case|try|catch|finally)\b/.test(line))
      .filter((line) => /(?:=|\+=|-=|\*=|\/=)|Math\.|=>|return /.test(line))
      .filter((line) => looksFormulaRelated(line));
    const compact = [...new Set(lines)].slice(0, 24).join('\n');
    if (compact.length < 30) continue;

    const topic = /formula|analyzer|roi|mao|arv|coc|dscr|cap|payment|profit/i.test(compact)
      ? 'Deal Analyzer Formulas'
      : unit.topic;
    const content = [
      `Derived formula/code unit from "${unit.source.conversationTitle}".`,
      'This focused unit exists so formula questions retrieve exact implementation lines instead of a large surrounding discussion.',
      compact,
    ].join('\n');
    const text = [
      topic,
      unit.context,
      content,
      unit.rationale ? `Rationale: ${unit.rationale}` : '',
      `Code: ${compact}`,
    ].filter(Boolean).join('\n');
    derived.push({
      id: stableId(`formula|${unit.id}|${compact}`),
      sequence,
      topic,
      context: unit.context,
      content,
      rationale: unit.rationale,
      code_snippet: compact,
      related_issues: [...new Set([...(unit.related_issues || []), 'formula-extraction'])],
      status: unit.status,
      timestamp: unit.timestamp,
      source: {
        ...unit.source,
        derivedFrom: unit.id,
        derivedType: 'formula-code',
      },
      text,
      embedding: embedText(text, dims),
    });
    sequence += 1;
  }
  return derived;
}

export async function writeBrainArtifacts(outputDir, payload) {
  await mkdir(outputDir, { recursive: true });
  const unitsPath = path.join(outputDir, 'knowledge-units.json');
  const jsonlPath = path.join(outputDir, 'documents.jsonl');
  const indexPath = path.join(outputDir, 'index.json');
  const manifestPath = path.join(outputDir, 'manifest.json');

  const jsonl = payload.units.map((unit) => JSON.stringify({
    id: unit.id,
    text: unit.text,
    metadata: metadataFor(unit),
    embedding: unit.embedding,
  })).join('\n');

  const index = payload.units.map((unit) => ({
    id: unit.id,
    sequence: unit.sequence,
    topic: unit.topic,
    status: unit.status,
    timestamp: unit.timestamp,
    source: unit.source,
    embedding: unit.embedding,
  }));

  await Promise.all([
    writeFile(unitsPath, `${JSON.stringify(payload.units, null, 2)}\n`, 'utf8'),
    writeFile(jsonlPath, `${jsonl}\n`, 'utf8'),
    writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8'),
    writeFile(manifestPath, `${JSON.stringify(payload.manifest, null, 2)}\n`, 'utf8'),
  ]);

  return { unitsPath, jsonlPath, indexPath, manifestPath };
}

export async function readKnowledgeUnits(brainDir = DEFAULT_BRAIN_DIR) {
  const filePath = path.join(brainDir, 'knowledge-units.json');
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export function queryKnowledgeUnits(units, query, options = {}) {
  const dims = Number(options.dims || units?.[0]?.embedding?.length || DEFAULT_VECTOR_DIMS);
  const top = Number(options.top || 3);
  const queryVector = embedText(query, dims);
  const queryTerms = tokenize(query);
  return units
    .map((unit) => ({
      score: hybridSearchScore({ query, queryTerms, queryVector, unit }),
      unit,
    }))
    .sort((a, b) => b.score - a.score || a.unit.sequence - b.unit.sequence)
    .slice(0, top);
}

export function metadataFor(unit) {
  return {
    topic: unit.topic,
    context: unit.context,
    rationale: unit.rationale,
    related_issues: unit.related_issues,
    status: unit.status,
    timestamp: unit.timestamp,
    source: unit.source,
    sequence: unit.sequence,
  };
}

export function embedText(text, dims = DEFAULT_VECTOR_DIMS) {
  const vector = new Array(dims).fill(0);
  const tokens = tokenize(text);
  const features = [];
  for (let i = 0; i < tokens.length; i += 1) {
    features.push(tokens[i]);
    if (tokens[i + 1]) features.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  for (const feature of features) {
    const index = positiveHash(feature) % dims;
    const sign = positiveHash(`sign:${feature}`) % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
  return normalizeVector(vector).map((value) => Number(value.toFixed(6)));
}

export function cosineSimilarity(left, right) {
  if (!left?.length || !right?.length) return 0;
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function compareNodesByTime(left, right) {
  const leftTime = Date.parse(left?.message?.inserted_at || '') || 0;
  const rightTime = Date.parse(right?.message?.inserted_at || '') || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function fragmentToText(fragment) {
  if (typeof fragment?.content === 'string') return fragment.content;
  if (typeof fragment?.text === 'string') return fragment.text;
  if (Array.isArray(fragment?.content)) return fragment.content.map(fragmentToText).join('\n');
  if (fragment?.content && typeof fragment.content === 'object') {
    if (Array.isArray(fragment.content.parts)) return fragment.content.parts.join('\n');
    if (typeof fragment.content.text === 'string') return fragment.content.text;
  }
  return '';
}

function redactSensitiveText(input) {
  const counts = {};
  let text = String(input || '');
  const replace = (name, regex, replacement) => {
    text = text.replace(regex, () => {
      counts[name] = (counts[name] || 0) + 1;
      return replacement;
    });
  };

  replace('slackWebhook', /https:\/\/hooks\.slack\.com\/services\/[^\s'"`<>\\)]+/gi, '[REDACTED_SLACK_WEBHOOK]');
  replace('openAiKey', /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_OPENAI_KEY]');
  replace('apiKey', /\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]');
  replace('telnyxKey', /\bKEY[A-Fa-f0-9]{20,}\b/g, '[REDACTED_TELNYX_KEY]');
  replace('googleKey', /\bAIza[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_GOOGLE_KEY]');
  replace('bearerToken', /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, 'Bearer [REDACTED_BEARER_TOKEN]');
  replace('jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');
  replace('email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]');
  replace('phone', /(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g, '[PHONE]');
  replace(
    'address',
    /\b\d{2,6}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,5}\s+(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Dr|Drive|Blvd|Boulevard|Ct|Court|Way|Pl|Place|Trl|Trail|Cir|Circle)\b/g,
    '[ADDRESS]',
  );
  return { text, counts };
}

function chunkText(text, { maxChunkChars, minChunkChars }) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  const chunks = [];
  let current = '';
  const flush = () => {
    if (current.trim().length >= minChunkChars) chunks.push(current.trim());
    current = '';
  };

  for (const block of blocks) {
    const normalizedBlock = block.trim();
    if (!normalizedBlock) continue;
    if (normalizedBlock.length > maxChunkChars) {
      flush();
      chunks.push(...splitLongBlock(normalizedBlock, maxChunkChars, minChunkChars));
      continue;
    }
    const candidate = current ? `${current}\n\n${normalizedBlock}` : normalizedBlock;
    if (candidate.length > maxChunkChars) {
      flush();
      current = normalizedBlock;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

function splitLongBlock(block, maxChunkChars, minChunkChars) {
  const chunks = [];
  const overlap = Math.min(220, Math.floor(maxChunkChars * 0.12));
  for (let start = 0; start < block.length; start += maxChunkChars - overlap) {
    const slice = block.slice(start, start + maxChunkChars).trim();
    if (slice.length >= minChunkChars) chunks.push(slice);
  }
  return chunks;
}

function inferTopic(text, title = '') {
  const haystack = `${title}\n${text}`;
  let best = ['General PBK Context', 0];
  for (const [topic, pattern] of TOPIC_PATTERNS) {
    const matches = haystack.match(pattern);
    const score = matches ? matches.length + (pattern.test(title) ? 2 : 0) : 0;
    if (score > best[1]) best = [topic, score];
  }
  return best[0];
}

function inferStatus(text) {
  if (/deprecated|removed|rolled back|reverted|do not use|stale|old ui/i.test(text)) return 'Deprecated or superseded';
  if (/still open|missing|not done|to do|todo|next step|remaining|blocker|caveat|unfinished|deferred/i.test(text)) return 'Pending or follow-up';
  if (/verified|passed|complete|done|implemented|fixed|live|green|pushed|deployed|wired|configured/i.test(text)) return 'Implemented or verified';
  if (/recommend|best|should|final|decided|we will|we use|chosen|choice/i.test(text)) return 'Decision';
  return 'Context or history';
}

function extractRationale(text) {
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => /because|so that|why|rationale|to avoid|this means|the reason|so we|in order to/i.test(sentence));
  return sentences.slice(0, 3).join(' ').slice(0, 1200);
}

function extractCodeSnippet(text) {
  const snippets = [];
  const regex = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    snippets.push(match[1].trim());
  }
  return snippets.join('\n\n---\n\n').slice(0, 6000);
}

function inferRelatedIssues(text) {
  return ISSUE_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([issue]) => issue);
}

function looksFormulaRelated(text, unit = {}) {
  const haystack = `${unit.topic || ''}\n${text}`;
  return /formula|roi|coc|cash.?on.?cash|dscr|cap.?rate|mao|arv|payment|pmt|profit|spread|equity|cash.?flow|holding|exit.?cost|repair|offer|price|rate|rent|noi|ltv|loan|balance/i.test(haystack);
}

function tokenize(text) {
  return normalizeForSearch(text)
    .split(/[^a-z0-9.$%]+/g)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function hybridSearchScore({ query, queryTerms, queryVector, unit }) {
  const vectorScore = cosineSimilarity(queryVector, unit.embedding || []);
  const lexical = lexicalScore(unit, queryTerms, query);
  return (vectorScore * 0.24) + (lexical * 0.76) + queryIntentBoost(unit, queryTerms);
}

function lexicalScore(unit, queryTerms, query) {
  const terms = [...new Set(queryTerms.filter((term) => term.length > 2))];
  if (!terms.length) return 0;
  const searchable = normalizeForSearch([
    unit.topic,
    unit.status,
    unit.context,
    unit.content,
    unit.rationale,
    unit.code_snippet,
  ].filter(Boolean).join('\n'));
  const topic = normalizeForSearch(unit.topic || '');
  let score = 0;
  let matched = 0;

  for (const term of terms) {
    const escaped = escapeRegExp(term);
    const count = (searchable.match(new RegExp(`\\b${escaped}\\b`, 'g')) || []).length;
    if (count > 0) {
      matched += 1;
      score += Math.min(0.2, 0.055 + Math.log1p(count) * 0.035);
    }
    if (topic.includes(term)) score += 0.08;
  }

  score += (matched / terms.length) * 0.44;

  const phrase = normalizeForSearch(query).trim();
  if (phrase.length > 4 && searchable.includes(phrase)) score += 0.35;

  for (let i = 0; i < terms.length - 1; i += 1) {
    const pair = `${terms[i]} ${terms[i + 1]}`;
    if (searchable.includes(pair)) score += 0.14;
  }

  if (terms.includes('formula') && unit.code_snippet) score += 0.26;
  if (terms.includes('roi') && terms.includes('flip') && normalizeForSearch(unit.code_snippet).includes('flip roi')) {
    score += 0.38;
  }
  const normalizedCode = normalizeForSearch(unit.code_snippet);
  if (
    terms.includes('formula')
    && terms.includes('roi')
    && terms.includes('flip')
    && normalizedCode.includes('gross profit')
    && normalizedCode.includes('total cost')
  ) {
    score += 0.44;
  }

  if (matched >= Math.min(3, terms.length)) score += 0.12;
  return Math.min(1, score);
}

function queryIntentBoost(unit, queryTerms) {
  const terms = new Set(queryTerms);
  const code = normalizeForSearch(unit.code_snippet || '');
  let boost = 0;
  if (terms.has('formula') && unit.source?.derivedType === 'formula-code') boost += 0.16;
  if (terms.has('flip') && terms.has('roi') && code.includes('gross profit') && code.includes('total cost')) {
    boost += 0.24;
  }
  if (terms.has('monthly') && terms.has('payment') && code.includes('monthly') && code.includes('price')) {
    boost += 0.26;
  }
  return boost;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeForSearch(text) {
  return String(text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[`"'’‘“”()[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ');
}

function positiveHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

function stableId(value) {
  return `pbkbrain_${crypto.createHash('sha1').update(value).digest('hex').slice(0, 16)}`;
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + value;
  }
}
