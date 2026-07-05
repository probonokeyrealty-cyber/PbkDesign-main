/**
 * LiveCallWidget — shell-layer component.
 *
 * Bloomberg-style live call card for the Command Center. Shows:
 *   • caller identity + phone + duration
 *   • Ava (autonomous agent) status badge
 *   • live sentiment dial (0–100, color-coded)
 *   • streaming transcript (last 6 lines, auto-scroll)
 *   • action row: Take Over · Mute Ava · End
 *
 * IMPORTANT — engine isolation:
 *   This file lives in `components/shell/` (NEW directory). It does not import
 *   from `components/` (engine) and does not touch `dealCalculations.ts`.
 *   The "Take Over" action, when wired, will navigate to `/deal/:id` which
 *   mounts the existing engine `<App />` via `routes/DealView.tsx` — that's
 *   the seam, and it stays the seam. We do not pull engine state into the
 *   shell card.
 *
 * State source:
 *   Command Center passes the latest bridge call state from `/state`.
 *   If no call is active, the widget renders an idle empty state instead of
 *   implying a live call is running.
 *
 * Props:
 *   - `state?`   bridge-fed call state
 *   - `onTakeOver?`, `onMute?`, `onEnd?` action handlers (parent decides nav)
 *   - `compact?` true for the compact vertical card; false for full-width
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Phone, PhoneOff, MicOff, Hand, CircleDot, Bot, Activity } from 'lucide-react';

// ---- Types --------------------------------------------------------------

export type CallStatus = 'idle' | 'dialing' | 'connected' | 'on-hold' | 'ended';

export type AgentMode = 'autopilot' | 'co-pilot' | 'human';

export interface TranscriptLine {
  id: string;
  /** "ava" = autonomous agent, "lead" = the seller, "user" = the wholesaler */
  speaker: 'ava' | 'lead' | 'user';
  text: string;
  /** ISO timestamp; widget converts to mm:ss relative to call start */
  ts: string;
}

export interface LiveCallState {
  callId: string | null;
  /** Linked deal id. Take Over routes to /deal/:id when present. */
  dealId: string | null;
  status: CallStatus;
  agentMode: AgentMode;
  caller: {
    name: string | null;
    phone: string | null;
    /** Optional CRM hint shown under the name, e.g. "owner - 4501 Maple St" */
    context?: string;
  };
  /** ISO timestamp of call start; widget computes elapsed. */
  startedAt: string | null;
  /** 0-100; <40 cold, 40-70 neutral, >70 warm. Streamed from OpenClaw. */
  sentiment: number | null;
  transcript: TranscriptLine[];
  avaLiveCockpit?: Record<string, unknown> | null;
}

// ---- Empty state --------------------------------------------------------

const EMPTY_STATE: LiveCallState = {
  callId: null,
  dealId: null,
  status: 'idle',
  agentMode: 'autopilot',
  caller: {
    name: null,
    phone: null,
    context: 'Waiting for the next bridge call event',
  },
  startedAt: null,
  sentiment: null,
  transcript: [],
  avaLiveCockpit: null,
};

// ---- Utilities ----------------------------------------------------------

