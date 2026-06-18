import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Save, StickyNote } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PbkDataSource } from '../../components/pbk/index';
import { LeadPortalContactability } from '../components/leads/LeadPortalContactability';
import { LeadPortalDealContext } from '../components/leads/LeadPortalDealContext';
import { LeadPortalHeader } from '../components/leads/LeadPortalHeader';
import { LeadPortalOverview } from '../components/leads/LeadPortalOverview';
import { LeadPortalProperty } from '../components/leads/LeadPortalProperty';
import { LeadPortalTimeline } from '../components/leads/LeadPortalTimeline';
import {
  buildLeadPortalModel,
  buildLeadPortalPatch,
  createLeadPortalDraft,
  type BridgeRecord,
  type LeadPortalDraft,
  type LeadPortalModel,
} from '../components/leads/leadPortalModel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  fetchConversationTimelineRequest,
  fetchConversationsRequest,
  fetchLeadFullRequest,
  deleteLeadRequest,
  patchLeadRequest,
  saveLeadNoteRequest,
  sendLeadContractRequest,
  startLeadCallRequest,
  type ConversationEvent,
  type ConversationThread,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

const TIMELINE_PAGE_SIZE = 80;
const PATH_TEMPLATE_NAMES: Record<string, string> = {
  cash: 'PBK_Cash_Offer_v1',
  rbp: 'PBK_RBP_v1',
  cf: 'PBK_Creative_Finance_v1',
  mt: 'PBK_Mortgage_Takeover_v1',
  land: 'PBK_Land_v1',
};

