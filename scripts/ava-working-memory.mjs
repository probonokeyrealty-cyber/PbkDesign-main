const DEFAULT_HISTORY_LIMIT = 4;
const DEFAULT_TEXT_LIMIT = 420;

function compactText(value = '', limit = DEFAULT_TEXT_LIMIT) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function normalizeTurn(turn = {}) {
  if (typeof turn === 'string') return { role: 'seller', content: compactText(turn, 320) };
  const role = String(turn.role || turn.speaker || turn.from || 'seller').trim().toLowerCase();
  const content = compactText(
    turn.content || turn.text || turn.transcript || turn.message || turn.words || '',
    320
  );
  return content ? { role, content } : null;
}

function normalizeLead(lead = {}) {
  return {
    id: compactText(lead.id || lead.leadId || lead.lead_id || '', 120),
    name: compactText(lead.name || lead.leadName || lead.sellerName || lead.seller?.name || '', 140),
    address: compactText(
      lead.address || lead.propertyAddress || lead.property?.address || lead.home?.address || '',
      220
    ),
    phone: compactText(lead.phone || lead.phoneNumber || lead.seller?.phone || '', 80),
    email: compactText(lead.email || lead.seller?.email || '', 140),
  };
}

function normalizeMemorySnippet(item = {}) {
  const text = compactText(
    item.content || item.summary || item.response || item.prompt || item.text || item.memory || '',
    260
  );
  if (!text) return null;
  return {
    text,
    source: compactText(item.source || item.memoryType || item.memory_type || item.type || 'memory', 80),
    confidence: Number.isFinite(Number(item.confidence ?? item.score))
      ? Math.max(0, Math.min(1, Number(item.confidence ?? item.score)))
      : null,
  };
}

export function buildAvaWorkingMemory(input = {}) {
  const historyLimit = Math.max(1, Math.min(8, Number(input.historyLimit || DEFAULT_HISTORY_LIMIT)));
  const lead = normalizeLead(input.lead || input.context || {});
  const phase = compactText(input.phase || input.stage || 'trust', 80) || 'trust';
  const transcript = compactText(input.transcript || input.query || input.text || '', 500);
  const lastTurns = (Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.session?.history)
      ? input.session.history
      : []
  )
    .map(normalizeTurn)
    .filter(Boolean)
    .slice(-historyLimit);
  const memorySnippets = (Array.isArray(input.memories) ? input.memories : [])
    .map(normalizeMemorySnippet)
    .filter(Boolean)
    .slice(0, 4);
  const activeSkill = input.activeSkill || input.selectedSkill || null;
  const activeSkillName = compactText(activeSkill?.name || activeSkill?.id || '', 120);
  const facts = [
    lead.name ? `Seller: ${lead.name}` : '',
    lead.address ? `Property: ${lead.address}` : '',
    input.path ? `Path: ${compactText(input.path, 80)}` : '',
    input.objection ? `Objection: ${compactText(input.objection, 120)}` : '',
    input.emotion ? `Emotion: ${compactText(input.emotion, 80)}` : '',
  ].filter(Boolean);
  const brief = [
    `Current phase: ${phase}.`,
    facts.length ? `Known facts: ${facts.join('; ')}.` : '',
    activeSkillName ? `Active governed skill: ${activeSkillName}.` : '',
    transcript ? `Latest seller words: ${transcript}.` : '',
    memorySnippets.length
      ? `Relevant memories: ${memorySnippets.map((item) => item.text).join(' | ')}.`
      : '',
    lastTurns.length
      ? `Recent turns: ${lastTurns.map((turn) => `${turn.role}: ${turn.content}`).join(' | ')}.`
      : '',
    'Instruction: answer with one seller-facing move; do not expose tools, JSON, IDs, or internal analysis.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    phase,
    lead,
    transcript,
    lastTurns,
    memories: memorySnippets,
    activeSkill: activeSkill
      ? {
          id: compactText(activeSkill.id || activeSkill.versionId || '', 120),
          name: activeSkillName,
        }
      : null,
    brief,
  };
}
