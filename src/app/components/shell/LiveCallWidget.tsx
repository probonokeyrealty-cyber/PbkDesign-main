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
 * State source (planned):
 *   Phase 1 (now)     — local stub state so Command Center renders + demos.
 *   Phase 2 (next)    — subscribe to OpenClaw WS via `lib/ws.ts` (TBD).
 *                       Payload shape mirrors the stub `LiveCallState` below.
 *   Phase 3 (later)   — Telnyx PSTN take-over hands the audio leg to the user.
 *
 * Props:
 *   - `state?`   external override (for storybook / demo / parent-fed data)
 *   - `onTakeOver?`, `onMute?`, `onEnd?` action handlers (parent decides nav)
 *   - `compact?` true → 240px-ish vertical card; false → full-width
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone,
  PhoneOff,
  MicOff,
  Hand,
  CircleDot,
  Bot,
  Activity,
} from 'lucide-react';

// ---- Types --------------------------------------------------------------

export type CallStatus =
  | 'idle'
  | 'dialing'
  | 'connected'
  | 'on-hold'
  | 'ended';

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
  /** Linked deal id — Take Over routes to /deal/:id when present. */
  dealId: string | null;
  status: CallStatus;
  agentMode: AgentMode;
  caller: {
    name: string | null;
    phone: string | null;
    /** Optional CRM hint shown under the name, e.g. "owner · 4501 Maple St" */
    context?: string;
  };
  /** ISO timestamp of call start; widget computes elapsed. */
  startedAt: string | null;
  /** 0–100; <40 cold, 40–70 neutral, >70 warm. Streamed from OpenClaw. */
  sentiment: number | null;
  transcript: TranscriptLine[];
}

// ---- Stub state ---------------------------------------------------------
// This is what the WS feed will eventually provide. Kept here so the widget
// renders something realistic in the Command Center before the WS lands.

const STUB_STATE: LiveCallState = {
  callId: 'demo-001',
  dealId: null,
  status: 'connected',
  agentMode: 'autopilot',
  caller: {
    name: 'Marcus Hill',
    phone: '+1 (404) 555-0188',
    context: 'owner · 1827 Glenwood Ave SE',
  },
  startedAt: new Date(Date.now() - 1000 * 73).toISOString(), // 1:13 ago
  sentiment: 62,
  transcript: [
    {
      id: 't1',
      speaker: 'ava',
      text: "Hi Marcus, this is Ava with Probono Key Realty — got a minute?",
      ts: new Date(Date.now() - 1000 * 73).toISOString(),
    },
    {
      id: 't2',
      speaker: 'lead',
      text: 'Uh, yeah, what is this about?',
      ts: new Date(Date.now() - 1000 * 67).toISOString(),
    },
    {
      id: 't3',
      speaker: 'ava',
      text: 'Calling about the property on Glenwood — are you still the owner?',
      ts: new Date(Date.now() - 1000 * 58).toISOString(),
    },
    {
      id: 't4',
      speaker: 'lead',
      text: "Yeah, I am. We've been thinking about selling actually.",
      ts: new Date(Date.now() - 1000 * 42).toISOString(),
    },
    {
      id: 't5',
      speaker: 'ava',
      text: 'Great — mind if I ask a few quick questions about condition?',
      ts: new Date(Date.now() - 1000 * 30).toISOString(),
    },
    {
      id: 't6',
      speaker: 'lead',
      text: 'Sure, go ahead.',
      ts: new Date(Date.now() - 1000 * 18).toISOString(),
    },
  ],
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

function sentimentTone(score: number | null) {
  if (score == null) return { label: '—', color: 'text-slate-500', bg: 'bg-slate-800' };
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
  const live = state ?? STUB_STATE;

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

  const isLive =
    live.status === 'connected' || live.status === 'on-hold' || live.status === 'dialing';

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
          <span className={`ml-2 inline-flex items-center gap-1.5 text-[10px] font-semibold ${status.color}`}>
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
            {live.caller.phone ?? '—'}
          </div>
        </div>

        {/* Sentiment dial */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            <span>Sentiment</span>
            <span className={sent.color}>
              {live.sentiment ?? '—'} · {sent.label}
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
                <span className={`${sp.text}`}>{line.text}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Action row */}
      <div className="px-3 py-2.5 border-t border-slate-800 bg-slate-900/60 flex items-center gap-2">
        <button
          type="button"
          disabled={!isLive}
          onClick={() => onTakeOver?.(live)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-medium transition-colors"
          title="Take over the call and route to the deal workspace"
        >
          <Hand className="h-3.5 w-3.5" />
          Take Over
        </button>
        <button
          type="button"
          disabled={!isLive}
          onClick={() => onMute?.(live)}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium transition-colors"
          title="Mute Ava (you take over voice, transcript continues)"
        >
          <MicOff className="h-3.5 w-3.5" />
          Mute Ava
        </button>
        <button
          type="button"
          disabled={!isLive}
          onClick={() => onEnd?.(live)}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600/90 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-medium transition-colors"
          title="End call"
        >
          <PhoneOff className="h-3.5 w-3.5" />
          End
        </button>
      </div>
    </div>
  );
}

export default LiveCallWidget;
