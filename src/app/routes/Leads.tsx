import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  FileSignature,
  HeartHandshake,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  X,
} from 'lucide-react';
import { PbkDataSource } from '../../components/pbk/index';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import { ANALYZER_CURRENT_DEAL_KEY, readAnalyzerStorage } from '../utils/analyzerStorage';
import {
  createLeadRequest,
  fetchLeadFullRequest,
  fetchLeadLastCallRequest,
  fetchLeadsRequest,
  patchLeadRequest,
  planLeadNurtureRequest,
  sendLeadContractRequest,
  sendMessageRequest,
  startLeadCallRequest,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

type BridgeRecord = Record<string, unknown>;

type LeadFormState = {
  name: string;
  phone: string;
  email: string;
  address: string;
  propertyType: string;
  motivation: string;
  tags: string;
  notes: string;
  selectedPath: CanonicalPath;
  lastOffer: string;
  sentiment: string;
  summary: string;
  bantBudget: string;
  bantAuthority: string;
  bantNeed: string;
  bantTimeline: string;
  bantUrgency: string;
  bantObjection: string;
  bantNextStep: string;
};

type NewLeadFormState = {
  sellerName: string;
  phone: string;
  email: string;
  preferredChannel: 'phone' | 'sms' | 'email' | 'unknown';
  bestTimeToCall: string;
  relationship: 'owner' | 'agent' | 'family' | 'executor' | 'unknown';
  propertyAddress: string;
  city: string;
  state: string;
  zip: string;
  occupancy: 'unknown' | 'owner_occupied' | 'tenant_occupied' | 'vacant';
  condition: 'unknown' | 'light' | 'moderate' | 'heavy';
  motivation: string;
  timeline: string;
  askingPrice: string;
  tags: string;
  leadSource: string;
  stage: string;
  tcpaConsent: 'unknown' | 'yes' | 'no';
  dncStatus: 'needs_review' | 'clear' | 'blocked';
  beds: string;
  baths: string;
  sqft: string;
  yearBuilt: string;
  estimatedRepairs: string;
  arv: string;
  mao: string;
  mortgageBalance: string;
  leadScore: string;
  assignedAgent: string;
  sellerNotes: string;
  internalNotes: string;
  selectedPath: CanonicalPath;
};

type CanonicalPath = 'cash' | 'rbp' | 'cf' | 'mt' | 'land';

type ContractFormState = {
  path: CanonicalPath;
  templateName: string;
  seller1Name: string;
  seller1Email: string;
  seller2Name: string;
  seller2Email: string;
  slot2Name: string;
  slot2Email: string;
  amount: string;
  timeline: string;
  notes: string;
};

type LeadCallConfirmDraft = {
  lead: BridgeRecord;
  leadId: string;
  sellerName: string;
  phone: string;
  address: string;
};

type QuickSmsDraft = {
  lead: BridgeRecord;
  leadId: string;
  sellerName: string;
  phone: string;
  body: string;
};

type DetailStatus = {
  tone: 'info' | 'success' | 'error';
  text: string;
  retry?: 'detail' | 'refresh';
};

type LeadsStats = {
  total: number;
  callable: number;
  contractReady: number;
  hot: number;
};

const PATH_LABELS: Record<CanonicalPath, string> = {
  cash: 'Cash Offer',
  rbp: 'Retail Buyer Program',
  cf: 'Creative Finance',
  mt: 'Mortgage Takeover',
  land: 'Land',
};

const TEMPLATE_NAMES: Record<CanonicalPath, string> = {
  cash: 'PBK_Cash_Offer_v1',
  rbp: 'PBK_RBP_v1',
  cf: 'PBK_Creative_Finance_v1',
  mt: 'PBK_Mortgage_Takeover_v1',
  land: 'PBK_Land_v1',
};

const PROPERTY_TYPES = [
  'Single Family',
  'Multi-family (2-4 units)',
  'Multi-family (5+ units)',
  'Land',
  'Condo',
  'Other',
];

function text(value: unknown, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function pickFirstText(...values: unknown[]) {
  for (const value of values) {
    const next = text(value);
    if (next) return next;
  }
  return '';
}

function numberText(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.round(numeric)) : '';
}

function numberOrNull(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const numeric = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function splitTags(value: unknown) {
  return text(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function money(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatDate(value: unknown) {
  const raw = text(value);
  if (!raw) return '-';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 16).replace('T', ' ');
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getLeadId(lead: BridgeRecord) {
  const record = unwrapLeadResponse(lead);
  const property = getProperty(record);
  return (
    pickFirstText(record.leadId, record.id, record.externalId, property.address) || 'unsaved-lead'
  );
}

function getSeller(lead: BridgeRecord): BridgeRecord {
  const record = unwrapLeadResponse(lead);
  if (typeof record.seller === 'string') return { name: record.seller };
  return (record.seller && typeof record.seller === 'object' ? record.seller : {}) as BridgeRecord;
}

function getProperty(lead: BridgeRecord): BridgeRecord {
  const record = unwrapLeadResponse(lead);
  return (
    record.property && typeof record.property === 'object' ? record.property : {}
  ) as BridgeRecord;
}

function getCallContext(lead: BridgeRecord): BridgeRecord {
  const record = unwrapLeadResponse(lead);
  const primary =
    record.callContext && typeof record.callContext === 'object' ? record.callContext : {};
  const fallback =
    record.call_context && typeof record.call_context === 'object' ? record.call_context : {};
  return { ...(fallback as BridgeRecord), ...(primary as BridgeRecord) };
}

function getSellerName(lead: BridgeRecord) {
  const record = unwrapLeadResponse(lead);
  const seller = getSeller(record);
  const leadProfile = asBridgeRecord(record.leadProfile || record.lead_profile);
  const profileSeller = asBridgeRecord(leadProfile.seller);
  const portalRecord = asBridgeRecord(record.portalRecord || record.portal_record);
  const portalLeadProfile = asBridgeRecord(portalRecord.leadProfile || portalRecord.lead_profile);
  const portalSeller = asBridgeRecord(portalLeadProfile.seller);
  const raw = asBridgeRecord(record.raw);
  const rawSeller = asBridgeRecord(raw.seller);
  return (
    pickFirstText(
      record.name,
      seller.name,
      record.leadName,
      record.sellerName,
      record.seller_name,
      record.lead_name,
      record.ownerName,
      record.owner_name,
      profileSeller.name,
      portalSeller.name,
      rawSeller.name,
      raw.leadName,
      raw.lead_name
    ) || 'Unknown seller'
  );
}

function getSellerInitial(name: string) {
  return (
    text(name, 'U')
      .match(/[A-Za-z0-9]/)?.[0]
      ?.toUpperCase() || 'U'
  );
}

function SellerRosterIdentity({
  name,
  address,
  variant = 'desktop',
}: {
  name: string;
  address: string;
  variant?: 'desktop' | 'mobile';
}) {
  return (
    <span
      className={['pbk-lead-roster-identity', variant === 'mobile' ? 'is-mobile' : ''].join(' ')}
    >
      <span className="pbk-lead-roster-name" title={name}>
        {name}
      </span>
      <span className="pbk-lead-roster-address" title={address}>
        {address}
      </span>
    </span>
  );
}

function getLeadEmail(lead: BridgeRecord) {
  const record = unwrapLeadResponse(lead);
  const seller = getSeller(record);
  return pickFirstText(record.email, seller.email);
}

function getLeadPhone(lead: BridgeRecord) {
  const record = unwrapLeadResponse(lead);
  const seller = getSeller(record);
  return pickFirstText(record.phone, seller.phone);
}

function normalizePhone(value: unknown) {
  return text(value).replace(/\D/g, '');
}

function isCallablePhone(value: unknown) {
  return normalizePhone(value).length >= 10;
}

function isValidEmail(value: unknown) {
  const email = text(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getLeadAddress(lead: BridgeRecord) {
  const record = unwrapLeadResponse(lead);
  const property = getProperty(record);
  return (
    pickFirstText(
      record.address,
      property.address,
      record.propertyAddress,
      record.property_address
    ) || 'No property'
  );
}

function leadAddressMatchKey(lead: BridgeRecord) {
  const address = getLeadAddress(lead).toLowerCase();
  if (!address || /^(no property|unknown property|not captured|unknown|n\/a|-)$/.test(address)) {
    return '';
  }
  return address;
}

function validateLeadForCall(lead: BridgeRecord) {
  if (!isCallablePhone(getLeadPhone(lead))) {
    return `${getSellerName(lead)} needs a valid phone number before Telnyx can dial.`;
  }
  return '';
}

function validateContractBeforeSend(form: ContractFormState, lead: BridgeRecord) {
  if (!text(form.seller1Name)) return 'Seller 1 name is required before DocuSign can be queued.';
  if (!isValidEmail(form.seller1Email)) {
    return 'A valid Seller 1 email is required before DocuSign can be queued.';
  }
  if (!isCallablePhone(getLeadPhone(lead))) {
    return 'A valid lead phone is required before sending this contract packet.';
  }
  if (form.seller2Email && !isValidEmail(form.seller2Email)) {
    return 'Seller 2 email is not valid.';
  }
  if (!isValidEmail(form.slot2Email)) return 'Signer 2 email is not valid.';
  return '';
}

function clampMotivationScore(value: string) {
  if (!value.trim()) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return String(Math.min(10, Math.max(1, Math.round(numeric))));
}

function getSeller1EmailError(form: ContractFormState | null) {
  if (!form) return '';
  if (!text(form.seller1Email)) return 'Seller 1 email is required.';
  if (!isValidEmail(form.seller1Email)) return 'Enter a valid Seller 1 email address.';
  return '';
}

function getContractLiveValidation(form: ContractFormState | null) {
  if (!form) return '';
  const seller1EmailError = getSeller1EmailError(form);
  if (seller1EmailError) return seller1EmailError;
  if (form.seller2Email && !isValidEmail(form.seller2Email)) return 'Seller 2 email is not valid.';
  if (!isValidEmail(form.slot2Email)) return 'Signer 2 email is not valid.';
  return '';
}

function getLeadScore(lead: BridgeRecord) {
  const score = Number(lead.score || lead.motivation_score || lead.motivationScore || 0);
  return Number.isFinite(score) && score > 0 ? Math.round(score) : 72;
}

function getLeadTags(lead: BridgeRecord) {
  if (Array.isArray(lead.tags)) return lead.tags.map(String).filter(Boolean).slice(0, 3);
  const raw = text(lead.tags || lead.source || 'runtime');
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function getLeadFinancial(lead: BridgeRecord, key: 'arv' | 'mao') {
  const property = getProperty(lead);
  const callContext = getCallContext(lead);
  return money(lead[key] || property[key] || callContext[key]);
}

function scoreTone(score: number) {
  if (score >= 80) return 'bg-lime-400/15 text-lime-300 border-lime-400/40';
  if (score >= 60) return 'bg-sky-400/15 text-sky-300 border-sky-400/40';
  return 'bg-amber-400/15 text-amber-300 border-amber-400/40';
}

function normalizePath(value: unknown, lead?: BridgeRecord): CanonicalPath {
  const raw = [
    value,
    lead?.selected_path,
    lead?.selectedPath,
    getCallContext(lead || {}).selected_path,
    getCallContext(lead || {}).selectedPath,
    getCallContext(lead || {}).path,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (raw.includes('rbp') || raw.includes('retail')) return 'rbp';
  if (raw.includes('creative') || /\bcf\b/.test(raw) || raw.includes('seller finance')) return 'cf';
  if (
    raw.includes('mortgage') ||
    raw.includes('subject') ||
    /\bmt\b/.test(raw) ||
    raw.includes('subto')
  )
    return 'mt';
  if (raw.includes('land') || raw.includes('parcel') || raw.includes('lot')) return 'land';

  const property = getProperty(lead || {});
  if (
    /land|parcel|lot/i.test(
      [property.propertyType, property.type, property.address].filter(Boolean).join(' ')
    )
  ) {
    return 'land';
  }

  return 'cash';
}

function formFromLead(lead: BridgeRecord): LeadFormState {
  const seller = getSeller(lead);
  const property = getProperty(lead);
  const callContext = getCallContext(lead);
  const bant = lead.bant && typeof lead.bant === 'object' ? (lead.bant as BridgeRecord) : {};
  return {
    name: text(lead.name || seller.name),
    phone: text(lead.phone || seller.phone),
    email: text(lead.email || seller.email),
    address: text(lead.address || property.address),
    propertyType: text(
      lead.property_type || property.propertyType || property.type,
      'Single Family'
    ),
    motivation: text(lead.motivation_score || lead.motivationScore || lead.score || ''),
    tags: Array.isArray(lead.tags) ? lead.tags.map(String).join(', ') : text(lead.tags),
    notes: text(lead.notes),
    selectedPath: normalizePath(lead.selected_path || lead.selectedPath, lead),
    lastOffer: text(callContext.last_offer || callContext.lastOffer),
    sentiment: text(callContext.sentiment || callContext.sentimentScore),
    summary: text(callContext.summary || callContext.callSummary),
    bantBudget: text(bant.budget || callContext.budget || callContext.askingPrice),
    bantAuthority: text(
      bant.authority ||
        callContext.authority ||
        seller.relationshipToProperty ||
        seller.relationship
    ),
    bantNeed: text(bant.need || callContext.need || lead.motivation || callContext.motivation),
    bantTimeline: text(bant.timeline || callContext.timeline),
    bantUrgency: text(bant.urgency || callContext.urgency),
    bantObjection: text(bant.objection || callContext.objection || callContext.primaryObjection),
    bantNextStep: text(
      bant.nextStep || bant.next_step || callContext.nextStep || callContext.next_step
    ),
  };
}

function buildBantFromLeadForm(form: LeadFormState): BridgeRecord {
  return {
    budget: form.bantBudget,
    authority: form.bantAuthority,
    need: form.bantNeed,
    timeline: form.bantTimeline,
    urgency: form.bantUrgency,
    objection: form.bantObjection,
    sentiment: form.sentiment ? Number(form.sentiment) : null,
    nextStep: form.bantNextStep,
  };
}

function readAnalyzerSeedDeal(): BridgeRecord {
  if (typeof window === 'undefined') return {};
  const parsed = readAnalyzerStorage<BridgeRecord>(ANALYZER_CURRENT_DEAL_KEY, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function seedNewLeadFromAnalyzer(): NewLeadFormState {
  const deal = readAnalyzerSeedDeal();
  const repairs = asBridgeRecord(deal.repairs);
  const path = normalizePath(deal.selectedPath || deal.selected_path, {
    property: { type: deal.type },
  });
  const motivationScore = Number(deal.motivationScore || 0);
  const leadScore =
    Number.isFinite(motivationScore) && motivationScore > 0
      ? String(Math.max(1, Math.min(100, Math.round(motivationScore * 20))))
      : '';

  return {
    sellerName: text(deal.sellerName),
    phone: text(deal.sellerPhone),
    email: text(deal.sellerEmail),
    preferredChannel: text(deal.sellerPhone)
      ? 'phone'
      : text(deal.sellerEmail)
        ? 'email'
        : 'unknown',
    bestTimeToCall: '',
    relationship:
      deal.contact === 'realtor' ? 'agent' : deal.contact === 'owner' ? 'owner' : 'unknown',
    propertyAddress: text(deal.address),
    city: '',
    state: '',
    zip: text(deal.zipCode),
    occupancy: 'unknown',
    condition: text(repairs.condition).toLowerCase().includes('heavy')
      ? 'heavy'
      : text(repairs.condition).toLowerCase().includes('moderate')
        ? 'moderate'
        : text(repairs.condition)
          ? 'light'
          : 'unknown',
    motivation: text(deal.motivationLevel),
    timeline: text(deal.timeline, 'Unknown'),
    askingPrice: numberText(deal.agreedPrice || deal.price),
    tags: ['manual-new-lead', PATH_LABELS[path].toLowerCase().replace(/\s+/g, '-')].join(', '),
    leadSource: 'manual-new-lead',
    stage: 'new',
    tcpaConsent: 'unknown',
    dncStatus: 'needs_review',
    beds: numberText(deal.beds),
    baths: numberText(deal.baths),
    sqft: numberText(deal.sqft),
    yearBuilt: numberText(deal.year),
    estimatedRepairs: numberText(repairs.mid),
    arv: numberText(deal.arv),
    mao: numberText(deal.mao60 || deal.maoRBP),
    mortgageBalance: numberText(deal.balance),
    leadScore,
    assignedAgent: 'Ava',
    sellerNotes: text(deal.notes),
    internalNotes: text(deal.address) ? `Seeded from Deal Analyzer path ${PATH_LABELS[path]}.` : '',
    selectedPath: path,
  };
}

function asBridgeRecord(value: unknown): BridgeRecord {
  return value && typeof value === 'object' ? (value as BridgeRecord) : {};
}

function buildNewLeadPayload(newLeadForm: NewLeadFormState): BridgeRecord {
  const selectedPath = newLeadForm.selectedPath;
  const askingPrice = numberOrNull(newLeadForm.askingPrice);
  const leadScore = numberOrNull(newLeadForm.leadScore);
  const arv = numberOrNull(newLeadForm.arv);
  const mao = numberOrNull(newLeadForm.mao);
  const estimatedRepairs = numberOrNull(newLeadForm.estimatedRepairs);
  const mortgageBalance = numberOrNull(newLeadForm.mortgageBalance);
  const tags = splitTags(newLeadForm.tags);
  const seller = {
    name: newLeadForm.sellerName,
    phone: newLeadForm.phone,
    email: newLeadForm.email,
    preferredChannel: newLeadForm.preferredChannel,
    bestTimeToCall: newLeadForm.bestTimeToCall,
    relationshipToProperty: newLeadForm.relationship,
    notes: newLeadForm.sellerNotes,
  };
  const property = {
    address: newLeadForm.propertyAddress,
    city: newLeadForm.city,
    state: newLeadForm.state,
    zip: newLeadForm.zip,
    occupancy: newLeadForm.occupancy,
    condition: newLeadForm.condition,
    beds: numberOrNull(newLeadForm.beds),
    baths: numberOrNull(newLeadForm.baths),
    sqft: numberOrNull(newLeadForm.sqft),
    yearBuilt: numberOrNull(newLeadForm.yearBuilt),
    estimatedRepairs,
    arv,
    mao,
    mortgageBalance,
    askingPrice,
    propertyType: 'house',
  };
  const motivation = {
    summary: newLeadForm.motivation,
    timeline: newLeadForm.timeline,
    askingPrice,
  };
  const compliance = {
    consentStatus: newLeadForm.tcpaConsent,
    tcpaConsent: newLeadForm.tcpaConsent,
    dncStatus: newLeadForm.dncStatus,
  };
  const assignment = {
    assignedAgent: newLeadForm.assignedAgent,
    campaign: newLeadForm.leadSource,
    stage: newLeadForm.stage,
  };
  const analyzer = {
    selectedPath,
    selected_path: selectedPath,
    selectedPathLabel: PATH_LABELS[selectedPath],
    askingPrice,
    arv,
    mao,
    estimatedRepairs,
    mortgageBalance,
    leadScore,
    source: 'new-lead-portal',
  };
  const liveCallDetails = {
    preferredChannel: newLeadForm.preferredChannel,
    bestTimeToCall: newLeadForm.bestTimeToCall,
    relationship: newLeadForm.relationship,
    selectedPath,
    selectedPathLabel: PATH_LABELS[selectedPath],
    assignedAgent: newLeadForm.assignedAgent,
    tcpaConsent: newLeadForm.tcpaConsent,
    dncStatus: newLeadForm.dncStatus,
    syncedFrom: 'path-and-deal-analyzer',
  };
  const contracts = {
    sellerName: newLeadForm.sellerName,
    sellerEmail: newLeadForm.email,
    sellerPhone: newLeadForm.phone,
    propertyAddress: newLeadForm.propertyAddress,
    askingPrice,
    arv,
    mao,
    estimatedRepairs,
    selectedPath,
    readyForDraft: Boolean(newLeadForm.email && newLeadForm.propertyAddress),
  };
  const approvals = {
    requiredForContract: true,
    requiredForFirstOutbound:
      newLeadForm.tcpaConsent !== 'yes' || newLeadForm.dncStatus !== 'clear',
    compliance,
  };
  const leadProfile = {
    seller,
    property,
    motivation,
    compliance,
    assignment,
    tags,
    notes: {
      seller: newLeadForm.sellerNotes,
      internal: newLeadForm.internalNotes,
    },
    score: leadScore,
    source: newLeadForm.leadSource,
    stage: newLeadForm.stage,
  };
  const portalRecord = {
    portalVersion: 'pbk-lead-portal-v1',
    source: 'new-lead-portal',
    leadProfile,
    analyzer,
    contracts,
    approvals,
    ava: {
      assignedAgent: newLeadForm.assignedAgent || 'Ava',
      notes: newLeadForm.sellerNotes,
      nextAction: 'first_contact',
      callContext: liveCallDetails,
    },
    rex: {
      score: leadScore,
      stage: newLeadForm.stage,
      underwritingContext: newLeadForm.internalNotes,
    },
    liveCallDetails,
    createdBy: 'PBK Command Center',
  };

  return {
    source: newLeadForm.leadSource,
    leadSource: newLeadForm.leadSource,
    stage: newLeadForm.stage,
    status: newLeadForm.stage,
    score: leadScore,
    seller,
    property,
    motivation,
    compliance,
    assignment,
    tags,
    notes: newLeadForm.internalNotes,
    sellerNotes: newLeadForm.sellerNotes,
    internalNotes: newLeadForm.internalNotes,
    selectedPath,
    selected_path: selectedPath,
    leadProfile,
    lead_profile: leadProfile,
    portalRecord,
    portal_record: portalRecord,
    contracts,
    approvals,
    analyzer,
    liveCallDetails,
    live_call_details: liveCallDetails,
    callContext: {
      selectedPath,
      selected_path: selectedPath,
      selectedPathLabel: PATH_LABELS[selectedPath],
      preferredChannel: newLeadForm.preferredChannel,
      bestTimeToCall: newLeadForm.bestTimeToCall,
      relationship: newLeadForm.relationship,
      tcpaConsent: newLeadForm.tcpaConsent,
      dncStatus: newLeadForm.dncStatus,
      assignedAgent: newLeadForm.assignedAgent,
      source: 'new-lead-portal',
      liveCallDetailsSynced: true,
      askingPrice,
      arv,
      mao,
      estimatedRepairs,
      mortgageBalance,
      leadScore,
    },
    bant: {
      motivation: newLeadForm.motivation,
      timeline: newLeadForm.timeline,
      authority: newLeadForm.relationship,
      budget: askingPrice,
      score: leadScore,
    },
    actor: 'New PBK lead portal',
  };
}

function contractFormFromLead(
  lead: BridgeRecord,
  lastCall?: BridgeRecord | null
): ContractFormState {
  const path = normalizePath(lead.selected_path || lead.selectedPath, lead);
  const callContext = getCallContext(lead);
  const property = getProperty(lead);
  const motivation =
    lead.motivation && typeof lead.motivation === 'object' ? (lead.motivation as BridgeRecord) : {};
  const lastOffer =
    lastCall?.last_offer || lastCall?.lastOffer || callContext.last_offer || callContext.lastOffer;
  const sellerName = getSellerName(lead);
  const sellerEmail = getLeadEmail(lead);
  return {
    path,
    templateName: TEMPLATE_NAMES[path],
    seller1Name: sellerName === 'Unknown seller' ? '' : sellerName,
    seller1Email: sellerEmail,
    seller2Name: text(lead.second_seller_name || callContext.seller2Name),
    seller2Email: text(lead.second_seller_email || callContext.seller2Email),
    slot2Name: path === 'rbp' ? 'RBP Manager' : 'Probono Key Realty',
    slot2Email: 'info@probonokeyrealty.com',
    amount: text(lastOffer || property.askingPrice || ''),
    timeline: text(callContext.timeline || motivation.timeline || ''),
    notes: `Send ${PATH_LABELS[path]} contract packet from lead detail.`,
  };
}

function unwrapLeadResponse(response: BridgeRecord): BridgeRecord {
  return (
    response.lead && typeof response.lead === 'object'
      ? response.lead
      : response.leadImport && typeof response.leadImport === 'object'
        ? response.leadImport
        : response
  ) as BridgeRecord;
}

function sameLeadRecord(left: BridgeRecord, right: BridgeRecord) {
  const leftLeadId = getLeadId(left);
  const rightLeadId = getLeadId(right);
  const leftPhone = normalizePhone(getLeadPhone(left));
  const rightPhone = normalizePhone(getLeadPhone(right));
  const leftEmail = getLeadEmail(left).toLowerCase();
  const rightEmail = getLeadEmail(right).toLowerCase();
  const leftAddress = leadAddressMatchKey(left);
  const rightAddress = leadAddressMatchKey(right);
  if (leftLeadId && rightLeadId && leftLeadId === rightLeadId) return true;
  if (leftPhone && rightPhone && leftPhone === rightPhone) return true;
  if (leftEmail && rightEmail && leftEmail === rightEmail) return true;
  return Boolean(leftAddress && rightAddress && leftAddress === rightAddress);
}

function mergeLeadRecord(base: BridgeRecord, enriched: BridgeRecord): BridgeRecord {
  const baseSeller = asBridgeRecord(base.seller);
  const enrichedSeller =
    typeof enriched.seller === 'string'
      ? { name: enriched.seller }
      : asBridgeRecord(enriched.seller);
  const baseProperty = asBridgeRecord(base.property);
  const enrichedProperty = asBridgeRecord(enriched.property);
  return {
    ...base,
    ...enriched,
    seller: { ...baseSeller, ...enrichedSeller },
    property: { ...baseProperty, ...enrichedProperty },
  };
}

function upsertVisibleLead(current: BridgeRecord[], lead: BridgeRecord): BridgeRecord[] {
  const record = unwrapLeadResponse(lead);
  return [record, ...current.filter((item) => !sameLeadRecord(item, record))];
}

function mergeVisibleLeadDetail(current: BridgeRecord[], lead: BridgeRecord): BridgeRecord[] {
  const record = unwrapLeadResponse(lead);
  let matched = false;
  const next = current.map((item) => {
    if (!sameLeadRecord(item, record)) return item;
    matched = true;
    return mergeLeadRecord(item, record);
  });
  return matched ? next : [record, ...next];
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5 text-xs text-slate-400">
      <span className="font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function LeadDetailSkeleton() {
  return (
    <div
      className="lead-detail-skeleton grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
      aria-label="Loading lead detail"
    >
      <div className="h-6 w-2/3 rounded-full bg-slate-800" />
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="h-3 w-20 rounded-full bg-slate-800" />
            <div className="mt-3 h-5 w-28 rounded-full bg-slate-800" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="h-52 rounded-2xl border border-slate-800 bg-slate-950/70" />
        <div className="h-52 rounded-2xl border border-slate-800 bg-slate-950/70" />
      </div>
    </div>
  );
}

function buildLeadsStats(leads: BridgeRecord[]): LeadsStats {
  return {
    total: leads.length,
    callable: leads.filter((lead) => isCallablePhone(getLeadPhone(lead))).length,
    contractReady: leads.filter((lead) => isValidEmail(getLeadEmail(lead))).length,
    hot: leads.filter((lead) => getLeadScore(lead) >= 80).length,
  };
}

function LeadsSourceRail() {
  return (
    <div className="pbk-leads-source-rail" aria-label="Leads data sources">
      <PbkDataSource endpoint="GET /api/leads" status="ships" note="full lead roster" />
      <PbkDataSource endpoint="POST /api/leads" status="ships" note="canonical seller portal" />
      <PbkDataSource endpoint="GET /state" status="ships" note="snapshot fallback" />
      <PbkDataSource endpoint="GET /api/leads/:id/full" status="ships" note="lead detail" />
      <PbkDataSource endpoint="GET /api/leads/:id/last-call" status="ships" note="call memory" />
      <PbkDataSource endpoint="PATCH /api/leads/:id" status="ships" note="CRM corrections" />
      <PbkDataSource endpoint="POST /invoke: telnyx_call" status="ships" note="call lane" />
      <PbkDataSource endpoint="POST /api/contract/send" status="ships" note="contract packet" />
    </div>
  );
}

function LeadsStatRibbon({ stats, sourceLabel }: { stats: LeadsStats; sourceLabel: string }) {
  const cards = [
    {
      label: 'Bridge leads',
      value: String(stats.total),
      detail: sourceLabel,
      tone: 'sky',
    },
    {
      label: 'Callable',
      value: String(stats.callable),
      detail: 'valid phone ready',
      tone: 'lime',
    },
    {
      label: 'Contract ready',
      value: String(stats.contractReady),
      detail: 'seller email captured',
      tone: 'sky',
    },
    {
      label: 'Hot scores',
      value: String(stats.hot),
      detail: 'score 80 or higher',
      tone: stats.hot ? 'amber' : 'sky',
    },
  ];

  return (
    <div className="pbk-leads-grid" aria-label="Leads summary">
      {cards.map((card) => (
        <div key={card.label} className="pbk-leads-stat">
          <div className="l">{card.label}</div>
          <div className={['v', card.tone].join(' ')}>{card.value}</div>
          <div className="delta">{card.detail}</div>
        </div>
      ))}
    </div>
  );
}

function LeadsHero({
  loading,
  error,
  stats,
  rosterSourceLabel,
  onRefresh,
  onCreateLead,
}: {
  loading: boolean;
  error: string | null | undefined;
  stats: LeadsStats;
  rosterSourceLabel: string;
  onRefresh: () => void;
  onCreateLead: () => void;
}) {
  return (
    <section className="pbk-leads-hero">
      <div className="pbk-leads-hero-top">
        <div>
          <div className="pbk-eyebrow">
            Lead command -{' '}
            {loading ? 'loading bridge' : error ? 'bridge offline' : `${stats.total} records`}
          </div>
          <h1 className="pbk-display pbk-h1">
            Leads &amp; <em>contracts</em>.
          </h1>
          <p>
            Seller pipeline, call memory, CRM corrections, and path-aware contract handoff in one
            operator cockpit. The seller roster is pulled from the bridge first, with the runtime
            snapshot labeled as a fallback when the full roster is unavailable.
          </p>
        </div>
        <div className="pbk-leads-hero-actions">
          <button type="button" className="pbk-leads-create" onClick={onCreateLead}>
            <Plus size={15} />
            New PBK lead
          </button>
          <button
            type="button"
            className="pbk-leads-refresh"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing' : 'Refresh leads'}
          </button>
        </div>
      </div>
      <LeadsStatRibbon stats={stats} sourceLabel={rosterSourceLabel} />
      <LeadsSourceRail />
    </section>
  );
}

function LeadsPipelineRail({
  children,
  total,
  visible,
  sourceNote,
  onLoadMore,
}: {
  children: ReactNode;
  total: number;
  visible: number;
  sourceNote: string;
  onLoadMore: () => void;
}) {
  return (
    <section className={`${softPanelClass} pbk-leads-pipeline-rail overflow-hidden`}>
      <div className="pipeline-head">
        <div>
          <span className="pbk-kicker">Pipeline leads</span>
          <h2>Seller roster</h2>
          <p>Tap a lead to load bridge detail and call memory.</p>
        </div>
        <PbkDataSource endpoint="GET /api/leads" status="ships" note={sourceNote} />
      </div>
      {children}
      {total > visible && (
        <div className="pipeline-load">
          <button type="button" className="load-more-leads" onClick={onLoadMore}>
            Load 50 more
          </button>
        </div>
      )}
    </section>
  );
}

function LeadsDetailShell({ children }: { children: ReactNode }) {
  return (
    <section className={`${softPanelClass} pbk-leads-detail-shell min-h-[520px] p-4 md:p-5`}>
      {children}
    </section>
  );
}

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20';

const softPanelClass =
  'rounded-2xl border border-slate-800 bg-slate-950/95 shadow-[0_18px_60px_rgba(2,6,23,0.22)]';

export function Leads() {
  const { snapshot, loading, error, refresh } = useRuntimeSnapshot();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const snapshotLeads = useMemo(
    () => (Array.isArray(snapshot?.leadImports) ? (snapshot.leadImports as BridgeRecord[]) : []),
    [snapshot?.leadImports]
  );
  const [leadRoster, setLeadRoster] = useState<BridgeRecord[]>([]);
  const [leadRosterStatus, setLeadRosterStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [leadRosterError, setLeadRosterError] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [leadDetail, setLeadDetail] = useState<BridgeRecord | null>(null);
  const [lastCall, setLastCall] = useState<BridgeRecord | null>(null);
  const [detailStatus, setDetailStatus] = useState<DetailStatus | null>(null);
  const [leadDetailLoading, setLeadDetailLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState<NewLeadFormState>(() => seedNewLeadFromAnalyzer());
  const [newLeadStatus, setNewLeadStatus] = useState<DetailStatus | null>(null);
  const [contractOpen, setContractOpen] = useState(false);
  const [contractConfirmOpen, setContractConfirmOpen] = useState(false);
  const [quickSmsDraft, setQuickSmsDraft] = useState<QuickSmsDraft | null>(null);
  const [leadCallConfirmDraft, setLeadCallConfirmDraft] = useState<LeadCallConfirmDraft | null>(
    null
  );
  const [editForm, setEditForm] = useState<LeadFormState | null>(null);
  const [contractForm, setContractForm] = useState<ContractFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [leadActionPending, setLeadActionPending] = useState('');
  const [reloading, setReloading] = useState(false);
  const [contractStatus, setContractStatus] = useState('');
  const [displayLimit, setDisplayLimit] = useState(40);
  const [leadQuery, setLeadQuery] = useState(() => searchParams.get('search') || '');
  const [leadFilter, setLeadFilter] = useState<'all' | 'hot' | 'callable' | 'contract'>('all');
  const reloadTimerRef = useRef<number | null>(null);
  const reloadInFlightRef = useRef(false);
  const leadActionLockRef = useRef(false);
  const selectedLeadRef = useRef<BridgeRecord | null>(null);
  const isLeadActionBusy = saving || Boolean(leadActionPending);
  const leads = useMemo(
    () => (leadRoster.length ? leadRoster : snapshotLeads),
    [leadRoster, snapshotLeads]
  );

  const selectedLead = useMemo(
    () => leads.find((lead) => getLeadId(lead) === selectedLeadId) || leads[0] || null,
    [leads, selectedLeadId]
  );
  useEffect(() => {
    selectedLeadRef.current = selectedLead || null;
  }, [selectedLead]);
  const filteredLeads = useMemo(() => {
    const needle = leadQuery.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesQuery =
        !needle ||
        [
          getSellerName(lead),
          getLeadAddress(lead),
          getLeadPhone(lead),
          getLeadEmail(lead),
          lead.status,
          lead.stage,
          lead.source,
          ...getLeadTags(lead),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      if (!matchesQuery) return false;
      if (leadFilter === 'hot') return getLeadScore(lead) >= 80;
      if (leadFilter === 'callable') return isCallablePhone(getLeadPhone(lead));
      if (leadFilter === 'contract') return isValidEmail(getLeadEmail(lead));
      return true;
    });
  }, [leadFilter, leadQuery, leads]);
  const visibleLeads = useMemo(
    () => filteredLeads.slice(0, displayLimit),
    [displayLimit, filteredLeads]
  );
  const leadsStats = useMemo(() => buildLeadsStats(leads), [leads]);
  const activeLead =
    leadDetail && getLeadId(leadDetail) === selectedLeadId ? leadDetail : selectedLead;
  const activeLeadId = activeLead ? getLeadId(activeLead) : '';
  const seller1EmailError = useMemo(() => getSeller1EmailError(contractForm), [contractForm]);
  const contractLiveValidation = useMemo(
    () => getContractLiveValidation(contractForm),
    [contractForm]
  );

  useEffect(() => {
    const requestedLeadId = searchParams.get('lead');
    const requestedSearch = searchParams.get('search');

    if (requestedLeadId) {
      navigate(`/leads/${encodeURIComponent(requestedLeadId)}`, { replace: true });
      return;
    } else if (requestedSearch && leads.length) {
      setLeadQuery(requestedSearch);
      const needle = requestedSearch.toLowerCase();
      const match = leads.find((lead) =>
        [getSellerName(lead), getLeadAddress(lead), getLeadPhone(lead), getLeadEmail(lead)]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      );
      if (match) setSelectedLeadId(getLeadId(match));
    }

    if (searchParams.get('new') === '1') {
      setNewLeadForm(seedNewLeadFromAnalyzer());
      setNewLeadOpen(true);
      setNewLeadStatus({
        tone: 'info',
        text: 'Seeded from the current Deal Analyzer path and live call details.',
      });
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('new');
          return next;
        },
        { replace: true }
      );
    }
  }, [leads, navigate, searchParams, setSearchParams]);

  useEffect(() => {
    setDisplayLimit(40);
  }, [leadFilter, leadQuery]);

  const beginLeadAction = useCallback((key: string) => {
    if (leadActionLockRef.current) return false;
    leadActionLockRef.current = true;
    setLeadActionPending(key);
    setSaving(true);
    return true;
  }, []);
  const endLeadAction = useCallback(() => {
    leadActionLockRef.current = false;
    setLeadActionPending('');
    setSaving(false);
  }, []);
  const loadLeadRoster = useCallback(async () => {
    setLeadRosterStatus('loading');
    setLeadRosterError('');
    try {
      const roster = await fetchLeadsRequest();
      setLeadRoster(
        Array.isArray(roster)
          ? (roster as BridgeRecord[]).map((lead) => unwrapLeadResponse(lead))
          : []
      );
      setLeadRosterStatus('ready');
    } catch (nextError) {
      setLeadRosterStatus('error');
      setLeadRosterError(
        nextError instanceof Error ? nextError.message : 'GET /api/leads unavailable.'
      );
    }
  }, []);
  const rosterSourceLabel =
    leadRosterStatus === 'ready'
      ? 'GET /api/leads full roster'
      : leadRosterStatus === 'loading'
        ? 'loading GET /api/leads'
        : leadRosterStatus === 'error'
          ? 'snapshot fallback'
          : 'pending full roster';
  const handleRefreshLeads = useCallback(() => {
    void Promise.all([refresh().catch(() => null), loadLeadRoster()]);
  }, [loadLeadRoster, refresh]);
  const leadActivity = Array.isArray(activeLead?.activity)
    ? (activeLead.activity as BridgeRecord[])
    : Array.isArray(snapshot?.activity)
      ? (snapshot.activity as BridgeRecord[]).filter((item) => {
          const haystack = [item.leadId, item.leadName, item.target, item.text]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return (
            haystack.includes(activeLeadId.toLowerCase()) ||
            haystack.includes(
              getLeadAddress(activeLead || {})
                .toLowerCase()
                .split(',')[0]
            )
          );
        })
      : [];

  useEffect(() => {
    if (!leads.length) return;
    if (!selectedLeadId || !leads.some((lead) => getLeadId(lead) === selectedLeadId)) {
      setSelectedLeadId(getLeadId(leads[0]));
    }
  }, [leads, selectedLeadId]);

  useEffect(() => {
    void loadLeadRoster();
  }, [loadLeadRoster]);

  useEffect(() => {
    if (!selectedLeadId) return;
    let cancelled = false;
    const loadDetail = async () => {
      const fallbackLead = selectedLeadRef.current;
      if (fallbackLead && getLeadId(fallbackLead) === selectedLeadId) {
        setLeadDetail((current) =>
          current && getLeadId(current) === selectedLeadId ? current : fallbackLead
        );
      }
      setLeadDetailLoading(true);
      setDetailStatus({ tone: 'info', text: 'Loading lead detail...' });
      try {
        const [fullResponse, callResponse] = await Promise.all([
          fetchLeadFullRequest(selectedLeadId),
          fetchLeadLastCallRequest(selectedLeadId).catch(() => null),
        ]);
        if (cancelled) return;
        const lead = unwrapLeadResponse(fullResponse);
        setLeadDetail(lead);
        setLeadRoster((current) => mergeVisibleLeadDetail(current, lead));
        setLastCall(callResponse as BridgeRecord | null);
        setDetailStatus({ tone: 'success', text: 'Lead synced from bridge.' });
      } catch (nextError) {
        if (cancelled) return;
        const fallbackLead = selectedLeadRef.current;
        setLeadDetail(
          fallbackLead && getLeadId(fallbackLead) === selectedLeadId ? fallbackLead : null
        );
        setLastCall(null);
        setDetailStatus({
          tone: 'error',
          text:
            nextError instanceof Error
              ? `Bridge detail unavailable: ${nextError.message}`
              : 'Bridge detail unavailable.',
          retry: 'detail',
        });
      } finally {
        if (!cancelled) setLeadDetailLoading(false);
      }
    };
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedLeadId]);

  const reloadLeadDetailNow = useCallback(async () => {
    if (!selectedLeadId) return;
    if (reloadInFlightRef.current) return;
    reloadInFlightRef.current = true;
    setReloading(true);
    setDetailStatus({ tone: 'info', text: 'Refreshing lead detail...' });
    try {
      const [fullResponse, callResponse] = await Promise.all([
        fetchLeadFullRequest(selectedLeadId),
        fetchLeadLastCallRequest(selectedLeadId).catch(() => null),
      ]);
      const lead = unwrapLeadResponse(fullResponse);
      setLeadDetail(lead);
      setLeadRoster((current) => mergeVisibleLeadDetail(current, lead));
      setLastCall(callResponse as BridgeRecord | null);
      setDetailStatus({ tone: 'success', text: 'Lead refreshed.' });
      await Promise.all([refresh().catch(() => null), loadLeadRoster()]);
    } catch (nextError) {
      setDetailStatus({
        tone: 'error',
        text:
          nextError instanceof Error ? `Refresh failed: ${nextError.message}` : 'Refresh failed.',
        retry: 'refresh',
      });
    } finally {
      reloadInFlightRef.current = false;
      setReloading(false);
    }
  }, [loadLeadRoster, refresh, selectedLeadId]);

  const reloadLeadDetail = useCallback(() => {
    if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(() => {
      void reloadLeadDetailNow();
    }, 300);
  }, [reloadLeadDetailNow]);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
    };
  }, []);

  const openEditModal = () => {
    if (!activeLead) return;
    setEditForm(formFromLead(activeLead));
    setEditOpen(true);
  };

  const openNewLeadModal = () => {
    setNewLeadForm(seedNewLeadFromAnalyzer());
    setNewLeadStatus(null);
    setNewLeadOpen(true);
  };

  const openContractModal = () => {
    if (!activeLead) return;
    setContractForm(contractFormFromLead(activeLead, lastCall));
    setContractStatus('');
    setContractConfirmOpen(false);
    setContractOpen(true);
  };

  const saveLead = async () => {
    if (!editForm || !activeLeadId) return;
    if (!beginLeadAction('save-lead')) return;
    try {
      const bant = buildBantFromLeadForm(editForm);
      const response = await patchLeadRequest(activeLeadId, {
        name: editForm.name,
        phone: editForm.phone,
        email: editForm.email,
        address: editForm.address,
        property_type: editForm.propertyType,
        motivation_score: editForm.motivation ? Number(editForm.motivation) : null,
        tags: editForm.tags,
        notes: editForm.notes,
        selected_path: editForm.selectedPath,
        last_offer: editForm.lastOffer ? Number(editForm.lastOffer) : null,
        sentiment: editForm.sentiment ? Number(editForm.sentiment) : null,
        summary: editForm.summary,
        bant,
        call_metadata: {
          bant,
          summary: editForm.summary,
          sentiment: editForm.sentiment ? Number(editForm.sentiment) : null,
          nextStep: editForm.bantNextStep,
          objection: editForm.bantObjection,
        },
        actor: 'Lead Detail',
      });
      const lead = unwrapLeadResponse(response);
      setLeadDetail(lead);
      setEditOpen(false);
      setDetailStatus({ tone: 'success', text: 'Lead saved to bridge.' });
      showUiToast({
        tone: 'success',
        title: 'Lead updated',
        desc: `${getSellerName(lead)} was saved to the bridge.`,
      });
      await Promise.all([refresh().catch(() => null), loadLeadRoster()]);
    } catch (nextError) {
      setDetailStatus({
        tone: 'error',
        text: nextError instanceof Error ? `Save failed: ${nextError.message}` : 'Save failed.',
      });
    } finally {
      endLeadAction();
    }
  };

  const createLead = async () => {
    if (!newLeadForm.sellerName.trim()) {
      setNewLeadStatus({ tone: 'error', text: 'Seller name is required.' });
      return;
    }
    if (!newLeadForm.phone.trim() && !newLeadForm.email.trim()) {
      setNewLeadStatus({ tone: 'error', text: 'Add a phone or email before creating the lead.' });
      return;
    }
    if (!newLeadForm.propertyAddress.trim()) {
      setNewLeadStatus({ tone: 'error', text: 'Property address is required.' });
      return;
    }
    if (!beginLeadAction('create-lead')) return;
    setNewLeadStatus({ tone: 'info', text: 'Creating bridge lead record...' });
    try {
      const response = await createLeadRequest(buildNewLeadPayload(newLeadForm));
      const lead = unwrapLeadResponse(response);
      const nextLeadId = getLeadId(lead);
      setLeadRoster((current) => upsertVisibleLead(current, lead));
      setLeadDetail(lead);
      setSelectedLeadId(nextLeadId);
      setLeadQuery('');
      setLeadFilter('all');
      setDisplayLimit((current) => Math.max(current, 40));
      setNewLeadOpen(false);
      setNewLeadStatus(null);
      setDetailStatus({ tone: 'success', text: 'New PBK lead created on the bridge.' });
      window.dispatchEvent(new CustomEvent('pbk:lead-created', { detail: { lead } }));
      showUiToast({
        tone: 'success',
        title: 'New PBK lead created',
        desc: `${getSellerName(lead)} is ready for Ava, Rex, approvals, analyzer, and contracts.`,
      });
      await Promise.all([refresh().catch(() => null), loadLeadRoster()]);
      navigate(`/leads/${encodeURIComponent(nextLeadId)}`);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? `Create failed: ${nextError.message}` : 'Create failed.';
      setNewLeadStatus({ tone: 'error', text: message });
      showUiToast({
        tone: 'error',
        title: 'Lead create failed',
        desc: message,
        critical: true,
      });
    } finally {
      endLeadAction();
    }
  };

  const startQuickLeadCall = async (lead: BridgeRecord) => {
    const validation = validateLeadForCall(lead);
    const leadId = getLeadId(lead);
    if (validation) {
      showUiToast({ tone: 'error', title: 'Call blocked', desc: validation });
      return;
    }
    if (!beginLeadAction(`call:${leadId}`)) return;
    try {
      const response = await startLeadCallRequest({
        leadId,
        leadName: getSellerName(lead),
        phone: getLeadPhone(lead),
        email: getLeadEmail(lead),
        address: getLeadAddress(lead),
        actor: 'PBK operator',
        requestedBy: 'PBK operator',
        source: 'leads_page_manual',
        manual: true,
        manualSend: true,
      });
      const status = String(
        response.status || response.result || response.outcome || response.action || ''
      ).toLowerCase();
      const approvalQueued =
        status.includes('approval') || Boolean(response.approvalId || response.approval_id);
      showUiToast({
        tone: approvalQueued ? 'info' : 'success',
        title: approvalQueued ? 'Call held by bridge' : 'Calling seller',
        desc: approvalQueued
          ? `${getSellerName(lead)} returned an approval hold from the bridge/provider policy.`
          : `${getSellerName(lead)} was sent to Telnyx from the manual lead quick action.`,
      });
      await Promise.all([refresh().catch(() => null), loadLeadRoster()]);
    } catch (nextError) {
      showUiToast({
        tone: 'error',
        title: 'Call request failed',
        desc:
          nextError instanceof Error
            ? nextError.message
            : 'The bridge did not accept the manual call request.',
        critical: true,
      });
    } finally {
      endLeadAction();
    }
  };

  const openQuickSms = (lead: BridgeRecord) => {
    const phone = getLeadPhone(lead);
    if (!isCallablePhone(phone)) {
      showUiToast({
        tone: 'error',
        title: 'SMS unavailable',
        desc: 'Add a canonical phone number before texting this seller.',
      });
      return;
    }
    setQuickSmsDraft({
      lead,
      leadId: getLeadId(lead),
      sellerName: getSellerName(lead),
      phone,
      body: `Hi ${getSellerName(lead).split(' ')[0] || 'there'}, this is Probono Key Realty following up about ${getLeadAddress(lead) || 'your property'}. Is now still a good time to talk?`,
    });
  };

  const sendQuickSms = async () => {
    if (!quickSmsDraft || !quickSmsDraft.body.trim()) return;
    const { lead, leadId } = quickSmsDraft;
    if (!beginLeadAction(`sms:${leadId}`)) return;
    try {
      const response = await sendMessageRequest({
        leadId,
        leadName: getSellerName(lead),
        phone: getLeadPhone(lead),
        email: getLeadEmail(lead),
        address: getLeadAddress(lead),
        channel: 'sms',
        message: quickSmsDraft.body.trim(),
        body: quickSmsDraft.body.trim(),
        actor: 'PBK operator',
        requestedBy: 'PBK operator',
        source: 'leads_page_manual',
        manual: true,
        manualSend: true,
      });
      const result = String(response.result || response.status || '').toLowerCase();
      const ok = response.ok !== false && !/failed|error|blocked/.test(result);
      showUiToast({
        tone: ok ? 'success' : 'warning',
        title: ok ? 'SMS sent' : 'SMS recorded with warning',
        desc: text(
          response.verbiage || response.message || response.error,
          'Manual SMS route returned.'
        ),
      });
      setQuickSmsDraft(null);
      await Promise.all([
        reloadLeadDetailNow().catch(() => null),
        refresh().catch(() => null),
        loadLeadRoster(),
      ]);
    } catch (nextError) {
      showUiToast({
        tone: 'error',
        title: 'SMS failed',
        desc:
          nextError instanceof Error
            ? nextError.message
            : 'The bridge did not accept the manual SMS.',
        critical: true,
      });
    } finally {
      endLeadAction();
    }
  };

  const addLeadToNurture = async (lead: BridgeRecord) => {
    const leadId = getLeadId(lead);
    if (!beginLeadAction(`nurture:${leadId}`)) return;
    try {
      const response = await planLeadNurtureRequest({
        leadId,
        leadName: getSellerName(lead),
        phone: getLeadPhone(lead),
        email: getLeadEmail(lead),
        address: getLeadAddress(lead),
        channels: ['sms', 'email', 'voice'],
        actor: 'PBK operator',
        requestedBy: 'PBK operator',
        source: 'leads_page_manual',
        manual: true,
        manualSend: true,
      });
      const plan =
        response.plan && typeof response.plan === 'object' ? (response.plan as BridgeRecord) : {};
      showUiToast({
        tone: response.ok === false ? 'error' : 'success',
        title: response.ok === false ? 'Nurture not started' : 'Nurture added',
        desc:
          text(response.error || response.message) ||
          `${getSellerName(lead)} is queued in the nurture lane${plan.approvalId ? ` (${plan.approvalId})` : ''}.`,
      });
      await Promise.all([refresh().catch(() => null), loadLeadRoster()]);
    } catch (nextError) {
      showUiToast({
        tone: 'error',
        title: 'Nurture failed',
        desc:
          nextError instanceof Error
            ? nextError.message
            : 'The bridge did not accept the nurture request.',
        critical: true,
      });
    } finally {
      endLeadAction();
    }
  };

  const executeLeadCall = async () => {
    if (!leadCallConfirmDraft) return;
    const { lead } = leadCallConfirmDraft;
    setLeadCallConfirmDraft(null);
    const leadId = getLeadId(lead);
    if (!beginLeadAction(`call:${leadId}`)) return;
    try {
      const response = await startLeadCallRequest({
        leadId,
        leadName: getSellerName(lead),
        phone: getLeadPhone(lead),
        email: getLeadEmail(lead),
        address: getLeadAddress(lead),
        source: 'leads_page_manual',
        manual: true,
        manualSend: true,
      });
      const status = String(
        response.status || response.result || response.outcome || response.action || ''
      ).toLowerCase();
      const approvalQueued =
        status.includes('approval') || Boolean(response.approvalId || response.approval_id);
      showUiToast({
        tone: approvalQueued ? 'info' : 'success',
        title: approvalQueued ? 'Call queued for approval' : 'Call request sent',
        desc: approvalQueued
          ? `${getSellerName(lead)} needs approval before Telnyx dials.`
          : `${getSellerName(lead)} was handed to the Telnyx call lane.`,
      });
      await Promise.all([refresh().catch(() => null), loadLeadRoster()]);
    } catch (nextError) {
      showUiToast({
        tone: 'error',
        title: 'Call request failed',
        desc:
          nextError instanceof Error
            ? nextError.message
            : 'The bridge did not accept the call request.',
        critical: true,
      });
    } finally {
      endLeadAction();
    }
  };

  const requestContractSend = () => {
    if (!contractForm || !activeLead) return;
    if (contractLiveValidation) {
      setContractStatus(contractLiveValidation);
      return;
    }
    const validation = validateContractBeforeSend(contractForm, activeLead);
    if (validation) {
      setContractStatus(validation);
      return;
    }
    setContractConfirmOpen(true);
  };

  const sendContract = async () => {
    if (!contractForm || !activeLead) return;
    if (contractLiveValidation) {
      setContractConfirmOpen(false);
      setContractStatus(contractLiveValidation);
      return;
    }
    const validation = validateContractBeforeSend(contractForm, activeLead);
    if (validation) {
      setContractConfirmOpen(false);
      setContractStatus(validation);
      return;
    }
    if (!beginLeadAction(`contract:${activeLeadId}`)) return;
    setContractConfirmOpen(false);
    setContractStatus('Preparing path-aware contract request...');
    try {
      const signers = [
        {
          roleName: 'Signer1',
          recipientId: '1',
          routingOrder: '1',
          name: 'Probono Key Realty',
          email: 'info@probonokeyrealty.com',
        },
        {
          roleName: 'Signer2',
          recipientId: '2',
          routingOrder: '2',
          name: contractForm.slot2Name || 'Probono Key Realty',
          email: contractForm.slot2Email || 'info@probonokeyrealty.com',
        },
        {
          roleName: 'Signer3',
          recipientId: '3',
          routingOrder: '3',
          name: contractForm.seller1Name || 'Seller 1',
          email: contractForm.seller1Email,
        },
        ...(contractForm.seller2Email
          ? [
              {
                roleName: 'Signer4',
                recipientId: '4',
                routingOrder: '4',
                name: contractForm.seller2Name || 'Seller 2',
                email: contractForm.seller2Email,
              },
            ]
          : []),
      ];
      const response = await sendLeadContractRequest({
        leadId: activeLeadId,
        leadName: contractForm.seller1Name || getSellerName(activeLead),
        email: contractForm.seller1Email,
        address: getLeadAddress(activeLead),
        path: contractForm.path,
        selectedPath: contractForm.path,
        selectedPathLabel: PATH_LABELS[contractForm.path],
        docusignTemplateName: contractForm.templateName,
        amount: contractForm.amount ? Number(contractForm.amount) : null,
        timeline: contractForm.timeline,
        notes: contractForm.notes,
        signers,
        source: 'lead-detail',
      });
      const contract =
        response.contract && typeof response.contract === 'object'
          ? (response.contract as BridgeRecord)
          : {};
      const result = String(
        response.result || response.outcome || contract.status || ''
      ).toLowerCase();
      setContractStatus(
        result === 'queued_for_approval'
          ? 'Queued for approval. Ava can continue after approval.'
          : response.ok === false
            ? text(response.error, 'Contract request failed.')
            : 'Contract request captured. Activity is attached to this lead.'
      );
      await Promise.all([reloadLeadDetailNow(), refresh().catch(() => null), loadLeadRoster()]);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? `Contract failed: ${nextError.message}` : 'Contract failed.';
      setContractStatus(message);
      showUiToast({
        tone: 'error',
        title: 'Contract request failed',
        desc: message,
        critical: true,
      });
    } finally {
      endLeadAction();
    }
  };

  const activeLeadPath = activeLead
    ? normalizePath(activeLead.selected_path || activeLead.selectedPath, activeLead)
    : 'cash';
  const activeLeadTemplateName = TEMPLATE_NAMES[activeLeadPath];

  return (
    <div className="pbk-leads-surface">
      <LeadsHero
        loading={loading || leadRosterStatus === 'loading'}
        error={error}
        stats={leadsStats}
        rosterSourceLabel={rosterSourceLabel}
        onRefresh={handleRefreshLeads}
        onCreateLead={openNewLeadModal}
      />

      {error && (
        <div className="pbk-leads-status" aria-live="polite">
          <AlertCircle size={15} aria-hidden="true" />
          {error}
        </div>
      )}

      {leadRosterStatus === 'error' && leadRosterError && (
        <div
          className="pbk-leads-status border-amber-300/25 bg-amber-500/10 text-amber-100"
          aria-live="polite"
        >
          <AlertCircle size={15} aria-hidden="true" />
          GET /api/leads unavailable, using runtime snapshot fallback: {leadRosterError}
        </div>
      )}

      <div className="pbk-leads-layout">
        <LeadsPipelineRail
          total={filteredLeads.length}
          visible={visibleLeads.length}
          sourceNote={rosterSourceLabel}
          onLoadMore={() => setDisplayLimit((current) => current + 50)}
        >
          <div className="pbk-leads-roster-tools">
            <label className="pbk-leads-search">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search leads</span>
              <input
                type="search"
                value={leadQuery}
                onChange={(event) => setLeadQuery(event.target.value)}
                placeholder="Search name, address, phone, stage..."
              />
              {leadQuery && (
                <button
                  type="button"
                  onClick={() => setLeadQuery('')}
                  aria-label="Clear lead search"
                >
                  <X size={13} />
                </button>
              )}
            </label>
            <div className="pbk-leads-smart-filters" aria-label="Lead filters">
              {[
                ['all', 'All'],
                ['hot', 'Hot 80+'],
                ['callable', 'Callable'],
                ['contract', 'Contract ready'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={leadFilter === value ? 'active' : ''}
                  aria-pressed={leadFilter === value}
                  onClick={() => setLeadFilter(value as 'all' | 'hot' | 'callable' | 'contract')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="pbk-leads-result-count" aria-live="polite">
              {filteredLeads.length} matching lead{filteredLeads.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="leads-mobile-cards">
            {visibleLeads.map((lead) => {
              const id = getLeadId(lead);
              const score = getLeadScore(lead);
              const path = normalizePath(lead.selected_path || lead.selectedPath, lead);
              const sellerName = getSellerName(lead);
              const isSelected = id === activeLeadId;
              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open lead ${sellerName} at ${getLeadAddress(lead)}`}
                  aria-selected={isSelected}
                  aria-pressed={isSelected}
                  className="lead-mobile-card"
                  onClick={() => setSelectedLeadId(id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedLeadId(id);
                    }
                  }}
                >
                  <span className={['lead-score', scoreTone(score)].join(' ')}>{score}</span>
                  <span className="min-w-0 flex-1">
                    <SellerRosterIdentity
                      name={sellerName}
                      address={getLeadAddress(lead)}
                      variant="mobile"
                    />
                    <span className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                      <span>
                        ARV{' '}
                        <strong className="text-slate-100">{getLeadFinancial(lead, 'arv')}</strong>
                      </span>
                      <span>
                        MAO{' '}
                        <strong className="text-slate-100">{getLeadFinancial(lead, 'mao')}</strong>
                      </span>
                    </span>
                    <span className="mt-3 flex flex-wrap gap-1.5">
                      {getLeadTags(lead).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                    <span className="mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                      <span>{text(lead.status || lead.stage, PATH_LABELS[path])}</span>
                      <span>{formatDate(lead.updatedAt || lead.createdAt)}</span>
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-sky-200">
                      {getSellerInitial(sellerName)}
                    </span>
                    <span
                      className="pbk-lead-quick-actions compact"
                      aria-label="Lead quick actions"
                    >
                      <button
                        type="button"
                        aria-label={`Call ${sellerName}`}
                        disabled={isLeadActionBusy || !isCallablePhone(getLeadPhone(lead))}
                        onClick={(event) => {
                          event.stopPropagation();
                          void startQuickLeadCall(lead);
                        }}
                      >
                        {leadActionPending === `call:${id}` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Phone size={13} />
                        )}
                        <span>Call</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Text ${sellerName}`}
                        disabled={isLeadActionBusy || !isCallablePhone(getLeadPhone(lead))}
                        onClick={(event) => {
                          event.stopPropagation();
                          openQuickSms(lead);
                        }}
                      >
                        <MessageSquare size={13} />
                        <span>SMS</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Add ${sellerName} to nurture`}
                        disabled={isLeadActionBusy}
                        onClick={(event) => {
                          event.stopPropagation();
                          void addLeadToNurture(lead);
                        }}
                      >
                        {leadActionPending === `nurture:${id}` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <HeartHandshake size={13} />
                        )}
                        <span>Nurture</span>
                      </button>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="leads-table-container max-h-[68vh] divide-y divide-slate-800 overflow-y-auto">
            {visibleLeads.map((lead) => {
              const id = getLeadId(lead);
              const isSelected = id === activeLeadId;
              const path = normalizePath(lead.selected_path || lead.selectedPath, lead);
              const sellerName = getSellerName(lead);
              return (
                <div
                  key={id}
                  aria-selected={isSelected}
                  className={[
                    'grid w-full grid-cols-1 gap-3 px-4 py-4 text-left transition',
                    isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-900',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    aria-label={`Open lead ${sellerName} at ${getLeadAddress(lead)}`}
                    onClick={() => setSelectedLeadId(id)}
                    className="min-w-0 text-left"
                  >
                    <SellerRosterIdentity name={sellerName} address={getLeadAddress(lead)} />
                    <span className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span>
                        {getLeadPhone(lead) || getLeadEmail(lead) || 'No contact captured'}
                      </span>
                      <span>Source: {text(lead.source, 'manual')}</span>
                    </span>
                  </button>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                      {PATH_LABELS[path]}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatDate(lead.updatedAt || lead.createdAt)}
                    </span>
                    <span
                      className="pbk-lead-quick-actions"
                      aria-label={`Quick actions for ${sellerName}`}
                    >
                      <button
                        type="button"
                        aria-label={`Call ${sellerName}`}
                        disabled={isLeadActionBusy || !isCallablePhone(getLeadPhone(lead))}
                        onClick={() => void startQuickLeadCall(lead)}
                      >
                        {leadActionPending === `call:${id}` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Phone size={13} />
                        )}
                        <span>Call</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Text ${sellerName}`}
                        disabled={isLeadActionBusy || !isCallablePhone(getLeadPhone(lead))}
                        onClick={() => openQuickSms(lead)}
                      >
                        <MessageSquare size={13} />
                        <span>SMS</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Add ${sellerName} to nurture`}
                        disabled={isLeadActionBusy}
                        onClick={() => void addLeadToNurture(lead)}
                      >
                        {leadActionPending === `nurture:${id}` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <HeartHandshake size={13} />
                        )}
                        <span>Nurture</span>
                      </button>
                    </span>
                  </span>
                </div>
              );
            })}
            {!filteredLeads.length && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                {leads.length
                  ? 'No leads match this search and filter.'
                  : 'No bridge leads loaded yet.'}
              </div>
            )}
          </div>
        </LeadsPipelineRail>

        <LeadsDetailShell>
          {activeLead ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2
                      className="truncate text-2xl font-semibold text-slate-100"
                      title={getSellerName(activeLead)}
                    >
                      {getSellerName(activeLead)}
                    </h2>
                    <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300">
                      {PATH_LABELS[activeLeadPath]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400" title={getLeadAddress(activeLead)}>
                    {getLeadAddress(activeLead)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Phone size={13} />
                      {getLeadPhone(activeLead) || 'No phone'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Mail size={13} />
                      {getLeadEmail(activeLead) || 'No email'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void startQuickLeadCall(activeLead)}
                    disabled={isLeadActionBusy || !isCallablePhone(getLeadPhone(activeLead))}
                    className="inline-flex items-center gap-2 rounded-full bg-sky-400 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {leadActionPending === `call:${activeLeadId}` ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Phone size={14} />
                    )}
                    Call
                  </button>
                  {!isCallablePhone(getLeadPhone(activeLead)) && (
                    <button
                      type="button"
                      onClick={openEditModal}
                      disabled={isLeadActionBusy}
                      className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-200 hover:bg-amber-300/15 disabled:cursor-wait disabled:opacity-60"
                    >
                      <Plus size={14} />
                      Add canonical phone
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openQuickSms(activeLead)}
                    disabled={isLeadActionBusy || !isCallablePhone(getLeadPhone(activeLead))}
                    className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-200 transition hover:border-sky-300 hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <MessageSquare size={14} /> SMS
                  </button>
                  <button
                    type="button"
                    onClick={() => void addLeadToNurture(activeLead)}
                    disabled={isLeadActionBusy}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-300 hover:bg-emerald-400/15 disabled:cursor-wait disabled:opacity-60"
                  >
                    {leadActionPending === `nurture:${activeLeadId}` ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <HeartHandshake size={14} />
                    )}
                    Nurture
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/leads/${encodeURIComponent(activeLeadId)}`)}
                    className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-200 transition hover:border-sky-300 hover:bg-sky-400/15"
                  >
                    Open lead
                  </button>
                  <button
                    type="button"
                    onClick={reloadLeadDetail}
                    disabled={reloading}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-sky-400 hover:text-sky-200 disabled:cursor-wait disabled:opacity-60"
                  >
                    <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />{' '}
                    {reloading ? 'Refreshing...' : 'Refresh'}
                  </button>
                  <button
                    type="button"
                    onClick={openEditModal}
                    disabled={isLeadActionBusy}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-sky-400 hover:text-sky-200"
                  >
                    <Edit3 size={14} /> Edit Lead
                  </button>
                  <button
                    type="button"
                    onClick={openContractModal}
                    disabled={isLeadActionBusy}
                    className="inline-flex items-center gap-2 rounded-full bg-sky-400 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
                  >
                    <FileSignature size={14} /> Send Contract
                  </button>
                </div>
              </div>

              {detailStatus && (
                <div
                  className={[
                    'flex flex-col gap-2 rounded-xl px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between',
                    detailStatus.tone === 'error'
                      ? 'border border-rose-400/30 bg-rose-500/10 text-rose-100'
                      : detailStatus.tone === 'success'
                        ? 'border border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
                        : 'border border-sky-500/20 bg-sky-500/10 text-sky-100',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2">
                    {detailStatus.tone === 'error' ? (
                      <AlertCircle size={15} className="shrink-0 text-rose-300" />
                    ) : detailStatus.tone === 'success' ? (
                      <CheckCircle2 size={15} className="shrink-0 text-emerald-300" />
                    ) : (
                      <Loader2 size={15} className="shrink-0 animate-spin text-sky-300" />
                    )}
                    {detailStatus.text}
                  </span>
                  {detailStatus.tone === 'error' && (
                    <button
                      type="button"
                      className="rounded-full border border-rose-300/40 px-3 py-1 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-300/10"
                      onClick={() =>
                        detailStatus.retry === 'refresh'
                          ? void reloadLeadDetailNow()
                          : void reloadLeadDetailNow()
                      }
                    >
                      Retry detail
                    </button>
                  )}
                </div>
              )}

              {leadDetailLoading && !activeLead ? (
                <LeadDetailSkeleton />
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Last offer
                      </div>
                      <div className="mt-2 text-lg font-semibold text-slate-100">
                        {money(
                          lastCall?.last_offer ||
                            getCallContext(activeLead).last_offer ||
                            getCallContext(activeLead).lastOffer
                        )}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Sentiment
                      </div>
                      <div className="mt-2 text-lg font-semibold text-slate-100">
                        {text(
                          lastCall?.sentiment || getCallContext(activeLead).sentiment,
                          'No data'
                        )}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Template
                      </div>
                      <div
                        className="mt-2 truncate text-sm font-semibold text-slate-100"
                        title={activeLeadTemplateName}
                      >
                        {activeLeadTemplateName}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Lead ID
                      </div>
                      <div className="mt-2 truncate text-sm font-semibold text-slate-100">
                        {activeLeadId}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">
                            Activity for this lead
                          </h3>
                          <p className="text-xs text-slate-500">
                            Documents, email sends, calls, and CRM edits attach here.
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {leadActivity.slice(0, 8).map((item, index) => (
                          <div
                            key={`${text(item.id, 'activity')}-${index}`}
                            className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-xs font-medium text-slate-200">
                                {text(item.actor, 'System')}
                              </div>
                              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                {text(item.category, 'Activity')} - {text(item.status, 'saved')}
                              </div>
                            </div>
                            <div className="mt-2 text-xs leading-relaxed text-slate-400">
                              {text(item.text, 'Runtime activity')}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-600">
                              {formatDate(item.at || item.createdAt)}
                            </div>
                          </div>
                        ))}
                        {!leadActivity.length && (
                          <div className="rounded-xl border border-dashed border-slate-800 px-3 py-5 text-center text-xs text-slate-500">
                            No lead-specific activity yet. PDF and contract actions will appear
                            after they are captured.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">
                            Live Call Details
                          </h3>
                          <p className="text-xs text-slate-500">
                            Latest transcript, sentiment, and offer memory.
                          </p>
                        </div>
                        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                          {lastCall?.call
                            ? text((lastCall.call as BridgeRecord).status, 'Call ended')
                            : 'No active call'}
                        </span>
                      </div>
                      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs leading-relaxed text-slate-300">
                        {text(
                          lastCall?.summary || getCallContext(activeLead).summary,
                          'No recent call summary captured yet.'
                        )}
                      </div>
                      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                        {Array.isArray(lastCall?.transcript) && lastCall.transcript.length ? (
                          (lastCall.transcript as BridgeRecord[]).slice(-8).map((line, index) => (
                            <div
                              key={text(line.id, `transcript-${index}`)}
                              className="rounded-lg bg-slate-950/60 px-3 py-2 text-xs text-slate-400"
                            >
                              <span className="font-semibold text-slate-300">
                                {text(line.speaker, 'Lead')}:{' '}
                              </span>
                              {text(line.text || line.body)}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-500">
                            Transcript will appear here after Telnyx/Deepgram call events are
                            attached.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center text-center text-sm text-slate-500">
              Select a lead to open the detail view.
            </div>
          )}
        </LeadsDetailShell>
      </div>

      {newLeadOpen && (
        <div className="pbk-new-lead-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-4">
          <form
            className={`${softPanelClass} pbk-new-lead-modal flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-pbk-lead-title"
            onSubmit={(event) => {
              event.preventDefault();
              void createLead();
            }}
          >
            <div className="pbk-new-lead-modal-header flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-4">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">
                  New PBK lead
                </div>
                <h3 id="new-pbk-lead-title" className="mt-1 text-xl font-semibold text-slate-100">
                  Capture the full seller profile once.
                </h3>
                <p className="mt-1 max-w-3xl text-xs text-slate-500">
                  Ava, Rex, approvals, analyzer, and contracts will all read this same bridge
                  record. Analyzer and path fields are prefilled when a current deal exists.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewLeadOpen(false)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
                aria-label="Close new lead form"
              >
                <X size={18} />
              </button>
            </div>

            <div className="pbk-new-lead-modal-body overflow-y-auto px-4 py-4">
              <div className="mb-4 flex flex-wrap gap-2">
                <PbkDataSource
                  endpoint="POST /api/leads"
                  status="ships"
                  note="create canonical seller portal"
                />
                <PbkDataSource
                  endpoint="localStorage:PBKAnalyzer"
                  status="ships"
                  note="deal/path seed only"
                />
                <PbkDataSource
                  endpoint="GET /api/leads/:id/full"
                  status="ships"
                  note="portal readback"
                />
              </div>

              {newLeadStatus && (
                <div
                  className={[
                    'mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
                    newLeadStatus.tone === 'error'
                      ? 'border-rose-400/30 bg-rose-500/10 text-rose-100'
                      : newLeadStatus.tone === 'success'
                        ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
                        : 'border-sky-500/20 bg-sky-500/10 text-sky-100',
                  ].join(' ')}
                  aria-live="polite"
                >
                  {newLeadStatus.tone === 'info' ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <AlertCircle size={15} />
                  )}
                  {newLeadStatus.text}
                </div>
              )}

              <div className="new-lead-portal-grid">
                <section className="new-lead-section">
                  <div className="new-lead-section-head">
                    <span>Seller</span>
                    <strong>Personal info</strong>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label="Seller name">
                      <input
                        className={inputClass}
                        value={newLeadForm.sellerName}
                        placeholder="Seller full name"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, sellerName: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Phone">
                      <input
                        className={inputClass}
                        type="tel"
                        value={newLeadForm.phone}
                        placeholder="+1 (555) 555-0199"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, phone: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Email">
                      <input
                        className={inputClass}
                        type="email"
                        value={newLeadForm.email}
                        placeholder="seller@example.com"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, email: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Preferred channel">
                      <select
                        className={inputClass}
                        value={newLeadForm.preferredChannel}
                        onChange={(event) =>
                          setNewLeadForm({
                            ...newLeadForm,
                            preferredChannel: event.target
                              .value as NewLeadFormState['preferredChannel'],
                          })
                        }
                      >
                        <option value="phone">Phone</option>
                        <option value="sms">SMS</option>
                        <option value="email">Email</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </Field>
                    <Field label="Best time to call">
                      <input
                        className={inputClass}
                        value={newLeadForm.bestTimeToCall}
                        placeholder="Weekdays after 3 PM"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, bestTimeToCall: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Relationship">
                      <select
                        className={inputClass}
                        value={newLeadForm.relationship}
                        onChange={(event) =>
                          setNewLeadForm({
                            ...newLeadForm,
                            relationship: event.target.value as NewLeadFormState['relationship'],
                          })
                        }
                      >
                        <option value="owner">Owner</option>
                        <option value="agent">Agent</option>
                        <option value="family">Family</option>
                        <option value="executor">Executor</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </Field>
                  </div>
                </section>

                <section className="new-lead-section">
                  <div className="new-lead-section-head">
                    <span>Property</span>
                    <strong>Address and asset details</strong>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <Field label="Property address">
                      <input
                        className={inputClass}
                        value={newLeadForm.propertyAddress}
                        placeholder="Property street address"
                        onChange={(event) =>
                          setNewLeadForm({
                            ...newLeadForm,
                            propertyAddress: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="City">
                      <input
                        className={inputClass}
                        value={newLeadForm.city}
                        placeholder="Columbus"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, city: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="State">
                      <input
                        className={inputClass}
                        value={newLeadForm.state}
                        placeholder="OH"
                        maxLength={2}
                        onChange={(event) =>
                          setNewLeadForm({
                            ...newLeadForm,
                            state: event.target.value.toUpperCase(),
                          })
                        }
                      />
                    </Field>
                    <Field label="ZIP">
                      <input
                        className={inputClass}
                        value={newLeadForm.zip}
                        placeholder="43215"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, zip: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Occupancy">
                      <select
                        className={inputClass}
                        value={newLeadForm.occupancy}
                        onChange={(event) =>
                          setNewLeadForm({
                            ...newLeadForm,
                            occupancy: event.target.value as NewLeadFormState['occupancy'],
                          })
                        }
                      >
                        <option value="unknown">Unknown</option>
                        <option value="owner_occupied">Owner occupied</option>
                        <option value="tenant_occupied">Tenant occupied</option>
                        <option value="vacant">Vacant</option>
                      </select>
                    </Field>
                    <Field label="Condition">
                      <select
                        className={inputClass}
                        value={newLeadForm.condition}
                        onChange={(event) =>
                          setNewLeadForm({
                            ...newLeadForm,
                            condition: event.target.value as NewLeadFormState['condition'],
                          })
                        }
                      >
                        <option value="unknown">Unknown</option>
                        <option value="light">Light</option>
                        <option value="moderate">Moderate</option>
                        <option value="heavy">Heavy</option>
                      </select>
                    </Field>
                  </div>
                </section>

                <section className="new-lead-section">
                  <div className="new-lead-section-head">
                    <span>Motivation</span>
                    <strong>Deal context</strong>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <Field label="Motivation">
                      <textarea
                        className={`${inputClass} min-h-24 resize-y`}
                        value={newLeadForm.motivation}
                        placeholder="Needs quick close, inherited property, tired landlord..."
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, motivation: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Timeline">
                      <input
                        className={inputClass}
                        value={newLeadForm.timeline}
                        placeholder="Unknown"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, timeline: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Asking price">
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        value={newLeadForm.askingPrice}
                        placeholder="$145,000"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, askingPrice: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Tags">
                      <input
                        className={inputClass}
                        value={newLeadForm.tags}
                        placeholder="probate, high-equity"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, tags: event.target.value })
                        }
                      />
                      <span className="mt-1 block text-[11px] text-slate-500">
                        Comma-separated tags. These persist on the lead record.
                      </span>
                    </Field>
                    <Field label="Lead source">
                      <input
                        className={inputClass}
                        value={newLeadForm.leadSource}
                        placeholder="manual-new-lead"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, leadSource: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Stage">
                      <select
                        className={inputClass}
                        value={newLeadForm.stage}
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, stage: event.target.value })
                        }
                      >
                        <option value="new">New</option>
                        <option value="contacted">Contacted</option>
                        <option value="qualified">Qualified</option>
                        <option value="contract_sent">Contract sent</option>
                        <option value="closed">Closed</option>
                      </select>
                    </Field>
                  </div>
                </section>

                <section className="new-lead-section">
                  <div className="new-lead-section-head">
                    <span>Compliance</span>
                    <strong>Safety checks</strong>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label="TCPA consent">
                      <select
                        className={inputClass}
                        value={newLeadForm.tcpaConsent}
                        onChange={(event) =>
                          setNewLeadForm({
                            ...newLeadForm,
                            tcpaConsent: event.target.value as NewLeadFormState['tcpaConsent'],
                          })
                        }
                      >
                        <option value="unknown">Unknown</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </Field>
                    <Field label="DNC status">
                      <select
                        className={inputClass}
                        value={newLeadForm.dncStatus}
                        onChange={(event) =>
                          setNewLeadForm({
                            ...newLeadForm,
                            dncStatus: event.target.value as NewLeadFormState['dncStatus'],
                          })
                        }
                      >
                        <option value="needs_review">Needs review</option>
                        <option value="clear">Clear</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </Field>
                  </div>
                </section>

                <section className="new-lead-section new-lead-section-wide">
                  <div className="new-lead-section-head">
                    <span>Advanced</span>
                    <strong>Numbers and assignments</strong>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    {[
                      ['Beds', 'beds', '3'],
                      ['Baths', 'baths', '2'],
                      ['Sq ft', 'sqft', '1540'],
                      ['Year built', 'yearBuilt', '1974'],
                      ['Est. repairs', 'estimatedRepairs', '$28,000'],
                      ['ARV', 'arv', '$220,000'],
                      ['MAO', 'mao', '$118,000'],
                      ['Mortgage balance', 'mortgageBalance', '$82,000'],
                      ['Lead score', 'leadScore', '78'],
                    ].map(([label, key, placeholder]) => (
                      <Field key={key} label={label}>
                        <input
                          className={inputClass}
                          value={String(newLeadForm[key as keyof NewLeadFormState] || '')}
                          placeholder={placeholder}
                          onChange={(event) =>
                            setNewLeadForm({ ...newLeadForm, [key]: event.target.value })
                          }
                        />
                      </Field>
                    ))}
                    <Field label="Assigned agent">
                      <input
                        className={inputClass}
                        value={newLeadForm.assignedAgent}
                        placeholder="Ava"
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, assignedAgent: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Field label="Seller notes">
                      <textarea
                        className={`${inputClass} min-h-24 resize-y`}
                        value={newLeadForm.sellerNotes}
                        placeholder="Anything Ava should know before the first call."
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, sellerNotes: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Internal notes">
                      <textarea
                        className={`${inputClass} min-h-24 resize-y`}
                        value={newLeadForm.internalNotes}
                        placeholder="Underwriting, comp, or disposition context."
                        onChange={(event) =>
                          setNewLeadForm({ ...newLeadForm, internalNotes: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                </section>
              </div>
            </div>

            <div className="pbk-new-lead-modal-footer flex flex-col gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[11px] text-slate-500">
                Source: Deal Analyzer seed + operator edits to bridge lead portal.
              </div>
              <div className="pbk-new-lead-modal-actions flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setNewLeadOpen(false)}
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLeadActionBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
                >
                  {isLeadActionBusy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plus size={15} />
                  )}
                  Create lead
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {editOpen && editForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div
            className={`${softPanelClass} flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">Edit Lead</h3>
                <p className="text-xs text-slate-500">
                  Correct CRM facts, BANT+, and Ava call memory.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Full name">
                  <input
                    className={inputClass}
                    value={editForm.name}
                    onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className={inputClass}
                    value={editForm.phone}
                    onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
                  />
                </Field>
                <Field label="Email">
                  <input
                    className={inputClass}
                    value={editForm.email}
                    onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                  />
                </Field>
                <Field label="Property address">
                  <input
                    className={inputClass}
                    value={editForm.address}
                    onChange={(event) => setEditForm({ ...editForm, address: event.target.value })}
                  />
                </Field>
                <Field label="Property type">
                  <select
                    className={inputClass}
                    value={editForm.propertyType}
                    onChange={(event) =>
                      setEditForm({ ...editForm, propertyType: event.target.value })
                    }
                  >
                    {PROPERTY_TYPES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Contract path">
                  <select
                    className={inputClass}
                    value={editForm.selectedPath}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        selectedPath: event.target.value as CanonicalPath,
                      })
                    }
                  >
                    {(Object.keys(PATH_LABELS) as CanonicalPath[]).map((path) => (
                      <option key={path} value={path}>
                        {PATH_LABELS[path]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Motivation score">
                  <input
                    className={inputClass}
                    type="number"
                    min="1"
                    max="10"
                    value={editForm.motivation}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        motivation: clampMotivationScore(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Tags">
                  <input
                    className={inputClass}
                    value={editForm.tags}
                    onChange={(event) => setEditForm({ ...editForm, tags: event.target.value })}
                  />
                </Field>
                <Field label="Agreed pricing / last offer">
                  <input
                    className={inputClass}
                    type="number"
                    value={editForm.lastOffer}
                    onChange={(event) =>
                      setEditForm({ ...editForm, lastOffer: event.target.value })
                    }
                  />
                </Field>
                <Field label="Sentiment">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={editForm.sentiment}
                    onChange={(event) =>
                      setEditForm({ ...editForm, sentiment: event.target.value })
                    }
                  />
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Field label="Notes">
                  <textarea
                    className={`${inputClass} min-h-28 resize-y`}
                    value={editForm.notes}
                    onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                  />
                </Field>
                <Field label="Call summary">
                  <textarea
                    className={`${inputClass} min-h-28 resize-y`}
                    value={editForm.summary}
                    onChange={(event) => setEditForm({ ...editForm, summary: event.target.value })}
                  />
                </Field>
              </div>
              <div className="mt-4 rounded-2xl border border-sky-400/15 bg-sky-400/5 p-3">
                <div className="mb-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300">
                    Compliance &amp; memory
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">
                    Human BANT+ fields
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    These fields save back into the bridge BANT record and Ava call metadata. No raw
                    JSON editing required.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Budget / price expectation">
                    <input
                      className={inputClass}
                      value={editForm.bantBudget}
                      placeholder="Seller wants $145,000 or needs payoff covered"
                      onChange={(event) =>
                        setEditForm({ ...editForm, bantBudget: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Authority / decision maker">
                    <input
                      className={inputClass}
                      value={editForm.bantAuthority}
                      placeholder="Owner, executor, spouse also signs..."
                      onChange={(event) =>
                        setEditForm({ ...editForm, bantAuthority: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Need / motivation">
                    <textarea
                      className={`${inputClass} min-h-24 resize-y`}
                      value={editForm.bantNeed}
                      placeholder="Inherited property, tired landlord, repairs, moving..."
                      onChange={(event) =>
                        setEditForm({ ...editForm, bantNeed: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Timeline / urgency">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        className={inputClass}
                        value={editForm.bantTimeline}
                        placeholder="Close in 14 days"
                        onChange={(event) =>
                          setEditForm({ ...editForm, bantTimeline: event.target.value })
                        }
                      />
                      <input
                        className={inputClass}
                        value={editForm.bantUrgency}
                        placeholder="High, medium, low"
                        onChange={(event) =>
                          setEditForm({ ...editForm, bantUrgency: event.target.value })
                        }
                      />
                    </div>
                  </Field>
                  <Field label="Primary objection">
                    <input
                      className={inputClass}
                      value={editForm.bantObjection}
                      placeholder="Price, trust, spouse, timing..."
                      onChange={(event) =>
                        setEditForm({ ...editForm, bantObjection: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Next step">
                    <input
                      className={inputClass}
                      value={editForm.bantNextStep}
                      placeholder="Send docs, call Friday, verify title..."
                      onChange={(event) =>
                        setEditForm({ ...editForm, bantNextStep: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLeadActionBusy}
                onClick={saveLead}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
              >
                {isLeadActionBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={15} />
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {contractOpen && contractForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div
            className={`${softPanelClass} flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">Send Contract</h3>
                <p className="text-xs text-slate-500">
                  Path-aware DocuSign routing with fixed signer order.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setContractConfirmOpen(false);
                  setContractOpen(false);
                }}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-100">
                <div className="font-semibold">{PATH_LABELS[contractForm.path]} selected</div>
                <div className="mt-1">
                  Template: <span className="font-mono">{contractForm.templateName}</span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Path">
                  <select
                    className={inputClass}
                    value={contractForm.path}
                    onChange={(event) => {
                      const path = event.target.value as CanonicalPath;
                      setContractForm({
                        ...contractForm,
                        path,
                        templateName: TEMPLATE_NAMES[path],
                        slot2Name: path === 'rbp' ? 'RBP Manager' : 'Probono Key Realty',
                      });
                    }}
                  >
                    {(Object.keys(PATH_LABELS) as CanonicalPath[]).map((path) => (
                      <option key={path} value={path}>
                        {PATH_LABELS[path]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Template">
                  <input
                    className={`${inputClass} font-mono`}
                    readOnly
                    value={contractForm.templateName}
                  />
                </Field>
                <Field label="1. Buyer Signer 1">
                  <input className={inputClass} readOnly value="Probono Key Realty" />
                </Field>
                <Field label="Signer 1 email">
                  <input className={inputClass} readOnly value="info@probonokeyrealty.com" />
                </Field>
                <Field label="2. Buyer Signer 2 / RBP Manager">
                  <input
                    className={inputClass}
                    value={contractForm.slot2Name}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, slot2Name: event.target.value })
                    }
                  />
                </Field>
                <Field label="Signer 2 email">
                  <input
                    className={inputClass}
                    type="email"
                    value={contractForm.slot2Email}
                    aria-invalid={Boolean(
                      contractForm.slot2Email && !isValidEmail(contractForm.slot2Email)
                    )}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, slot2Email: event.target.value })
                    }
                  />
                </Field>
                <Field label="3. Seller 1 name">
                  <input
                    className={inputClass}
                    value={contractForm.seller1Name}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, seller1Name: event.target.value })
                    }
                  />
                </Field>
                <Field label="Seller 1 email">
                  <input
                    className={inputClass}
                    type="email"
                    required
                    value={contractForm.seller1Email}
                    aria-invalid={Boolean(seller1EmailError)}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, seller1Email: event.target.value })
                    }
                  />
                  {seller1EmailError && (
                    <span className="mt-1 flex items-center gap-1.5 text-[11px] text-rose-300">
                      <AlertCircle size={12} />
                      {seller1EmailError}
                    </span>
                  )}
                </Field>
                <Field label="4. Seller 2 name">
                  <input
                    className={inputClass}
                    value={contractForm.seller2Name}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, seller2Name: event.target.value })
                    }
                  />
                </Field>
                <Field label="Seller 2 email">
                  <input
                    className={inputClass}
                    type="email"
                    value={contractForm.seller2Email}
                    aria-invalid={Boolean(
                      contractForm.seller2Email && !isValidEmail(contractForm.seller2Email)
                    )}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, seller2Email: event.target.value })
                    }
                  />
                </Field>
                <Field label="Offer amount">
                  <input
                    className={inputClass}
                    type="number"
                    value={contractForm.amount}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, amount: event.target.value })
                    }
                  />
                </Field>
                <Field label="Timeline">
                  <input
                    className={inputClass}
                    value={contractForm.timeline}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, timeline: event.target.value })
                    }
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Internal notes">
                  <textarea
                    className={`${inputClass} min-h-24 resize-y`}
                    value={contractForm.notes}
                    onChange={(event) =>
                      setContractForm({ ...contractForm, notes: event.target.value })
                    }
                  />
                </Field>
              </div>
              {(contractStatus || contractLiveValidation) && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-xs text-slate-300">
                  {contractLiveValidation || /(failed|required|valid)/i.test(contractStatus) ? (
                    <AlertCircle size={15} className="mt-0.5 text-amber-300" />
                  ) : (
                    <CheckCircle2 size={15} className="mt-0.5 text-emerald-300" />
                  )}
                  <span>{contractLiveValidation || contractStatus}</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setContractConfirmOpen(false);
                  setContractOpen(false);
                }}
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLeadActionBusy || Boolean(contractLiveValidation)}
                onClick={requestContractSend}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
              >
                {isLeadActionBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={15} />
                )}
                Send via DocuSign
              </button>
            </div>
          </div>
        </div>
      )}

      {quickSmsDraft && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lead-quick-sms-title"
            className={`${softPanelClass} w-full max-w-lg overflow-hidden`}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300">
                  Manual SMS
                </div>
                <h3 id="lead-quick-sms-title" className="mt-2 text-lg font-semibold text-slate-100">
                  Text {quickSmsDraft.sellerName}
                </h3>
                <p className="mt-1 text-xs text-slate-400">{quickSmsDraft.phone}</p>
              </div>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full border border-slate-700 text-slate-300"
                onClick={() => setQuickSmsDraft(null)}
                aria-label="Close SMS composer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4">
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Message
                <textarea
                  className={`${inputClass} min-h-32 resize-y normal-case tracking-normal`}
                  value={quickSmsDraft.body}
                  onChange={(event) =>
                    setQuickSmsDraft((current) =>
                      current ? { ...current, body: event.target.value } : current
                    )
                  }
                  autoFocus
                />
              </label>
              <p className="mt-2 text-xs text-slate-500">
                Human-sent SMS uses the manual bridge lane. Provider failures are shown immediately
                and can be retried without hiding the outcome.
              </p>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-800 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setQuickSmsDraft(null)}
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLeadActionBusy || !quickSmsDraft.body.trim()}
                onClick={() => void sendQuickSms()}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
              >
                {leadActionPending === `sms:${quickSmsDraft.leadId}` ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={15} />
                )}
                Send SMS
              </button>
            </div>
          </div>
        </div>
      )}

      {leadCallConfirmDraft && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="lead-call-confirm-title"
            className={`${softPanelClass} w-full max-w-md p-5`}
          >
            <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300">
              Call confirmation
            </div>
            <h3 id="lead-call-confirm-title" className="mt-2 text-lg font-semibold text-slate-100">
              Place this call?
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              PBK will ask the bridge to dial this seller through the Telnyx call lane.
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-300">
              <div className="font-semibold text-slate-100">{leadCallConfirmDraft.sellerName}</div>
              <div className="mt-1">{leadCallConfirmDraft.address}</div>
              <div className="mt-2 text-xs text-slate-400">{leadCallConfirmDraft.phone}</div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setLeadCallConfirmDraft(null)}
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLeadActionBusy}
                onClick={() => {
                  void executeLeadCall();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
              >
                <Phone size={15} /> Confirm and Call
              </button>
            </div>
          </div>
        </div>
      )}

      {contractConfirmOpen && contractForm && activeLead && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="contract-confirm-title"
            className={`${softPanelClass} w-full max-w-md p-5`}
          >
            <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
              Final DocuSign check
            </div>
            <h3 id="contract-confirm-title" className="mt-2 text-lg font-semibold text-slate-100">
              Confirm contract send
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              PBK cannot undo this provider send after DocuSign accepts it. Confirm the signer email
              and lead phone before continuing.
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-300">
              <div className="font-semibold text-slate-100">{PATH_LABELS[contractForm.path]}</div>
              <div className="mt-1">
                {getSellerName(activeLead)} / {getLeadAddress(activeLead)}
              </div>
              <div className="mt-2 text-xs text-slate-400">
                {contractForm.seller1Email} / {getLeadPhone(activeLead)}
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setContractConfirmOpen(false)}
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLeadActionBusy}
                onClick={() => {
                  void sendContract();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
              >
                <Send size={15} /> Confirm and Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
