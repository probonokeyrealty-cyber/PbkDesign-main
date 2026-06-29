import { randomUUID } from 'node:crypto';

const MAX_ASSISTANT_HISTORY = 40;
const MAX_TURN_CONTENT = 1800;
const COMMAND_CENTER_PATH = '/index.shell.html';
const TURN_TRUNCATION_WARNING =
  'Long text truncated; Ava only retained the first 1800 characters for this turn.';
const ASSISTANT_INTENT_CLASSIFIER = String(process.env.PBK_ASSISTANT_INTENT_CLASSIFIER || 'regex')
  .trim()
  .toLowerCase();
const ASSISTANT_INTENT_CLASSIFIER_THRESHOLD = Math.max(
  0.35,
  Math.min(0.98, Number(process.env.PBK_ASSISTANT_INTENT_CLASSIFIER_THRESHOLD || 0.72))
);

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(?:docusign|telnyx|instantly)_[a-z0-9_]*(?:key|token|secret|sid|client_id|private_key|access_token|api_key)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}["']?/gi,
  /\b(?:DOCUSIGN|TELNYX|INSTANTLY)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|SID|CLIENT_ID|PRIVATE_KEY|ACCESS_TOKEN|API_KEY)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}["']?/g,
];

const LOCAL_INTENT_EXAMPLES = [
  {
    intent: 'analyze_deal',
    examples: [
      'analyze this deal',
      'what is the mao',
      'is this worth chasing',
      'should we pursue this property',
      'run the deal math',
      'underwrite this address',
    ],
  },
  {
    intent: 'nurture_start',
    examples: [
      'start a nurture sequence',
      'schedule follow up campaign',
      'automate follow up for this seller',
      'queue a nurture sequence tonight',
    ],
  },
  {
    intent: 'nurture_consult',
    examples: [
      'what is the best follow up',
      'should i text or email',
      'recommend the next seller follow up',
      'which channel should we use',
    ],
  },
  {
    intent: 'unified_additive_intelligence',
    examples: [
      'use all intelligence',
      'run frontier additives',
      'sync the whole system',
      'use the unified intelligence layer',
    ],
  },
  {
    intent: 'session_recall',
    examples: [
      'what did i just ask',
      'what was my last message',
      'recall my last question',
      'remember what i said',
    ],
  },
  {
    intent: 'lead_lookup',
    examples: [
      'find this lead',
      'look up seller',
      'show contact named',
      'get lead with this address',
    ],
  },
  {
    intent: 'approvals',
    examples: [
      'show pending approvals',
      'what contracts are waiting',
      'approval status',
      'what is waiting for approval',
    ],
  },
  {
    intent: 'summary',
    examples: [
      'summarize recent calls',
      'catch me up on leads',
      'recap deal activity',
      'summarize approvals',
    ],
  },
  {
    intent: 'call',
    examples: [
      'call this number',
      'dial the seller',
      'ring the owner',
      'place a call now',
    ],
  },
  {
    intent: 'help',
    examples: [
      'what can you do',
      'what can you help with',
      'what can you help my agents do',
      'show commands',
      'help me',
      'what are your capabilities',
    ],
  },
];

export const ASSISTANT_SYSTEM_PROMPT = `
You are Ava, PBK Command Center's personal assistant.
You are warm, concise, useful, and proactive. Speak like a capable operating partner for real estate agents, not a debug console.
You can help analyze deals, summarize recent activity, find leads, explain PBK workflows, and prepare approval-gated actions.
Keep internal labels out of normal replies: do not mention OpenClaw, bridge, sidecar, tool plan, provider write, local worker, or implementation details unless the operator explicitly asks for technical support.
Prefer action-state replies: "I found...", "I queued...", "I'm missing...", "Here's the next clean move...".
When an operator asks for follow-up by SMS, email, call, or nurture sequence, first consult the Nurture Agent for the best channel, timing, and sequence.
When an authenticated operator asks about frontier additives, robustness, full-system sync, or "use all intelligence", use the Unified Additive Intelligence layer so stopping-agent, path-search, compact memory, workflow induction, tool discovery, state inference, GUI planning, mission planning, ACP routing, and safety transparency act together.
Do not pretend to be human. Do not start calls, texts, emails, contracts, payments, or admin/provider writes unless the authenticated Command Center approval flow allows it.
Only start a nurture sequence when the authenticated operator explicitly asks to automate it; provider writes remain approval-gated.
Start with the clean next move, then add enough context to feel thoughtful and useful. Keep routine replies short, but use fuller conversation when the operator is asking for strategy, coaching, memory, or a complicated next action.
`.trim();

export function createAssistantSessionId(prefix = 'ava_chat') {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function redactAssistantSecrets(value = '') {
  let text = String(value || '');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[redacted-secret]');
  }
  return text;
}

export function sanitizeAssistantTurn(value = '', maxLength = MAX_TURN_CONTENT) {
  const raw = String(value || '');
  const compacted = redactAssistantSecrets(raw)
    .replace(/\s+/g, ' ')
    .trim();
  const truncated = compacted.length > maxLength;
  return {
    content: compacted.slice(0, maxLength),
    truncated,
    warning: truncated ? TURN_TRUNCATION_WARNING : '',
    originalLength: raw.length,
    retainedLength: Math.min(compacted.length, maxLength),
  };
}

