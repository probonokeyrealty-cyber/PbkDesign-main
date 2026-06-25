import { useCallback, useEffect, useState } from 'react';
import { DealData, PBKPath } from '../types';
import { LiveCallInputs } from './LiveCallInputs';
import { LiveDealTrackerPanel } from './LiveDealTrackerPanel';
import { ScriptPanel } from './ScriptPanel';
import { InvestorYield } from './InvestorYield';
import { getLiveInputPath, getPathLabel, getPathOptions } from '../utils/pbk';
import type { AgentDealContext } from '../utils/agentDealContext';
import {
  patchLeadRequest,
  saveLeadNoteRequest,
  scheduleAppointmentRequest,
  sendOfferEmailRequest,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

type ScriptVariant = 'owner' | 'agent';

interface CallModeTabProps {
  deal: DealData;
  onDealChange: (updates: Partial<DealData>) => void;
  selectedPath: PBKPath;
  onSelectPath: (path: PBKPath) => void;
  onPushScriptToAgent?: (context: AgentDealContext) => void | Promise<void>;
}

function getForcedVariant(path: PBKPath): ScriptVariant | null {
  if (path === 'cf' || path === 'mt') return 'agent';
  if (path === 'rbp') return 'owner';
  if (path === 'land-agent') return 'agent';
  if (path === 'land-owner' || path === 'rbp-land') return 'owner';
  return null;
}

function isCoCPath(path: PBKPath): path is 'cf' | 'mt' {
  return path === 'cf' || path === 'mt';
}

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function getDealLeadId(deal: DealData) {
  return String(deal.leadId || (deal as DealData & { lead_id?: string }).lead_id || '').trim();
}

function getDealLeadName(deal: DealData) {
  return deal.sellerName || 'Seller';
}

function getTomorrowMorningIso() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

function buildOfferEmailBody(deal: DealData, selectedPath: PBKPath, callNotes = '') {
  const sellerName = deal.sellerName?.trim() || 'there';
  const address = deal.address?.trim() || 'your property';
  const pathLabel = getPathLabel(selectedPath);
  const offerLine =
    deal.agreedPrice || deal.offer || deal.mao60
      ? `We can review an offer range around $${Math.round(deal.agreedPrice || deal.offer || deal.mao60).toLocaleString()}.`
      : 'We can review the cleanest offer path once the remaining details are confirmed.';
  return [
    `Hi ${sellerName},`,
    '',
    `Following up on our conversation about ${address}. Based on the ${pathLabel} path, PBK can keep the next step simple and transparent.`,
    offerLine,
    callNotes.trim() ? `Call notes: ${callNotes.trim()}` : '',
    '',
    'If you want to keep moving, reply with the best time to talk through the next step.',
    '',
    'PBK Team',
  ]
    .filter(Boolean)
    .join('\n');
}

function getMissingLeadSyncMessage(action: string) {
  return `Create or sync this lead before ${action}.`;
}

export function CallModeTab({
  deal,
  onDealChange,
  selectedPath: activePath,
  onSelectPath,
  onPushScriptToAgent,
}: CallModeTabProps) {
  const [callNotes, setCallNotes] = useState(deal.notes || '');
  const [lastSavedNotes, setLastSavedNotes] = useState(deal.notes || '');
  const [postCallStatus, setPostCallStatus] = useState('');
  const [pendingPostCallAction, setPendingPostCallAction] = useState('');
  const [scriptVariant, setScriptVariant] = useState<ScriptVariant>(
    deal.contact === 'realtor' ? 'agent' : 'owner'
  );
  const pathOptions = getPathOptions({ type: deal.type, contact: deal.contact });
  const forcedVariant = getForcedVariant(activePath);

  useEffect(() => {
    setScriptVariant(deal.contact === 'realtor' ? 'agent' : 'owner');
  }, [deal.contact]);

  useEffect(() => {
    if (forcedVariant) {
      setScriptVariant(forcedVariant);
    }
  }, [forcedVariant]);

  useEffect(() => {
    setCallNotes(deal.notes || '');
    setLastSavedNotes(deal.notes || '');
  }, [deal.address, deal.notes]);

  const saveCallNotes = useCallback(async () => {
    const note = callNotes.trim();
    if (!note || note === lastSavedNotes.trim()) return;
    const leadId = getDealLeadId(deal);
    if (!leadId) {
      setPostCallStatus(getMissingLeadSyncMessage('saving call notes to the bridge'));
      return;
    }
    try {
      await saveLeadNoteRequest({
        leadId,
        leadName: getDealLeadName(deal),
        address: deal.address,
        email: deal.sellerEmail || '',
        phone: deal.sellerPhone || '',
        note,
        actor: 'Call Mode',
        source: 'deal-view-call-mode',
      });
      setLastSavedNotes(note);
      setPostCallStatus('Call notes saved to the bridge.');
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Call notes not saved',
        desc: error instanceof Error ? error.message : 'The bridge did not accept the note.',
      });
    }
  }, [callNotes, deal, lastSavedNotes]);

  const handleScheduleFollowUp = async () => {
    const leadId = getDealLeadId(deal);
    if (!leadId) {
      showUiToast({
        tone: 'warning',
        title: 'Lead sync required',
        desc: getMissingLeadSyncMessage('scheduling a follow-up'),
      });
      return;
    }
    setPendingPostCallAction('schedule');
    setPostCallStatus('');
    try {
      const startTime = getTomorrowMorningIso();
      await scheduleAppointmentRequest({
        leadId,
        leadName: getDealLeadName(deal),
        address: deal.address,
        email: deal.sellerEmail || '',
        phone: deal.sellerPhone || '',
        startTime,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
        source: 'deal-view-call-mode',
        actor: 'Call Mode',
        notes: callNotes.trim() || `Follow-up for ${getPathLabel(activePath)} path.`,
      });
      setPostCallStatus(`Follow-up call scheduled for ${new Date(startTime).toLocaleString()}.`);
      showUiToast({
        tone: 'success',
        title: 'Follow-up scheduled',
        desc: 'The bridge appointment queue was updated.',
      });
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Follow-up failed',
        desc: error instanceof Error ? error.message : 'The bridge did not schedule the call.',
      });
    } finally {
      setPendingPostCallAction('');
    }
  };

  const handleSendOfferEmail = async () => {
    const leadId = getDealLeadId(deal);
    if (!leadId) {
      showUiToast({
        tone: 'warning',
        title: 'Lead sync required',
        desc: getMissingLeadSyncMessage('sending an offer email'),
      });
      return;
    }
    if (!deal.sellerEmail?.includes('@')) {
      showUiToast({
        tone: 'error',
        title: 'Email blocked',
        desc: 'Add a valid seller email before sending an offer email.',
      });
      return;
    }
    setPendingPostCallAction('email');
    setPostCallStatus('');
    try {
      const subject = `Offer next steps for ${deal.address || 'your property'}`;
      const body = buildOfferEmailBody(deal, activePath, callNotes);
      const result = await sendOfferEmailRequest({
        leadId,
        leadName: getDealLeadName(deal),
        address: deal.address,
        email: deal.sellerEmail,
        phone: deal.sellerPhone || '',
        subject,
        body,
        selectedPath: activePath,
        selectedPathLabel: getPathLabel(activePath),
        source: 'deal-view-call-mode',
      });
      const status = String(result.result || result.status || '').toLowerCase();
      const queued =
        status.includes('approval') ||
        status.includes('queued') ||
        Boolean(result.approval || result.approvalId);
      setPostCallStatus(
        queued ? 'Offer email queued for approval.' : 'Offer email handed to the bridge.'
      );
      showUiToast({
        tone: queued ? 'info' : 'success',
        title: queued ? 'Offer email queued' : 'Offer email submitted',
        desc: queued
          ? 'Provider send is approval-gated.'
          : 'The bridge accepted the offer email request.',
      });
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Offer email failed',
        desc: error instanceof Error ? error.message : 'The bridge did not accept the offer email.',
      });
    } finally {
      setPendingPostCallAction('');
    }
  };

  const handleAddToCrm = async () => {
    const leadId = getDealLeadId(deal);
    if (!leadId) {
      showUiToast({
        tone: 'warning',
        title: 'Lead sync required',
        desc: getMissingLeadSyncMessage('syncing CRM activity'),
      });
      return;
    }
    setPendingPostCallAction('crm');
    setPostCallStatus('');
    try {
      const result = await patchLeadRequest(leadId, {
        name: getDealLeadName(deal),
        address: deal.address,
        email: deal.sellerEmail || '',
        phone: normalizePhone(deal.sellerPhone || ''),
        selected_path: activePath,
        selectedPathLabel: getPathLabel(activePath),
        motivation_score: deal.motivationScore || 0,
        notes: callNotes.trim() || deal.notes || '',
        summary: callNotes.trim() || deal.notes || '',
        message: `Call Mode synced ${deal.address || getDealLeadName(deal)} to CRM after ${getPathLabel(activePath)} call review.`,
        source: 'deal_view_call_mode_manual',
        actor: 'Call Mode',
      });
      const status = String(result.result || result.status || '').replace(/_/g, ' ') || 'submitted';
      setPostCallStatus(`Lead profile ${status}.`);
      showUiToast({
        tone: 'success',
        title: 'Lead profile updated',
        desc: 'Saved quietly to the lead profile. No approval or Slack review was needed.',
      });
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'CRM update failed',
        desc: error instanceof Error ? error.message : 'The bridge did not accept the CRM update.',
      });
    } finally {
      setPendingPostCallAction('');
    }
  };

  return (
    <div className="p-3.5">
      <div className="pbk-analyzer-card bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-1 h-3 bg-purple-500 rounded-sm"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-purple-500">
              Path Selector
            </h3>
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            Active packet path:{' '}
            <strong className="text-purple-600 dark:text-purple-300">
              {getPathLabel(activePath)}
            </strong>
          </div>
        </div>

        <div className="mb-3 rounded-2xl border border-purple-200 bg-purple-50 px-3 py-2 text-[11px] leading-5 text-purple-800 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300">
          Tap a path and the scripts, tracker, live inputs, and Documents/PDF packet all follow this
          same selected path.
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {pathOptions.map((option) => {
            const isActive = option.id === activePath;
            const toneClasses =
              option.tone === 'green'
                ? isActive
                  ? 'border-green-500 bg-green-500 text-white shadow-green-500/25'
                  : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300'
                : option.tone === 'blue'
                  ? isActive
                    ? 'border-blue-500 bg-blue-500 text-white shadow-blue-500/25'
                    : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300'
                  : option.tone === 'purple'
                    ? isActive
                      ? 'border-purple-500 bg-purple-500 text-white shadow-purple-500/25'
                      : 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300'
                    : option.tone === 'amber'
                      ? isActive
                        ? 'border-amber-500 bg-amber-500 text-white shadow-amber-500/25'
                        : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                      : isActive
                        ? 'border-slate-600 bg-slate-700 text-white shadow-slate-900/20'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300';

            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => onSelectPath(option.id)}
                className={`min-w-fit rounded-full border px-4 py-2 text-left transition-all shadow-sm ${toneClasses}`}
              >
                <div className="text-[9px] font-semibold uppercase tracking-[0.2em] opacity-80">
                  Path
                </div>
                <div className="text-[12px] font-semibold leading-tight">{option.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      <ScriptPanel
        deal={deal}
        activePath={activePath}
        scriptVariant={scriptVariant}
        forcedVariant={forcedVariant}
        onScriptVariantChange={setScriptVariant}
        onPushScriptToAgent={onPushScriptToAgent}
      />

      {isCoCPath(activePath) ? (
        <div className="mb-3">
          <InvestorYield deal={deal} onDealChange={onDealChange} activePath={activePath} />
        </div>
      ) : null}

      <LiveDealTrackerPanel deal={deal} activePath={activePath} />

      <div className="pbk-analyzer-card bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Call Notes
          </h3>
        </div>

        <textarea
          aria-label="Call notes"
          value={callNotes}
          onChange={(event) => {
            setCallNotes(event.target.value);
            onDealChange({ notes: event.target.value });
          }}
          onBlur={() => void saveCallNotes()}
          placeholder="Take notes during your call..."
          className="w-full h-32 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all resize-vertical"
        />
      </div>

      <LiveCallInputs
        deal={deal}
        onDealChange={onDealChange}
        selectedPath={getLiveInputPath(activePath)}
        canonicalPath={activePath}
      />

      <div className="pbk-analyzer-card bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Post-Call Actions
          </h3>
        </div>

        <div className="space-y-2">
          {postCallStatus && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-800 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-200">
              {postCallStatus}
            </div>
          )}
          <button
            type="button"
            disabled={Boolean(pendingPostCallAction)}
            onClick={() => void handleScheduleFollowUp()}
            className="w-full px-4 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300 text-[12px] font-medium text-left hover:bg-green-100 dark:hover:bg-green-900/30 transition-all disabled:cursor-wait disabled:opacity-60"
          >
            {pendingPostCallAction === 'schedule' ? 'Scheduling...' : 'Schedule Follow-up Call'}
          </button>
          <button
            type="button"
            disabled={Boolean(pendingPostCallAction)}
            onClick={() => void handleSendOfferEmail()}
            className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300 text-[12px] font-medium text-left hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all disabled:cursor-wait disabled:opacity-60"
          >
            {pendingPostCallAction === 'email' ? 'Sending...' : 'Send Offer Email'}
          </button>
          <button
            type="button"
            disabled={Boolean(pendingPostCallAction)}
            onClick={() => void handleAddToCrm()}
            className="w-full px-4 py-2 rounded-lg bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-800 dark:text-gray-300 text-[12px] font-medium text-left hover:bg-gray-100 dark:hover:bg-slate-800 transition-all disabled:cursor-wait disabled:opacity-60"
          >
            {pendingPostCallAction === 'crm' ? 'Syncing...' : 'Add to CRM'}
          </button>
        </div>
      </div>
    </div>
  );
}