function unwrapLead(response: BridgeRecord) {
  return response.lead && typeof response.lead === 'object'
    ? (response.lead as BridgeRecord)
    : response;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isCallablePhone(value: string) {
  return value.replace(/\D/g, '').length >= 10;
}

type PortalAction = 'call' | 'contract' | 'delete' | '';

type FieldProps = {
  label: string;
  value: string;
  type?: 'text' | 'email' | 'number';
  multiline?: boolean;
  onChange: (value: string) => void;
};

function PortalField({ label, value, type = 'text', multiline = false, onChange }: FieldProps) {
  return (
    <label className={multiline ? 'wide' : ''}>
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} />
      ) : (
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function PortalSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LeadPortal() {
  const { leadId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestSequence = useRef(0);
  const timelineRequestSequence = useRef(0);
  const timelineThreadIdRef = useRef('');
  const currentLeadIdRef = useRef(leadId);
  const actionSequence = useRef(0);
  const editRequestHandled = useRef('');
  const [leadPayload, setLeadPayload] = useState<BridgeRecord | null>(null);
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [timelineError, setTimelineError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<LeadPortalDraft | null>(null);
  const [draftLeadId, setDraftLeadId] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const [confirmAction, setConfirmAction] = useState<PortalAction>('');

  const lead = useMemo<LeadPortalModel | null>(
    () => (leadPayload ? buildLeadPortalModel(leadPayload) : null),
    [leadPayload]
  );
  currentLeadIdRef.current = leadId;

  const beginAction = (name: string) => {
    const token = ++actionSequence.current;
    setPendingAction(name);
    return token;
  };

  const finishAction = (token: number) => {
    if (token === actionSequence.current) setPendingAction('');
  };

  const loadTimeline = useCallback(
    async (
      selectedThread: ConversationThread,
      { cursor = '', append = false }: { cursor?: string; append?: boolean } = {}
    ) => {
      const timelineRequestId = ++timelineRequestSequence.current;
      const requestedThreadId = selectedThread.id;
      timelineThreadIdRef.current = requestedThreadId;
      if (append) {
        setTimelineLoadingMore(true);
      } else {
        setTimelineLoading(true);
      }
      if (!append) setTimelineError('');
      try {
        const response = await fetchConversationTimelineRequest(selectedThread.id, {
          cursor,
          limit: TIMELINE_PAGE_SIZE,
        });
        if (
          timelineRequestId !== timelineRequestSequence.current ||
          requestedThreadId !== timelineThreadIdRef.current
        ) {
          return;
        }
        setEvents((current) => {
          if (!append) return response.items || [];
          const merged = new Map(current.map((event) => [event.id, event]));
          for (const event of response.items || []) merged.set(event.id, event);
          return [...merged.values()];
        });
        setTimelineCursor(response.nextCursor || null);
      } catch (nextError) {
        if (timelineRequestId !== timelineRequestSequence.current) return;
        setTimelineError(
          nextError instanceof Error
            ? nextError.message
            : 'Unable to load the unified seller timeline.'
        );
      } finally {
        if (timelineRequestId === timelineRequestSequence.current) {
          setTimelineLoading(false);
          setTimelineLoadingMore(false);
        }
      }
    },
    []
  );

  const loadPortal = useCallback(async () => {
    if (!leadId) return;
    const requestId = ++requestSequence.current;
    timelineRequestSequence.current += 1;
    timelineThreadIdRef.current = '';
    setLoading(true);
    setError('');
    setTimelineError('');
    try {
      const fullResponse = await fetchLeadFullRequest(leadId);
      if (fullResponse.ok === false) {
        throw new Error(String(fullResponse.error || 'The bridge did not return this lead.'));
      }
      if (requestId !== requestSequence.current) return;
      const canonicalLead = unwrapLead(fullResponse);
      const canonicalLeadId = String(canonicalLead.leadId || canonicalLead.id || leadId).trim();
      if (canonicalLeadId && canonicalLeadId !== leadId) {
        navigate(`/leads/${encodeURIComponent(canonicalLeadId)}`, { replace: true });
        return;
      }
      const conversationResponse = await fetchConversationsRequest({
        leadId: canonicalLeadId || leadId,
        limit: 2,
      }).catch(() => null);
      if (requestId !== requestSequence.current) return;
      setLeadPayload(fullResponse);
      const selectedThread =
        conversationResponse?.items?.find(
          (candidate) => candidate.leadId === (canonicalLeadId || leadId)
        ) ||
        conversationResponse?.items?.[0] ||
        null;
      setThread(selectedThread);
      if (selectedThread) {
        await loadTimeline(selectedThread);
      } else {
        setEvents([]);
        setTimelineCursor(null);
      }
    } catch (nextError) {
      if (requestId !== requestSequence.current) return;
      setError(
        nextError instanceof Error ? nextError.message : 'Unable to load the seller workspace.'
      );
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [leadId, loadTimeline, navigate]);

  useEffect(() => {
    actionSequence.current += 1;
    setPendingAction('');
    setEditOpen(false);
    setDraft(null);
    setDraftLeadId('');
    setNoteOpen(false);
    setNote('');
    setConfirmAction('');
    void loadPortal();
    return () => {
      requestSequence.current += 1;
      timelineRequestSequence.current += 1;
      timelineThreadIdRef.current = '';
    };
  }, [loadPortal]);

  const startEdit = () => {
    if (!lead) return;
    setDraft(createLeadPortalDraft(lead));
    setDraftLeadId(lead.id || leadId);
    setEditOpen(true);
  };

  useEffect(() => {
    if (!lead || searchParams.get('edit') !== '1') return;
    const requestKey = `${leadId}:${lead.id || leadId}`;
    if (editRequestHandled.current === requestKey) return;
    editRequestHandled.current = requestKey;
    setDraft(createLeadPortalDraft(lead));
    setDraftLeadId(lead.id || leadId);
    setEditOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
  }, [lead, leadId, searchParams, setSearchParams]);

  const updateDraft = (key: keyof LeadPortalDraft, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const saveLead = async () => {
    if (!draft || !lead || !draftLeadId) return;
    if (draftLeadId !== currentLeadIdRef.current) {
      setEditOpen(false);
      setDraft(null);
      setDraftLeadId('');
      showUiToast({
        tone: 'error',
        title: 'Seller changed before save',
        desc: 'Open Edit again from the current seller workspace.',
      });
      return;
    }
    if (!draft.name.trim()) {
      showUiToast({ tone: 'error', title: 'Seller name is required' });
      return;
    }
    const actionLeadId = draftLeadId;
    const actionToken = beginAction('save');
    try {
      const response = await patchLeadRequest(actionLeadId, buildLeadPortalPatch(draft));
      if (response.ok === false) {
        throw new Error(String(response.error || 'The bridge rejected the profile update.'));
      }
      if (currentLeadIdRef.current === actionLeadId) {
        setLeadPayload({ ...leadPayload, lead: unwrapLead(response) });
        setEditOpen(false);
        setDraft(null);
        setDraftLeadId('');
      }
      showUiToast({
        tone: 'success',
        title: 'Seller profile updated',
        desc: 'Ava, Rex, approvals, analyzer, and contracts now read the same bridge record.',
      });
      if (currentLeadIdRef.current === actionLeadId) await loadPortal();
    } catch (nextError) {
      showUiToast({
        tone: 'error',
        title: 'Seller profile not saved',
        desc: nextError instanceof Error ? nextError.message : 'The bridge rejected the update.',
        critical: true,
      });
    } finally {
      finishAction(actionToken);
    }
  };

  const saveNote = async () => {
    if (!lead || !note.trim()) return;
    const actionLeadId = lead.id || leadId;
    const actionToken = beginAction('note');
    try {
      const response = await saveLeadNoteRequest({
        leadId: actionLeadId,
        leadName: lead.name,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        note: note.trim(),
        actor: 'Canonical Lead Portal',
        source: 'lead-portal',
      });
      if (response.ok === false) {
        throw new Error(String(response.error || 'The bridge rejected the lead note.'));
      }
      if (currentLeadIdRef.current === actionLeadId) {
        setNote('');
        setNoteOpen(false);
      }
      showUiToast({
        tone: response.timelineProjected === false ? 'warning' : 'success',
        title:
          response.timelineProjected === false
            ? 'Lead note saved; timeline pending'
            : 'Lead note saved',
        desc:
          response.timelineProjected === false
            ? `The bridge saved the note, but conversation projection is ${String(
                response.projectionResult || 'unavailable'
              )}.`
            : 'The bridge attached it to the seller timeline.',
      });
      if (currentLeadIdRef.current === actionLeadId) await loadPortal();
    } catch (nextError) {
      showUiToast({
        tone: 'error',
        title: 'Lead note not saved',
        desc: nextError instanceof Error ? nextError.message : 'The bridge rejected the note.',
      });
    } finally {
      finishAction(actionToken);
    }
  };

  const executeCall = async () => {
    if (!lead) return;
    const actionLeadId = lead.id || leadId;
    const actionToken = beginAction('call');
    try {
      const response = await startLeadCallRequest({
        leadId: actionLeadId,
        leadName: lead.name,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        source: 'canonical-lead-portal',
      });
      if (response.ok === false) {
        throw new Error(String(response.error || 'The bridge rejected the call request.'));
      }
      const toolResult =
        response.result && typeof response.result === 'object'
          ? (response.result as BridgeRecord)
          : response;
      if (toolResult.ok === false) {
        throw new Error(String(toolResult.error || 'The call tool rejected the request.'));
      }
      const status = String(response.status || response.result || '').toLowerCase();
      const resolvedStatus = String(
        toolResult.status || toolResult.result || toolResult.outcome || status
      ).toLowerCase();
      const telnyx =
        toolResult.telnyx && typeof toolResult.telnyx === 'object'
          ? (toolResult.telnyx as BridgeRecord)
          : {};
      const approvalQueued =
        resolvedStatus.includes('approval') ||
        Boolean(
          toolResult.approvalId ||
          toolResult.approval_id ||
          response.approvalId ||
          response.approval_id
        );
      const providerLive = telnyx.live === true;
      showUiToast({
        tone: approvalQueued ? 'info' : providerLive ? 'success' : 'warning',
        title: approvalQueued
          ? 'Call queued for approval'
          : providerLive
            ? 'Call handed to Telnyx'
            : 'Call staged; provider not live',
        desc: approvalQueued
          ? 'The operator approval queue now owns this request.'
          : providerLive
            ? 'Live call state will appear when the provider acknowledges the call.'
            : telnyx.simulated === true
              ? 'The bridge created a simulated call record because live Telnyx voice is not ready.'
              : 'The bridge accepted the request, but did not confirm a live Telnyx call.',
      });
    } catch (nextError) {
      showUiToast({
        tone: 'error',
        title: 'Call request failed',
        desc: nextError instanceof Error ? nextError.message : 'The bridge rejected the call.',
        critical: true,
      });
    } finally {
      finishAction(actionToken);
      if (currentLeadIdRef.current === actionLeadId) setConfirmAction('');
    }
  };

  const executeContract = async () => {
    if (!lead) return;
    const actionLeadId = lead.id || leadId;
    const actionToken = beginAction('contract');
    try {
      const templateName = PATH_TEMPLATE_NAMES[lead.path] || PATH_TEMPLATE_NAMES.cash;
      const response = await sendLeadContractRequest({
        leadId: actionLeadId,
        leadName: lead.name,
        email: lead.email,
        phone: lead.phone,
        address: lead.address,
        path: lead.path,
        selectedPath: lead.path,
        selectedPathLabel: lead.pathLabel,
        docusignTemplateName: templateName,
        amount: lead.mao,
        source: 'canonical-lead-portal',
        signers: [
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
            name: 'Probono Key Realty',
            email: 'info@probonokeyrealty.com',
          },
          {
            roleName: 'Signer3',
            recipientId: '3',
            routingOrder: '3',
            name: lead.name,
            email: lead.email,
          },
        ],
      });
      if (response.ok === false) {
        throw new Error(String(response.error || 'The bridge rejected the contract request.'));
      }
      const result = String(response.result || response.status || '').toLowerCase();
      showUiToast({
        tone: result.includes('approval') ? 'info' : 'success',
        title: result.includes('approval') ? 'Contract queued for approval' : 'Contract captured',
        desc: `${templateName} is attached to ${lead.name}'s bridge record.`,
      });
      if (currentLeadIdRef.current === actionLeadId) await loadPortal();
    } catch (nextError) {
      showUiToast({
        tone: 'error',
        title: 'Contract request failed',
        desc: nextError instanceof Error ? nextError.message : 'The bridge rejected the contract.',
        critical: true,
      });
    } finally {
      finishAction(actionToken);
      if (currentLeadIdRef.current === actionLeadId) setConfirmAction('');
    }
  };

  const executeDelete = async () => {
    if (!lead) return;
    const actionLeadId = lead.id || leadId;
    const actionToken = beginAction('delete');
    try {
      const response = await deleteLeadRequest(actionLeadId, {
        actor: 'Canonical Lead Portal',
        reason: 'operator_confirmed_delete',
      });
      if (response.ok === false) {
        throw new Error(String(response.error || 'The bridge rejected the delete request.'));
      }
      showUiToast({
        tone: 'success',
        title: 'Lead deleted',
        desc: `${lead.name} was removed from the PBK lead roster.`,
      });
      navigate('/leads', { replace: true });
    } catch (nextError) {
      showUiToast({
        tone: 'error',
        title: 'Lead not deleted',
        desc:
          nextError instanceof Error
            ? nextError.message
            : 'The bridge rejected the delete request.',
        critical: true,
      });
    } finally {
      finishAction(actionToken);
      setConfirmAction('');
    }
  };

  if (loading && !lead) {
    return (
      <div className="pbk-lead-portal-loading" aria-label="Loading seller workspace">
        <Loader2 className="animate-spin" />
        <strong>Loading canonical seller record</strong>
        <span>GET /api/leads/:id/full</span>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="pbk-lead-portal-error" role="alert">
        <AlertCircle />
        <h1>Seller workspace unavailable</h1>
        <p>{error || 'The bridge did not return a lead record.'}</p>
        <div>
          <button type="button" onClick={() => void loadPortal()}>
            Retry
          </button>
          <button type="button" onClick={() => navigate('/leads')}>
            Back to leads
          </button>
        </div>
      </div>
    );
  }

  const confirmCopy =
    confirmAction === 'delete'
      ? {
          title: `Delete ${lead.name}?`,
          description:
            'This removes the lead and its PBK runtime calls, messages, appointments, contracts, and analyzer records. Provider-side records are not revoked. This action cannot be undone.',
          action: 'Delete lead',
        }
      : confirmAction === 'call'
        ? {
            title: `Call ${lead.name}?`,
            description: `${lead.phone} will be sent to the real Telnyx call lane. Provider policy may require operator approval.`,
            action: 'Place call',
          }
        : {
            title: `Prepare ${lead.pathLabel} contract?`,
            description: `${PATH_TEMPLATE_NAMES[lead.path] || PATH_TEMPLATE_NAMES.cash} will be sent through the bridge for ${lead.email}.`,
            action: 'Prepare contract',
          };

  return (
    <main className="pbk-lead-portal">
      <LeadPortalHeader
        lead={lead}
        loading={loading}
        pendingAction={pendingAction}
        messageAvailable={Boolean(thread)}
        onBack={() => navigate('/leads')}
        onRefresh={() => void loadPortal()}
        onEdit={startEdit}
        onAddPhone={startEdit}
        onMessage={() =>
          thread && navigate(`/inbox/conversations?thread=${encodeURIComponent(thread.id)}`)
        }
        onCall={() => {
          if (!isCallablePhone(lead.phone)) {
            showUiToast({
              tone: 'error',
              title: 'Call blocked',
              desc: 'Add a valid seller phone before Telnyx can dial.',
            });
            return;
          }
          setConfirmAction('call');
        }}
        onNote={() => setNoteOpen(true)}
        onContract={() => {
          if (!isValidEmail(lead.email)) {
            showUiToast({
              tone: 'error',
              title: 'Contract blocked',
              desc: 'Add a valid seller email before DocuSign can be queued.',
            });
            return;
          }
          if (!isCallablePhone(lead.phone)) {
            showUiToast({
              tone: 'error',
              title: 'Contract blocked',
              desc: 'Add a valid seller phone before the contract packet is queued.',
            });
            return;
          }
          setConfirmAction('contract');
        }}
        onAnalyze={() => navigate(`/deal/${encodeURIComponent(lead.id || leadId)}`)}
        onDelete={() => setConfirmAction('delete')}
      />

      <div className="pbk-lead-portal-source">
        <PbkDataSource
          endpoint="GET /api/leads/:id/full"
          status="ships"
          note="canonical seller, property, calls, documents, and analyzer context"
        />
        <PbkDataSource
          endpoint="GET /api/conversations?leadId=:leadId"
          status="ships"
          note={thread ? 'canonical seller thread resolved' : 'no thread attached yet'}
        />
      </div>

      <div className="pbk-lead-portal-grid">
        <LeadPortalOverview lead={lead} />
        <LeadPortalContactability lead={lead} />
        <LeadPortalProperty lead={lead} />
        <LeadPortalDealContext lead={lead} />
      </div>

      <LeadPortalTimeline
        thread={thread}
        events={events}
        loading={timelineLoading}
        loadingMore={timelineLoadingMore}
        error={timelineError}
        hasMore={Boolean(timelineCursor)}
        onRetry={() => thread && void loadTimeline(thread)}
        onLoadMore={() =>
          thread &&
          timelineCursor &&
          void loadTimeline(thread, { cursor: timelineCursor, append: true })
        }
        onEventChanged={() => thread && void loadTimeline(thread)}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="pbk-lead-portal-edit">
          <DialogHeader>
            <DialogTitle>Edit complete seller profile</DialogTitle>
            <DialogDescription>
              This PATCH updates the shared bridge record used by Ava, Rex, approvals, analyzer,
              calls, and contracts.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="pbk-lead-portal-edit-grid">
              <PortalField
                label="Seller name"
                value={draft.name}
                onChange={(value) => updateDraft('name', value)}
              />
              <PortalField
                label="Phone"
                value={draft.phone}
                onChange={(value) => updateDraft('phone', value)}
              />
              <PortalField
                label="Email"
                type="email"
                value={draft.email}
                onChange={(value) => updateDraft('email', value)}
              />
              <PortalSelect
                label="Preferred channel"
                value={draft.preferredChannel}
                onChange={(value) => updateDraft('preferredChannel', value)}
                options={[
                  ['unknown', 'Unknown'],
                  ['phone', 'Phone'],
                  ['sms', 'SMS'],
                  ['email', 'Email'],
                ]}
              />
              <PortalField
                label="Best time to call"
                value={draft.bestTimeToCall}
                onChange={(value) => updateDraft('bestTimeToCall', value)}
              />
              <PortalField
                label="Relationship"
                value={draft.relationship}
                onChange={(value) => updateDraft('relationship', value)}
              />
              <PortalField
                label="Property address"
                value={draft.address}
                onChange={(value) => updateDraft('address', value)}
              />
              <PortalField
                label="City"
                value={draft.city}
                onChange={(value) => updateDraft('city', value)}
              />
              <PortalField
                label="State"
                value={draft.state}
                onChange={(value) => updateDraft('state', value)}
              />
              <PortalField
                label="ZIP"
                value={draft.zip}
                onChange={(value) => updateDraft('zip', value)}
              />
              <PortalField
                label="Property type"
                value={draft.propertyType}
                onChange={(value) => updateDraft('propertyType', value)}
              />
              <PortalField
                label="Occupancy"
                value={draft.occupancy}
                onChange={(value) => updateDraft('occupancy', value)}
              />
              <PortalField
                label="Condition"
                value={draft.condition}
                onChange={(value) => updateDraft('condition', value)}
              />
              <PortalField
                label="Beds"
                type="number"
                value={draft.beds}
                onChange={(value) => updateDraft('beds', value)}
              />
              <PortalField
                label="Baths"
                type="number"
                value={draft.baths}
                onChange={(value) => updateDraft('baths', value)}
              />
              <PortalField
                label="Sq ft"
                type="number"
                value={draft.sqft}
                onChange={(value) => updateDraft('sqft', value)}
              />
              <PortalField
                label="Year built"
                type="number"
                value={draft.yearBuilt}
                onChange={(value) => updateDraft('yearBuilt', value)}
              />
              <PortalField
                label="Asking price"
                type="number"
                value={draft.askingPrice}
                onChange={(value) => updateDraft('askingPrice', value)}
              />
              <PortalField
                label="ARV"
                type="number"
                value={draft.arv}
                onChange={(value) => updateDraft('arv', value)}
              />
              <PortalField
                label="MAO"
                type="number"
                value={draft.mao}
                onChange={(value) => updateDraft('mao', value)}
              />
              <PortalField
                label="Estimated repairs"
                type="number"
                value={draft.estimatedRepairs}
                onChange={(value) => updateDraft('estimatedRepairs', value)}
              />
              <PortalField
                label="Mortgage balance"
                type="number"
                value={draft.mortgageBalance}
                onChange={(value) => updateDraft('mortgageBalance', value)}
              />
              <PortalField
                label="Lead score"
                type="number"
                value={draft.score}
                onChange={(value) => updateDraft('score', value)}
              />
              <PortalField
                label="Stage"
                value={draft.stage}
                onChange={(value) => updateDraft('stage', value)}
              />
              <PortalSelect
                label="Deal path"
                value={draft.path}
                onChange={(value) => updateDraft('path', value)}
                options={[
                  ['cash', 'Cash Offer'],
                  ['rbp', 'Retail Buyer Program'],
                  ['cf', 'Creative Finance'],
                  ['mt', 'Mortgage Takeover'],
                  ['land', 'Land'],
                ]}
              />
              <PortalField
                label="Assigned agent"
                value={draft.assignedAgent}
                onChange={(value) => updateDraft('assignedAgent', value)}
              />
              <PortalField
                label="Tags"
                value={draft.tags}
                onChange={(value) => updateDraft('tags', value)}
              />
              <PortalSelect
                label="TCPA consent"
                value={draft.tcpaConsent}
                onChange={(value) => updateDraft('tcpaConsent', value)}
                options={[
                  ['unknown', 'Unknown'],
                  ['yes', 'Yes'],
                  ['no', 'No'],
                ]}
              />
              <PortalSelect
                label="DNC status"
                value={draft.dncStatus}
                onChange={(value) => updateDraft('dncStatus', value)}
                options={[
                  ['needs_review', 'Needs review'],
                  ['clear', 'Clear'],
                  ['blocked', 'Blocked'],
                ]}
              />
              <PortalField
                label="Motivation"
                value={draft.motivation}
                multiline
                onChange={(value) => updateDraft('motivation', value)}
              />
              <PortalField
                label="Timeline"
                value={draft.timeline}
                multiline
                onChange={(value) => updateDraft('timeline', value)}
              />
              <PortalField
                label="Seller notes"
                value={draft.sellerNotes}
                multiline
                onChange={(value) => updateDraft('sellerNotes', value)}
              />
              <PortalField
                label="Internal notes"
                value={draft.internalNotes}
                multiline
                onChange={(value) => updateDraft('internalNotes', value)}
              />
              <div className="pbk-lead-edit-section wide">
                <span>Compliance &amp; memory</span>
                <strong>BANT+ call context</strong>
                <small>
                  Editable human fields that save into the bridge BANT object and Ava call metadata.
                </small>
              </div>
              <PortalField
                label="Budget / price expectation"
                value={draft.bantBudget}
                onChange={(value) => updateDraft('bantBudget', value)}
              />
              <PortalField
                label="Authority / decision maker"
                value={draft.bantAuthority}
                onChange={(value) => updateDraft('bantAuthority', value)}
              />
              <PortalField
                label="Need / motivation"
                value={draft.bantNeed}
                multiline
                onChange={(value) => updateDraft('bantNeed', value)}
              />
              <PortalField
                label="Timeline"
                value={draft.bantTimeline}
                onChange={(value) => updateDraft('bantTimeline', value)}
              />
              <PortalField
                label="Urgency"
                value={draft.bantUrgency}
                onChange={(value) => updateDraft('bantUrgency', value)}
              />
              <PortalField
                label="Primary objection"
                value={draft.bantObjection}
                onChange={(value) => updateDraft('bantObjection', value)}
              />
              <PortalField
                label="Sentiment"
                type="number"
                value={draft.bantSentiment}
                onChange={(value) => updateDraft('bantSentiment', value)}
              />
              <PortalField
                label="Next step"
                value={draft.bantNextStep}
                onChange={(value) => updateDraft('bantNextStep', value)}
              />
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              className="pbk-portal-secondary"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pbk-portal-primary"
              onClick={() => void saveLead()}
              disabled={pendingAction === 'save'}
            >
              {pendingAction === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
              Save seller profile
            </button>
          </DialogFooter>
          <PbkDataSource
            endpoint="PATCH /api/leads/:id"
            status="ships"
            note="shared seller profile"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="pbk-lead-portal-note">
          <DialogHeader>
            <DialogTitle>Add timeline note</DialogTitle>
            <DialogDescription>
              This note is persisted through the bridge and projected into the seller activity
              stream.
            </DialogDescription>
          </DialogHeader>
          <label>
            <span>Note</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={5}
              autoFocus
            />
          </label>
          <DialogFooter>
            <button
              type="button"
              className="pbk-portal-secondary"
              onClick={() => setNoteOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pbk-portal-primary"
              onClick={() => void saveNote()}
              disabled={!note.trim() || pendingAction === 'note'}
            >
              {pendingAction === 'note' ? <Loader2 className="animate-spin" /> : <StickyNote />}
              Save note
            </button>
          </DialogFooter>
          <PbkDataSource
            endpoint="POST /api/leads/add-note"
            status="ships"
            note="seller timeline note"
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => !open && setConfirmAction('')}
      >
        <AlertDialogContent className="pbk-lead-portal-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmCopy.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirmAction === 'delete' ? 'pbk-btn-danger' : undefined}
              onClick={() =>
                void (confirmAction === 'delete'
                  ? executeDelete()
                  : confirmAction === 'call'
                    ? executeCall()
                    : executeContract())
              }
            >
              {confirmCopy.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