function cleanText(value = '', maxLength = MAX_TURN_CONTENT) {
  return sanitizeAssistantTurn(value, maxLength).content;
}

function mergeSanitizationMetadata(metadata = {}, sanitized = {}) {
  const safeMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  if (sanitized.truncated) {
    safeMetadata.truncated = true;
    safeMetadata.warning = sanitized.warning;
    safeMetadata.originalLength = sanitized.originalLength;
    safeMetadata.retainedLength = sanitized.retainedLength;
  }
  return safeMetadata;
}

export function normalizeAssistantSession(session = {}) {
  const history = Array.isArray(session?.history) ? session.history : [];
  return {
    ...session,
    history: history
      .map((turn) => {
        const sanitized = sanitizeAssistantTurn(turn?.content || '');
        return {
          role: ['user', 'assistant', 'system'].includes(String(turn?.role || '').toLowerCase())
            ? String(turn.role).toLowerCase()
            : 'user',
          content: sanitized.content,
          at: turn?.at || turn?.timestamp || null,
          metadata: mergeSanitizationMetadata(turn?.metadata, sanitized),
        };
      })
      .filter((turn) => turn.content)
      .slice(-MAX_ASSISTANT_HISTORY),
    leadId: cleanText(session?.leadId || session?.lead_id || '', 120),
    userId: cleanText(session?.userId || session?.user_id || '', 120),
    toolResults:
      session?.toolResults && typeof session.toolResults === 'object' ? session.toolResults : {},
  };
}

export function appendAssistantMessage(session = {}, role = 'user', content = '', metadata = {}) {
  const normalized = normalizeAssistantSession(session);
  const safeRole = ['user', 'assistant', 'system'].includes(String(role || '').toLowerCase())
    ? String(role).toLowerCase()
    : 'user';
  const sanitized = sanitizeAssistantTurn(content);
  if (!sanitized.content) return normalized;
  normalized.history = [
    ...normalized.history,
    {
      role: safeRole,
      content: sanitized.content,
      at: new Date().toISOString(),
      metadata: mergeSanitizationMetadata(metadata, sanitized),
    },
  ].slice(-MAX_ASSISTANT_HISTORY);
  return normalized;
}

function extractAddress(message = '') {
  const text = String(message || '');
  const match = text.match(
    /\b\d{1,7}\s+[A-Za-z0-9.'#\-\s]+?\s(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Way|Court|Ct|Circle|Cir|Place|Pl|Trail|Trl)\b/i
  );
  return match ? cleanText(match[0], 220) : '';
}

function extractPhone(message = '') {
  const match = String(message || '').match(
    /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/
  );
  return match ? match[0].replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') : '';
}

function extractEmailAddress(message = '') {
  const match = String(message || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return cleanText(match?.[0] || '', 160);
}

function extractQuotedText(message = '') {
  const text = String(message || '');
  const quoted = text.match(/"([^"]{2,700})"/) || text.match(/'([^']{2,700})'/);
  return cleanText(quoted?.[1] || '', 700);
}

function extractMessageBody(message = '') {
  const quoted = extractQuotedText(message);
  if (quoted) return quoted;
  const match = String(message || '').match(
    /\b(?:that|saying|says|message|body|text)\s*[:-]?\s+(.{3,700})$/i
  );
  return cleanText(match?.[1] || '', 700);
}

function extractLeadQuery(message = '') {
  const match = String(message || '').match(
    /\b(?:find|show|get|lookup|look up)\s+(?:lead|seller|contact)\s+(?:named|called|with)?\s*"?([^".,?]+)"?/i
  );
  return cleanText(match?.[1] || '', 120);
}

function stripLeadQuery(value = '') {
  const query = cleanText(value, 160)
    .replace(/\b(?:tonight|today|tomorrow|this week|next week|now|please|asap|after|before|at|on|by)\b.*$/i, '')
    .replace(/\b(?:lead|seller|contact)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!query || /^(?:this|that|the|a|an|for|with|to)$/i.test(query)) return '';
  return query.length >= 2 ? query : '';
}

