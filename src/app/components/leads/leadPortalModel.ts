export type BridgeRecord = Record<string, unknown>;

export type LeadPortalModel = {
  id: string;
  name: string;
  initials: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  stage: string;
  path: string;
  pathLabel: string;
  score: number | null;
  assignedAgent: string;
  source: string;
  tags: string[];
  preferredChannel: string;
  bestTimeToCall: string;
  relationship: string;
  tcpaConsent: string;
  dncStatus: string;
  occupancy: string;
  condition: string;
  propertyType: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  motivation: string;
  timeline: string;
  askingPrice: number | null;
  arv: number | null;
  mao: number | null;
  estimatedRepairs: number | null;
  mortgageBalance: number | null;
  sellerNotes: string;
  internalNotes: string;
  avaBrief: string;
  calls: BridgeRecord[];
  messages: BridgeRecord[];
  contracts: BridgeRecord[];
  analyzerRuns: BridgeRecord[];
  activity: BridgeRecord[];
  raw: BridgeRecord;
};

export type LeadPortalDraft = {
  name: string;
  phone: string;
  email: string;
  preferredChannel: string;
  bestTimeToCall: string;
  relationship: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  occupancy: string;
  condition: string;
  propertyType: string;
  beds: string;
  baths: string;
  sqft: string;
  yearBuilt: string;
  motivation: string;
  timeline: string;
  askingPrice: string;
  arv: string;
  mao: string;
  estimatedRepairs: string;
  mortgageBalance: string;
  score: string;
  stage: string;
  path: string;
  assignedAgent: string;
  tags: string;
  tcpaConsent: string;
  dncStatus: string;
  sellerNotes: string;
  internalNotes: string;
};

export function record(value: unknown): BridgeRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as BridgeRecord)
    : {};
}

export function text(value: unknown, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const next = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(next) ? next : null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const next = numeric(value);
    if (next !== null) return next;
  }
  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (
      value !== null &&
      value !== undefined &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      continue;
    }
    const next = text(value);
    if (next) return next;
  }
  return '';
}

