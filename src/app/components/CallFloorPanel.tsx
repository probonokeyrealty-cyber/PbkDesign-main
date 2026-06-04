import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock3, Phone, Search, X } from 'lucide-react';
import {
  cancelScheduledCallRequest,
  scheduleAppointmentRequest,
  startLeadCallRequest,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

type BridgeRecord = Record<string, unknown>;

type ScheduledCall = {
  id: string;
  leadId: string;
  leadName: string;
  phone: string;
  address: string;
  scheduledAt: string;
  notifiedAt?: string;
};

type CancelScheduledCallDraft = ScheduledCall;

const SCHEDULED_CALLS_KEY = 'pbk:scheduled-calls:v1';

function text(value: unknown, fallback = '') {
  return value == null ? fallback : String(value);
}
function nested(record: BridgeRecord, key: string) {
  return record[key] && typeof record[key] === 'object' ? (record[key] as BridgeRecord) : {};
}

function getLeadId(lead: BridgeRecord) {
  return text(lead.id || lead.leadId || lead.lead_id || lead.phone || lead.address, 'unknown-lead');
}

function getLeadName(lead: BridgeRecord) {
  const seller = nested(lead, 'seller');
  return text(lead.lead_name || lead.leadName || lead.name || seller.name, 'Unnamed lead');
}

function getLeadPhone(lead: BridgeRecord) {
  const seller = nested(lead, 'seller');
  return text(lead.phone || lead.phone_number || lead.phoneNumber || seller.phone, '');
}

function getLeadAddress(lead: BridgeRecord) {
  const property = nested(lead, 'property');
  return text(
    lead.address || lead.property_address || lead.propertyAddress || property.address,
    'No address recorded'
  );
}

function getLeadScore(lead: BridgeRecord) {
  const raw = Number(
    lead.engagement_score || lead.engagementScore || lead.score || lead.motivation_score || 0
  );
  return Number.isFinite(raw) ? Math.round(raw) : 0;
}

function getLeadMotivation(lead: BridgeRecord) {
  return text(
    lead.motivation || lead.motivation_label || lead.status || lead.stage || 'warm'
  ).replace(/_/g, ' ');
}

function getLeadLastTouch(lead: BridgeRecord) {
  return text(
    lead.last_touch ||
      lead.lastTouch ||
      lead.updated_at ||
      lead.updatedAt ||
      lead.created_at ||
      lead.createdAt,
    ''
  );
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '');
}

