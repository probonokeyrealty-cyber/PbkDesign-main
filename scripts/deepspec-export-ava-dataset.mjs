import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DEFAULT_OUTPUT = path.join(ROOT_DIR, '.pbk-training', 'deepspec', 'ava-speculative-dataset.jsonl');
const DEFAULT_SUMMARY = path.join(ROOT_DIR, '.pbk-training', 'deepspec', 'ava-speculative-dataset-summary.json');
const DEFAULT_STATE = path.join(ROOT_DIR, process.env.PBK_OPENCLAW_STATE_DIR || '.pbk-local', 'openclaw-state.json');
const DEFAULT_AVA_TRAINING = path.join(ROOT_DIR, '.pbk-training', 'ava-training-data.jsonl');

const SYSTEM_PROMPT = [
  'You are Ava Chen, PBK wholesale acquisition command-center companion.',
  'You qualify sellers, use PBK-approved language, preserve compliance boundaries,',
  'and choose safe next actions for leads, calls, SMS, email, contracts, and approvals.',
].join(' ');

const REDACTION_PATTERNS = [
  {
    name: 'email',
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    replacement: '[redacted-email]',
  },
  {
    name: 'phone',
    pattern: /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g,
    replacement: '[redacted-phone]',
  },
  {
    name: 'secret',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{12,}|rnd_[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9._-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})\b/gi,
    replacement: '[redacted-secret]',
  },
  {
    name: 'credential',
    pattern: /\b(?:token|api[_-]?key|secret|password|passcode|protected code)\s*[:=]?\s*["']?[^"'\s,;]{4,}/gi,
    replacement: '[redacted-credential]',
  },
  {
    name: 'address',
    pattern: /\b\d{1,6}[A-Z]?\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Loop|Way|Ct|Court|Cir|Circle|Pl|Place|Pkwy|Parkway|Ter|Terrace)\b(?:[^\n,]{0,40})?/gi,
    replacement: '[redacted-address]',
  },
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    inputs: [],
    out: process.env.PBK_DEEPSPEC_DATASET_OUTPUT || DEFAULT_OUTPUT,
    summary: process.env.PBK_DEEPSPEC_DATASET_SUMMARY || DEFAULT_SUMMARY,
    state: process.env.PBK_DEEPSPEC_STATE_PATH || DEFAULT_STATE,
    limit: Number(process.env.PBK_DEEPSPEC_DATASET_LIMIT || 1000),
    minChars: Number(process.env.PBK_DEEPSPEC_DATASET_MIN_CHARS || 20),
    dryRun: false,
    allowEmpty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--input' && next) {
      options.inputs.push(next);
      index += 1;
    } else if ((arg === '--out' || arg === '--output') && next) {
      options.out = next;
      index += 1;
    } else if (arg === '--summary' && next) {
      options.summary = next;
      index += 1;
    } else if (arg === '--state' && next) {
      options.state = next;
      index += 1;
    } else if (arg === '--limit' && next) {
      options.limit = Number(next);
      index += 1;
    } else if (arg === '--min-chars' && next) {
      options.minChars = Number(next);
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--allow-empty') {
      options.allowEmpty = true;
    }
  }

  options.out = path.resolve(ROOT_DIR, options.out);
  options.summary = path.resolve(ROOT_DIR, options.summary);
  options.state = path.resolve(ROOT_DIR, options.state);
  options.limit = Math.max(1, Math.min(20_000, Number.isFinite(options.limit) ? options.limit : 1000));
  options.minChars = Math.max(1, Math.min(1000, Number.isFinite(options.minChars) ? options.minChars : 20));
  return options;
}

