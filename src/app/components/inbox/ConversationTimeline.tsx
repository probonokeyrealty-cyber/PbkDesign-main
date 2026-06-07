import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileSignature,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Play,
  RefreshCw,
  ShieldCheck,
  StickyNote,
  Copy,
  Flag,
  Trash2,
} from 'lucide-react';
import { PbkDataSource } from '../../../components/pbk/index';
import {
  patchConversationEventRequest,
  reportConversationEventSpamRequest,
  restoreConversationEventRequest,
  type ConversationEvent,
  type ConversationThread,
} from '../../utils/runtimeBridge';
import { showUiToast, toastUndo } from '../../utils/uiFeedback';
import { groupConversationEventsByDay } from '../../routes/conversationRuntimeLogic.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
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

type ConversationTimelineProps = {
  thread?: ConversationThread | null;
  events: ConversationEvent[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpenProfile: () => void;
  onLatestSeen: () => void;
  onEventChanged: () => void;
};

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function eventKind(event: ConversationEvent) {
  const kind = text(event.eventType).toLowerCase();
  if (event.channel === 'sms' || kind.includes('sms')) return 'sms';
  if (event.channel === 'email' || kind.includes('email')) return 'email';
  if (kind.includes('transcript')) return 'transcript';
  if (event.channel === 'call' || kind.includes('call') || kind.includes('recording')) return 'call';
  if (kind.includes('docusign') || kind.includes('contract') || kind.includes('envelope'))
    return 'contract';
  if (kind.includes('approval')) return 'approval';
  if (kind.includes('note')) return 'note';
  return 'system';
}

function EventIcon({ kind }: { kind: ReturnType<typeof eventKind> }) {
  const icons = {
    sms: MessageSquare,
    email: Mail,
    transcript: Bot,
    call: Phone,
    contract: FileSignature,
    approval: ShieldCheck,
    note: StickyNote,
    system: Clock3,
  };
  const Icon = icons[kind];
  return <Icon size={15} aria-hidden="true" />;
}

function getRecordingUrl(event: ConversationEvent) {
  const payload = record(event.payload);
  return text(
    payload.recordingUrl ||
      payload.recording_url ||
      payload.audioUrl ||
      payload.audio_url ||
      payload.mediaUrl
  );
}

function getTranscriptSegments(event: ConversationEvent) {
  const payload = record(event.payload);
  const candidates = [payload.segments, payload.transcriptSegments, payload.words];
  const source = candidates.find(Array.isArray);
  if (!Array.isArray(source)) return [];
  return source
    .map((entry) => record(entry))
    .map((entry) => ({
      text: text(entry.text || entry.word || entry.transcript),
      start: Number(entry.start ?? entry.startTime ?? entry.offset ?? 0),
    }))
    .filter((entry) => entry.text);
}

function ConversationEventRow({
  event,
  onEventChanged,
}: {
  event: ConversationEvent;
  onEventChanged: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const kind = eventKind(event);
  const message = kind === 'sms' || kind === 'email';
  const outbound = text(event.direction).toLowerCase() === 'outbound';
  const spamEligible = message && !outbound;
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmSpam, setConfirmSpam] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const recordingUrl = getRecordingUrl(event);
  const transcriptSegments = getTranscriptSegments(event);
  const body = text(event.body || event.subject, 'Activity recorded');

  const seekRecording = (seconds: number) => {
    if (!audioRef.current || !Number.isFinite(seconds)) return;
    audioRef.current.currentTime = Math.max(0, seconds);
    void audioRef.current.play();
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = () => {
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      setMenuOpen(true);
      longPressTimerRef.current = null;
    }, 550);
  };

  useEffect(
    () => () => {
      clearLongPress();
    },
    []
  );

  const copyEvent = async () => {
    try {
      await navigator.clipboard.writeText(
        [event.subject, event.body].map((value) => text(value)).filter(Boolean).join('\n')
      );
      showUiToast({ tone: 'success', title: 'Copied to clipboard' });
    } catch {
      showUiToast({ tone: 'error', title: 'Copy failed' });
    }
  };

  const markImportant = async () => {
    setActionPending(true);
    try {
      await patchConversationEventRequest(event.id, { important: true });
      onEventChanged();
      showUiToast({ tone: 'success', title: 'Marked important' });
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Could not mark important',
        desc: error instanceof Error ? error.message : 'The bridge rejected the update.',
      });
    } finally {
      setActionPending(false);
    }
  };

  const softDelete = async () => {
    setActionPending(true);
    try {
      await patchConversationEventRequest(event.id, { hidden: true });
      onEventChanged();
      toastUndo({
        title: 'Activity removed from this timeline',
        desc: 'The event is soft-deleted and can be restored.',
        undo: async () => {
          await restoreConversationEventRequest(event.id);
          onEventChanged();
        },
      });
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Could not remove activity',
        desc: error instanceof Error ? error.message : 'The bridge rejected the update.',
      });
    } finally {
      setActionPending(false);
    }
  };

  const reportSpam = async () => {
    if (!spamEligible) return;
    setActionPending(true);
    try {
      await reportConversationEventSpamRequest(event.id, {
        reason: 'Reported by PBK operator from unified inbox',
        actor: 'PBK operator',
      });
      onEventChanged();
      showUiToast({
        tone: 'warning',
        title: 'Reported as spam',
        desc: 'PBK recorded the report. Explicit opt-outs are also added to DNC.',
      });
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Spam report failed',
        desc: error instanceof Error ? error.message : 'The bridge rejected the report.',
      });
    } finally {
      setActionPending(false);
      setConfirmSpam(false);
    }
  };

  const eventMenu = (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="pbk-conversation-event-menu-trigger"
            aria-label="Open activity actions"
          >
            {actionPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <MoreHorizontal size={15} />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="pbk-conversation-event-menu">
          <DropdownMenuItem onSelect={() => void copyEvent()}>
            <Copy />
            Copy
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void markImportant()}>
            <Flag />
            Mark important
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {spamEligible && (
            <DropdownMenuItem onSelect={() => setConfirmSpam(true)}>
              <ShieldCheck />
              Report spam
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => void softDelete()}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {spamEligible && (
        <AlertDialog open={confirmSpam} onOpenChange={setConfirmSpam}>
          <AlertDialogContent className="pbk-conversation-confirm-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Report this inbound message as spam?</AlertDialogTitle>
              <AlertDialogDescription>
                PBK will keep an audit record. If this message contains an explicit opt-out, the
                seller phone is added to DNC.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void reportSpam()}>
                <ShieldCheck size={14} />
                Report spam
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );

  if (message) {
    return (
      <article
        className={`pbk-conversation-bubble ${outbound ? 'outbound' : 'inbound'}`}
        aria-label={`${outbound ? 'Outbound' : 'Inbound'} ${kind}`}
        onPointerDown={startLongPress}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onPointerMove={clearLongPress}
      >
        {eventMenu}
        {event.subject && <div className="pbk-conversation-subject">{event.subject}</div>}
        <div className="pbk-conversation-body">{body}</div>
        <div className="pbk-conversation-event-meta">
          <span>{formatTime(event.occurredAt)}</span>
          <span>{text(event.provider, kind)}</span>
          <span className={`status ${text(event.status).toLowerCase()}`}>
            {text(event.status, outbound ? 'sent' : 'received').replace(/_/g, ' ')}
          </span>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`pbk-conversation-event-row ${kind}`}
      onPointerDown={startLongPress}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerMove={clearLongPress}
    >
      {eventMenu}
      <span className="pbk-conversation-event-icon">
        <EventIcon kind={kind} />
      </span>
      <div className="pbk-conversation-event-content">
        <div className="pbk-conversation-event-heading">
          <strong>{text(event.eventType, 'System activity').replace(/_/g, ' ')}</strong>
          <span>{formatTime(event.occurredAt)}</span>
        </div>
        {kind === 'transcript' ? (
          <>
            <button
              type="button"
              className="pbk-conversation-transcript-toggle"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? 'Collapse transcript' : 'Open transcript'}
            </button>
            <p className={expanded ? '' : 'clamped'}>{body}</p>
            {expanded && transcriptSegments.length > 0 && (
              <div className="pbk-conversation-transcript-segments">
                {transcriptSegments.map((segment, index) => (
                  <button
                    key={`${segment.start}-${index}`}
                    type="button"
                    onClick={() => seekRecording(segment.start)}
                    disabled={!recordingUrl}
                    title={recordingUrl ? `Play at ${segment.start.toFixed(1)} seconds` : undefined}
                  >
                    <Play size={10} aria-hidden="true" />
                    {segment.text}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p>{body}</p>
        )}
        <div className="pbk-conversation-event-meta">
          <span>{text(event.actorName || event.provider, 'PBK runtime')}</span>
          <span className={`status ${text(event.status).toLowerCase()}`}>
            {text(event.status, 'recorded').replace(/_/g, ' ')}
          </span>
        </div>
        {recordingUrl && (
          <audio ref={audioRef} controls preload="metadata" src={recordingUrl}>
            Your browser does not support audio playback.
          </audio>
        )}
      </div>
    </article>
  );
}

export function ConversationTimeline({
  thread,
  events,
  loading,
  loadingMore,
  error,
  hasMore,
  onRetry,
  onLoadMore,
  onOpenProfile,
  onLatestSeen,
  onEventChanged,
}: ConversationTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const previousThreadIdRef = useRef('');
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const groups = useMemo(
    () =>
      groupConversationEventsByDay(events, { timeZone }) as Array<{
        key: string;
        label: string;
        events: ConversationEvent[];
      }>,
    [events, timeZone]
  );
  const latestEventId = useMemo(() => {
    let latest: ConversationEvent | null = null;
    for (const event of events) {
      if (!latest || Date.parse(event.occurredAt) > Date.parse(latest.occurredAt)) latest = event;
    }
    return latest?.id || '';
  }, [events]);

  useEffect(() => {
    if (!thread?.id || !latestEventId || !scrollRef.current) return undefined;
    const threadChanged = previousThreadIdRef.current !== thread.id;
    previousThreadIdRef.current = thread.id;
    if (!threadChanged && !atBottomRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTop = node.scrollHeight;
      atBottomRef.current = true;
      onLatestSeen();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestEventId, onLatestSeen, thread?.id]);

  return (
    <section className="pbk-conversation-timeline" aria-label="Conversation timeline">
      <header className="pbk-conversation-timeline-head">
        <div>
          <div className="pbk-eyebrow">Unified seller timeline</div>
          <h2>{thread?.title || 'Choose a conversation'}</h2>
          <p>
            {thread
              ? `${thread.unreadCount || 0} unread · ${thread.status || 'open'}`
              : 'Select a seller thread to view messages, calls, contracts, and approvals.'}
          </p>
        </div>
        {thread && (
          <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={onOpenProfile}>
            Open seller profile
          </button>
        )}
      </header>

      <div
        ref={scrollRef}
        className="pbk-conversation-timeline-scroll"
        onScroll={(event) => {
          const node = event.currentTarget;
          const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
          atBottomRef.current = atBottom;
          if (atBottom) onLatestSeen();
        }}
      >
        {loading &&
          Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="pbk-conversation-bubble-skeleton" aria-hidden="true" />
          ))}

        {!loading && error && (
          <div className="pbk-conversation-inline-state error" role="alert">
            <AlertCircle size={18} />
            <strong>Timeline unavailable</strong>
            <span>{error}</span>
            <button type="button" onClick={onRetry}>
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}

        {!loading &&
          !error &&
          groups.map((group) => (
            <div key={group.key} className="pbk-conversation-day-group">
              <div className="pbk-conversation-day-label">
                <span>{group.label}</span>
              </div>
              {group.events.map((event) => (
                <ConversationEventRow
                  key={event.id}
                  event={event}
                  onEventChanged={onEventChanged}
                />
              ))}
            </div>
          ))}

        {!loading && !error && thread && !events.length && (
          <div className="pbk-conversation-inline-state">
            <CheckCircle2 size={18} />
            <strong>No activity yet</strong>
            <span>The seller thread exists, but no provider events have landed.</span>
          </div>
        )}

        {!loading && !error && !thread && (
          <div className="pbk-conversation-inline-state">
            <MessageSquare size={18} />
            <strong>Select a seller</strong>
            <span>The full cross-channel timeline will open here.</span>
          </div>
        )}

        {hasMore && !loading && !error && (
          <button
            type="button"
            className="pbk-conversation-load-more"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore && <Loader2 size={14} className="animate-spin" />}
            {loadingMore ? 'Loading history' : 'Load earlier activity'}
          </button>
        )}
      </div>
      <PbkDataSource
        endpoint="GET /api/conversations/:threadId/timeline"
        status="ships"
        note="SMS, email, calls, contracts, approvals, and notes"
      />
    </section>
  );
}
