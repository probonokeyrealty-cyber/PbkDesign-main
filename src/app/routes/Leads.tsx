import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  FileSignature,
  Mail,
  Phone,
  RefreshCw,
  Save,
  Send,
  X,
} from 'lucide-react';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  fetchLeadFullRequest,
  fetchLeadLastCallRequest,
  patchLeadRequest,
  sendLeadContractRequest,
} from '../utils/runtimeBridge';

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
  bant: string;
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
  return String(value ?? fallback).trim();
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
  const property = getProperty(lead);
  return text(lead.leadId || lead.id || lead.externalId || property.address, 'unsaved-lead');
}

function getSeller(lead: BridgeRecord): BridgeRecord {
  return (lead.seller && typeof lead.seller === 'object' ? lead.seller : {}) as BridgeRecord;
}

function getProperty(lead: BridgeRecord): BridgeRecord {
  return (lead.property && typeof lead.property === 'object' ? lead.property : {}) as BridgeRecord;
}

function getCallContext(lead: BridgeRecord): BridgeRecord {
  const primary = lead.callContext && typeof lead.callContext === 'object' ? lead.callContext : {};
  const fallback = lead.call_context && typeof lead.call_context === 'object' ? lead.call_context : {};
  return { ...(fallback as BridgeRecord), ...(primary as BridgeRecord) };
}

function getSellerName(lead: BridgeRecord) {
  const seller = getSeller(lead);
  return text(lead.name || seller.name || lead.leadName, 'Unknown seller');
}

function getLeadEmail(lead: BridgeRecord) {
  const seller = getSeller(lead);
  return text(lead.email || seller.email);
}

function getLeadPhone(lead: BridgeRecord) {
  const seller = getSeller(lead);
  return text(lead.phone || seller.phone);
}

function getLeadAddress(lead: BridgeRecord) {
  const property = getProperty(lead);
  return text(lead.address || property.address, 'No property');
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
  if (raw.includes('mortgage') || raw.includes('subject') || /\bmt\b/.test(raw) || raw.includes('subto')) return 'mt';
  if (raw.includes('land') || raw.includes('parcel') || raw.includes('lot')) return 'land';

  const property = getProperty(lead || {});
  if (/land|parcel|lot/i.test([property.propertyType, property.type, property.address].filter(Boolean).join(' '))) {
    return 'land';
  }

  return 'cash';
}

function formFromLead(lead: BridgeRecord): LeadFormState {
  const seller = getSeller(lead);
  const property = getProperty(lead);
  const callContext = getCallContext(lead);
  const bant = lead.bant && typeof lead.bant === 'object' ? lead.bant : {};
  return {
    name: text(lead.name || seller.name),
    phone: text(lead.phone || seller.phone),
    email: text(lead.email || seller.email),
    address: text(lead.address || property.address),
    propertyType: text(lead.property_type || property.propertyType || property.type, 'Single Family'),
    motivation: text(lead.motivation_score || lead.motivationScore || lead.score || ''),
    tags: Array.isArray(lead.tags) ? lead.tags.map(String).join(', ') : text(lead.tags),
    notes: text(lead.notes),
    selectedPath: normalizePath(lead.selected_path || lead.selectedPath, lead),
    lastOffer: text(callContext.last_offer || callContext.lastOffer),
    sentiment: text(callContext.sentiment || callContext.sentimentScore),
    summary: text(callContext.summary || callContext.callSummary),
    bant: JSON.stringify(bant, null, 2),
  };
}