function readStructuredFile(filePath) {
  const resolved = path.resolve(ROOT_DIR, filePath);
  const text = readFileSync(resolved, 'utf8');
  const extension = path.extname(resolved).toLowerCase();
  if (extension === '.jsonl') {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  const parsed = JSON.parse(text || 'null');
  return Array.isArray(parsed) ? parsed : [parsed];
}

function redactText(value = '', totals = {}) {
  let text = String(value || '');
  for (const item of REDACTION_PATTERNS) {
    const matches = text.match(item.pattern);
    if (matches?.length) totals[item.name] = (totals[item.name] || 0) + matches.length;
    text = text.replace(item.pattern, item.replacement);
  }
  return text;
}

function redactMetadata(value, totals = {}) {
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactMetadata(item, totals));
  if (!value || typeof value !== 'object') return redactText(value, totals);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(name|seller|owner|contact)/i.test(key) && typeof item === 'string') {
      totals.name = (totals.name || 0) + 1;
      output[key] = '[redacted-name]';
    } else if (/(address|phone|email|token|secret|passcode|password|key)/i.test(key)) {
      output[key] = redactText(String(item || ''), totals);
    } else if (typeof item === 'object') {
      output[key] = redactMetadata(item, totals);
    } else {
      output[key] = item;
    }
  }
  return output;
}

function normalizeMessages(messages = [], totals = {}) {
  return messages
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      role: ['system', 'user', 'assistant', 'tool'].includes(String(message.role || '').trim())
        ? String(message.role).trim()
        : 'user',
      content: redactText(message.content || message.text || message.message || '', totals).trim(),
    }))
    .filter((message) => message.content);
}

