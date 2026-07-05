import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Clock3,
  Flag,
  Hand,
  Loader2,
  MessageSquarePlus,
  MicOff,
  Phone,
  PhoneOff,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { PbkDataSource } from '../../../components/pbk/index';
import {
  controlRuntimeCall,
  saveLeadNoteRequest,
  scheduleAppointmentRequest,
} from '../../utils/runtimeBridge';
import { showUiToast } from '../../utils/uiFeedback';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

type RuntimeCall = Record<string, unknown>;

type LiveCallPipProps = {
  calls: unknown[];
  leadId?: string | null;
  leadName?: string;
  phone?: string;
  address?: string;
  onChanged?: () => void;
};

type TranscriptLine = {
  id: string;
  speaker: 'ava' | 'seller' | 'operator';
  text: string;
  at: string;
};

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePhone(value: unknown) {
  return text(value).replace(/\D+/g, '').slice(-10);
}

function callId(call: RuntimeCall) {
  return text(call.id || call.callId || call.call_id);
}

function callLeadId(call: RuntimeCall) {
  return text(call.leadId || call.lead_id);
}

function callPhone(call: RuntimeCall) {
  return text(call.phone || call.recipientPhone || call.recipient_phone || call.from || call.to);
}

function callPhoneCandidates(call: RuntimeCall) {
  return [call.phone, call.recipientPhone, call.recipient_phone, call.to, call.from]
    .map(normalizePhone)
    .filter(Boolean);
}

function activeCallStatus(value: unknown) {
  return /^(active|connected|dialing|initiated|queued|in[_ -]?progress|live|on[_ -]?hold|ringing|transferring)$/i.test(
    text(value)
  );
}

function callStatusLabel(value: unknown) {
  const status = text(value).toLowerCase();
  if (status === 'transferring') return 'Operator handoff';
  if (/queued|initiated|dialing|ringing/.test(status)) return 'Calling';
  if (/on[_ -]?hold/.test(status)) return 'On hold';
  return 'Live call';
}

function selectLiveCall(calls: RuntimeCall[], leadId = '', phone = '') {
  const normalizedPhone = normalizePhone(phone);
  return (
    calls.find((call) => {
      if (!activeCallStatus(call.status)) return false;
      if (leadId && callLeadId(call) === leadId) return true;
      return Boolean(normalizedPhone && callPhoneCandidates(call).includes(normalizedPhone));
    }) || null
  );
}

function normalizeSentiment(call: RuntimeCall) {
  const context = record(call.callContext || call.context);
  const raw = number(call.sentiment ?? context.sentiment ?? context.sentimentScore);
  if (raw == null) return null;
  return Math.max(0, Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw)));
}

function sentimentLabel(score: number | null, call: RuntimeCall) {
  const explicit = text(call.sentimentDirection || call.sentimentTrend || call.sentimentLabel);
  if (explicit) return explicit.replace(/_/g, ' ');
  if (score == null) return 'Not available';
  if (score >= 70) return 'Warm';
  if (score >= 40) return 'Neutral';
  return 'Cold';
}

function readTalkTime(call: RuntimeCall) {
  const talkTime = record(call.talkTime || call.talk_time || call.speakerTime);
  const ava = number(
    call.avaTalkSeconds ??
      call.agentTalkSeconds ??
      call.aiTalkSeconds ??
      talkTime.ava ??
      talkTime.agent ??
      talkTime.ai
  );
  const seller = number(
    call.sellerTalkSeconds ??
      call.leadTalkSeconds ??
      call.customerTalkSeconds ??
      talkTime.seller ??
      talkTime.lead ??
      talkTime.customer
  );
  return {
    ava: ava == null ? null : Math.max(0, Math.round(ava)),
    seller: seller == null ? null : Math.max(0, Math.round(seller)),
  };
}

function mapTranscript(call: RuntimeCall): TranscriptLine[] {
  if (!Array.isArray(call.transcript)) return [];
  return call.transcript.flatMap((entry, index) => {
    const item = typeof entry === 'string' ? { text: entry } : record(entry);
    const body = text(item.text || item.body || item.transcript);
    if (!body) return [];
    const speaker = text(item.speaker || item.actor).toLowerCase();
    return [
      {
        id: text(item.id, `live-transcript-${index}`),
        speaker: /ava|ai|agent|bot/.test(speaker)
          ? 'ava'
          : /operator|human|user|you/.test(speaker)
            ? 'operator'
            : 'seller',
        text: body,
        at: text(item.at || item.ts || item.createdAt),
      } satisfies TranscriptLine,
    ];
  });
}