function extractNurtureLeadQuery(message = '') {
  const text = String(message || '');
  const quoted = text.match(/"([^"]{2,120})"/);
  if (quoted?.[1]) return stripLeadQuery(quoted[1]);
  const match = text.match(
    /\b(?:for|with|to)\s+(?:the\s+)?(?:lead|seller|contact)?\s*([^".,?]+?)(?:\s+\b(?:tonight|today|tomorrow|this week|next week|now|please|asap|after|before|at|on|by)\b|[.?!]|$)/i
  );
  return stripLeadQuery(match?.[1] || '');
}

function extractProviderLeadQuery(message = '') {
  const text = String(message || '');
  const match = text.match(
    /\b(?:for|to|with)\s+(?:the\s+)?(?:lead|seller|contact)?\s*([^".,?]+?)(?:\s+\b(?:that|saying|about|regarding|tonight|today|tomorrow|this week|next week|now|please|asap|after|before|at|on|by|with)\b|[.?!]|$)/i
  );
  return stripLeadQuery(match?.[1] || '');
}

function extractFollowUpWhen(message = '') {
  const text = cleanText(message, 500);
  const match = text.match(
    /\b(?:tonight|today|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in \d+\s+(?:minutes?|hours?|days?)|at \d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i
  );
  return cleanText(match?.[0] || '', 80);
}

function normalizeComparableText(value = '') {
  return cleanText(value, 320)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(query = '', candidate = '') {
  const q = normalizeComparableText(query);
  const c = normalizeComparableText(candidate);
  if (!q || !c) return 0;
  if (c === q) return 1;
  if (c.includes(q)) return 0.95;
  if (q.includes(c) && c.length >= 4) return 0.82;
  const qTokens = q.split(' ').filter((token) => token.length > 1);
  const cTokens = new Set(c.split(' ').filter((token) => token.length > 1));
  if (!qTokens.length || !cTokens.size) return 0;
  const overlap = qTokens.filter((token) => cTokens.has(token)).length;
  const prefixOverlap = qTokens.filter((token) =>
    [...cTokens].some((candidateToken) => candidateToken.startsWith(token) || token.startsWith(candidateToken))
  ).length;
  return Math.max(overlap / qTokens.length, prefixOverlap ? prefixOverlap / qTokens.length - 0.1 : 0);
}

function getLeadIdentity(lead = {}) {
  const name =
    lead.name ||
    lead.leadName ||
    lead.sellerName ||
    lead.ownerName ||
    lead.contactName ||
    lead.seller?.name ||
    lead.contact?.name ||
    '';
  const address =
    lead.address ||
    lead.propertyAddress ||
    lead.property?.address ||
    lead.home?.address ||
    lead.mailingAddress ||
    '';
  const leadId = lead.id || lead.leadId || lead.lead_id || lead.uuid || '';
  return {
    leadId: cleanText(leadId, 120),
    name: cleanText(name, 160),
    address: cleanText(address, 220),
  };
}

export function findAssistantLeadMatch(query = '', leads = [], { threshold = 0.3 } = {}) {
  const safeQuery = stripLeadQuery(query) || cleanText(query, 160);
  if (!safeQuery || !Array.isArray(leads) || !leads.length) return null;
  let best = null;
  for (const lead of leads) {
    const identity = getLeadIdentity(lead);
    if (!identity.leadId && !identity.name && !identity.address) continue;
    const nameScore = tokenSimilarity(safeQuery, identity.name);
    const addressScore = tokenSimilarity(safeQuery, identity.address);
    const combinedScore = tokenSimilarity(safeQuery, `${identity.name} ${identity.address}`);
    const similarity = Math.max(nameScore, addressScore, combinedScore);
    if (!best || similarity > best.similarity) {
      best = {
        ...identity,
        similarity: Number(similarity.toFixed(3)),
        matchMode: 'fuzzy',
      };
    }
  }
  return best && best.similarity >= threshold ? best : null;
}

export function classifyAssistantIntentLocally(message = '', options = {}) {
  const mode = String(options.classifierMode || ASSISTANT_INTENT_CLASSIFIER || 'regex')
    .trim()
    .toLowerCase();
  if (!['local', 'offline', 'tiny', 'tiny-local', 'local-llm'].includes(mode)) return null;
  const text = cleanText(message, 2400);
  if (!text) return null;
  let best = null;
  for (const item of LOCAL_INTENT_EXAMPLES) {
    for (const example of item.examples) {
      const similarity = Math.max(
        tokenSimilarity(text, example),
        tokenSimilarity(example, text)
      );
      if (!best || similarity > best.confidence) {
        best = {
          intent: item.intent,
          confidence: Number(similarity.toFixed(3)),
          classifierSource: 'local_tiny_intent',
          example,
        };
      }
    }
  }
  const threshold = Math.max(
    0.35,
    Math.min(0.98, Number(options.threshold || ASSISTANT_INTENT_CLASSIFIER_THRESHOLD))
  );
  return best && best.confidence >= threshold ? best : null;
}

function buildAssistantIntentFromClassifier(classified = null, context = {}) {
  if (!classified?.intent) return null;
  const text = context.text || '';
  const lower = context.lower || text.toLowerCase();
  const phone = context.phone || '';
  const address = context.address || '';
  const base = {
    message: text,
    classifierSource: classified.classifierSource || 'local_classifier',
    classifierConfidence: classified.confidence,
  };
  if (classified.intent === 'help') return { ...base, intent: 'help' };
  if (classified.intent === 'unified_additive_intelligence') {
    return { ...base, intent: 'unified_additive_intelligence' };
  }
  if (classified.intent === 'session_recall') return { ...base, intent: 'session_recall' };
  if (classified.intent === 'analyze_deal') {
    return { ...base, intent: 'analyze_deal', address };
  }
  if (classified.intent === 'nurture_start' || classified.intent === 'nurture_consult') {
    const channelMatch = lower.match(/\b(sms|text|email|call)\b/i);
    const requestedChannel = channelMatch?.[1] === 'text' ? 'sms' : channelMatch?.[1] || '';
    return {
      ...base,
      intent: classified.intent,
      requestedChannel,
      leadQuery: extractNurtureLeadQuery(text),
    };
  }
  if (classified.intent === 'call' && phone) return { ...base, intent: 'call', phone };
  if (classified.intent === 'approvals') return { ...base, intent: 'approvals' };
  if (classified.intent === 'summary') return { ...base, intent: 'summary' };
  if (classified.intent === 'lead_lookup') {
    return {
      ...base,
      intent: 'lead_lookup',
      query: extractLeadQuery(text) || extractNurtureLeadQuery(text) || address || '',
    };
  }
  return null;
}

export function detectAssistantIntent(message = '') {
  const text = cleanText(message, 2400);
  const lower = text.toLowerCase();
  const phone = extractPhone(text);
  const address = extractAddress(text);
  const localIntent = buildAssistantIntentFromClassifier(
    classifyAssistantIntentLocally(text),
    { text, lower, phone, address }
  );
  if (localIntent) return localIntent;

  if (/\b(what can you (?:do|help(?:\s+(?:with|my team|my agents))?)|how can you help|help|capabilities|commands?)\b/i.test(lower)) {
    return { intent: 'help', message: text, classifierSource: 'regex' };
  }

  if (
    /\b(frontier|additives?|all intelligence|unified intelligence|whole system|system sync|robust|masteragent|mem1|neuroskill|tooluniverse|encompass|awm|stopping agent|autograph|acp)\b/i.test(
      lower
    )
  ) {
    return { intent: 'unified_additive_intelligence', message: text, classifierSource: 'regex' };
  }

  if (
    /\b(what did i (just )?(ask|say)|what was my last (question|message)|remember what i (asked|said)|recall my last)\b/i.test(
      lower
    )
  ) {
    return { intent: 'session_recall', message: text, classifierSource: 'regex' };
  }

  if (
    /\b(?:send|draft|compose|write|prepare)\b.{0,60}\b(?:sms|text|message|email|mail)\b/i.test(lower) ||
    /^(?:text|sms|email|mail)\b/i.test(lower)
  ) {
    const channel = /\b(email|mail)\b/i.test(lower) ? 'email' : 'sms';
    const delivery = /\b(?:send|text|sms|email|mail)\b/i.test(lower) &&
      !/\b(?:draft|compose|write|prepare)\b/i.test(lower)
      ? 'send'
      : 'draft';
    return {
      intent: 'seller_message',
      message: text,
      channel,
      delivery,
      phone,
      email: extractEmailAddress(text),
      messageBody: extractMessageBody(text),
      leadQuery: extractProviderLeadQuery(text),
      classifierSource: 'regex',
    };
  }

  if (/\b(?:send|prepare|draft|build|create).{0,48}(?:contract|agreement|docusign|seller docs?|docs?)\b/i.test(lower)) {
    const sendRequested = /\bsend\b/i.test(lower) && !/\b(?:do not send|don't send|without sending|not send)\b/i.test(lower);
    return {
      intent: sendRequested ? 'contract_send' : 'contract_prepare',
      message: text,
      address,
      leadQuery: extractProviderLeadQuery(text),
      classifierSource: 'regex',
    };
  }

  if (/\b(?:schedule|set|queue|plan).{0,48}(?:follow[\s-]?up|appointment|callback|reminder)\b/i.test(lower)) {
    return {
      intent: 'schedule_follow_up',
      message: text,
      leadQuery: extractProviderLeadQuery(text),
      when: extractFollowUpWhen(text),
      classifierSource: 'regex',
    };
  }

  if (/\b(?:remember|save|store|note).{0,48}(?:this|note|memory|seller fact|lesson)\b/i.test(lower)) {
    return {
      intent: 'remember_note',
      message: text,
      note: extractMessageBody(text) || text,
      leadQuery: extractProviderLeadQuery(text),
      classifierSource: 'regex',
    };
  }

  if (/\b(?:review|score|audit|summarize).{0,48}(?:latest\s+)?(?:call|conversation|seller interaction|interaction)\b/i.test(lower)) {
    return {
      intent: 'call_review',
      message: text,
      leadQuery: extractProviderLeadQuery(text),
      classifierSource: 'regex',
    };
  }

  if (
    /\b(analy[sz]e|mao|arv|offer|deal math|underwrite|property value|worth chasing|worth pursuing|worth it|should (?:we|i) chase|should (?:we|i) pursue|make sense as a deal|deal worth)\b/i.test(
      lower
    )
  ) {
    return { intent: 'analyze_deal', message: text, address, classifierSource: 'regex' };
  }

  if (
    /\b(nurture|follow[\s-]?up|reach out|send (?:a )?(?:sms|text|email)|text this lead|email this lead|should i (?:sms|text|email|call)|best (?:channel|follow[\s-]?up))\b/i.test(
      lower
    )
  ) {
    const channelMatch = lower.match(/\b(sms|text|email|call)\b/i);
    const requestedChannel = channelMatch?.[1] === 'text' ? 'sms' : channelMatch?.[1] || '';
    const explicitStart = /\b(start|launch|activate|automate|queue|schedule|run|turn\s+on|set\s+up)\b.*\b(nurture|follow[\s-]?up|sequence|campaign)\b/i.test(lower)
      || /\b(nurture|follow[\s-]?up)\b.*\b(start|launch|activate|automate|queue|schedule|run|sequence|campaign)\b/i.test(lower);
    return {
      intent: explicitStart ? 'nurture_start' : 'nurture_consult',
      message: text,
      requestedChannel,
      leadQuery: extractNurtureLeadQuery(text),
      classifierSource: 'regex',
    };
  }

  if (/\b(call|dial|ring)\b/i.test(lower) && phone) {
    return { intent: 'call', message: text, phone, classifierSource: 'regex' };
  }

  if (
    /\b(pending\s+)?approvals?|approval status|contracts? pending|offers? pending|what'?s waiting\b/i.test(
      lower
    )
  ) {
    return { intent: 'approvals', message: text, classifierSource: 'regex' };
  }

  if (
    /\b(summarize|summary|recap|catch me up)\b.*\b(calls?|leads?|deals?|approvals?|activity)\b/i.test(
      lower
    )
  ) {
    return { intent: 'summary', message: text, classifierSource: 'regex' };
  }

  const leadQuery = extractLeadQuery(text);
  if (leadQuery) {
    return { intent: 'lead_lookup', message: text, query: leadQuery, classifierSource: 'regex' };
  }

  return { intent: 'general', message: text, classifierSource: 'regex' };
}

export function buildAssistantSuggestions(intent = 'general', { publicMode = true } = {}) {
  if (publicMode) {
    if (intent === 'analyze_deal')
      return ['Share property details', 'Ask how PBK reviews offers', 'Request a callback'];
    if (intent === 'call')
      return ['Share callback info', 'Explain the callback process', 'Ask a PBK question'];
    return ['Ask how PBK works', 'Share a property address', 'Request a callback'];
  }

  if (intent === 'analyze_deal') return ['Share the address', 'Run deal math', 'Draft seller question'];
  if (intent === 'approvals')
    return ['Show what needs review', 'Summarize approvals', 'Find the related lead'];
  if (intent === 'call') return ['Prepare call request', 'Find the lead first', 'Write an opener'];
  if (intent === 'nurture_consult')
    return ['Recommend next touch', 'Find the lead', 'Draft the follow-up'];
  if (intent === 'nurture_start')
    return ['Prepare nurture approval', 'Check best timing first', 'Find the lead'];
  if (intent === 'seller_message') return ['Draft the wording', 'Find the lead', 'Prepare for approval'];
  if (intent === 'contract_prepare' || intent === 'contract_send')
    return ['Prepare contract', 'Find the lead', 'Check DocuSign readiness'];
  if (intent === 'schedule_follow_up') return ['Pick the lead', 'Recommend timing', 'Prepare follow-up'];
  if (intent === 'remember_note') return ['Save note', 'Attach to lead', 'Recall later'];
  if (intent === 'call_review') return ['Review latest call', 'Summarize missed context', 'Next coaching move'];
  if (intent === 'unified_additive_intelligence')
    return ['Run full intelligence', 'Show safest next step', 'Check provider readiness'];
  if (intent === 'summary') return ['Summarize calls', 'Show hot leads', 'What needs attention'];
  return ['Find a lead', 'Analyze a deal', 'Draft a follow-up'];
}

function getAssistantLeadPlanContext(detected = {}, options = {}) {
  const session = normalizeAssistantSession(options.session || {});
  const leadId = cleanText(options.leadId || detected.leadId || session.leadId || '', 120);
  const providedLeads = [
    ...(Array.isArray(options.leads) ? options.leads : []),
    ...(Array.isArray(options.leadRoster) ? options.leadRoster : []),
    ...(Array.isArray(options.session?.leads) ? options.session.leads : []),
  ];
  const leadQuery =
    detected.leadQuery ||
    detected.query ||
    extractProviderLeadQuery(detected.message || '') ||
    extractNurtureLeadQuery(detected.message || '');
  const leadMatch = leadId ? null : findAssistantLeadMatch(leadQuery || detected.message || '', providedLeads);
  return { leadId, leadQuery, leadMatch };
}

export function planAssistantIntent(detected = {}, options = {}) {
  const publicMode = options.publicMode !== false;
  const authenticated = Boolean(options.authenticated);
  const intent = detected?.intent || 'general';
  const suggestions = buildAssistantSuggestions(intent, { publicMode });

  if (publicMode && intent === 'call') {
    return {
      action: 'blocked_public_provider_write',
      answer:
        'I can save callback info, but public chat will not start calls, texts, emails, contracts, or other provider writes. Share the property details and best contact info, and the PBK team can review it.',
      suggestions,
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (publicMode && ['approvals', 'lead_lookup', 'summary'].includes(intent)) {
    return {
      action: 'blocked_public_private_data',
      answer:
        `That information lives inside the authenticated PBK Command Center. Open the Command Center at ${COMMAND_CENTER_PATH} to review approvals, leads, calls, and private deal activity.`,
      suggestions,
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (publicMode && intent === 'help') {
    return {
      action: 'public_help',
      answer:
        'Ask me about PBK, selling options, timelines, or what information the team needs. If you want a callback, share the property address and best contact info.',
      suggestions,
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (intent === 'session_recall') {
    const session = normalizeAssistantSession(options.session || {});
    const recalledHistory = normalizeAssistantSession({
      history: Array.isArray(options.recalledHistory)
        ? options.recalledHistory
        : Array.isArray(options.persistedHistory)
          ? options.persistedHistory
          : [],
    }).history;
    const recallHistory = [...recalledHistory, ...session.history].slice(-MAX_ASSISTANT_HISTORY);
    const lastUserTurn = [...recallHistory]
      .reverse()
      .find(
        (turn) =>
          turn.role === 'user' &&
          turn.content &&
          !/\b(what did i (just )?(ask|say)|what was my last (question|message)|remember what i (asked|said)|recall my last)\b/i.test(
            turn.content
          )
      );
    return {
      action: 'session_recall',
      answer: lastUserTurn
        ? `You just asked: "${lastUserTurn.content}"`
        : 'I do not have an earlier message in this session yet.',
      suggestions,
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (!publicMode && !authenticated) {
    return {
      action: 'authentication_required',
      answer:
        'Sign in to the PBK Command Center first, then I can use private deal data and team tools for you.',
      suggestions: ['Sign in', 'Use public chat safely'],
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'help') {
    return {
      action: 'internal_help',
      answer:
        'Tell me what you need in plain English. I can find leads, pull seller context, run deal math, draft follow-ups, summarize calls, prepare approvals, and help decide the next clean seller move.',
      suggestions,
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (
    publicMode &&
    ['seller_message', 'contract_prepare', 'contract_send', 'schedule_follow_up', 'remember_note', 'call_review'].includes(
      intent
    )
  ) {
    return {
      action: 'blocked_public_provider_write',
      answer:
        'Public chat can capture property and callback details, but agent actions live inside the authenticated Command Center. Open PBK Command Center before texts, emails, contracts, follow-ups, memories, or call reviews touch private records.',
      suggestions,
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'seller_message') {
    const channel = detected.channel === 'email' ? 'email' : 'sms';
    const delivery = detected.delivery === 'send' ? 'send' : 'draft';
    const { leadId, leadQuery, leadMatch } = getAssistantLeadPlanContext(detected, options);
    const recipient = channel === 'email' ? detected.email : detected.phone;
    if (!leadId && !recipient && leadMatch) {
      return {
        action: 'lead_confirmation_required',
        answer: `I found ${leadMatch.name || 'a likely lead'}${leadMatch.address ? ` at ${leadMatch.address}` : ''}. Confirm this is the right seller and I will ${delivery === 'send' ? 'prepare the message for approval' : 'draft the message'}.`,
        suggestions,
        leadMatch,
        toolPlan: {
          toolName: 'confirmLeadMatch',
          params: {
            nextToolName: channel === 'email' ? 'sendColdEmail' : 'telnyx_sms',
            leadId: leadMatch.leadId,
            matchedLead: leadMatch,
            userRequest: detected.message,
            channel,
            delivery,
            messageBody: detected.messageBody || '',
          },
          providerWrite: false,
          requiresConfirmation: true,
        },
        usedIntent: intent,
      };
    }
    if (!leadId && !recipient && leadQuery) {
      return {
        action: 'lead_lookup_required',
        answer: `I need to confirm which seller you mean before I touch ${channel.toUpperCase()}. I can search for "${leadQuery}" and let you pick the right lead.`,
        suggestions,
        toolPlan: {
          toolName: 'findLead',
          params: { query: leadQuery, nextToolName: channel === 'email' ? 'sendColdEmail' : 'telnyx_sms' },
          providerWrite: false,
          requiresConfirmation: true,
        },
        usedIntent: intent,
      };
    }
    if (delivery !== 'send') {
      return {
        action: 'draft_message',
        answer:
          detected.messageBody
            ? `Draft ${channel.toUpperCase()}: ${detected.messageBody}`
            : `Tell me the seller and the point you want made, and I will draft a clean ${channel === 'email' ? 'email' : 'text'} without sending it.`,
        suggestions,
        toolPlan: {
          toolName: 'draftSellerMessage',
          params: { leadId, channel, body: detected.messageBody || '', userRequest: detected.message },
          providerWrite: false,
        },
        usedIntent: intent,
      };
    }
    if (!detected.messageBody) {
      return {
        action: 'missing_required_info',
        answer: `I can prepare the ${channel === 'email' ? 'email' : 'text'} for approval, but I need the exact message or goal first.`,
        suggestions,
        toolPlan: null,
        usedIntent: intent,
      };
    }
    return {
      action: 'approval_required',
      answer: `I will prepare that ${channel === 'email' ? 'email' : 'text'} for approval. Nothing sends until the approval path releases it.`,
      suggestions,
      toolPlan: {
        toolName: channel === 'email' ? 'sendColdEmail' : 'telnyx_sms',
        params: {
          leadId,
          ...(channel === 'email' ? { email: detected.email } : { phone: detected.phone, to: detected.phone }),
          body: detected.messageBody,
          message: detected.messageBody,
          customBody: detected.messageBody,
          subject: channel === 'email' ? 'Follow-up from Probono Key Realty' : undefined,
          forceApproval: true,
          source: 'ava-assistant-chat',
        },
        providerWrite: true,
        approvalRequired: true,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && ['contract_prepare', 'contract_send'].includes(intent)) {
    const sendContract = intent === 'contract_send';
    const { leadId, leadQuery, leadMatch } = getAssistantLeadPlanContext(detected, options);
    if (!leadId && !detected.address && leadMatch) {
      return {
        action: 'lead_confirmation_required',
        answer: `I found ${leadMatch.name || 'a likely lead'}${leadMatch.address ? ` at ${leadMatch.address}` : ''}. Confirm this is the right seller and I will ${sendContract ? 'prepare DocuSign for approval' : 'prepare the contract draft'}.`,
        suggestions,
        leadMatch,
        toolPlan: {
          toolName: 'confirmLeadMatch',
          params: {
            nextToolName: sendContract ? 'prepare_and_send_contract' : 'prepareContract',
            leadId: leadMatch.leadId,
            matchedLead: leadMatch,
            userRequest: detected.message,
          },
          providerWrite: false,
          requiresConfirmation: true,
        },
        usedIntent: intent,
      };
    }
    if (!leadId && !detected.address && leadQuery) {
      return {
        action: 'lead_lookup_required',
        answer: `I need to confirm the seller before preparing contract documents. I can search for "${leadQuery}" first.`,
        suggestions,
        toolPlan: {
          toolName: 'findLead',
          params: { query: leadQuery, nextToolName: sendContract ? 'prepare_and_send_contract' : 'prepareContract' },
          providerWrite: false,
          requiresConfirmation: true,
        },
        usedIntent: intent,
      };
    }
    if (!leadId && !detected.address) {
      return {
        action: 'missing_required_info',
        answer:
          'Send me the seller, lead, or property address so I can prepare the right contract path without guessing.',
        suggestions,
        toolPlan: null,
        usedIntent: intent,
      };
    }
    return {
      action: sendContract ? 'approval_required' : 'tool_plan',
      answer: sendContract
        ? 'I will prepare DocuSign for approval. Nothing sends until the approval path releases it.'
        : 'I will prepare the contract draft now without sending it.',
      suggestions,
      toolPlan: {
        toolName: sendContract ? 'prepare_and_send_contract' : 'prepareContract',
        params: {
          leadId,
          address: detected.address,
          userRequest: detected.message,
          forceApproval: sendContract,
          source: 'ava-assistant-chat',
        },
        providerWrite: sendContract,
        approvalRequired: sendContract,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'schedule_follow_up') {
    const { leadId, leadQuery, leadMatch } = getAssistantLeadPlanContext(detected, options);
    if (!leadId && leadMatch) {
      return {
        action: 'lead_confirmation_required',
        answer: `I found ${leadMatch.name || 'a likely lead'}${leadMatch.address ? ` at ${leadMatch.address}` : ''}. Confirm this is the right seller and I will prepare the follow-up for approval.`,
        suggestions,
        leadMatch,
        toolPlan: {
          toolName: 'confirmLeadMatch',
          params: {
            nextToolName: 'scheduleAppointment',
            leadId: leadMatch.leadId,
            matchedLead: leadMatch,
            userRequest: detected.message,
            when: detected.when || '',
          },
          providerWrite: false,
          requiresConfirmation: true,
        },
        usedIntent: intent,
      };
    }
    if (!leadId && leadQuery) {
      return {
        action: 'lead_lookup_required',
        answer: `I need the seller first. I can search for "${leadQuery}" and then prepare the follow-up.`,
        suggestions,
        toolPlan: {
          toolName: 'findLead',
          params: { query: leadQuery, nextToolName: 'scheduleAppointment' },
          providerWrite: false,
          requiresConfirmation: true,
        },
        usedIntent: intent,
      };
    }
    if (!leadId) {
      return {
        action: 'missing_required_info',
        answer: 'Pick the lead first, then I can prepare the follow-up timing for approval.',
        suggestions,
        toolPlan: null,
        usedIntent: intent,
      };
    }
    return {
      action: 'approval_required',
      answer: 'I will prepare the follow-up for approval. Nothing is scheduled until it is approved.',
      suggestions,
      toolPlan: {
        toolName: 'scheduleAppointment',
        params: {
          leadId,
          notes: detected.message,
          requestedWhen: detected.when || '',
          forceApproval: true,
          source: 'ava-assistant-chat',
        },
        providerWrite: true,
        approvalRequired: true,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'remember_note') {
    const { leadId } = getAssistantLeadPlanContext(detected, options);
    return {
      action: 'tool_plan',
      answer: 'I will save that note to PBK memory so Ava can use it later.',
      suggestions,
      toolPlan: {
        toolName: 'addPbkMemory',
        params: {
          agentName: 'ava',
          memoryType: leadId ? 'lead_note' : 'operator_note',
          leadId,
          text: detected.note || detected.message,
          content: detected.note || detected.message,
          source: 'ava-assistant-chat',
        },
        providerWrite: false,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'call_review') {
    return {
      action: 'call_review_summary',
      answer: 'I will review the latest seller interaction and pull the clean next coaching move.',
      suggestions,
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'analyze_deal') {
    if (!detected.address) {
      return {
        action: 'missing_required_info',
        answer:
          "I'm missing the street address. Send it and I'll run ARV, repairs, MAO, and the next seller question.",
        suggestions,
        toolPlan: null,
        usedIntent: intent,
      };
    }
    return {
      action: 'tool_plan',
      answer: `I'll run the deal math for ${detected.address} now.`,
      suggestions,
      toolPlan: {
        toolName: 'analyzeDeal',
        params: { address: detected.address },
        providerWrite: false,
        requiresBridgeConfirmation: true,
        retryable: true,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'approvals') {
    return {
      action: 'tool_plan',
      answer: 'I will pull what needs review now.',
      suggestions,
      toolPlan: {
        toolName: 'getApprovals',
        params: { status: 'pending' },
        providerWrite: false,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'call') {
    return {
      action: 'approval_required',
      answer: `I will prepare the call request for ${detected.phone}. Nothing dials until you approve it.`,
      suggestions,
      toolPlan: {
        toolName: 'telnyx_call',
        params: { to: detected.phone, forceApproval: true },
        providerWrite: true,
        approvalRequired: true,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && ['nurture_consult', 'nurture_start'].includes(intent)) {
    const session = normalizeAssistantSession(options.session || {});
    const leadId = cleanText(options.leadId || detected.leadId || session.leadId || '', 120);
    if (!leadId) {
      const providedLeads = [
        ...(Array.isArray(options.leads) ? options.leads : []),
        ...(Array.isArray(options.leadRoster) ? options.leadRoster : []),
        ...(Array.isArray(options.session?.leads) ? options.session.leads : []),
      ];
      const leadQuery = detected.leadQuery || extractNurtureLeadQuery(detected.message || '');
      const leadMatch = findAssistantLeadMatch(leadQuery || detected.message || '', providedLeads);
      const nextToolName = intent === 'nurture_start' ? 'startNurtureSequence' : 'consultNurtureAgent';
      if (leadMatch) {
        return {
          action: 'lead_confirmation_required',
          answer: `I found ${leadMatch.name || 'a likely lead'}${leadMatch.address ? ` at ${leadMatch.address}` : ''}. Confirm this is the right lead and I will ${intent === 'nurture_start' ? 'prepare the nurture sequence for approval' : 'recommend the next follow-up'}.`,
          suggestions,
          leadMatch,
          toolPlan: {
            toolName: 'confirmLeadMatch',
            params: {
              nextToolName,
              leadId: leadMatch.leadId,
              matchedLead: leadMatch,
              userRequest: detected.message,
              requestedChannel: detected.requestedChannel || '',
              matchMode: 'fuzzy',
              threshold: 0.3,
            },
            providerWrite: false,
            requiresConfirmation: true,
          },
          usedIntent: intent,
        };
      }
      if (leadQuery) {
        return {
          action: 'lead_lookup_required',
          answer:
            `I need to confirm the lead first. I can search for "${leadQuery}" and let you pick the right match.`,
          suggestions,
          toolPlan: {
            toolName: 'findLead',
            params: {
              query: leadQuery,
              matchMode: 'fuzzy',
              strategy: 'pg_trgm_similarity',
              threshold: 0.3,
              nextToolName,
              userRequest: detected.message,
              requestedChannel: detected.requestedChannel || '',
            },
            providerWrite: false,
            requiresConfirmation: true,
          },
          usedIntent: intent,
        };
      }
      return {
        action: 'missing_required_info',
        answer:
          'Pick a lead first, then I can recommend whether SMS, email, or a call is the best next touch.',
        suggestions,
        toolPlan: null,
        usedIntent: intent,
      };
    }
    if (intent === 'nurture_start') {
      return {
        action: 'approval_required',
        answer:
          'I will prepare the nurture sequence for approval now. Nothing sends until the approval path releases it.',
        suggestions,
        toolPlan: {
          toolName: 'startNurtureSequence',
          params: {
            leadId,
            userRequest: detected.message,
            requestedChannel: detected.requestedChannel || '',
            forceApproval: true,
          },
          providerWrite: true,
          approvalRequired: true,
        },
        usedIntent: intent,
      };
    }
    return {
      action: 'tool_plan',
      answer: 'I will check the best follow-up channel, timing, and wording.',
      suggestions,
      toolPlan: {
        toolName: 'consultNurtureAgent',
        params: {
          leadId,
          userRequest: detected.message,
          requestedChannel: detected.requestedChannel || '',
        },
        providerWrite: false,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'lead_lookup') {
    return {
      action: 'tool_plan',
      answer: `I will look for a lead matching "${detected.query}".`,
      suggestions,
      toolPlan: {
        toolName: 'findLead',
        params: { query: detected.query },
        providerWrite: false,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'summary') {
    return {
      action: 'summary_plan',
      answer:
        'I will summarize the recent calls, leads, and approvals that need attention.',
      suggestions,
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'unified_additive_intelligence') {
    return {
      action: 'tool_plan',
      answer:
        'I will run the full PBK intelligence check and return the safest next action.',
      suggestions,
      toolPlan: {
        toolName: 'runUnifiedAdditiveIntelligence',
        params: {
          query: detected.message,
          command: detected.message,
          goal: detected.message,
          liveProbe: true,
        },
        providerWrite: false,
      },
      usedIntent: intent,
    };
  }

  return {
    action: 'general',
    answer: '',
    suggestions,
    toolPlan: null,
    usedIntent: intent,
  };
}

export function buildAssistantPrompt(session = {}, options = {}) {
  const normalized = normalizeAssistantSession(session);
  const priorTurns = normalized.history.slice(-8);
  const extraContext = cleanText(options.extraContext || '', 1600);
  let prompt = ASSISTANT_SYSTEM_PROMPT;
  if (extraContext) {
    prompt += `\n\nCommand Center context:\n${extraContext}`;
  }
  if (priorTurns.length) {
    prompt += '\n\nPrevious conversation:\n';
    for (const turn of priorTurns) {
      const label = turn.role === 'assistant' ? 'Ava' : turn.role === 'system' ? 'System' : 'User';
      prompt += `${label}: ${turn.content}\n`;
    }
  }
  return prompt.trim();
}
