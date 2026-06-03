import { randomUUID } from 'node:crypto';

const MAX_ASSISTANT_HISTORY = 40;
const MAX_TURN_CONTENT = 1800;
const COMMAND_CENTER_PATH = '/index.shell.html';
const TURN_TRUNCATION_WARNING =
  'Long text truncated; Ava only retained the first 1800 characters for this turn.';

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(?:docusign|telnyx|instantly)_[a-z0-9_]*(?:key|token|secret|sid|client_id|private_key|access_token|api_key)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}["']?/gi,
  /\b(?:DOCUSIGN|TELNYX|INSTANTLY)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|SID|CLIENT_ID|PRIVATE_KEY|ACCESS_TOKEN|API_KEY)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}["']?/g,
];

export const ASSISTANT_SYSTEM_PROMPT = `
You are Ava, PBK Command Center's personal assistant.
You are warm, concise, useful, and proactive.
You can help analyze deals, summarize recent activity, find leads, explain PBK workflows, and prepare approval-gated actions.
When an operator asks for follow-up by SMS, email, call, or nurture sequence, first consult the Nurture Agent for the best channel, timing, and sequence.
When an authenticated operator asks about frontier additives, robustness, full-system sync, or "use all intelligence", use the Unified Additive Intelligence layer so stopping-agent, path-search, compact memory, workflow induction, tool discovery, state inference, GUI planning, mission planning, ACP routing, and safety transparency act together.
Do not pretend to be human. Do not start calls, texts, emails, contracts, payments, or admin/provider writes unless the authenticated Command Center approval flow allows it.
Only start a nurture sequence when the authenticated operator explicitly asks to automate it; provider writes remain approval-gated.
Keep replies under two sentences unless the user asks for detail.
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

export function detectAssistantIntent(message = '') {
  const text = cleanText(message, 2400);
  const lower = text.toLowerCase();
  const phone = extractPhone(text);
  const address = extractAddress(text);

  if (/\b(what can you do|help|capabilities|commands?)\b/i.test(lower)) {
    return { intent: 'help', message: text };
  }

  if (
    /\b(frontier|additives?|all intelligence|unified intelligence|whole system|system sync|robust|masteragent|mem1|neuroskill|tooluniverse|encompass|awm|stopping agent|autograph|acp)\b/i.test(
      lower
    )
  ) {
    return { intent: 'unified_additive_intelligence', message: text };
  }

  if (
    /\b(what did i (just )?(ask|say)|what was my last (question|message)|remember what i (asked|said)|recall my last)\b/i.test(
      lower
    )
  ) {
    return { intent: 'session_recall', message: text };
  }

  if (
    /\b(analy[sz]e|mao|arv|offer|deal math|underwrite|property value|worth chasing|worth pursuing|worth it|should (?:we|i) chase|should (?:we|i) pursue|make sense as a deal|deal worth)\b/i.test(
      lower
    )
  ) {
    return { intent: 'analyze_deal', message: text, address };
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
    };
  }

  if (/\b(call|dial|ring)\b/i.test(lower) && phone) {
    return { intent: 'call', message: text, phone };
  }

  if (
    /\b(pending\s+)?approvals?|approval status|contracts? pending|offers? pending|what'?s waiting\b/i.test(
      lower
    )
  ) {
    return { intent: 'approvals', message: text };
  }

  if (
    /\b(summarize|summary|recap|catch me up)\b.*\b(calls?|leads?|deals?|approvals?|activity)\b/i.test(
      lower
    )
  ) {
    return { intent: 'summary', message: text };
  }

  const leadQuery = extractLeadQuery(text);
  if (leadQuery) {
    return { intent: 'lead_lookup', message: text, query: leadQuery };
  }

  return { intent: 'general', message: text };
}

export function buildAssistantSuggestions(intent = 'general', { publicMode = true } = {}) {
  if (publicMode) {
    if (intent === 'analyze_deal')
      return ['Share property details', 'Ask how PBK reviews offers', 'Request a callback'];
    if (intent === 'call')
      return ['Share callback info', 'Explain the callback process', 'Ask a PBK question'];
    return ['Ask how PBK works', 'Share a property address', 'Request a callback'];
  }

  if (intent === 'analyze_deal') return ['Run deal analysis', 'Check comps', 'Prepare approval'];
  if (intent === 'approvals')
    return ['View pending approvals', 'Run heartbeat', 'Open approval board'];
  if (intent === 'call') return ['Create call approval', 'Check DNC first', 'Find lead'];
  if (intent === 'nurture_consult')
    return ['Consult Nurture Agent', 'Start approval-gated sequence', 'Find lead'];
  if (intent === 'nurture_start')
    return ['Queue nurture approval', 'Consult timing first', 'Find lead'];
  if (intent === 'unified_additive_intelligence')
    return ['Run unified intelligence', 'Check guardrails', 'Plan mission'];
  if (intent === 'summary') return ['Summarize calls', 'Show hot leads', 'Run heartbeat'];
  return ['Analyze a deal', 'Check approvals', 'Summarize recent calls'];
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
        'I can answer PBK process questions or save property/contact details for the team. Calls, texts, emails, contracts, and private approval data stay inside the approval-gated Command Center.',
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
        'Please authenticate in the PBK Command Center before I access private tools or deal data.',
      suggestions: ['Sign in', 'Use public chat safely'],
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'analyze_deal') {
    if (!detected.address) {
      return {
        action: 'missing_required_info',
        answer: 'Send me the street address and I can prepare the deal analysis.',
        suggestions,
        toolPlan: null,
        usedIntent: intent,
      };
    }
    return {
      action: 'tool_plan',
      answer: `I can analyze ${detected.address} now.`,
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
      answer: 'I can pull the current pending approval count for you.',
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
      answer: `I can prepare a call request for ${detected.phone}, but the actual dial stays approval-gated.`,
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
          answer: `I found ${leadMatch.name || 'a likely lead'}${leadMatch.address ? ` at ${leadMatch.address}` : ''}. Confirm this is the lead before I ${intent === 'nurture_start' ? 'queue the nurture sequence for approval' : 'consult the Nurture Agent'}.`,
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
            `I need to confirm the lead before any nurture action. I can search for "${leadQuery}" and ask you to confirm the best match.`,
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
          'Pick a lead first, then I can consult the Nurture Agent on whether SMS, email, or a call is best.',
        suggestions,
        toolPlan: null,
        usedIntent: intent,
      };
    }
    if (intent === 'nurture_start') {
      return {
        action: 'approval_required',
        answer: 'I can queue the nurture sequence for approval now. Provider sends still remain approval-gated.',
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
      answer: 'I can consult the Nurture Agent for the best follow-up channel and timing.',
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
      answer: `I can look for a lead matching "${detected.query}".`,
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
        'I can summarize recent calls, leads, and approvals from the Command Center snapshot.',
      suggestions,
      toolPlan: null,
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'unified_additive_intelligence') {
    return {
      action: 'tool_plan',
      answer:
        'I can run the unified additive intelligence layer across PBK now and return the safest next action.',
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
