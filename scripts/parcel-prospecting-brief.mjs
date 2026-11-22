const orderPrompt = 'You are advising a PBK real-estate acquisitions operator. Rank the supplied checks using only the supplied facts. Return a JSON object with an "order" array containing each supplied check ID exactly once. Preserve all outreach holds. Never propose contacting a seller, infer motivation, or make up evidence.';

export function prospectingOrderMessages(input) {
  return [
    { role: 'system', content: orderPrompt },
    { role: 'user', content: JSON.stringify(input) },
  ];
}

export function createClaudeProspectingReview({ apiKey, model = 'claude-sonnet-4-6', fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) return undefined;
  return async (input, deadlineAt) => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return '';
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: orderPrompt + ' Independently reassess the proposed order if supplied.',
        messages: [{ role: 'user', content: JSON.stringify(input) }],
      }),
      signal: AbortSignal.timeout(Math.min(remainingMs, 6000)),
    });
    if (!response.ok) return '';
    const payload = await response.json();
    if (payload.stop_reason === 'max_tokens') return '';
    return (payload.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('');
  };
}

function getChecks(selection) {
  const match = selection.match.status;
  const reasons = new Set(selection.eligibility.reasons.map(reason => reason.code));
  const checks = [];
  const add = (id, title, detail) => checks.push({ id, title, detail });
  const isHeld = reasons.has('dnc') || reasons.has('lead_closed');
  if (isHeld) {
    add('hold-outreach', 'Keep outreach on hold', 'The current contact has a do-not-call or closed-lead restriction. Review the saved record before any follow-up.');
  }
  if (match === 'ambiguous') {
    add('resolve-match', 'Resolve the CRM match', 'Multiple records match this parcel. Compare their parcel IDs and addresses before choosing a seller record.');
  }
  if (match === 'matched') {
    add('review-conversation', 'Review seller history', 'Open the matched seller’s conversation to check prior outreach, commitments, and open questions.');
    if (reasons.has('no_phone') || reasons.has('crm_contact_unavailable')) {
      add('verify-contact', 'Verify contact details', 'Check the saved lead for a verified, callable contact before preparing outreach.');
    }
  }
  if (match === 'no_match') {
    add('check-records', 'Verify the property record', 'Compare the county parcel record with any existing notes or ownership evidence before associating a seller.');
    if (selection.createLeadAvailable) {
      add('consider-lead', 'Decide whether to create a lead', 'If you want to track this parcel, review its verified property details in Create lead.');
    }
  }
  add('inspect-parcel', 'Check property basics', 'Confirm the parcel boundary and situs address. Locate the county record before relying on lot size or other missing facts.');
  return { checks, isHeld };
}

function parseOrder(answer, knownIds) {
  if (typeof answer !== 'string') return null;
  try {
    const json = answer.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
    const { order } = JSON.parse(json);
    if (!Array.isArray(order) || order.length !== knownIds.length ||
        new Set(order).size !== knownIds.length || !order.every(id => knownIds.includes(id))) return null;
    return order;
  } catch {
    return null;
  }
}

async function rank(rankChecks, input, ids, deadlineAt) {
  if (!rankChecks) return { status: 'unconfigured', order: null };
  if (deadlineAt <= Date.now()) return { status: 'unavailable', order: null };
  try {
    const order = parseOrder(await rankChecks(input, deadlineAt), ids);
    if (order) return { status: 'used', order };
  } catch {
    // The shortlist remains usable if an advisory provider fails.
  }
  return { status: 'unavailable', order: null };
}

export function createProspectingBrief({ prioritize, review } = {}) {
  return async (selection, deadlineAt = Date.now() + 12_000) => {
    const { parcelId, acres } = selection.parcel.properties;
    const { checks, isHeld } = getChecks(selection);
    const ids = checks.map(check => check.id);
    const facts = {
      match: selection.match.status,
      hasLotSize: Number.isFinite(acres) && acres > 0,
      outreachHeld: isHeld,
      phoneMissing: selection.eligibility.reasons.some(reason => reason.code === 'no_phone'),
    };
    const input = { facts, checks };
    const deepSeek = await rank(prioritize, input, ids, Math.min(deadlineAt, Date.now() + (review ? 6500 : 11000)));
    const claude = await rank(review, { ...input, proposedOrder: deepSeek.order }, ids, deadlineAt);
    const order = claude.order ?? deepSeek.order ?? ids;
    const mandatory = isHeld ? 'hold-outreach' : facts.match === 'ambiguous' ? 'resolve-match' : null;
    const finalOrder = mandatory ? [mandatory, ...order.filter(id => id !== mandatory)] : order;
    return {
      ok: true,
      parcelId,
      facts,
      providers: { deepSeek: deepSeek.status, claude: claude.status },
      steps: finalOrder.map(id => checks.find(check => check.id === id)),
    };
  };
}