function normalizeTags(value: unknown) {
  if (Array.isArray(value)) return value.map((tag) => text(tag)).filter(Boolean);
  return text(value)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizePath(value: unknown) {
  const raw = text(value, 'cash').toLowerCase();
  if (raw.includes('rbp') || raw.includes('retail')) return 'rbp';
  if (raw.includes('creative') || raw === 'cf') return 'cf';
  if (raw.includes('mortgage') || raw.includes('subject') || raw === 'mt') return 'mt';
  if (raw.includes('land') || raw.includes('parcel')) return 'land';
  return 'cash';
}

const PATH_LABELS: Record<string, string> = {
  cash: 'Cash Offer',
  rbp: 'Retail Buyer Program',
  cf: 'Creative Finance',
  mt: 'Mortgage Takeover',
  land: 'Land',
};

export function buildLeadPortalModel(payload: BridgeRecord): LeadPortalModel {
  const root = record(payload);
  const lead = record(root.lead || root.profile || root);
  const seller = record(lead.seller);
  const property = record(lead.property);
  const motivationRecord = record(lead.motivation);
  const compliance = record(lead.compliance);
  const assignment = record(lead.assignment);
  const notes = record(lead.notes);
  const callContext = {
    ...record(lead.call_context),
    ...record(lead.callContext),
  };
  const portalRecord = {
    ...record(lead.portal_record),
    ...record(lead.portalRecord),
  };
  const ava = record(portalRecord.ava);
  const path = normalizePath(
    firstText(
      lead.selected_path,
      lead.selectedPath,
      callContext.selected_path,
      callContext.selectedPath,
      callContext.path
    )
  );
  const name = firstText(seller.name, lead.name, lead.leadName) || 'Unknown seller';
  const initials =
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .replace(/[^a-z]/gi, '')
      .slice(0, 2)
      .toUpperCase() || 'PB';

  return {
    id: firstText(lead.leadId, lead.id),
    name,
    initials,
    phone: firstText(seller.phone, seller.mobile, lead.phone),
    email: firstText(seller.email, lead.email),
    address: firstText(property.address, property.propertyAddress, lead.address),
    city: firstText(property.city, lead.city),
    state: firstText(property.state, lead.state),
    zip: firstText(property.zip, property.zipCode, lead.zip, lead.zipCode),
    stage: firstText(assignment.stage, lead.stage, lead.status) || 'new',
    path,
    pathLabel:
      firstText(lead.selectedPathLabel, callContext.selectedPathLabel) || PATH_LABELS[path],
    score: firstNumber(lead.score, lead.leadScore, lead.motivation_score),
    assignedAgent:
      firstText(assignment.assignedAgent, ava.assignedAgent, lead.assignedAgent) || 'Unassigned',
    source: firstText(lead.source, lead.leadSource, assignment.campaign),
    tags: normalizeTags(lead.tags),
    preferredChannel: firstText(seller.preferredChannel, lead.preferredChannel) || 'unknown',
    bestTimeToCall: firstText(seller.bestTimeToCall, lead.bestTimeToCall),
    relationship:
      firstText(
        seller.relationship,
        seller.relationshipToProperty,
        lead.relationship
      ) || 'unknown',
    tcpaConsent:
      firstText(compliance.tcpaConsent, compliance.consentStatus, lead.tcpaConsent) || 'unknown',
    dncStatus: firstText(compliance.dncStatus, lead.dncStatus) || 'needs_review',
    occupancy: firstText(property.occupancy, lead.occupancy) || 'unknown',
    condition: firstText(property.condition, lead.condition) || 'unknown',
    propertyType:
      firstText(lead.property_type, property.propertyType, property.type) || 'Not captured',
    beds: firstNumber(lead.beds, property.beds),
    baths: firstNumber(lead.baths, property.baths),
    sqft: firstNumber(lead.sqft, property.sqft, property.squareFeet),
    yearBuilt: firstNumber(lead.yearBuilt, property.yearBuilt, property.year),
    motivation:
      firstText(
        motivationRecord.summary,
        lead.motivationSummary,
        typeof lead.motivation === 'string' ? lead.motivation : ''
      ) ||
      'Not captured',
    timeline: firstText(motivationRecord.timeline, lead.timeline) || 'Unknown',
    askingPrice: firstNumber(
      property.askingPrice,
      motivationRecord.askingPrice,
      lead.askingPrice
    ),
    arv: firstNumber(property.arv, callContext.arv, lead.arv),
    mao: firstNumber(property.mao, callContext.mao, lead.mao, lead.maoRbp),
    estimatedRepairs: firstNumber(
      property.estimatedRepairs,
      callContext.repairs,
      lead.estimatedRepairs,
      lead.repairs
    ),
    mortgageBalance: firstNumber(
      property.mortgageBalance,
      callContext.mortgageBalance,
      lead.mortgageBalance
    ),
    sellerNotes: firstText(seller.notes, notes.seller, lead.sellerNotes),
    internalNotes: firstText(
      notes.internal,
      typeof lead.notes === 'string' ? lead.notes : '',
      lead.internalNotes
    ),
    avaBrief:
      firstText(
        callContext.summary,
        callContext.callSummary,
        ava.notes,
        seller.notes,
        notes.seller
      ) || 'No pre-call brief has been captured yet.',
    calls: Array.isArray(root.calls) ? (root.calls as BridgeRecord[]) : [],
    messages: Array.isArray(root.messages) ? (root.messages as BridgeRecord[]) : [],
    contracts: Array.isArray(root.contracts) ? (root.contracts as BridgeRecord[]) : [],
    analyzerRuns: Array.isArray(root.analyzerRuns)
      ? (root.analyzerRuns as BridgeRecord[])
      : [],
    activity: Array.isArray(root.activity) ? (root.activity as BridgeRecord[]) : [],
    raw: lead,
  };
}

export function formatLeadMoney(value: number | null) {
  if (value === null) return 'Not captured';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatLeadValue(value: string) {
  return text(value) ? titleCase(value) : 'Not captured';
}

export function createLeadPortalDraft(lead: LeadPortalModel): LeadPortalDraft {
  const numberText = (value: number | null) => (value === null ? '' : String(value));
  return {
    name: lead.name === 'Unknown seller' ? '' : lead.name,
    phone: lead.phone,
    email: lead.email,
    preferredChannel: lead.preferredChannel,
    bestTimeToCall: lead.bestTimeToCall,
    relationship: lead.relationship,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    occupancy: lead.occupancy,
    condition: lead.condition,
    propertyType: lead.propertyType === 'Not captured' ? '' : lead.propertyType,
    beds: numberText(lead.beds),
    baths: numberText(lead.baths),
    sqft: numberText(lead.sqft),
    yearBuilt: numberText(lead.yearBuilt),
    motivation: lead.motivation === 'Not captured' ? '' : lead.motivation,
    timeline: lead.timeline === 'Unknown' ? '' : lead.timeline,
    askingPrice: numberText(lead.askingPrice),
    arv: numberText(lead.arv),
    mao: numberText(lead.mao),
    estimatedRepairs: numberText(lead.estimatedRepairs),
    mortgageBalance: numberText(lead.mortgageBalance),
    score: numberText(lead.score),
    stage: lead.stage,
    path: lead.path,
    assignedAgent: lead.assignedAgent === 'Unassigned' ? '' : lead.assignedAgent,
    tags: lead.tags.join(', '),
    tcpaConsent: lead.tcpaConsent,
    dncStatus: lead.dncStatus,
    sellerNotes: lead.sellerNotes,
    internalNotes: lead.internalNotes,
  };
}

function draftNumber(value: string) {
  const next = numeric(value);
  return next === null ? null : next;
}

export function buildLeadPortalPatch(draft: LeadPortalDraft): BridgeRecord {
  const tags = normalizeTags(draft.tags);
  return {
    name: draft.name,
    phone: draft.phone,
    email: draft.email,
    preferredChannel: draft.preferredChannel,
    bestTimeToCall: draft.bestTimeToCall,
    relationship: draft.relationship,
    address: draft.address,
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
    occupancy: draft.occupancy,
    condition: draft.condition,
    property_type: draft.propertyType,
    beds: draftNumber(draft.beds),
    baths: draftNumber(draft.baths),
    sqft: draftNumber(draft.sqft),
    yearBuilt: draftNumber(draft.yearBuilt),
    motivation: draft.motivation,
    timeline: draft.timeline,
    askingPrice: draftNumber(draft.askingPrice),
    arv: draftNumber(draft.arv),
    mao: draftNumber(draft.mao),
    estimatedRepairs: draftNumber(draft.estimatedRepairs),
    mortgageBalance: draftNumber(draft.mortgageBalance),
    motivation_score: draftNumber(draft.score),
    stage: draft.stage,
    status: draft.stage,
    selectedPath: draft.path,
    selected_path: draft.path,
    assignedAgent: draft.assignedAgent,
    tags,
    tcpaConsent: draft.tcpaConsent,
    dncStatus: draft.dncStatus,
    sellerNotes: draft.sellerNotes,
    internalNotes: draft.internalNotes,
    notes: draft.internalNotes,
    seller: {
      name: draft.name,
      phone: draft.phone,
      email: draft.email,
      preferredChannel: draft.preferredChannel,
      bestTimeToCall: draft.bestTimeToCall,
      relationshipToProperty: draft.relationship,
      notes: draft.sellerNotes,
    },
    property: {
      address: draft.address,
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
      occupancy: draft.occupancy,
      condition: draft.condition,
      propertyType: draft.propertyType,
      beds: draftNumber(draft.beds),
      baths: draftNumber(draft.baths),
      sqft: draftNumber(draft.sqft),
      yearBuilt: draftNumber(draft.yearBuilt),
      askingPrice: draftNumber(draft.askingPrice),
      arv: draftNumber(draft.arv),
      mao: draftNumber(draft.mao),
      estimatedRepairs: draftNumber(draft.estimatedRepairs),
      mortgageBalance: draftNumber(draft.mortgageBalance),
    },
    compliance: {
      tcpaConsent: draft.tcpaConsent,
      consentStatus: draft.tcpaConsent,
      dncStatus: draft.dncStatus,
    },
    assignment: {
      assignedAgent: draft.assignedAgent,
      stage: draft.stage,
    },
    actor: 'Canonical Lead Portal',
  };
}