function formatRelative(value: string) {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDateInput(date: Date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

function readScheduledCalls(): ScheduledCall[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SCHEDULED_CALLS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveScheduledCalls(calls: ScheduledCall[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SCHEDULED_CALLS_KEY, JSON.stringify(calls));
  }
  return calls;
}

function notifyDueScheduledCalls(calls: ScheduledCall[], alertsEnabled: boolean) {
  if (
    !alertsEnabled ||
    typeof Notification === 'undefined' ||
    Notification.permission !== 'granted'
  ) {
    return calls;
  }
  const now = Date.now();
  let changed = false;
  const next = calls.map((call) => {
    if (call.notifiedAt) return call;
    const scheduledAt = new Date(call.scheduledAt).getTime();
    if (!Number.isFinite(scheduledAt) || scheduledAt > now) return call;
    try {
      new Notification('PBK callback due', {
        body: `${call.leadName} - ${call.phone || call.address}`,
        tag: `pbk-callback-${call.id}`,
      });
      changed = true;
      return { ...call, notifiedAt: new Date().toISOString() };
    } catch {
      return call;
    }
  });
  return changed ? next : calls;
}

function isActiveCall(call: BridgeRecord) {
  return ['live', 'connected', 'dialing', 'queued', 'on-hold'].includes(
    text(call.status).toLowerCase()
  );
}

interface CallFloorPanelProps {
  leads: BridgeRecord[];
  calls: BridgeRecord[];
  onSelectLead?: (lead: BridgeRecord) => void;
}

export function CallFloorPanel({ leads, calls, onSelectLead }: CallFloorPanelProps) {
  const [query, setQuery] = useState('');
  const [dialingId, setDialingId] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [scheduledCalls, setScheduledCalls] = useState(() => readScheduledCalls());
  const [scheduleActionPending, setScheduleActionPending] = useState('');
  const [cancelScheduledCallDraft, setCancelScheduledCallDraft] =
    useState<CancelScheduledCallDraft | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );

  const activePhones = useMemo(() => {
    const phones = new Set<string>();
    calls.filter(isActiveCall).forEach((call) => {
      const phone = normalizePhone(text(call.phone || call.to || call.from || call.leadPhone));
      if (phone) phones.add(phone);
    });
    return phones;
  }, [calls]);

  const visibleLeads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? leads.filter((lead) =>
          [getLeadName(lead), getLeadPhone(lead), getLeadAddress(lead), getLeadMotivation(lead)]
            .join(' ')
            .toLowerCase()
            .includes(needle)
        )
      : leads;
    return filtered.slice(0, 8);
  }, [leads, query]);

  const selectedLead = useMemo(
    () =>
      visibleLeads.find((lead) => getLeadId(lead) === selectedLeadId) || visibleLeads[0] || null,
    [selectedLeadId, visibleLeads]
  );

  const startBridgeCall = useCallback(
    async (lead: BridgeRecord | null = selectedLead) => {
      if (!lead) {
        showUiToast({
          tone: 'error',
          title: 'No lead selected',
          desc: 'Search or select a lead first.',
        });
        return;
      }
      const leadId = getLeadId(lead);
      const phone = normalizePhone(getLeadPhone(lead));
      if (!phone) {
        showUiToast({
          tone: 'error',
          title: 'No phone number',
          desc: `${getLeadName(lead)} has no callable phone.`,
        });
        return;
      }
      if (activePhones.has(phone)) return;
      setDialingId(leadId);
      showUiToast({
        tone: 'info',
        title: 'Requesting call...',
        desc: `${getLeadName(lead)} is being sent to the bridge.`,
      });
      try {
        const response = await startLeadCallRequest({
          leadId,
          leadName: getLeadName(lead),
          phone: getLeadPhone(lead),
          address: getLeadAddress(lead),
          source: 'call-floor-panel',
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
            ? `${getLeadName(lead)} needs operator approval before Telnyx dials.`
            : `${getLeadName(lead)} was handed to the Telnyx call lane.`,
        });
      } catch (nextError) {
        showUiToast({
          tone: 'error',
          title: 'Call request failed',
          desc:
            nextError instanceof Error
              ? nextError.message
              : 'The bridge did not accept the call request.',
        });
      } finally {
        setDialingId((current) => (current === leadId ? '' : current));
      }
    },
    [activePhones, selectedLead]
  );

  useEffect(() => {
    const onCallNow = (event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean }>).detail;
      if (detail && typeof detail === 'object') detail.handled = true;
      void startBridgeCall(
        visibleLeads.find((lead) => !activePhones.has(normalizePhone(getLeadPhone(lead)))) || null
      );
    };
    window.addEventListener('pbk:call-now', onCallNow);
    return () => window.removeEventListener('pbk:call-now', onCallNow);
  }, [activePhones, startBridgeCall, visibleLeads]);

  useEffect(() => {
    if (!alertsEnabled) return undefined;
    const checkDueCalls = () => {
      setScheduledCalls((current) => {
        const next = notifyDueScheduledCalls(current, alertsEnabled);
        return next === current ? current : saveScheduledCalls(next);
      });
    };
    checkDueCalls();
    const timer = window.setInterval(checkDueCalls, 60000);
    return () => window.clearInterval(timer);
  }, [alertsEnabled]);

  const applyQuickTime = (type: 'hour' | 'two-hours' | 'today-five' | 'tomorrow-nine') => {
    const next = new Date();
    if (type === 'hour') next.setHours(next.getHours() + 1);
    if (type === 'two-hours') next.setHours(next.getHours() + 2);
    if (type === 'today-five') {
      next.setHours(17, 0, 0, 0);
      if (next.getTime() < Date.now()) next.setDate(next.getDate() + 1);
    }
    if (type === 'tomorrow-nine') {
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
    }
    setCallbackTime(formatDateInput(next));
  };

  const scheduleSelectedLead = async () => {
    if (!selectedLead) {
      showUiToast({
        tone: 'error',
        title: 'No lead selected',
        desc: 'Choose a lead before scheduling.',
      });
      return;
    }
    if (!callbackTime) {
      showUiToast({
        tone: 'error',
        title: 'Choose a callback time',
        desc: 'Use a quick pick or the date/time field.',
      });
      return;
    }
    const scheduledAt = new Date(callbackTime).toISOString();
    const leadId = getLeadId(selectedLead);
    setScheduleActionPending(`schedule:${leadId}`);
    try {
      const response = await scheduleAppointmentRequest({
        leadId,
        leadName: getLeadName(selectedLead),
        phone: getLeadPhone(selectedLead),
        address: getLeadAddress(selectedLead),
        startTime: scheduledAt,
        scheduledFor: scheduledAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
        source: 'call-floor-panel',
        actor: 'Call Floor',
        notes: 'Scheduled callback from the PBK call floor.',
      });
      const appointment =
        response.appointment && typeof response.appointment === 'object'
          ? (response.appointment as BridgeRecord)
          : {};
      const item: ScheduledCall = {
        id: text(appointment.id, `scheduled-${Date.now()}`),
        leadId,
        leadName: getLeadName(selectedLead),
        phone: getLeadPhone(selectedLead),
        address: getLeadAddress(selectedLead),
        scheduledAt: text(appointment.startTime, scheduledAt),
      };
      setScheduledCalls((current) =>
        saveScheduledCalls([item, ...current.filter((call) => call.id !== item.id)].slice(0, 8))
      );
      showUiToast({
        tone: 'success',
        title: 'Scheduled call added',
        desc: `${item.leadName} was synced to the bridge appointment queue.`,
      });
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Scheduling failed',
        desc: error instanceof Error ? error.message : 'The bridge did not schedule the callback.',
      });
    } finally {
      setScheduleActionPending('');
    }
  };

  const cancelScheduledCall = async (id: string) => {
    const item = scheduledCalls.find((call) => call.id === id);
    if (!item) return;
    setScheduleActionPending(`cancel:${id}`);
    try {
      await cancelScheduledCallRequest(id, {
        leadId: item.leadId,
        leadName: item.leadName,
        phone: item.phone,
        address: item.address,
        startTime: item.scheduledAt,
        source: 'call-floor-panel',
        actor: 'Call Floor',
      });
      setScheduledCalls((current) =>
        saveScheduledCalls(current.filter((nextItem) => nextItem.id !== id))
      );
      showUiToast({
        tone: 'info',
        title: 'Scheduled call canceled',
        desc: 'Cancellation was synced to the bridge appointment queue.',
      });
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Cancel failed',
        desc:
          error instanceof Error
            ? error.message
            : 'The bridge did not cancel the scheduled callback.',
      });
    } finally {
      setScheduleActionPending('');
    }
  };

  const enableAlerts = async () => {
    if (typeof Notification === 'undefined') {
      showUiToast({
        tone: 'error',
        title: 'Notifications unavailable',
        desc: 'This browser does not expose notifications.',
      });
      return;
    }
    const permission = await Notification.requestPermission();
    setAlertsEnabled(permission === 'granted');
    showUiToast({
      tone: permission === 'granted' ? 'success' : 'info',
      title: permission === 'granted' ? 'Call alerts enabled' : 'Call alerts not enabled',
      desc:
        permission === 'granted'
          ? 'Inbound call notifications can now appear in this browser.'
          : 'You can still use in-app call floor alerts.',
    });
  };

  return (
    <section className="call-floor-panel rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Call Floor</h2>
          <p className="text-xs text-slate-500">
            Search, call, and schedule from the existing lead snapshot.
          </p>
        </div>
        <button type="button" className="chip-btn" onClick={enableAlerts}>
          {alertsEnabled ? 'Alerts on' : 'Enable call alerts'}
        </button>
      </div>

      <label className="call-floor-search mt-3">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, phone, address, motivation..."
        />
      </label>

      <div className="mt-3 grid gap-2">
        {visibleLeads.map((lead) => {
          const leadId = getLeadId(lead);
          const phone = getLeadPhone(lead);
          const normalizedPhone = normalizePhone(phone);
          const inCall = Boolean(normalizedPhone && activePhones.has(normalizedPhone));
          const dialing = dialingId === leadId;
          const score = getLeadScore(lead);
          return (
            <div
              key={leadId}
              aria-label={`Select ${getLeadName(lead)} at ${getLeadAddress(lead)}. ${
                phone || 'No phone'
              }.`}
              aria-selected={selectedLeadId === leadId}
              className={[
                'outbound-lead-result',
                selectedLeadId === leadId ? 'is-selected' : '',
              ].join(' ')}
              onClick={() => {
                setSelectedLeadId(leadId);
                onSelectLead?.(lead);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedLeadId(leadId);
                  onSelectLead?.(lead);
                }
              }}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{getLeadName(lead)}</strong>
                  <span
                    className={`score-badge ${score >= 75 ? 'hot' : score >= 50 ? 'warm' : ''}`}
                  >
                    Score {score}
                  </span>
                  {inCall && <span className="in-call-badge">In call</span>}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  <span className="mono">{phone || 'no phone'}</span> · {getLeadAddress(lead)}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                  <span>Last touch: {formatRelative(getLeadLastTouch(lead))}</span>
                  <span className="capitalize">Motivation: {getLeadMotivation(lead)}</span>
                </div>
              </div>
              <button
                type="button"
                className="btn-call"
                disabled={inCall || dialing || !phone}
                onClick={(event) => {
                  event.stopPropagation();
                  void startBridgeCall(lead);
                }}
              >
                {dialing ? <span className="loading-spinner-small" /> : <Phone size={14} />}
                {inCall ? 'In call' : dialing ? 'Calling...' : 'Call'}
              </button>
            </div>
          );
        })}
        {!visibleLeads.length && (
          <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
            No matching leads found.
          </div>
        )}
      </div>

      <div className="call-scheduler mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-sky-300">
          <CalendarClock size={14} />
          Schedule callback
        </div>
        <div className="quick-time-row mt-3">
          <button
            type="button"
            className="chip-btn quick-time"
            onClick={() => applyQuickTime('hour')}
          >
            In 1 hour
          </button>
          <button
            type="button"
            className="chip-btn quick-time"
            onClick={() => applyQuickTime('two-hours')}
          >
            In 2 hours
          </button>
          <button
            type="button"
            className="chip-btn quick-time"
            onClick={() => applyQuickTime('today-five')}
          >
            Today 5pm
          </button>
          <button
            type="button"
            className="chip-btn quick-time"
            onClick={() => applyQuickTime('tomorrow-nine')}
          >
            Tomorrow 9am
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="callbackTime"
            type="datetime-local"
            value={callbackTime}
            onChange={(event) => setCallbackTime(event.target.value)}
            className="callback-time-input"
          />
          <button
            type="button"
            className="btn-primary"
            disabled={scheduleActionPending.startsWith('schedule:')}
            onClick={() => void scheduleSelectedLead()}
          >
            {scheduleActionPending.startsWith('schedule:') ? 'Scheduling...' : 'Schedule selected'}
          </button>
        </div>
      </div>

      <div className="scheduled-call-list mt-4">
        <div className="flex items-center justify-between gap-2">
          <h3>Scheduled Calls</h3>
          <span>{scheduledCalls.length} synced</span>
        </div>
        <div className="mt-2 grid gap-2">
          {scheduledCalls.map((item) => (
            <div key={item.id} className="scheduled-call-row">
              <Clock3 size={14} className="text-sky-300" />
              <div className="min-w-0">
                <strong>{item.leadName}</strong>
                <span>
                  {new Date(item.scheduledAt).toLocaleString()} - {item.phone || item.address}
                </span>
              </div>
              <button
                type="button"
                aria-label={`Cancel ${item.leadName}`}
                disabled={scheduleActionPending === `cancel:${item.id}`}
                onClick={() => setCancelScheduledCallDraft(item)}
              >
                <X size={14} />
                {scheduleActionPending === `cancel:${item.id}` ? 'Canceling...' : 'Cancel'}
              </button>
            </div>
          ))}
          {!scheduledCalls.length && (
            <div className="rounded-xl border border-dashed border-slate-800 px-3 py-3 text-xs text-slate-500">
              No scheduled calls yet. Pick a lead, choose a time, and it will sync to the bridge
              queue.
            </div>
          )}
        </div>
      </div>

      {cancelScheduledCallDraft && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-scheduled-call-title"
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.55)]"
          >
            <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
              Schedule change
            </div>
            <h3
              id="cancel-scheduled-call-title"
              className="mt-2 text-lg font-semibold text-slate-100"
            >
              Cancel this callback?
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              This removes the callback for{' '}
              <span className="font-semibold text-slate-200">
                {cancelScheduledCallDraft.leadName}
              </span>{' '}
              from the bridge appointment queue.
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-300">
              {new Date(cancelScheduledCallDraft.scheduledAt).toLocaleString()} -{' '}
              {cancelScheduledCallDraft.phone || cancelScheduledCallDraft.address}
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCancelScheduledCallDraft(null)}
              >
                Keep scheduled
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const id = cancelScheduledCallDraft.id;
                  setCancelScheduledCallDraft(null);
                  void cancelScheduledCall(id);
                }}
              >
                Cancel callback
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
