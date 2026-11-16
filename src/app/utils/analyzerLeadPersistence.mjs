const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value.trim() : '';
const fact = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function buildAnalyzerLeadPatch(deal) {
  if (!text(deal?.leadId)) throw Error('Choose a saved lead before saving property facts.');
  const address = text(deal.address).match(/^(.+),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  return {
    actor: 'PBK operator', actionSource: 'deal-analyzer-save', selectedPath: deal.selectedPath,
    seller: {
      ...(deal.sellerName !== undefined ? { name: text(deal.sellerName) } : {}),
      ...(deal.sellerPhone !== undefined ? { phone: text(deal.sellerPhone) } : {}),
      ...(deal.sellerEmail !== undefined ? { email: text(deal.sellerEmail) } : {}),
    },
    property: {
      ...(address ? { address: address[1].trim(), city: address[2].trim(), state: address[3].toUpperCase(), zip: address[4] }
        : text(deal.address) ? { address: text(deal.address) } : {}),
      propertyType: deal.type, beds: fact(deal.beds), baths: fact(deal.baths), sqft: fact(deal.sqft),
      yearBuilt: fact(deal.year), askingPrice: fact(deal.price),
      arv: fact(deal.arv), mao: fact(deal.mao60), maoRbp: fact(deal.maoRBP),
      estimatedRepairs: fact(deal.repairs?.mid), condition: text(deal.repairs?.condition),
      mortgageBalance: fact(deal.balance), mortgageRate: fact(deal.rate), rent: fact(deal.rent),
    },
    analyzer: { comps: deal.comps }, deal: { ...deal },
  };
}

export function latestCallModeNote(payload, leadId) {
  const root = record(payload); const lead = record(root.lead || root.profile || root);
  const activity = Array.isArray(lead.activity) ? lead.activity : Array.isArray(root.activity) ? root.activity : [];
  const notes = activity.filter(row => row && (row.leadId || row.lead_id) === leadId
    && row.source === 'deal-view-call-mode' && String(row.category || '').toUpperCase() === 'NOTE' && text(row.text));
  notes.sort((a, b) => (Date.parse(b.at || b.createdAt || '') || 0) - (Date.parse(a.at || a.createdAt || '') || 0));
  return text(notes[0]?.text);
}
