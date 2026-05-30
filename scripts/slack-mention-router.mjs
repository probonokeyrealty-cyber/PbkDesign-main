const BOT_MENTION_PATTERN = /<@[A-Z0-9][A-Z0-9_-]*>/gi;

function cleanWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeSlackMentionText(text = '') {
  return cleanWhitespace(String(text || '').replace(BOT_MENTION_PATTERN, ''));
}

function has(pattern, text) {
  return pattern.test(text);
}

function baseParams(event = {}, command = '') {
  return {
    command,
    text: command,
    actor: event.user || event.user_name || 'slack',
    requestedBy: event.user || event.user_name || 'slack',
    channel: event.channel || event.channel_id || '',
    threadTs: event.thread_ts || event.ts || '',
    source: 'slack-app-mention',
  };
}

export function classifySlackMentionIntent(event = {}) {
  const command = normalizeSlackMentionText(event.text || event.command || '');
  const lower = command.toLowerCase();
  const common = baseParams(event, command);

  if (!command) {
    return {
      ok: true,
      intent: 'help',
      toolName: 'runCoworkerHeartbeat',
      requiresApproval: false,
      params: {
        ...common,
        postSlack: false,
      },
      replyHint: 'I can check what needs attention, route a PBK command, or save Ava coaching memory.',
    };
  }

  if (has(/\b(what needs my attention|heartbeat|status|morning|today|scan|check the board|coworker)\b/i, lower)) {
    return {
      ok: true,
      intent: 'heartbeat',
      toolName: 'runCoworkerHeartbeat',
      requiresApproval: false,
      params: {
        ...common,
        postSlack: false,
      },
    };
  }

  if (has(/^(remember|correct|instruct|script|teach|save this|learn)\b/i, lower)) {
    const content = command.replace(/^(remember|correct|instruct|script|teach|save this|learn)\b[:\s-]*/i, '').trim() || command;
    return {
      ok: true,
      intent: 'coach_memory',
      toolName: 'ingestResearchDoc',
      requiresApproval: false,
      params: {
        title: `Slack Ava coaching: ${content.slice(0, 80)}`,
        topic: 'Ava Operator Memory',
        kind: 'coach-memory',
        source: 'Slack app mention',
        summary: content,
        excerpt: content,
        tags: ['ava', 'rex', 'operator-instruction', 'slack-mention', 'pbk-wholesale'],
        actor: common.actor,
      },
    };
  }

  if (has(/\b(health|diagnostic|is pbk ok|is ava ok|is rex ok)\b/i, lower)) {
    return {
      ok: true,
      intent: 'health',
      toolName: 'admin_check_health',
      requiresApproval: false,
      params: common,
    };
  }

  const likelyBusinessWorkflow = has(/\b(proposal|offer|contract|commission|report|send|call|sms|email|docusign|deal|lead|comps|app|tracker|build)\b/i, lower);
  return {
    ok: true,
    intent: likelyBusinessWorkflow ? 'delegated_workflow' : 'brain_command',
    toolName: 'routeAdminCommand',
    requiresApproval: likelyBusinessWorkflow,
    params: common,
  };
}

export function buildSlackMentionAck(route = {}, result = {}) {
  const threadTs = route.params?.threadTs || route.params?.thread_ts || '';
  const approvalText = route.requiresApproval
    ? ' I will keep provider writes and contract/call actions behind PBK approvals.'
    : '';
  const resultText = result?.answer
    || result?.summary
    || result?.text
    || result?.result?.answer
    || '';
  return {
    channel: route.params?.channel || '',
    thread_ts: threadTs,
    text: resultText
      ? `Routed to PBK: ${resultText}`
      : `Routed to PBK ${route.intent || 'workflow'} via ${route.toolName || 'router'}.${approvalText}`,
  };
}