function contractFormFromLead(lead: BridgeRecord, lastCall?: BridgeRecord | null): ContractFormState {
  const path = normalizePath(lead.selected_path || lead.selectedPath, lead);
  const callContext = getCallContext(lead);
  const property = getProperty(lead);
  const motivation = lead.motivation && typeof lead.motivation === 'object' ? lead.motivation as BridgeRecord : {};
  const lastOffer = lastCall?.last_offer || lastCall?.lastOffer || callContext.last_offer || callContext.lastOffer;
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
  return (response.lead && typeof response.lead === 'object' ? response.lead : response) as BridgeRecord;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-xs text-slate-400">
      <span className="font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20';

const softPanelClass = 'rounded-2xl border border-slate-800 bg-slate-950/95 shadow-[0_18px_60px_rgba(2,6,23,0.22)]';

export function Leads() {
  const { snapshot, loading, error, refresh } = useRuntimeSnapshot();
  const leads = Array.isArray(snapshot?.leadImports) ? snapshot.leadImports as BridgeRecord[] : [];
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [leadDetail, setLeadDetail] = useState<BridgeRecord | null>(null);
  const [lastCall, setLastCall] = useState<BridgeRecord | null>(null);
  const [detailStatus, setDetailStatus] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [editForm, setEditForm] = useState<LeadFormState | null>(null);
  const [contractForm, setContractForm] = useState<ContractFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [contractStatus, setContractStatus] = useState('');

  const selectedLead = useMemo(
    () => leads.find((lead) => getLeadId(lead) === selectedLeadId) || leads[0] || null,
    [leads, selectedLeadId],
  );
  const activeLead = leadDetail || selectedLead;
  const activeLeadId = activeLead ? getLeadId(activeLead) : '';
  const leadActivity = Array.isArray(activeLead?.activity)
    ? activeLead.activity as BridgeRecord[]
    : Array.isArray(snapshot?.activity)
      ? (snapshot.activity as BridgeRecord[]).filter((item) => {
          const haystack = [item.leadId, item.leadName, item.target, item.text].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(activeLeadId.toLowerCase()) || haystack.includes(getLeadAddress(activeLead || {}).toLowerCase().split(',')[0]);
        })
      : [];

  useEffect(() => {
    if (!selectedLeadId && leads[0]) setSelectedLeadId(getLeadId(leads[0]));
  }, [leads, selectedLeadId]);

  useEffect(() => {
    if (!selectedLeadId) return;
    let cancelled = false;
    const loadDetail = async () => {
      setDetailStatus('Loading lead detail...');
      try {
        const [fullResponse, callResponse] = await Promise.all([
          fetchLeadFullRequest(selectedLeadId),
          fetchLeadLastCallRequest(selectedLeadId).catch(() => null),
        ]);
        if (cancelled) return;
        const lead = unwrapLeadResponse(fullResponse);
        setLeadDetail(lead);
        setLastCall(callResponse as BridgeRecord | null);
        setDetailStatus('Lead synced from bridge.');
      } catch (nextError) {
        if (cancelled) return;
        setLeadDetail(selectedLead || null);
        setLastCall(null);
        setDetailStatus(nextError instanceof Error ? `Bridge detail unavailable: ${nextError.message}` : 'Bridge detail unavailable.');
      }
    };
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedLeadId]);

  const reloadLeadDetail = async () => {
    if (!selectedLeadId) return;
    setDetailStatus('Refreshing lead detail...');
    try {
      const [fullResponse, callResponse] = await Promise.all([
        fetchLeadFullRequest(selectedLeadId),
        fetchLeadLastCallRequest(selectedLeadId).catch(() => null),
      ]);
      setLeadDetail(unwrapLeadResponse(fullResponse));
      setLastCall(callResponse as BridgeRecord | null);
      setDetailStatus('Lead refreshed.');
      await refresh().catch(() => null);
    } catch (nextError) {
      setDetailStatus(nextError instanceof Error ? `Refresh failed: ${nextError.message}` : 'Refresh failed.');
    }
  };

  const openEditModal = () => {
    if (!activeLead) return;
    setEditForm(formFromLead(activeLead));
    setEditOpen(true);
  };

  const openContractModal = () => {
    if (!activeLead) return;
    setContractForm(contractFormFromLead(activeLead, lastCall));
    setContractStatus('');
    setContractOpen(true);
  };

  const saveLead = async () => {
    if (!editForm || !activeLeadId) return;
    setSaving(true);
    try {
      let bant: BridgeRecord = {};
      if (editForm.bant.trim()) {
        bant = JSON.parse(editForm.bant);
      }
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
        actor: 'Lead Detail',
      });
      const lead = unwrapLeadResponse(response);
      setLeadDetail(lead);
      setEditOpen(false);
      setDetailStatus('Lead saved to bridge.');
      await refresh().catch(() => null);
    } catch (nextError) {
      setDetailStatus(nextError instanceof Error ? `Save failed: ${nextError.message}` : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const sendContract = async () => {
    if (!contractForm || !activeLead) return;
    if (!contractForm.seller1Email.trim()) {
      setContractStatus('Seller 1 email is required before DocuSign can be queued.');
      return;
    }
    setSaving(true);
    setContractStatus('Preparing path-aware contract request...');
    try {
      const signers = [
        { roleName: 'Signer1', recipientId: '1', routingOrder: '1', name: 'Probono Key Realty', email: 'info@probonokeyrealty.com' },
        { roleName: 'Signer2', recipientId: '2', routingOrder: '2', name: contractForm.slot2Name || 'Probono Key Realty', email: contractForm.slot2Email || 'info@probonokeyrealty.com' },
        { roleName: 'Signer3', recipientId: '3', routingOrder: '3', name: contractForm.seller1Name || 'Seller 1', email: contractForm.seller1Email },
        ...(contractForm.seller2Email
          ? [{ roleName: 'Signer4', recipientId: '4', routingOrder: '4', name: contractForm.seller2Name || 'Seller 2', email: contractForm.seller2Email }]
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
      const contract = response.contract && typeof response.contract === 'object' ? response.contract as BridgeRecord : {};
      const result = String(response.result || response.outcome || contract.status || '').toLowerCase();
      setContractStatus(
        result === 'queued_for_approval'
          ? 'Queued for approval. Ava can continue after approval.'
          : response.ok === false
            ? text(response.error, 'Contract request failed.')
            : 'Contract request captured. Activity is attached to this lead.',
      );
      await Promise.all([reloadLeadDetail(), refresh().catch(() => null)]);
    } catch (nextError) {
      setContractStatus(nextError instanceof Error ? `Contract failed: ${nextError.message}` : 'Contract failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Leads</h1>
          <p className="text-sm text-slate-400">
            Lead detail, live call context, CRM corrections, and one-click path-aware contracts.
          </p>
        </div>
        <div className="text-xs text-slate-500">
          {loading ? 'Loading leads...' : error || `${leads.length} lead records in the bridge`}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_1fr]">
        <section className={`${softPanelClass} overflow-hidden`}>
          <div className="border-b border-slate-800 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Pipeline leads</div>
            <div className="mt-1 text-sm text-slate-300">Tap a lead to load detail.</div>
          </div>
          <div className="max-h-[68vh] divide-y divide-slate-800 overflow-y-auto">
            {leads.slice(0, 40).map((lead) => {
              const id = getLeadId(lead);
              const isSelected = id === activeLeadId;
              const path = normalizePath(lead.selected_path || lead.selectedPath, lead);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedLeadId(id)}
                  className={[
                    'grid w-full grid-cols-1 gap-2 px-4 py-4 text-left transition md:grid-cols-[1fr_auto]',
                    isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-900',
                  ].join(' ')}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {getSellerName(lead)}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-400">
                      {getLeadAddress(lead)}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span>{getLeadPhone(lead) || getLeadEmail(lead) || 'No contact captured'}</span>
                      <span>Source: {text(lead.source, 'manual')}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2 md:justify-end">
                    <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                      {PATH_LABELS[path]}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatDate(lead.updatedAt || lead.createdAt)}
                    </span>
                  </span>
                </button>
              );
            })}
            {!leads.length && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No bridge leads loaded yet.
              </div>
            )}
          </div>
        </section>

        <section className={`${softPanelClass} min-h-[520px] p-4 md:p-5`}>
          {activeLead ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-2xl font-semibold text-slate-100">
                      {getSellerName(activeLead)}
                    </h2>
                    <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300">
                      {PATH_LABELS[normalizePath(activeLead.selected_path || activeLead.selectedPath, activeLead)]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{getLeadAddress(activeLead)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Phone size={13} />{getLeadPhone(activeLead) || 'No phone'}</span>
                    <span className="inline-flex items-center gap-1"><Mail size={13} />{getLeadEmail(activeLead) || 'No email'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={reloadLeadDetail}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-sky-400 hover:text-sky-200"
                  >
                    <RefreshCw size={14} /> Refresh
                  </button>
                  <button
                    type="button"
                    onClick={openEditModal}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-sky-400 hover:text-sky-200"
                  >
                    <Edit3 size={14} /> Edit Lead
                  </button>
                  <button
                    type="button"
                    onClick={openContractModal}
                    className="inline-flex items-center gap-2 rounded-full bg-sky-400 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-300"
                  >
                    <FileSignature size={14} /> Send Contract
                  </button>
                </div>
              </div>

              {detailStatus && (
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                  {detailStatus}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Last offer</div>
                  <div className="mt-2 text-lg font-semibold text-slate-100">
                    {money(lastCall?.last_offer || getCallContext(activeLead).last_offer || getCallContext(activeLead).lastOffer)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Sentiment</div>
                  <div className="mt-2 text-lg font-semibold text-slate-100">
                    {text(lastCall?.sentiment || getCallContext(activeLead).sentiment, 'No data')}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Template</div>
                  <div className="mt-2 truncate text-sm font-semibold text-slate-100">
                    {TEMPLATE_NAMES[normalizePath(activeLead.selected_path || activeLead.selectedPath, activeLead)]}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Lead ID</div>
                  <div className="mt-2 truncate text-sm font-semibold text-slate-100">{activeLeadId}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-100">Activity for this lead</h3>
                      <p className="text-xs text-slate-500">Documents, email sends, calls, and CRM edits attach here.</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {leadActivity.slice(0, 8).map((item, index) => (
                      <div
                        key={`${text(item.id, 'activity')}-${index}`}
                        className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-medium text-slate-200">{text(item.actor, 'System')}</div>
                          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            {text(item.category, 'Activity')} - {text(item.status, 'saved')}
                          </div>
                        </div>
                        <div className="mt-2 text-xs leading-relaxed text-slate-400">{text(item.text, 'Runtime activity')}</div>
                        <div className="mt-1 text-[11px] text-slate-600">{formatDate(item.at || item.createdAt)}</div>
                      </div>
                    ))}
                    {!leadActivity.length && (
                      <div className="rounded-xl border border-dashed border-slate-800 px-3 py-5 text-center text-xs text-slate-500">
                        No lead-specific activity yet. PDF and contract actions will appear after they are captured.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-100">Live Call Details</h3>
                      <p className="text-xs text-slate-500">Latest transcript, sentiment, and offer memory.</p>
                    </div>
                    <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                      {lastCall?.call ? text((lastCall.call as BridgeRecord).status, 'Call ended') : 'No active call'}
                    </span>
                  </div>
                  <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs leading-relaxed text-slate-300">
                    {text(lastCall?.summary || getCallContext(activeLead).summary, 'No recent call summary captured yet.')}
                  </div>
                  <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                    {Array.isArray(lastCall?.transcript) && lastCall.transcript.length ? (
                      (lastCall.transcript as BridgeRecord[]).slice(-8).map((line, index) => (
                        <div key={text(line.id, `transcript-${index}`)} className="rounded-lg bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
                          <span className="font-semibold text-slate-300">{text(line.speaker, 'Lead')}: </span>
                          {text(line.text || line.body)}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-500">
                        Transcript will appear here after Telnyx/Deepgram call events are attached.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center text-center text-sm text-slate-500">
              Select a lead to open the detail view.
            </div>
          )}
        </section>
      </div>

      {editOpen && editForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className={`${softPanelClass} flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">Edit Lead</h3>
                <p className="text-xs text-slate-500">Correct CRM facts, BANT+, and Ava call memory.</p>
              </div>
              <button type="button" onClick={() => setEditOpen(false)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Full name"><input className={inputClass} value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></Field>
                <Field label="Phone"><input className={inputClass} value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} /></Field>
                <Field label="Email"><input className={inputClass} value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} /></Field>
                <Field label="Property address"><input className={inputClass} value={editForm.address} onChange={(event) => setEditForm({ ...editForm, address: event.target.value })} /></Field>
                <Field label="Property type">
                  <select className={inputClass} value={editForm.propertyType} onChange={(event) => setEditForm({ ...editForm, propertyType: event.target.value })}>
                    {PROPERTY_TYPES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="Selected path">
                  <select className={inputClass} value={editForm.selectedPath} onChange={(event) => setEditForm({ ...editForm, selectedPath: event.target.value as CanonicalPath })}>
                    {(Object.keys(PATH_LABELS) as CanonicalPath[]).map((path) => <option key={path} value={path}>{PATH_LABELS[path]}</option>)}
                  </select>
                </Field>
                <Field label="Motivation score"><input className={inputClass} type="number" min="1" max="10" value={editForm.motivation} onChange={(event) => setEditForm({ ...editForm, motivation: event.target.value })} /></Field>
                <Field label="Tags"><input className={inputClass} value={editForm.tags} onChange={(event) => setEditForm({ ...editForm, tags: event.target.value })} /></Field>
                <Field label="Last offer"><input className={inputClass} type="number" value={editForm.lastOffer} onChange={(event) => setEditForm({ ...editForm, lastOffer: event.target.value })} /></Field>
                <Field label="Sentiment"><input className={inputClass} type="number" min="0" max="1" step="0.01" value={editForm.sentiment} onChange={(event) => setEditForm({ ...editForm, sentiment: event.target.value })} /></Field>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Field label="Notes">
                  <textarea className={`${inputClass} min-h-28 resize-y`} value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })} />
                </Field>
                <Field label="Call summary">
                  <textarea className={`${inputClass} min-h-28 resize-y`} value={editForm.summary} onChange={(event) => setEditForm({ ...editForm, summary: event.target.value })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="BANT+ JSON">
                  <textarea className={`${inputClass} min-h-40 resize-y font-mono text-xs`} value={editForm.bant} onChange={(event) => setEditForm({ ...editForm, bant: event.target.value })} />
                </Field>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setEditOpen(false)} className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={saveLead} className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60">
                <Save size={15} /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {contractOpen && contractForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className={`${softPanelClass} flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">Send Contract</h3>
                <p className="text-xs text-slate-500">Path-aware DocuSign routing with fixed signer order.</p>
              </div>
              <button type="button" onClick={() => setContractOpen(false)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-100">
                <div className="font-semibold">{PATH_LABELS[contractForm.path]} selected</div>
                <div className="mt-1">Template: <span className="font-mono">{contractForm.templateName}</span></div>
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
                    {(Object.keys(PATH_LABELS) as CanonicalPath[]).map((path) => <option key={path} value={path}>{PATH_LABELS[path]}</option>)}
                  </select>
                </Field>
                <Field label="Template"><input className={`${inputClass} font-mono`} readOnly value={contractForm.templateName} /></Field>
                <Field label="1. Buyer Signer 1"><input className={inputClass} readOnly value="Probono Key Realty" /></Field>
                <Field label="Signer 1 email"><input className={inputClass} readOnly value="info@probonokeyrealty.com" /></Field>
                <Field label="2. Buyer Signer 2 / RBP Manager"><input className={inputClass} value={contractForm.slot2Name} onChange={(event) => setContractForm({ ...contractForm, slot2Name: event.target.value })} /></Field>
                <Field label="Signer 2 email"><input className={inputClass} value={contractForm.slot2Email} onChange={(event) => setContractForm({ ...contractForm, slot2Email: event.target.value })} /></Field>
                <Field label="3. Seller 1 name"><input className={inputClass} value={contractForm.seller1Name} onChange={(event) => setContractForm({ ...contractForm, seller1Name: event.target.value })} /></Field>
                <Field label="Seller 1 email"><input className={inputClass} value={contractForm.seller1Email} onChange={(event) => setContractForm({ ...contractForm, seller1Email: event.target.value })} /></Field>
                <Field label="4. Seller 2 name"><input className={inputClass} value={contractForm.seller2Name} onChange={(event) => setContractForm({ ...contractForm, seller2Name: event.target.value })} /></Field>
                <Field label="Seller 2 email"><input className={inputClass} value={contractForm.seller2Email} onChange={(event) => setContractForm({ ...contractForm, seller2Email: event.target.value })} /></Field>
                <Field label="Offer amount"><input className={inputClass} type="number" value={contractForm.amount} onChange={(event) => setContractForm({ ...contractForm, amount: event.target.value })} /></Field>
                <Field label="Timeline"><input className={inputClass} value={contractForm.timeline} onChange={(event) => setContractForm({ ...contractForm, timeline: event.target.value })} /></Field>
              </div>
              <div className="mt-3">
                <Field label="Internal notes"><textarea className={`${inputClass} min-h-24 resize-y`} value={contractForm.notes} onChange={(event) => setContractForm({ ...contractForm, notes: event.target.value })} /></Field>
              </div>
              {contractStatus && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-xs text-slate-300">
                  {contractStatus.includes('failed') || contractStatus.includes('required') ? <AlertCircle size={15} className="mt-0.5 text-amber-300" /> : <CheckCircle2 size={15} className="mt-0.5 text-emerald-300" />}
                  <span>{contractStatus}</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setContractOpen(false)} className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={sendContract} className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60">
                <Send size={15} /> Send via DocuSign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