function fmtElapsed(startedAt: string | null): string {
  if (!startedAt) return '0:00';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

function readAvaLiveCockpit(value: unknown) {
  const cockpit = record(value);
  const timeline = Array.isArray(cockpit.missionTimeline)
    ? cockpit.missionTimeline
        .map((entry, index) => {
          const step = record(entry);
          return {
            id: text(step.id, `mission-${index}`),
            label: text(step.label, `Step ${index + 1}`),
            status: text(step.status, 'waiting').replace(/_/g, ' '),
            detail: text(step.detail),
          };
        })
        .filter((step) => step.label || step.detail)
    : [];
  if (
    !timeline.length &&
    !text(cockpit.nextBestQuestion) &&
    !Object.keys(record(cockpit.leadCommitProof)).length &&
    !Object.keys(record(cockpit.memoryProof)).length &&
    !Object.keys(record(cockpit.skillOutcomeProof)).length &&
    !Object.keys(record(cockpit.observability)).length &&
    number(cockpit.latencyMs) == null
  ) {
    return null;
  }
  return {
    phase: text(cockpit.phase, 'tracking').replace(/_/g, ' '),
    nextBestQuestion: text(cockpit.nextBestQuestion),
    latencyMs: number(cockpit.latencyMs),
    timeline,
    leadCommitProof: record(cockpit.leadCommitProof),
    memoryProof: record(cockpit.memoryProof),
    skillOutcomeProof: record(cockpit.skillOutcomeProof),
    observability: record(cockpit.observability),
  };
}

function sentimentTone(score: number | null) {
  if (score == null) return { label: '-', color: 'text-slate-500', bg: 'bg-slate-800' };
  if (score >= 70) return { label: 'warm', color: 'text-emerald-400', bg: 'bg-emerald-500' };
  if (score >= 40) return { label: 'neutral', color: 'text-amber-400', bg: 'bg-amber-500' };
  return { label: 'cold', color: 'text-rose-400', bg: 'bg-rose-500' };
}

function statusTone(status: CallStatus) {
  switch (status) {
    case 'connected':
      return { label: 'LIVE', color: 'text-emerald-400', dot: 'bg-emerald-500 animate-pulse' };
    case 'dialing':
      return { label: 'DIALING', color: 'text-amber-400', dot: 'bg-amber-500 animate-pulse' };
    case 'on-hold':
      return { label: 'HOLD', color: 'text-amber-400', dot: 'bg-amber-500' };
    case 'ended':
      return { label: 'ENDED', color: 'text-slate-500', dot: 'bg-slate-600' };
    case 'idle':
    default:
      return { label: 'IDLE', color: 'text-slate-500', dot: 'bg-slate-700' };
  }
}

function speakerStyle(speaker: TranscriptLine['speaker']) {
  switch (speaker) {
    case 'ava':
      return { label: 'Ava', text: 'text-sky-300', tag: 'bg-sky-900/60 text-sky-300' };
    case 'lead':
      return { label: 'Lead', text: 'text-slate-200', tag: 'bg-slate-800 text-slate-300' };
    case 'user':
      return { label: 'You', text: 'text-emerald-200', tag: 'bg-emerald-900/60 text-emerald-300' };
  }
}

const TRANSCRIPT_HIGHLIGHT_REGEX =
  /(too expensive|think about it|talk to spouse|talk to my spouse|need to talk|not interested|angry|frustrated|probate|foreclosure|cash offer|creative finance|mortgage takeover|retail buyer|rbp|path locked|mao)/gi;

function highlightTone(match: string) {
  const lower = match.toLowerCase();
  if (/too expensive|think about|talk to|not interested|angry|frustrated/.test(lower))
    return 'objection';
  if (/cash offer|creative finance|mortgage takeover|retail buyer|rbp|path locked|mao/.test(lower))
    return 'decision';
  return 'emotion';
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderSystemHighlightedTranscript(text: string, keyPrefix = '') {
  const parts = text.split(TRANSCRIPT_HIGHLIGHT_REGEX);
  return parts.map((part, index) => {
    if (!part) return null;
    TRANSCRIPT_HIGHLIGHT_REGEX.lastIndex = 0;
    if (!TRANSCRIPT_HIGHLIGHT_REGEX.test(part))
      return <span key={`${keyPrefix}${part}-${index}`}>{part}</span>;
    TRANSCRIPT_HIGHLIGHT_REGEX.lastIndex = 0;
    return (
      <mark
        key={`${keyPrefix}${part}-${index}`}
        className={`transcript-highlight ${highlightTone(part)}`}
      >
        {part}
      </mark>
    );
  });
}

function renderHighlightedTranscript(text: string, userQuery = '') {
  const query = userQuery.trim();
  if (!query) return renderSystemHighlightedTranscript(text);
  const queryRegex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return text.split(queryRegex).map((part, index) => {
    if (!part) return null;
    if (part.toLowerCase() !== query.toLowerCase()) {
      return (
        <span key={`search-context-${index}`}>
          {renderSystemHighlightedTranscript(part, `search-context-${index}-`)}
        </span>
      );
    }
    return (
      <mark key={`search-hit-${index}`} className="transcript-highlight decision">
        {part}
      </mark>
    );
  });
}

// ---- Component ----------------------------------------------------------

export interface LiveCallWidgetProps {
  state?: LiveCallState;
  onTakeOver?: (state: LiveCallState) => void;
  onMute?: (state: LiveCallState) => void;
  onEnd?: (state: LiveCallState) => void;
  compact?: boolean;
}

export function LiveCallWidget({
  state,
  onTakeOver,
  onMute,
  onEnd,
  compact = false,
}: LiveCallWidgetProps) {
  const live = state ?? EMPTY_STATE;
  const [transcriptQuery, setTranscriptQuery] = useState('');

  // Tick once per second so elapsed timer updates without external state.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (live.status !== 'connected' && live.status !== 'dialing' && live.status !== 'on-hold') {
      return;
    }
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [live.status]);

  // Auto-scroll transcript to bottom as new lines arrive.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [live.transcript.length]);

  const status = useMemo(() => statusTone(live.status), [live.status]);
  const sent = useMemo(() => sentimentTone(live.sentiment), [live.sentiment]);
  const elapsed = fmtElapsed(live.startedAt);
  const cockpit = useMemo(() => readAvaLiveCockpit(live.avaLiveCockpit), [live.avaLiveCockpit]);
  const transcriptMatchCount = useMemo(() => {
    const needle = transcriptQuery.trim().toLowerCase();
    if (!needle) return 0;
    return live.transcript.reduce(
      (count, line) => count + (line.text.toLowerCase().includes(needle) ? 1 : 0),
      0
    );
  }, [live.transcript, transcriptQuery]);

  const isLive =
    live.status === 'connected' || live.status === 'on-hold' || live.status === 'dialing';
  const hasBridgeCallId = Boolean(live.callId);
  const canControlCall = isLive && hasBridgeCallId;
  const controlTitle = canControlCall
    ? 'Send this command to the live bridge call'
    : hasBridgeCallId
      ? 'Call controls are available after the call connects'
      : 'Waiting for the bridge call id before controls are enabled';

  return (
    <div
      className={[
        'rounded-lg border border-slate-800 bg-slate-950 overflow-hidden',
        'flex flex-col',
        compact ? 'h-[360px]' : 'h-[440px]',
      ].join(' ')}
      data-testid="live-call-widget"
    >
      {/* Header strip */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-2 min-w-0">
          <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <div className="text-[11px] uppercase tracking-wider font-medium text-slate-300">
            Live Call
          </div>
          <span
            className={`ml-2 inline-flex items-center gap-1.5 text-[10px] font-semibold ${status.color}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400 tabular-nums shrink-0">
          <span className="inline-flex items-center gap-1">
            <Activity className="h-3 w-3" />
            {elapsed}
          </span>
          <span className="inline-flex items-center gap-1">
            <Bot className="h-3 w-3" />
            <span className="capitalize">{live.agentMode.replace('-', ' ')}</span>
          </span>
        </div>
      </div>

      {/* Caller block */}
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100 truncate">
              {live.caller.name ?? 'Unknown caller'}
            </div>
            {live.caller.context && (
              <div className="text-[11px] text-slate-500 truncate">{live.caller.context}</div>
            )}
          </div>
          <div className="text-[11px] text-slate-400 tabular-nums shrink-0">
            {live.caller.phone ?? '-'}
          </div>
        </div>

        {/* Sentiment dial */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            <span>Sentiment</span>
            <span className={sent.color}>
              {live.sentiment ?? '-'} / {sent.label}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full ${sent.bg} transition-all duration-500`}
              style={{ width: `${live.sentiment ?? 0}%` }}
            />
          </div>
        </div>
      </div>

      {cockpit && (
        <div className="border-b border-emerald-400/20 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em]">
            <span className="text-emerald-300">Ava mission</span>
            <span className="text-slate-500">
              {cockpit.phase}
              {cockpit.latencyMs == null ? '' : ` - ${cockpit.latencyMs}ms`}
            </span>
          </div>
          <div className="mt-2 rounded-md border border-slate-800 bg-slate-950/70 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-[0.12em] text-sky-300">
              Next best action
            </div>
            <div className="mt-1 text-[12px] leading-relaxed text-slate-100">
              {cockpit.nextBestQuestion || 'Ava is tracking the seller turn and waiting for proof.'}
            </div>
          </div>
          {cockpit.timeline.length > 0 && (
            <div className="mt-2 grid gap-1.5">
              {cockpit.timeline.slice(0, 3).map((step) => (
                <div
                  key={step.id || step.label}
                  className="rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-100">{step.label}</span>
                    <span className="text-[9px] uppercase tracking-[0.12em] text-emerald-300">
                      {step.status}
                    </span>
                  </div>
                  {step.detail && (
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500">
                      {step.detail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
            <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5">
              <span className="block uppercase tracking-[0.12em] text-slate-500">CRM</span>
              <b className="mt-0.5 block text-slate-200">
                {number(cockpit.leadCommitProof.fieldCount) || 0} fields
              </b>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5">
              <span className="block uppercase tracking-[0.12em] text-slate-500">Memory</span>
              <b className="mt-0.5 block truncate text-slate-200">
                {text(cockpit.memoryProof.hotMemory, 'Ready').replace(/_/g, ' ')}
              </b>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5">
              <span className="block uppercase tracking-[0.12em] text-slate-500">Skill</span>
              <b className="mt-0.5 block truncate text-slate-200">
                {text(cockpit.skillOutcomeProof.skillName) ||
                  text(cockpit.skillOutcomeProof.skillId) ||
                  'Waiting'}
              </b>
            </div>
          </div>
        </div>
      )}

      <div className="border-b border-slate-800 px-4 py-2">
        <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-400 focus-within:border-sky-500/60">
          <span className="shrink-0 uppercase tracking-[0.12em]">Search transcript</span>
          <input
            value={transcriptQuery}
            onChange={(event) => setTranscriptQuery(event.target.value)}
            placeholder="keyword..."
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
          />
          {transcriptQuery.trim() && (
            <span className="shrink-0 text-[10px] text-sky-300">
              {transcriptMatchCount} hit{transcriptMatchCount === 1 ? '' : 's'}
            </span>
          )}
        </label>
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2 text-[12px] leading-relaxed"
      >
        {live.transcript.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600 text-[11px]">
            <CircleDot className="h-3 w-3 mr-1.5" />
            No transcript yet
          </div>
        ) : (
          live.transcript.map((line) => {
            const sp = speakerStyle(line.speaker);
            return (
              <div key={line.id} className="flex gap-2">
                <span
                  className={`mt-0.5 inline-flex h-4 px-1.5 items-center rounded text-[9px] font-semibold uppercase tracking-wider shrink-0 ${sp.tag}`}
                >
                  {sp.label}
                </span>
                <span className={`${sp.text}`}>
                  {renderHighlightedTranscript(line.text, transcriptQuery)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Action row */}
      {isLive && !hasBridgeCallId && (
        <div className="border-t border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          Waiting for bridge call id before call controls can send commands.
        </div>
      )}
      <div className="px-3 py-2.5 border-t border-slate-800 bg-slate-900/60 flex items-center gap-2">
        <button
          type="button"
          disabled={!canControlCall}
          onClick={() => onTakeOver?.(live)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-medium transition-colors"
          title={controlTitle}
        >
          <Hand className="h-3.5 w-3.5" />
          Take Over
        </button>
        <button
          type="button"
          disabled={!canControlCall}
          onClick={() => onMute?.(live)}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium transition-colors"
          title={controlTitle}
        >
          <MicOff className="h-3.5 w-3.5" />
          Mute Ava
        </button>
        <button
          type="button"
          disabled={!canControlCall}
          onClick={() => onEnd?.(live)}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600/90 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-medium transition-colors"
          title={controlTitle}
        >
          <PhoneOff className="h-3.5 w-3.5" />
          End
        </button>
      </div>
    </div>
  );
}

export default LiveCallWidget;
