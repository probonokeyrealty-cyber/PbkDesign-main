export const SYNTHETIC_EDGE_CASE_SOURCE = 'synthetic';

const EDGE_CONTEXTS = [
  {
    id: 'probate_sibling',
    label: 'probate with sibling disagreement',
    pressure: 'family alignment, grief, and title timing',
  },
  {
    id: 'foreclosure_deadline',
    label: 'foreclosure deadline pressure',
    pressure: 'auction timing, payoff uncertainty, and seller fear',
  },
  {
    id: 'tenant_damage',
    label: 'tenant damage and occupancy',
    pressure: 'access limits, repairs, and relocation sensitivity',
  },
  {
    id: 'agent_protected',
    label: 'listed property with an agent',
    pressure: 'commission protection, agent trust, and transparent math',
  },
  {
    id: 'rural_land',
    label: 'rural land or access issue',
    pressure: 'access, utility, zoning, and buyer pool uncertainty',
  },
];

const OBJECTION_TRACKS = [
  {
    id: 'legacy_price_anchor',
    prompt: 'Seller anchors to an old high Zestimate or neighbor sale.',
    response: 'I hear why that number is in your mind. The fair comparison is condition, access, timing, and certainty. Can I walk you through what changes the number from that retail sale to an as-is cash number?',
  },
  {
    id: 'hidden_decision_maker',
    prompt: 'Seller reveals another decision maker late in the call.',
    response: 'That matters, and I do not want you carrying the whole explanation alone. Who else needs to be comfortable, and would it help if I summarized the numbers and protections for both of you together?',
  },
  {
    id: 'paperwork_fear',
    prompt: 'Seller is afraid of signing the wrong paperwork.',
    response: 'That is reasonable. You should not sign anything you do not understand. We can keep this plain English, use title or attorney review, and pause on any clause that feels unclear.',
  },
  {
    id: 'repair_unknown',
    prompt: 'Seller refuses to discuss repairs or condition.',
    response: 'No problem. I am not here to judge the property. I only need enough information to price risk honestly, so what is the one issue you would want me to know before I walk it?',
  },
  {
    id: 'trust_scam',
    prompt: 'Seller worries the offer is a scam.',
    response: 'Fair question. You should verify us. We will not ask for money or sensitive personal info upfront. I can send proof, explain how title handles funds, and let you verify before deciding.',
  },
  {
    id: 'cash_vs_retail',
    prompt: 'Seller compares the cash offer to a retail listing price.',
    response: 'That is the key tradeoff. Retail may be higher if you repair, list, wait, and accept contingencies. Our number is for speed, as-is certainty, and avoiding those moving parts.',
  },
  {
    id: 'tax_lien_confusion',
    prompt: 'Seller is confused about tax liens, payoff, or title.',
    response: 'Title will verify the exact payoff so nobody guesses. The important question for us now is whether a clean close that handles the payoff would solve the problem you are trying to get away from.',
  },
  {
    id: 'tenant_sensitivity',
    prompt: 'Seller is worried about bothering tenants or family in the property.',
    response: 'We can handle that carefully. I do not need to pressure anyone. Let us map who is inside, what communication is safe, and what timeline protects your relationship and the deal.',
  },
  {
    id: 'creative_finance_skeptic',
    prompt: 'Agent or seller is skeptical about creative finance or subject-to.',
    response: 'Skepticism is healthy. I will not pitch it if it does not fit. If we discuss it, we explain risks plainly, protect commissions in writing, and recommend legal/title review before execution.',
  },
  {
    id: 'last_minute_cold_feet',
    prompt: 'Seller gets cold feet after initially agreeing.',
    response: 'That happens with big decisions. Let us slow down. What part feels uncomfortable: the number, the timing, the paperwork, or the feeling of letting go of the property?',
  },
];

function slugifySynthetic(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function buildSyntheticEdgeCaseObjections(options = {}) {
  const count = Math.max(1, Math.min(50, Number(options.count || 50)));
  const workspaceId = String(options.workspaceId || options.workspace_id || 'pbk').trim() || 'pbk';
  const pathKey = String(options.pathKey || options.path_key || 'general').trim() || 'general';
  const entries = [];

  for (const context of EDGE_CONTEXTS) {
    for (const track of OBJECTION_TRACKS) {
      const id = `synthetic-edge-${slugifySynthetic(context.id)}-${slugifySynthetic(track.id)}`;
      entries.push({
        id,
        workspaceId,
        memoryType: 'objection',
        objectionTag: `synthetic_${track.id}`,
        pathKey,
        prompt: `${track.prompt} Context: ${context.label}. Pressure points: ${context.pressure}.`,
        response: `${track.response} Then ask one calm next-step question tied to ${context.pressure}.`,
        source: SYNTHETIC_EDGE_CASE_SOURCE,
        sourceUrl: '',
        outcome: 'approved',
        score: 0.84,
        metadata: {
          framework: 'synthetic_edge_case_generator',
          context: context.id,
          track: track.id,
          generatedBy: 'pbk-tier-additives',
          deterministic: true,
        },
      });
    }
  }

  return entries.slice(0, count);
}