function transcriptToText(value = []) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((turn) => {
      if (typeof turn === 'string') return turn;
      const speaker = String(turn?.speaker || turn?.role || turn?.from || 'turn').trim();
      const text = String(turn?.text || turn?.transcript || turn?.message || turn?.content || '').trim();
      return text ? `${speaker}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function stableId(seed = '') {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function buildFromMessages(record = {}, source = 'input', index = 0, totals = {}) {
  const messages = normalizeMessages(record.messages || [], totals);
  const lastAssistantIndex = messages.map((message) => message.role).lastIndexOf('assistant');
  const acceptedAnswer = redactText(
    record.accepted_answer || record.acceptedAnswer || record.answer || record.response || (lastAssistantIndex >= 0 ? messages[lastAssistantIndex].content : ''),
    totals
  ).trim();
  const promptMessages = lastAssistantIndex >= 0
    ? messages.filter((_, messageIndex) => messageIndex !== lastAssistantIndex)
    : messages;
  if (!promptMessages.some((message) => message.role === 'system')) {
    promptMessages.unshift({ role: 'system', content: SYSTEM_PROMPT });
  }
  return buildExample(promptMessages, acceptedAnswer, record, source, index, totals);
}

function buildFromPromptAnswer(record = {}, source = 'input', index = 0, totals = {}) {
  const prompt = redactText(
    record.prompt || record.query || record.user || record.transcriptSnippet || record.transcript || transcriptToText(record.transcriptTurns || record.turns),
    totals
  ).trim();
  const acceptedAnswer = redactText(
    record.accepted_answer || record.acceptedAnswer || record.answer || record.response || record.agentAction || record.agent_action || record.summary || record.recommendation,
    totals
  ).trim();
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  return buildExample(messages, acceptedAnswer, record, source, index, totals);
}

function buildExample(messages = [], acceptedAnswer = '', record = {}, source = 'input', index = 0, totals = {}) {
  const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  const answer = String(acceptedAnswer || '').trim();
  const id = stableId(`${source}:${record.id || record.feedbackId || record.callId || index}:${messages.map((message) => message.content).join('\n')}:${answer}`);
  return {
    id,
    source,
    messages,
    accepted_answer: answer,
    metadata: {
      sourceKind: String(record.sourceKind || record.kind || record.type || 'ava').slice(0, 80),
      sourceId: String(record.id || record.feedbackId || record.callId || record.leadId || '').slice(0, 120),
      createdAt: record.createdAt || record.created_at || '',
      redactionVersion: '2026-06-28',
      redactedMetadata: redactMetadata(record.metadata || {}, totals),
    },
    stats: {
      promptChars,
      answerChars: answer.length,
    },
  };
}

function flattenStateRecords(state = {}) {
  const records = [];
  for (const row of Array.isArray(state.pbkFeedback) ? state.pbkFeedback : []) {
    records.push({ ...row, sourceKind: 'pbk-feedback' });
  }
  for (const call of Array.isArray(state.calls) ? state.calls : []) {
    records.push({
      ...call,
      sourceKind: 'call',
      transcript: transcriptToText(call.transcript || call.turns),
      answer: call.avaReply || call.reply || call.summary || call.outcomeLabel || call.outcome,
    });
  }
  for (const session of Array.isArray(state.assistantSessions) ? state.assistantSessions : []) {
    records.push({
      ...session,
      sourceKind: 'assistant-session',
      messages: session.history || session.messages || session.transcript || [],
    });
  }
  return records;
}

function loadRecords(options = {}) {
  const sources = [];
  for (const input of options.inputs) {
    sources.push({
      source: path.relative(ROOT_DIR, path.resolve(ROOT_DIR, input)) || input,
      records: readStructuredFile(input),
    });
  }

  if (!sources.length && existsSync(DEFAULT_AVA_TRAINING)) {
    sources.push({
      source: path.relative(ROOT_DIR, DEFAULT_AVA_TRAINING),
      records: readStructuredFile(DEFAULT_AVA_TRAINING),
    });
  }

  if (!sources.length && existsSync(options.state)) {
    const state = JSON.parse(readFileSync(options.state, 'utf8') || '{}');
    sources.push({
      source: path.relative(ROOT_DIR, options.state),
      records: flattenStateRecords(state),
    });
  }

  return sources;
}

function dedupeExamples(examples = []) {
  const seen = new Set();
  const output = [];
  for (const example of examples) {
    const key = `${example.messages.map((message) => `${message.role}:${message.content}`).join('\n')}\n=>${example.accepted_answer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(example);
  }
  return output;
}

export function buildDeepSpecDataset(options = parseArgs()) {
  const redactions = {};
  const rejected = [];
  const examples = [];
  const sources = loadRecords(options);

  for (const source of sources) {
    source.records.forEach((record, index) => {
      const example = Array.isArray(record?.messages)
        ? buildFromMessages(record, source.source, index, redactions)
        : buildFromPromptAnswer(record, source.source, index, redactions);
      const ok = example.stats.promptChars >= options.minChars && example.stats.answerChars >= options.minChars;
      if (!ok) {
        rejected.push({
          source: source.source,
          id: record?.id || record?.feedbackId || record?.callId || index,
          reason: 'prompt_or_answer_too_short',
        });
        return;
      }
      examples.push(example);
    });
  }

  const deduped = dedupeExamples(examples).slice(0, options.limit);
  return {
    examples: deduped,
    summary: {
      ok: Boolean(deduped.length || options.allowEmpty),
      sourceCount: sources.length,
      examplesLoaded: examples.length,
      examplesWritten: deduped.length,
      rejectedCount: rejected.length,
      redactions,
      output: {
        jsonlPath: options.out,
        summaryPath: options.summary,
      },
      safety: {
        providerWrites: false,
        productionModelFlip: false,
        note: 'This command only creates a redacted local JSONL dataset for DeepSpec/vLLM benchmarking.',
      },
      generatedAt: new Date().toISOString(),
    },
    rejected,
  };
}

if (path.resolve(process.argv[1] || '') === __filename) {
  const options = parseArgs();
  const { examples, summary, rejected } = buildDeepSpecDataset(options);
  const finalSummary = { ...summary, rejected: rejected.slice(0, 20) };

  if (!options.dryRun) {
    mkdirSync(path.dirname(options.out), { recursive: true });
    mkdirSync(path.dirname(options.summary), { recursive: true });
    writeFileSync(options.out, `${examples.map((example) => JSON.stringify(example)).join('\n')}${examples.length ? '\n' : ''}`, 'utf8');
    writeFileSync(options.summary, JSON.stringify(finalSummary, null, 2), 'utf8');
  }

  console.log(JSON.stringify(finalSummary, null, 2));
  if (!finalSummary.ok) process.exitCode = 1;
}
