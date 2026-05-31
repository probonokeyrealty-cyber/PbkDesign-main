import { randomUUID } from 'node:crypto';

const MAX_ASSISTANT_HISTORY = 40;
const MAX_TURN_CONTENT = 1800;

export const ASSISTANT_SYSTEM_PROMPT = `
You are Ava, PBK Command Center's personal assistant.
You are warm, concise, useful, and proactive.
You can help analyze deals, summarize recent activity, find leads, explain PBK workflows, and prepare approval-gated actions.
When an operator asks for follow-up by SMS, email, call, or nurture sequence, first consult the Nurture Agent for the best channel, timing, and sequence.
Do not pretend to be human. Do not start calls, texts, emails, contracts, payments, or admin/provider writes unless the authenticated Command Center approval flow allows it.
Only start a nurture sequence when the authenticated operator explicitly asks to automate it; provider writes remain approval-gated.
Keep replies under two sentences unless the user asks for detail.
`.trim();

export function createAssistantSessionId(prefix = 'ava_chat') {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function cleanText(value = '', maxLength = MAX_TURN_CONTENT) {
  return String(value || '')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/g, '[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizeAssistantSession(session = {}) {
  const history = Array.isArray(session?.history) ? session.history : [];
  return {
    ...session,
    history: history
      .map((turn) => ({
        role: ['user', 'assistant', 'system'].includes(String(turn?.role || '').toLowerCase())
          ? String(turn.role).toLowerCase()
          : 'user',
        content: cleanText(turn?.content || ''),
        at: turn?.at || turn?.timestamp || null,
        metadata: turn?.metadata && typeof turn.metadata === 'object' ? turn.metadata : {},
      }))
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
  const safeContent = cleanText(content);
  if (!safeContent) return normalized;
  normalized.history = [
    ...normalized.history,
    {
      role: safeRole,
      content: safeContent,
      at: new Date().toISOString(),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
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

export function detectAssistantIntent(message = '') {
  const text = cleanText(message, 2400);
  const lower = text.toLowerCase();
  const phone = extractPhone(text);
  const address = extractAddress(text);

  if (/\b(what can you do|help|capabilities|commands?)\b/i.test(lower)) {
    return { intent: 'help', message: text };
  }

  if (
    /\b(what did i (just )?(ask|say)|what was my last (question|message)|remember what i (asked|said)|recall my last)\b/i.test(
      lower
    )
  ) {
    return { intent: 'session_recall', message: text };
  }

  if (/\b(analy[sz]e|mao|arv|offer|deal math|underwrite|property value)\b/i.test(lower)) {
    return { intent: 'analyze_deal', message: text, address };
  }

  if (
    /\b(nurture|follow[\s-]?up|reach out|send (?:a )?(?:sms|text|email)|text this lead|email this lead|should i (?:sms|text|email|call)|best (?:channel|follow[\s-]?up))\b/i.test(
      lower
    )
  ) {
    const channelMatch = lower.match(/\b(sms|text|email|call)\b/i);
    const requestedChannel = channelMatch?.[1] === 'text' ? 'sms' : channelMatch?.[1] || '';
    return { intent: 'nurture_consult', message: text, requestedChannel };
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
        'That information lives inside the authenticated PBK Command Center. Open the Command Center to review approvals, leads, calls, and private deal activity.',
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
    const lastUserTurn = [...session.history]
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
        params: { to: detected.phone },
        providerWrite: true,
        approvalRequired: true,
      },
      usedIntent: intent,
    };
  }

  if (!publicMode && intent === 'nurture_consult') {
    const session = normalizeAssistantSession(options.session || {});
    const leadId = cleanText(options.leadId || detected.leadId || session.leadId || '', 120);
    if (!leadId) {
      return {
        action: 'missing_required_info',
        answer:
          'Pick a lead first, then I can consult the Nurture Agent on whether SMS, email, or a call is best.',
        suggestions,
        toolPlan: null,
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
