import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  Mic,
  Send,
  Sparkles,
  Square,
  UserRoundPen,
  WandSparkles,
} from 'lucide-react';
import { PbkDataSource } from '../../../components/pbk/index';
import { getSmsSegmentInfo } from '../../routes/inboxRuntimeLogic.js';
import {
  fetchReplyTemplatesRequest,
  fetchSenderIdentitiesRequest,
  fetchSenderRecommendationRequest,
  refineConversationDraftRequest,
  sendConversationMessageRequest,
  syncSenderIdentitiesRequest,
  type CommunicationSenderIdentity,
  type ConversationEvent,
  type ConversationThread,
  type ReplyTemplateRecord,
} from '../../utils/runtimeBridge';
import { showUiToast } from '../../utils/uiFeedback';
import { getSenderRestrictionReason } from '../../routes/conversationRuntimeLogic.js';
import { SenderIdentitySelect } from './SenderIdentitySelect';

type Channel = 'sms' | 'email';

type ConversationComposerProps = {
  thread: ConversationThread;
  lead?: Record<string, unknown> | null;
  recipientSummary?: { phone?: string; email?: string } | null;
  events: ConversationEvent[];
  initialChannel?: Channel;
  onSent: () => void;
};

type SpeechRecognitionResultEvent = Event & {
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type ComposerOutcome = {
  tone: 'success' | 'warning' | 'error';
  title: string;
  detail: string;
};

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function getLeadProfile(payload?: Record<string, unknown> | null) {
  const root = record(payload);
  return record(root.lead || root.profile || root);
}

function getRecipient(
  thread: ConversationThread,
  lead: Record<string, unknown> | null | undefined,
  recipientSummary: { phone?: string; email?: string } | null | undefined,
  channel: Channel
) {
  const identityType = channel === 'sms' ? 'phone' : 'email';
  const identity = thread.identities?.find((candidate) => candidate.identityType === identityType);
  const profile = getLeadProfile(lead);
  const seller = record(profile.seller);
  return text(
    identity?.displayValue ||
      identity?.normalizedValue ||
      identity?.value ||
      recipientSummary?.[channel === 'sms' ? 'phone' : 'email'] ||
      profile[channel === 'sms' ? 'phone' : 'email'] ||
      seller[channel === 'sms' ? 'phone' : 'email']
  );
}

function latestInboundBody(events: ConversationEvent[]) {
  return [...events]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .find((event) => text(event.direction).toLowerCase() === 'inbound')?.body;
}

function normalizeTemplates(response: {
  selected?: ReplyTemplateRecord;
  templates?: Record<string, ReplyTemplateRecord>;
}) {
  const values = [
    ...(response.selected ? [response.selected] : []),
    ...Object.values(response.templates || {}),
  ];
  const seen = new Set<string>();
  return values.filter((template) => {
    const body = text(template.text || template.html);
    if (!body || seen.has(body)) return false;
    seen.add(body);
    return true;
  });
}

function dncBlocked(lead?: Record<string, unknown> | null) {
  const profile = getLeadProfile(lead);
  const compliance = record(profile.compliance);
  const status = text(profile.dncStatus || compliance.dncStatus).toLowerCase();
  return profile.dnc === true || /blocked|dnc|do_not_contact|do not contact/.test(status);
}

function explainRecommendationGuard(reasonCodes: string[]) {
  if (reasonCodes.includes('dnc_blocked')) return 'This seller is marked do not contact.';
  if (reasonCodes.some((reasonCode) => reasonCode.startsWith('consent_'))) {
    return 'Verified SMS consent is required before PBK can recommend a sender.';
  }
  if (reasonCodes.includes('no_eligible_sender')) {
    return 'No eligible sender is connected for this channel.';
  }
  return reasonCodes.length
    ? `The bridge did not approve a sender: ${reasonCodes.join(', ').replace(/_/g, ' ')}.`
    : 'The bridge did not approve a sender for this channel.';
}

function ComposerOutcomeBanner({
  outcome,
  label,
  onDismiss,
}: {
  outcome: ComposerOutcome;
  label: string;
  onDismiss: () => void;
}) {
  const OutcomeIcon = outcome.tone === 'success' ? CheckCircle2 : AlertTriangle;
  return (
    <div
      className={`pbk-composer-outcome ${outcome.tone}`}
      role={outcome.tone === 'error' ? 'alert' : 'status'}
    >
      <OutcomeIcon size={15} />
      <span>
        <strong>{outcome.title}</strong>
        <small>{outcome.detail}</small>
      </span>
      <button type="button" onClick={onDismiss} aria-label={`Dismiss ${label}`}>
        Dismiss
      </button>
    </div>
  );
}

export function ConversationComposer({
  thread,
  lead,
  recipientSummary,
  events,
  initialChannel = 'sms',
  onSent,
}: ConversationComposerProps) {
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [senderIdentities, setSenderIdentities] = useState<CommunicationSenderIdentity[]>([]);
  const [senderIdentityId, setSenderIdentityId] = useState('');
  const [recommendedId, setRecommendedId] = useState('');
  const [senderLoading, setSenderLoading] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendLater, setSendLater] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [refining, setRefining] = useState(false);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [templates, setTemplates] = useState<ReplyTemplateRecord[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [notice, setNotice] = useState<ComposerOutcome | null>(null);
  const [sendOutcome, setSendOutcome] = useState<ComposerOutcome | null>(null);
  const [recommendationGuard, setRecommendationGuard] = useState('');
  const [submittedFingerprint, setSubmittedFingerprint] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const senderRequestSequence = useRef(0);
  const senderSyncAttempted = useRef(false);
  const templateRequestSequence = useRef(0);
  const bodyRef = useRef(body);
  const subjectRef = useRef(subject);
  const channelRef = useRef(channel);
  bodyRef.current = body;
  subjectRef.current = subject;
  channelRef.current = channel;

  const profile = getLeadProfile(lead);
  const seller = record(profile.seller);
  const property = record(profile.property);
  const templateLeadName = text(profile.leadName || profile.name || seller.name || thread.title);
  const templateAddress = text(profile.address || property.address || property.propertyAddress);
  const templateInboundBody = useMemo(() => latestInboundBody(events) || '', [events]);
  const recipient = getRecipient(thread, lead, recipientSummary, channel);
  const selectedSender =
    senderIdentities.find((identity) => identity.id === senderIdentityId) || null;
  const senderRestriction = selectedSender ? getSenderRestrictionReason(selectedSender) : '';
  const recipientRepairHref = thread.leadId
    ? `/leads/${encodeURIComponent(thread.leadId)}`
    : '/leads?new=1';
  const senderMatchesChannel = selectedSender?.channel === channel;
  const blockedByDnc = dncBlocked(lead);
  const segmentInfo = useMemo(() => getSmsSegmentInfo(body), [body]);
  const scheduleInvalid =
    sendLater && (!scheduledFor || new Date(scheduledFor).getTime() <= Date.now());
  const sendFingerprint = JSON.stringify({
    channel,
    senderIdentityId,
    recipient,
    subject: channel === 'email' ? subject.trim() : '',
    body: body.trim(),
    scheduledFor: sendLater ? scheduledFor : '',
  });
  const exactMessageAlreadyQueued =
    Boolean(submittedFingerprint) && submittedFingerprint === sendFingerprint;
  const sendDisabledReason = blockedByDnc
    ? 'This seller is marked do not contact.'
    : recommendationGuard
      ? recommendationGuard
      : !recipient
        ? `Add a canonical ${channel === 'sms' ? 'phone number' : 'email address'} to this lead.`
        : senderLoading
          ? 'Connected senders are still loading.'
          : !senderIdentityId
            ? `Choose an eligible ${channel === 'sms' ? 'Telnyx number' : 'Instantly email account'}.`
            : !senderMatchesChannel
              ? 'Choose a sender that matches the active channel.'
              : senderRestriction
                ? senderRestriction
                : !body.trim()
                  ? 'Write a message to enable Send.'
                  : scheduleInvalid
                    ? 'Choose a future schedule time.'
                    : exactMessageAlreadyQueued
                      ? 'This exact message is already queued. Edit it before submitting another copy.'
                      : '';
  const canSend =
    Boolean(recipient && body.trim() && senderIdentityId && senderMatchesChannel) &&
    !senderLoading &&
    !senderRestriction &&
    !blockedByDnc &&
    !recommendationGuard &&
    !scheduleInvalid &&
    !exactMessageAlreadyQueued &&
    !sending;

  const loadSenders = useCallback(async () => {
    const requestId = ++senderRequestSequence.current;
    setSenderLoading(true);
    setNotice(null);
    setRecommendationGuard('');
    try {
      let inventory = await fetchSenderIdentitiesRequest({ channel });
      if (!(inventory.items || []).length && !senderSyncAttempted.current) {
        senderSyncAttempted.current = true;
        const sync = await syncSenderIdentitiesRequest();
        inventory = await fetchSenderIdentitiesRequest({ channel });
        const unavailableProviders = Object.entries(record(sync.providers))
          .filter(([, value]) => record(value).ok === false)
          .map(([provider]) => provider);
        if (unavailableProviders.length) {
          setNotice({
            tone: 'warning',
            title: 'Some senders need attention',
            detail: `${unavailableProviders.join(' and ')} could not refresh. Available connected identities are still shown.`,
          });
        }
      }
      const recommendation = await fetchSenderRecommendationRequest(thread.id, channel);
      if (requestId !== senderRequestSequence.current) return;
      const identities = inventory.items || [];
      const recommended = recommendation.recommended || null;
      setSenderIdentities(identities);
      setRecommendedId(recommended?.id || '');
      if (!recommended) {
        setRecommendationGuard(explainRecommendationGuard(recommendation.reasonCodes || []));
      } else if (recommendation.reasonCodes?.includes('approval_required')) {
        setNotice({
          tone: 'warning',
          title: 'SMS approval required',
          detail:
            'Consent needs review. You can draft and submit this message, but PBK will not send it until an operator approves it.',
        });
      }
      setSenderIdentityId((current) => {
        if (!recommended) return '';
        if (identities.some((identity) => identity.id === current)) return current;
        if (
          recommended &&
          identities.some((identity) => identity.id === recommended.id) &&
          !getSenderRestrictionReason(recommended)
        ) {
          return recommended.id;
        }
        return '';
      });
    } catch (error) {
      if (requestId !== senderRequestSequence.current) return;
      setSenderIdentities([]);
      setSenderIdentityId('');
      setRecommendationGuard('Sender eligibility could not be verified.');
      setNotice({
        tone: 'error',
        title: 'Sender inventory unavailable',
        detail: error instanceof Error ? error.message : 'Unable to load connected senders.',
      });
    } finally {
      if (requestId === senderRequestSequence.current) setSenderLoading(false);
    }
  }, [channel, thread.id]);

  useEffect(() => {
    void loadSenders();
    return () => {
      senderRequestSequence.current += 1;
    };
  }, [loadSenders]);

  useEffect(() => {
    const requestId = ++templateRequestSequence.current;
    setTemplatesLoading(true);
    void fetchReplyTemplatesRequest({
      channel,
      leadName: templateLeadName,
      address: templateAddress,
      body: templateInboundBody,
    })
      .then((response) => {
        if (requestId === templateRequestSequence.current) {
          setTemplates(normalizeTemplates(response).slice(0, 4));
        }
      })
      .catch(() => {
        if (requestId === templateRequestSequence.current) setTemplates([]);
      })
      .finally(() => {
        if (requestId === templateRequestSequence.current) setTemplatesLoading(false);
      });
    return () => {
      templateRequestSequence.current += 1;
    };
  }, [channel, templateAddress, templateInboundBody, templateLeadName]);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    []
  );

  const startListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognition = speechRecognitionConstructor();
    if (!SpeechRecognition) {
      showUiToast({
        tone: 'warning',
        title: 'Voice dictation unavailable',
        desc: 'This browser does not expose speech recognition.',
      });
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setListening(false);
      showUiToast({
        tone: 'error',
        title: 'Voice dictation stopped',
        desc: event.error || 'Speech recognition could not continue.',
      });
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join(' ')
        .trim();
      if (transcript) setBody(transcript);
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const refineDraft = async () => {
    if (!body.trim() || refining) return;
    const requestedChannel = channel;
    const requestedBody = body;
    const requestedSubject = subject;
    setRefining(true);
    setNotice(null);
    try {
      const response = await refineConversationDraftRequest(thread.id, {
        channel,
        draft: requestedBody,
        subject: requestedSubject,
      });
      if (!response.refinedDraft) throw new Error(response.error || 'Ava returned no revision.');
      if (
        channelRef.current === requestedChannel &&
        bodyRef.current === requestedBody &&
        subjectRef.current === requestedSubject
      ) {
        setBody(response.refinedDraft);
        setNotice({
          tone: response.degraded ? 'warning' : 'success',
          title: response.degraded ? 'Original draft preserved' : 'Ava refinement ready',
          detail: 'Review and edit the draft before sending. Nothing was sent automatically.',
        });
      } else {
        setNotice({
          tone: 'warning',
          title: 'Newer draft preserved',
          detail:
            'The message changed while Ava was working. Run Refine again on the current text.',
        });
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Ava refinement unavailable',
        detail: error instanceof Error ? error.message : 'Unable to refine this draft.',
      });
    } finally {
      setRefining(false);
    }
  };

  const sendMessage = async () => {
    if (!canSend) return;
    const submittedChannel = channel;
    const submittedBody = body.trim();
    const submittedSubject = channel === 'email' ? subject.trim() : '';
    const submittedSendFingerprint = sendFingerprint;
    setSending(true);
    setSendOutcome(null);
    try {
      const response = await sendConversationMessageRequest(thread.id, {
        channel,
        senderIdentityId,
        body: submittedBody,
        subject: channel === 'email' ? submittedSubject : undefined,
        scheduledFor: sendLater ? new Date(scheduledFor).toISOString() : undefined,
        actor: 'PBK operator',
        requestedBy: 'unified-inbox',
      });
      const approvalRequired =
        Boolean(response.approval) || response.result === 'approval_required';
      setSendOutcome({
        tone: approvalRequired || response.scheduled ? 'warning' : 'success',
        title: approvalRequired
          ? 'Queued for approval'
          : response.scheduled
            ? 'Message scheduled'
            : 'Message accepted',
        detail: approvalRequired
          ? 'Ava/Rex approval is required before the provider sends this message.'
          : response.scheduled
            ? `Scheduled for ${new Date(response.scheduledFor || scheduledFor).toLocaleString()}.`
            : `Provider result: ${response.result || 'accepted'}.`,
      });
      if (approvalRequired || response.scheduled) {
        setSubmittedFingerprint(submittedSendFingerprint);
      } else if (
        channelRef.current === submittedChannel &&
        bodyRef.current.trim() === submittedBody &&
        (submittedChannel !== 'email' || subjectRef.current.trim() === submittedSubject)
      ) {
        setBody('');
        if (submittedChannel === 'email') setSubject('');
      }
      onSent();
    } catch (error) {
      setSendOutcome({
        tone: 'error',
        title: 'Message not sent',
        detail: error instanceof Error ? error.message : 'The bridge rejected the message.',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="pbk-conversation-composer" aria-label="Message composer">
      <div className="pbk-composer-topline">
        <div className="pbk-composer-channel" aria-label="Message channel">
          <button
            type="button"
            className={channel === 'sms' ? 'active' : ''}
            aria-pressed={channel === 'sms'}
            onClick={() => {
              setChannel('sms');
              setNotice(null);
            }}
          >
            <MessageSquare size={14} />
            SMS
          </button>
          <button
            type="button"
            className={channel === 'email' ? 'active' : ''}
            aria-pressed={channel === 'email'}
            onClick={() => {
              setChannel('email');
              setNotice(null);
            }}
          >
            <Mail size={14} />
            Email
          </button>
        </div>
        <span className="pbk-composer-recipient" title={recipient || undefined}>
          To: {recipient || `No ${channel === 'sms' ? 'phone number' : 'email address'}`}
        </span>
      </div>

      <SenderIdentitySelect
        identities={senderIdentities}
        selectedId={senderIdentityId}
        recommendedId={recommendedId}
        loading={senderLoading}
        disabled={sending}
        onChange={(identityId) => {
          setSenderIdentityId(identityId);
          setNotice(null);
        }}
      />

      {channel === 'email' && (
        <label className="pbk-composer-subject">
          <span>Subject</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Seller follow-up"
          />
        </label>
      )}

      <label className="pbk-composer-body">
        <span className="sr-only">Message body</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            channel === 'sms'
              ? 'Write a clear seller text...'
              : 'Write a thoughtful seller email...'
          }
          rows={4}
        />
      </label>

      <div className="pbk-composer-smart-replies" aria-label="Ava smart replies">
        <span>
          <Sparkles size={12} />
          Smart replies
        </span>
        {templatesLoading && <Loader2 size={13} className="animate-spin" />}
        {templates.map((template, index) => (
          <button
            key={`${template.templateKey || 'reply'}-${index}`}
            type="button"
            onClick={() => {
              setBody(text(template.text || template.html));
              if (channel === 'email' && template.subject) setSubject(template.subject);
            }}
            title={text(template.text || template.html)}
          >
            {text(template.text || template.html).slice(0, 52)}
          </button>
        ))}
      </div>

      <div className="pbk-composer-tools">
        <button
          type="button"
          className={listening ? 'active listening' : ''}
          onClick={startListening}
          aria-pressed={listening}
        >
          {listening ? <Square size={13} /> : <Mic size={14} />}
          {listening ? 'Stop dictation' : 'Ava mic'}
        </button>
        <button
          type="button"
          onClick={() => void refineDraft()}
          disabled={!body.trim() || refining}
        >
          {refining ? <Loader2 size={14} className="animate-spin" /> : <WandSparkles size={14} />}
          Refine with Ava
        </button>
        <label className="pbk-composer-schedule-toggle">
          <input
            type="checkbox"
            checked={sendLater}
            onChange={(event) => setSendLater(event.target.checked)}
          />
          <CalendarClock size={14} />
          Send later
        </label>
        {sendLater && (
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(event) => setScheduledFor(event.target.value)}
            aria-label="Scheduled send time"
          />
        )}
        <span className="pbk-composer-count">
          {channel === 'sms'
            ? `${segmentInfo.segments} segment${segmentInfo.segments === 1 ? '' : 's'} · ${segmentInfo.encoding}`
            : `${body.length} characters`}
        </span>
      </div>

      {!canSend && sendDisabledReason && !sending && (
        <div
          id="conversation-send-requirement"
          className={`pbk-composer-guard ${
            blockedByDnc || recommendationGuard || senderRestriction || scheduleInvalid
              ? ''
              : 'neutral'
          }`}
          role={blockedByDnc || recommendationGuard ? 'alert' : 'status'}
        >
          <span>{sendDisabledReason}</span>
          {!recipient && (
            <Link to={recipientRepairHref}>
              <UserRoundPen size={13} aria-hidden="true" />
              {thread.leadId ? 'Add contact info' : 'Create lead'}
            </Link>
          )}
        </div>
      )}

      {notice && (
        <ComposerOutcomeBanner
          outcome={notice}
          label="composer notice"
          onDismiss={() => setNotice(null)}
        />
      )}
      {sendOutcome && (
        <ComposerOutcomeBanner
          outcome={sendOutcome}
          label="send result"
          onDismiss={() => setSendOutcome(null)}
        />
      )}

      <div className="pbk-composer-send-row">
        <span>
          Voice and Ava refinement only edit this draft. The bridge sends only when you press Send.
        </span>
        <button
          type="button"
          onClick={() => void sendMessage()}
          disabled={!canSend}
          aria-describedby={
            !canSend && sendDisabledReason && !sending ? 'conversation-send-requirement' : undefined
          }
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {sendLater ? 'Schedule' : 'Send'}
        </button>
      </div>
      <PbkDataSource
        endpoint="POST /api/conversations/:threadId/messages"
        status="ships"
        note="explicit sender, provider safety, scheduling, and approvals"
      />
    </section>
  );
}