function formatElapsed(startedAt: string, tick: number) {
  void tick;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 'Not available';
  const total = Math.max(0, Math.floor((Date.now() - start) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function tomorrowMorningInput() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  const offset = next.getTimezoneOffset();
  return new Date(next.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function talkTimeLabel(seconds: number | null) {
  if (seconds == null) return 'Not available';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function readOperatorWhisper(call: RuntimeCall) {
  const raw = call.operatorWhisper || call.operator_whisper;
  const whisper = typeof raw === 'string' ? { text: raw } : record(raw);
  const whisperText = text(whisper.text || whisper.hint || whisper.nextMove || whisper.next_move);
  if (!whisperText) return null;
  const confidence = number(whisper.confidence);
  return {
    text: whisperText,
    reason: text(whisper.reason || whisper.rule),
    confidence: confidence == null ? null : Math.round(Math.max(0, Math.min(1, confidence)) * 100),
    confidenceBand: text(whisper.confidenceBand || whisper.confidence_band).toLowerCase(),
    responseMode: text(whisper.responseMode || whisper.response_mode).toLowerCase(),
    checking: Boolean(whisper.checking || whisper.shouldVerify || whisper.should_verify),
    approvalNeeded: Boolean(whisper.approvalNeeded || whisper.approval_needed),
  };
}

function readAvaLiveCockpit(call: RuntimeCall) {
  const cockpit = record(call.avaLiveCockpit || call.ava_live_cockpit);
  const timeline = Array.isArray(cockpit.missionTimeline)
    ? cockpit.missionTimeline
        .map((entry, index) => {
          const step = record(entry);
          return {
            id: text(step.id, `ava-mission-${index}`),
            label: text(step.label, `Step ${index + 1}`),
            status: text(step.status, 'waiting').replace(/_/g, ' '),
            detail: text(step.detail),
          };
        })
        .filter((step) => step.label || step.detail)
    : [];
  const hasUsefulCockpit =
    timeline.length ||
    text(cockpit.nextBestQuestion) ||
    text(cockpit.replyPreview) ||
    Object.keys(record(cockpit.leadCommitProof)).length ||
    Object.keys(record(cockpit.memoryProof)).length ||
    Object.keys(record(cockpit.skillOutcomeProof)).length;
  if (!hasUsefulCockpit) return null;
  return {
    intent: text(cockpit.intent, 'unknown').replace(/_/g, ' '),
    phase: text(cockpit.phase, 'tracking').replace(/_/g, ' '),
    nextBestQuestion: text(cockpit.nextBestQuestion),
    latencyMs: number(cockpit.latencyMs),
    timeline,
    leadCommitProof: record(cockpit.leadCommitProof),
    memoryProof: record(cockpit.memoryProof),
    skillOutcomeProof: record(cockpit.skillOutcomeProof),
    humanHandoff: record(cockpit.humanHandoff),
    observability: record(cockpit.observability),
  };
}

function proofStatus(value: unknown, fallback = 'Ready') {
  const label = text(value, fallback).replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function LiveCallPip({
  calls,
  leadId = '',
  leadName = '',
  phone = '',
  address = '',
  onChanged,
}: LiveCallPipProps) {
  const runtimeCalls = useMemo(() => calls.map(record), [calls]);
  const liveCall = useMemo(
    () => selectLiveCall(runtimeCalls, text(leadId), phone),
    [runtimeCalls, leadId, phone]
  );
  const liveCallId = liveCall ? callId(liveCall) : '';
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);
  const [pendingAction, setPendingAction] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpAt, setFollowUpAt] = useState(tomorrowMorningInput);
  const [endCallTarget, setEndCallTarget] = useState<{
    id: string;
    leadName: string;
  } | null>(null);

  useEffect(() => {
    if (!liveCallId) return undefined;
    const timer = window.setInterval(() => setTick((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [liveCallId]);

  useEffect(() => {
    setExpanded(false);
    setNoteOpen(false);
    setFollowUpOpen(false);
    setNote('');
    setEndCallTarget(null);
  }, [liveCallId]);

  if (!liveCall) return null;

  const id = callId(liveCall);
  const resolvedLeadId = text(leadId || callLeadId(liveCall));
  const resolvedLeadName = text(leadName || liveCall.leadName, 'Selected seller');
  const resolvedPhone = text(phone || callPhone(liveCall));
  const resolvedAddress = text(address || liveCall.address);
  const transcript = mapTranscript(liveCall);
  const talkTime = readTalkTime(liveCall);
  const talkTotal = (talkTime.ava || 0) + (talkTime.seller || 0);
  const avaTalkWidth = talkTotal ? Math.round(((talkTime.ava || 0) / talkTotal) * 100) : 0;
  const sellerTalkWidth = talkTotal ? Math.round(((talkTime.seller || 0) / talkTotal) * 100) : 0;
  const sentiment = normalizeSentiment(liveCall);
  const operatorWhisper = readOperatorWhisper(liveCall);
  const avaLiveCockpit = readAvaLiveCockpit(liveCall);
  const startedAt = text(liveCall.startedAt || liveCall.connectedAt || liveCall.createdAt);

  const runCallControl = async (
    action: 'takeover' | 'mute' | 'end',
    label: string,
    targetCallId = id
  ) => {
    if (!targetCallId || pendingAction) return;
    setPendingAction(action);
    try {
      await controlRuntimeCall(targetCallId, action);
      showUiToast({ tone: 'success', title: label, desc: `${resolvedLeadName}: ${action}.` });
      onChanged?.();
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: `${label} failed`,
        desc: error instanceof Error ? error.message : 'The bridge rejected the call control.',
        critical: action === 'end',
      });
    } finally {
      setPendingAction('');
      if (action === 'end') setEndCallTarget(null);
    }
  };

  const saveNote = async (value: string, important = false) => {
    const nextNote = value.trim();
    if (!nextNote || pendingAction) return;
    setPendingAction(important ? 'important' : 'note');
    try {
      await saveLeadNoteRequest({
        leadId: resolvedLeadId,
        leadName: resolvedLeadName,
        phone: resolvedPhone,
        address: resolvedAddress,
        callId: id,
        note: nextNote,
        important,
        actor: 'Unified Inbox',
        source: 'live-call-pip',
      });
      setNote('');
      setNoteOpen(false);
      showUiToast({
        tone: 'success',
        title: important ? 'Call marked important' : 'Call note saved',
        desc: 'The lead timeline was updated through the bridge.',
      });
      onChanged?.();
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: important ? 'Important flag not saved' : 'Call note not saved',
        desc: error instanceof Error ? error.message : 'The bridge rejected the note.',
      });
    } finally {
      setPendingAction('');
    }
  };

  const scheduleFollowUp = async () => {
    const followUpDate = new Date(followUpAt);
    if (
      !resolvedLeadId ||
      !Number.isFinite(followUpDate.getTime()) ||
      followUpDate.getTime() <= Date.now() ||
      pendingAction
    ) {
      showUiToast({
        tone: 'warning',
        title: 'Choose a valid follow-up',
        desc: resolvedLeadId
          ? 'Select a future date and time.'
          : 'Link this conversation to a lead before scheduling.',
      });
      return;
    }
    const startTime = followUpDate.toISOString();
    setPendingAction('follow-up');
    try {
      await scheduleAppointmentRequest({
        leadId: resolvedLeadId,
        leadName: resolvedLeadName,
        phone: resolvedPhone,
        address: resolvedAddress,
        startTime,
        scheduledFor: startTime,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
        source: 'live-call-pip',
        actor: 'Unified Inbox',
        notes: `Follow-up scheduled from live call ${id}.`,
      });
      setFollowUpOpen(false);
      showUiToast({
        tone: 'success',
        title: 'Follow-up scheduled',
        desc: new Date(startTime).toLocaleString(),
      });
      onChanged?.();
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Follow-up not scheduled',
        desc: error instanceof Error ? error.message : 'The bridge rejected the appointment.',
      });
    } finally {
      setPendingAction('');
    }
  };

  return (
    <aside className={`pbk-live-call-pip ${expanded ? 'expanded' : ''}`} aria-label="Live call">
      <button
        type="button"
        className="pbk-live-call-pip-head"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <span className="pbk-live-call-pulse" aria-hidden="true" />
        <span>
          <small>{callStatusLabel(liveCall.status)}</small>
          <strong>{resolvedLeadName}</strong>
        </span>
        <span className="pbk-live-call-duration">
          <Clock3 size={13} />
          {formatElapsed(startedAt, tick)}
        </span>
        {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>

      <div className="pbk-live-call-pip-summary">
        <span title={resolvedPhone || undefined}>
          <Phone size={12} />
          {resolvedPhone || 'Phone not available'}
        </span>
        <span>
          <Activity size={12} />
          Sentiment:{' '}
          {sentiment == null
            ? 'Not available'
            : `${sentiment} / ${sentimentLabel(sentiment, liveCall)}`}
        </span>
      </div>

      {expanded && (
        <div className="pbk-live-call-pip-body">
          <div className="pbk-live-call-talk-grid">
            <div>
              <span>
                <Bot size={13} />
                Ava talk time
              </span>
              <strong>{talkTimeLabel(talkTime.ava)}</strong>
              <i style={{ width: `${avaTalkWidth}%` }} />
            </div>
            <div>
              <span>
                <UserRound size={13} />
                Seller talk time
              </span>
              <strong>{talkTimeLabel(talkTime.seller)}</strong>
              <i style={{ width: `${sellerTalkWidth}%` }} />
            </div>
          </div>

          {operatorWhisper && (
            <section
              className={`pbk-live-call-whisper ${
                operatorWhisper.checking ? 'is-checking' : ''
              }`.trim()}
              aria-label="Private Ava operator coaching"
              aria-live="polite"
            >
              <div>
                <span>
                  <Sparkles size={13} />
                  Ava whisper
                </span>
                <small>
                  {operatorWhisper.checking ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Ava is checking
                    </>
                  ) : operatorWhisper.confidence == null ? (
                    'Live guidance'
                  ) : (
                    `${operatorWhisper.confidence}% confidence`
                  )}
                </small>
              </div>
              <strong>{operatorWhisper.text}</strong>
              {(operatorWhisper.reason ||
                operatorWhisper.confidenceBand ||
                operatorWhisper.responseMode ||
                operatorWhisper.approvalNeeded) && (
                <p>
                  {operatorWhisper.reason}
                  {operatorWhisper.confidenceBand
                    ? `${operatorWhisper.reason ? ' · ' : ''}${operatorWhisper.confidenceBand} evidence confidence`
                    : ''}
                  {operatorWhisper.responseMode &&
                  !['proceed', 'boundary'].includes(operatorWhisper.responseMode)
                    ? `${
                        operatorWhisper.reason || operatorWhisper.confidenceBand ? ' · ' : ''
                      }Mode: ${operatorWhisper.responseMode}`
                    : ''}
                  {operatorWhisper.approvalNeeded
                    ? `${
                        operatorWhisper.reason ||
                        operatorWhisper.confidenceBand ||
                        operatorWhisper.responseMode
                          ? ' · '
                          : ''
                      }Approval required before action`
                    : ''}
                </p>
              )}
            </section>
          )}

          {avaLiveCockpit && (
            <section className="pbk-live-call-cockpit" aria-label="Ava mission timeline">
              <div className="pbk-live-call-cockpit-head">
                <span>
                  <Sparkles size={13} />
                  Ava mission timeline
                </span>
                <small>
                  {avaLiveCockpit.phase}
                  {avaLiveCockpit.latencyMs == null
                    ? ''
                    : ` - ${avaLiveCockpit.latencyMs}ms response`}
                </small>
              </div>
              <div className="pbk-live-call-cockpit-next">
                <b>Next best action</b>
                <span>
                  {avaLiveCockpit.nextBestQuestion ||
                    `Tracking ${avaLiveCockpit.intent || 'seller context'}.`}
                </span>
              </div>
              <ol className="pbk-live-call-mission-timeline">
                {avaLiveCockpit.timeline.slice(0, 7).map((step) => (
                  <li key={step.id || step.label}>
                    <b>{step.label}</b>
                    <small>{proofStatus(step.status)}</small>
                    {step.detail && <span>{step.detail}</span>}
                  </li>
                ))}
              </ol>
              <div className="pbk-live-call-proof-grid">
                <div>
                  <b>CRM proof</b>
                  <span>
                    {proofStatus(avaLiveCockpit.leadCommitProof.envelope, 'LeadCommitEnvelope')}
                  </span>
                  <small>
                    {number(avaLiveCockpit.leadCommitProof.fieldCount) || 0} protected field
                    {(number(avaLiveCockpit.leadCommitProof.fieldCount) || 0) === 1 ? '' : 's'}
                  </small>
                </div>
                <div>
                  <b>Memory proof</b>
                  <span>{proofStatus(avaLiveCockpit.memoryProof.hotMemory, 'Fast memory')}</span>
                  <small>
                    {proofStatus(
                      avaLiveCockpit.observability.memoryWrite,
                      'Post-call learning ready'
                    )}
                  </small>
                </div>
                <div>
                  <b>Skill proof</b>
                  <span>
                    {text(avaLiveCockpit.skillOutcomeProof.skillName) ||
                      text(avaLiveCockpit.skillOutcomeProof.skillId) ||
                      'No active skill'}
                  </span>
                  <small>
                    {avaLiveCockpit.skillOutcomeProof.ready
                      ? 'Outcome can be scored'
                      : 'Waiting for skill match'}
                  </small>
                </div>
              </div>
            </section>
          )}

          <section className="pbk-live-call-transcript" aria-label="Live transcript">
            <div>
              <strong>Open transcript</strong>
              <span>{transcript.length ? `${transcript.length} lines` : 'Not available'}</span>
            </div>
            {transcript.length ? (
              transcript.slice(-10).map((line) => (
                <p key={line.id}>
                  <b>
                    {line.speaker === 'seller' ? 'Seller' : line.speaker === 'ava' ? 'Ava' : 'You'}
                  </b>
                  <span>{line.text}</span>
                </p>
              ))
            ) : (
              <p className="empty">No transcript has reached the bridge yet.</p>
            )}
          </section>

          {!resolvedLeadId && (
            <div className="pbk-live-call-context-guard" role="status">
              Link this conversation to a lead to save notes or schedule follow-up.
            </div>
          )}

          <div className="pbk-live-call-secondary-actions">
            <button
              type="button"
              onClick={() => void saveNote(`Important live call with ${resolvedLeadName}.`, true)}
              disabled={!resolvedLeadId || Boolean(pendingAction)}
              title="Mark important"
            >
              {pendingAction === 'important' ? <Loader2 className="animate-spin" /> : <Flag />}
              Mark important
            </button>
            <button
              type="button"
              onClick={() => setNoteOpen((current) => !current)}
              aria-expanded={noteOpen}
              disabled={!resolvedLeadId || Boolean(pendingAction)}
            >
              <MessageSquarePlus />
              Add note
            </button>
            <button
              type="button"
              onClick={() => setFollowUpOpen((current) => !current)}
              aria-expanded={followUpOpen}
              disabled={!resolvedLeadId || Boolean(pendingAction)}
            >
              <CalendarPlus />
              Follow-up
            </button>
          </div>

          {noteOpen && (
            <div className="pbk-live-call-inline-form">
              <label>
                <span>Call note</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Capture the objection, promise, or next step..."
                />
              </label>
              <button
                type="button"
                onClick={() => void saveNote(note)}
                disabled={!note.trim() || Boolean(pendingAction)}
              >
                {pendingAction === 'note' && <Loader2 className="animate-spin" />}
                Save note
              </button>
            </div>
          )}

          {followUpOpen && (
            <div className="pbk-live-call-inline-form follow-up">
              <label>
                <span>Follow-up time</span>
                <input
                  type="datetime-local"
                  value={followUpAt}
                  onChange={(event) => setFollowUpAt(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => void scheduleFollowUp()}
                disabled={!followUpAt || !resolvedLeadId || Boolean(pendingAction)}
              >
                {pendingAction === 'follow-up' && <Loader2 className="animate-spin" />}
                Schedule
              </button>
            </div>
          )}

          <div className="pbk-live-call-primary-actions">
            <button
              type="button"
              onClick={() => void runCallControl('takeover', 'Call transferred to operator')}
              disabled={!id || Boolean(pendingAction)}
            >
              {pendingAction === 'takeover' ? <Loader2 className="animate-spin" /> : <Hand />}
              Take over
            </button>
            <button
              type="button"
              onClick={() => void runCallControl('mute', 'Ava muted')}
              disabled={!id || Boolean(pendingAction)}
            >
              {pendingAction === 'mute' ? <Loader2 className="animate-spin" /> : <MicOff />}
              Mute Ava
            </button>
            <button
              type="button"
              className="danger"
              onClick={() =>
                setEndCallTarget({
                  id,
                  leadName: resolvedLeadName,
                })
              }
              disabled={!id || Boolean(pendingAction)}
            >
              <PhoneOff />
              End
            </button>
          </div>

          <PbkDataSource
            endpoint="snapshot.calls + POST /api/calls/:id/action"
            status="ships"
            note="private hint: calls[].operatorWhisper; lead notes: POST /api/leads/add-note; follow-up: POST /api/appointments"
          />
        </div>
      )}

      <AlertDialog
        open={Boolean(endCallTarget)}
        onOpenChange={(open) => {
          if (!open) setEndCallTarget(null);
        }}
      >
        <AlertDialogContent className="pbk-conversation-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>End the live call?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends a provider hang-up command for{' '}
              {endCallTarget?.leadName || resolvedLeadName}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep call live</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void runCallControl('end', 'Call ended', endCallTarget?.id || '')}
            >
              <PhoneOff size={14} />
              End call
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
