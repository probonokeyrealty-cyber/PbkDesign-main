import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  Database,
  ExternalLink,
  EyeOff,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { PbkDataSource } from '../../components/pbk/index';
import { CompactPager, getPageSlice, OPERATOR_LIST_PAGE_SIZE } from '../components/CompactPager';
import {
  fetchActiveExperimentsRequest,
  curateMemoryEventRequest,
  fetchMemoryEventsRequest,
  fetchSkillOutcomesRequest,
  fetchSkillTrendsRequest,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';
import {
  buildMemoryAnalyticsViewModel,
  buildMemoryConflictGroups,
} from './memoryAnalyticsRuntimeLogic.js';

type MemoryViewModel = ReturnType<typeof buildMemoryAnalyticsViewModel>;
type SkillMetric = MemoryViewModel['skills'][number];
type ExperimentMetric = MemoryViewModel['experiments'][number];
type MemoryEventMetric = MemoryViewModel['events'][number];
type CurationReceipt = 'Correction queued' | 'Forget request recorded';
type MemoryStats = {
  activeSkills: number;
  totalUsage: number;
  averageConfidence: number;
  provenSkills: number;
  evolvingSkills: number;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0);
}

function buildMemoryStats(skills: SkillMetric[]): MemoryStats {
  const totalUsage = skills.reduce((sum, skill) => sum + Number(skill.usage || 0), 0);
  const averageConfidence = skills.length
    ? Math.round(
        skills.reduce((sum, skill) => sum + Number(skill.confidence || 0), 0) / skills.length
      )
    : 0;
  return {
    activeSkills: skills.length,
    totalUsage,
    averageConfidence,
    provenSkills: skills.filter((skill) => Number(skill.confidence || 0) >= 85).length,
    evolvingSkills: skills.filter((skill) => Number(skill.confidence || 0) < 85).length,
  };
}

function trendTone(values: number[]) {
  const first = values[0] || 0;
  const last = values[values.length - 1] || 0;
  if (last > first + 1) return 'text-lime-300';
  if (last < first - 1) return 'text-red-300';
  return 'text-sky-300';
}

function formatMemoryDate(value: string) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function eventAgeDays(event: MemoryEventMetric) {
  const time = event.createdAt ? new Date(event.createdAt).getTime() : 0;
  if (!time || Number.isNaN(time)) return null;
  return Math.floor((Date.now() - time) / 86_400_000);
}

function buildMemoryHygiene(events: MemoryEventMetric[], pairedKeys: Set<string>) {
  const lowConfidence = events.filter(
    (event) => Number(event.confidence || 0) > 0 && Number(event.confidence || 0) < 70
  );
  const needsSource = events.filter((event) => !event.source && !getMemorySourceHref(event));
  const stale = events.filter((event) => {
    const age = eventAgeDays(event);
    return age !== null && age > 30;
  });
  const contradictions = events.filter(
    (event) =>
      pairedKeys.has(getMemoryEventKey(event)) ||
      /\b(?:conflict\w*|contradict\w*|mismatch\w*|inconsisten\w*)\b/i.test(
        `${event.title} ${event.detail}`
      )
  );
  const compliance = events.filter((event) =>
    /dnc|do not call|stop texting|unsubscribe|compliance|consent|permission/i.test(
      `${event.title} ${event.detail} ${event.type}`
    )
  );
  const sensitive = events.filter((event) =>
    /ssn|social security|bank account|routing|password|private key|credit card|card number/i.test(
      `${event.title} ${event.detail}`
    )
  );
  const stopUsing = [
    ...new Map(
      [...lowConfidence, ...stale, ...sensitive].map((event) => [getMemoryEventKey(event), event])
    ).values(),
  ];
  return { lowConfidence, needsSource, stale, contradictions, compliance, sensitive, stopUsing };
}

function memoryEventMatches(event: MemoryEventMetric, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    event.type,
    event.title,
    event.detail,
    event.agentName,
    event.source,
    event.skillName,
    event.leadId,
    event.callId,
    event.chatId,
    event.campaignId,
  ]
    .join(' ')
    .toLowerCase()
    .includes(query);
}

function getMemoryEventKey(event: MemoryEventMetric) {
  return event.id || `${event.type}-${event.createdAt}`;
}

function getMemorySourceHref(event: MemoryEventMetric) {
  if (/^\/(?![\\/])[^\\]*$|^https?:\/\//i.test(event.sourceHref)) return event.sourceHref;
  if (event.leadId) return `/leads/${encodeURIComponent(event.leadId)}`;
  if (event.callId) return `/calls?callId=${encodeURIComponent(event.callId)}`;
  if (event.chatId) return `/ava-chat?threadId=${encodeURIComponent(event.chatId)}`;
  if (event.campaignId) return `/campaigns?campaignId=${encodeURIComponent(event.campaignId)}`;
  return '';
}

function MemorySourceLink({ event }: { event: MemoryEventMetric }) {
  const href = getMemorySourceHref(event);
  const label = event.source || 'Open source record';
  if (!href) return <span>{event.source || 'Source needs review'}</span>;
  const content = (
    <>
      <ExternalLink size={13} aria-hidden="true" />
      {label}
    </>
  );
  return href.startsWith('/') ? <Link to={href}>{content}</Link> : <a href={href}>{content}</a>;
}

function MemoryConflictComparison({
  groups,
}: {
  groups: ReturnType<typeof buildMemoryConflictGroups>;
}) {
  if (!groups.length) return null;
  return (
    <section className="pbk-memory-comparison" aria-labelledby="memory-conflicts-title">
      <h2 id="memory-conflicts-title">Conflicting facts</h2>
      {groups.map(({ id, label, observations }) => (
        <div className="pbk-memory-conflict-group" key={id}>
          <h3>{label}</h3>
          <div className="pbk-memory-conflict-observations">
            {observations.map(({ event, value }) => (
              <article key={getMemoryEventKey(event)} className="pbk-memory-observation">
                <strong>{value}</strong>
                <div className="pbk-memory-evidence">
                  <MemorySourceLink event={event} />
                  <small>{formatMemoryDate(event.createdAt)}</small>
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function buildMemoryUsageProof(event: MemoryEventMetric) {
  const source = event.source || event.callId || event.chatId || event.leadId || 'memory event';
  const confidence = event.confidence ? `${event.confidence}% confidence` : 'confidence pending';
  const outcome =
    event.success === true
      ? 'confirmed useful'
      : event.success === false
        ? 'needs review before reuse'
        : 'waiting for outcome proof';
  const channel = event.callId
    ? 'call coaching'
    : event.chatId
      ? 'Ava chat'
      : event.leadId
        ? 'lead update'
        : event.campaignId
          ? 'campaign work'
          : 'future Ava decisions';
  return `Context: ${channel}. Source: ${source}. ${confidence}; ${outcome}.`;
}

function Sparkline({ values }: { values: number[] }) {
  const maxIndex = Math.max(1, values.length - 1);
  const points = values
    .map(
      (value, index) =>
        `${(index / maxIndex) * 60},${20 - (Math.max(0, Math.min(100, value)) / 100) * 18}`
    )
    .join(' ');

  return (
    <svg
      className={['pbk-memory-sparkline', trendTone(values)].join(' ')}
      width="60"
      height="20"
      viewBox="0 0 60 20"
      aria-hidden="true"
    >
      <polyline
        points={points}
        stroke="currentColor"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MemorySourceRail() {
  return (
    <details className="pbk-source-disclosure">
      <summary>System sources</summary>
      <div className="pbk-memory-source-rail" aria-label="Memory Analytics data sources">
        <PbkDataSource endpoint="GET /api/skills/outcomes" status="ships" />
        <PbkDataSource endpoint="GET /api/skills/trends" status="ships" />
        <PbkDataSource
          endpoint="GET /api/memory/events"
          status="ships"
          note="premium memory timeline and agent learning events"
        />
        <PbkDataSource
          endpoint="GET /api/emotion/policies/experiments"
          status="ships"
          note="active emotion-policy experiment rows"
        />
      </div>
    </details>
  );
}

function MemoryHero({
  status,
  model,
  stats,
  onRefresh,
}: {
  status: 'loading' | 'ready' | 'error';
  model: MemoryViewModel;
  stats: MemoryStats;
  onRefresh: () => void;
}) {
  return (
    <section className="pbk-memory-hero">
      <div className="pbk-memory-hero-top">
        <div>
          <div className="pbk-eyebrow">Ava learning</div>
          <h1 className="pbk-display">Memory</h1>
        </div>
        <div className="pbk-memory-hero-actions">
          <button
            type="button"
            className="pbk-memory-refresh"
            onClick={onRefresh}
            disabled={status === 'loading'}
          >
            <RefreshCw size={15} className={status === 'loading' ? 'animate-spin' : ''} />
            {status === 'loading' ? 'Refreshing' : 'Refresh memory'}
          </button>
          <Link className="pbk-btn pbk-btn-ghost" to="/ava-chat">
            <Sparkles size={15} />
            Ask Ava
          </Link>
          <Link className="pbk-btn pbk-btn-ghost" to="/skills">
            <Sparkles size={15} />
            Teach Ava
          </Link>
          <Link className="pbk-btn pbk-btn-primary" to="/skills?create=1">
            <Plus size={15} />
            Add Skill
          </Link>
        </div>
      </div>
      <MemoryStatRibbon stats={stats} generatedAt={model.generatedAt} />
      <MemorySourceRail />
    </section>
  );
}

function MemoryStatRibbon({ stats, generatedAt }: { stats: MemoryStats; generatedAt: string }) {
  const generatedLabel = formatMemoryDate(generatedAt);
  return (
    <div className="pbk-memory-grid">
      <div className="pbk-memory-stat">
        <div className="l">Ava skills</div>
        <div className="v sky">{formatNumber(stats.activeSkills)}</div>
        <div className="delta">ready to review</div>
      </div>
      <div className="pbk-memory-stat">
        <div className="l">Times used</div>
        <div className="v">{formatNumber(stats.totalUsage)}</div>
        <div className="delta">calls, chats, follow-ups</div>
      </div>
      <div className="pbk-memory-stat">
        <div className="l">Avg confidence</div>
        <div className="v lime">{stats.activeSkills ? `${stats.averageConfidence}%` : 'N/A'}</div>
        <div className="delta">{stats.provenSkills} proven responses</div>
      </div>
      <div className="pbk-memory-stat">
        <div className="l">Last refresh</div>
        <div className="v is-date">{generatedLabel}</div>
        <div className="delta">{stats.evolvingSkills} evolving</div>
      </div>
    </div>
  );
}

function MemorySkillRow({ skill }: { skill: SkillMetric }) {
  const confidence = Number(skill.confidence || 0);
  const tone = confidence >= 85 ? 'lime' : confidence >= 60 ? 'amber' : '';
  return (
    <div className="pbk-memory-perf-row">
      <div className="name">
        {skill.name}
        <span className="src">
          {skill.agentName || skill.source || skill.status || 'Ava learning'}
        </span>
      </div>
      <div className="num" data-label="Used">
        {formatNumber(Number(skill.usage || 0))}x
      </div>
      <div
        data-label="Win rate"
        className={`num ${skill.successRate >= 60 ? 'good' : skill.successRate < 35 ? 'warn' : ''}`.trim()}
      >
        {skill.successRate}%
      </div>
      <div className="spark-wrap" data-label="Trend">
        <Sparkline values={skill.trend} />
      </div>
      <div className="bar" data-label={`Confidence ${confidence}%`}>
        <div
          className={`bar-fill ${tone}`.trim()}
          style={{ width: `${Math.max(0, Math.min(100, confidence))}%` }}
        />
      </div>
    </div>
  );
}

function MemoryProvenanceChips({ event }: { event: MemoryEventMetric }) {
  const chips = [
    event.confidence ? `Confidence: ${event.confidence}%` : '',
    event.agentName ? `Agent: ${event.agentName}` : '',
    event.skillName ? `Skill: ${event.skillName}` : '',
    event.leadId ? `Lead: ${event.leadId}` : '',
    event.callId ? `Call: ${event.callId}` : '',
    event.chatId ? `Chat: ${event.chatId}` : '',
    event.campaignId ? `Campaign: ${event.campaignId}` : '',
  ].filter(Boolean);
  return (
    <div className="pbk-memory-provenance-chips" aria-label="Memory provenance">
      {chips.map((chip) => (
        <span key={chip}>{chip}</span>
      ))}
    </div>
  );
}

function MemoryEventCard({
  event,
  pinned,
  receipt,
  busy,
  onPin,
  onHide,
  onCorrect,
  onForget,
}: {
  event: MemoryEventMetric;
  pinned: boolean;
  receipt?: CurationReceipt;
  busy: boolean;
  onPin: () => void;
  onHide: () => void;
  onCorrect: () => void;
  onForget: () => void;
}) {
  const correctionPrompt = encodeURIComponent(
    `Please review and correct this Ava memory if needed: ${event.title}. ${event.detail}`
  );
  const title =
    event.type === 'memory_curation' &&
    Array.isArray(event.metadata.deleteIds) &&
    event.metadata.deleteIds.length > 0
      ? 'Forget request recorded'
      : event.title;
  return (
    <article className="pbk-memory-event" aria-label={title} aria-busy={busy}>
      <span>{event.type}</span>
      <h3>{title}</h3>
      {event.detail && <p>{event.detail}</p>}
      <div className="pbk-memory-evidence">
        <MemorySourceLink event={event} />
        <small>{formatMemoryDate(event.createdAt)}</small>
      </div>
      {receipt && (
        <p className="pbk-memory-receipt" role="status">
          {receipt}
        </p>
      )}
      <details className="pbk-memory-record-details">
        <summary>Record details</summary>
        <p className="pbk-memory-usage-proof">{buildMemoryUsageProof(event)}</p>
        <MemoryProvenanceChips event={event} />
      </details>
      <div className="pbk-memory-event-actions">
        <button type="button" onClick={onPin} disabled={busy} aria-pressed={pinned}>
          <Pin size={13} />
          {pinned ? 'Unpin' : 'Pin'}
        </button>
        <button type="button" onClick={onCorrect} disabled={busy}>
          <Sparkles size={13} />
          Correct memory
        </button>
        <Link to={`/ava-chat?prompt=${correctionPrompt}`}>Ask Ava</Link>
        <button type="button" onClick={onHide} disabled={busy}>
          <EyeOff size={13} />
          Hide
        </button>
        <button
          type="button"
          onClick={onForget}
          disabled={busy}
          title="Record a forget request for review"
        >
          <Trash2 size={13} />
          Forget
        </button>
      </div>
    </article>
  );
}

function MemoryControlPanel({
  search,
  filter,
  hygiene,
  pinnedCount,
  visibleCount,
  onSearch,
  onFilter,
}: {
  search: string;
  filter: string;
  hygiene: ReturnType<typeof buildMemoryHygiene>;
  pinnedCount: number;
  visibleCount: number;
  onSearch: (value: string) => void;
  onFilter: (value: string) => void;
}) {
  const filters = [
    { value: 'all', label: 'All memories', count: visibleCount },
    { value: 'low_confidence', label: 'Low confidence', count: hygiene.lowConfidence.length },
    { value: 'stale', label: 'Stale facts', count: hygiene.stale.length },
    { value: 'needs_source', label: 'Needs source', count: hygiene.needsSource.length },
    { value: 'contradictions', label: 'Possible conflicts', count: hygiene.contradictions.length },
    { value: 'compliance', label: 'DNC and compliance', count: hygiene.compliance.length },
    { value: 'sensitive', label: 'Sensitive data', count: hygiene.sensitive.length },
    { value: 'stop_using', label: 'Stop using', count: hygiene.stopUsing.length },
  ];
  return (
    <section className="pbk-memory-control-panel" aria-label="Memory control center">
      <div className="pbk-memory-control-head">
        <div>
          <span>Memory control center</span>
          <h2>Memory records</h2>
        </div>
        <small>{pinnedCount} pinned memories</small>
      </div>
      <label className="pbk-memory-search">
        <Search size={16} />
        <input
          aria-label="Search memories"
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search seller facts, sources, calls, skills, or lead ids"
        />
      </label>
      <div className="pbk-memory-filter-row">
        {filters.map((item) => (
          <button
            type="button"
            key={item.value}
            className={filter === item.value ? 'active' : ''}
            aria-pressed={filter === item.value}
            onClick={() => onFilter(item.value)}
          >
            {item.label}
            <strong>{item.count}</strong>
          </button>
        ))}
      </div>
      <details className="pbk-memory-hygiene-details">
        <summary className="pbk-memory-hygiene-title">Memory hygiene</summary>
        <div className="pbk-memory-hygiene">
          <article>
            <AlertTriangle size={15} />
            <div>
              <strong>{hygiene.contradictions.length} possible conflicts</strong>
              <span>Confirm these before Ava uses them in offers or seller advice.</span>
            </div>
          </article>
          <article>
            <AlertTriangle size={15} />
            <div>
              <strong>{hygiene.lowConfidence.length} low-confidence memories</strong>
              <span>Coach or correct these before they shape live conversations.</span>
            </div>
          </article>
          <article>
            <AlertTriangle size={15} />
            <div>
              <strong>{hygiene.stale.length} stale memories</strong>
              <span>Older facts should be refreshed before a new offer or contract.</span>
            </div>
          </article>
          <article>
            <AlertTriangle size={15} />
            <div>
              <strong>{hygiene.compliance.length} DNC or compliance memories</strong>
              <span>Respect these before calls, SMS, campaigns, or contract follow-up.</span>
            </div>
          </article>
          <article>
            <AlertTriangle size={15} />
            <div>
              <strong>{hygiene.sensitive.length} sensitive memories</strong>
              <span>Review these before Ava repeats private or regulated data.</span>
            </div>
          </article>
        </div>
      </details>
    </section>
  );
}

function MemoryExperimentCard({ experiment }: { experiment: ExperimentMetric }) {
  return (
    <section className="pbk-memory-ab-card">
      <div className="ab-card-head">
        <h4>Active A/B - {experiment.name}</h4>
        <span className="lift">{experiment.confidence}% confidence</span>
      </div>

      <div className="ab-card-vs">
        {experiment.variants.map((variant: Record<string, unknown>, index: number) => {
          const name = String(variant.name || variant.id || `Variant ${index + 1}`);
          const attempts = Number(variant.attempts || variant.uses || 0);
          const successes = Number(variant.successes || variant.wins || 0);
          const rate = attempts
            ? Math.round((successes / attempts) * 100)
            : Number(variant.rate || 0);
          const winner =
            rate ===
            Math.max(
              ...experiment.variants.map((candidate: Record<string, unknown>) => {
                const candidateAttempts = Number(candidate.attempts || candidate.uses || 0);
                const candidateSuccesses = Number(candidate.successes || candidate.wins || 0);
                return candidateAttempts
                  ? Math.round((candidateSuccesses / candidateAttempts) * 100)
                  : Number(candidate.rate || 0);
              })
            );
          return (
            <div key={name} className={`ab-variant ${winner ? 'winner' : ''}`.trim()}>
              <div className="v-label">{winner ? `${name} (leader)` : name}</div>
              <div className="v-val">
                {successes} / {attempts}
              </div>
              <div className="v-rate">{rate}% success rate</div>
              <div className="ab-bar-track">
                <div
                  className={`ab-bar-fill ${winner ? 'winner' : ''}`.trim()}
                  style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="ab-note">
        {experiment.status || 'Ava is comparing these responses from real outcomes.'}
      </p>
    </section>
  );
}

function MemoryExperimentEmpty() {
  return (
    <section className="pbk-memory-ab-card empty">
      <div className="ab-card-head">
        <h4>Active A/B experiments</h4>
        <span className="lift muted">none active</span>
      </div>
      <p className="ab-note">
        No active response tests are running. Add a skill or ask Ava to draft a better reply when a
        seller objection keeps showing up.
      </p>
      <PbkDataSource endpoint="GET /api/emotion/policies/experiments" status="ships" />
    </section>
  );
}

const EMPTY_MEMORY = buildMemoryAnalyticsViewModel();

function loadWarning(label: string, loadError: unknown) {
  const message =
    loadError instanceof Error ? loadError.message : String(loadError || 'unknown error');
  return `${label} unavailable: ${message}`;
}

export function MemoryAnalytics() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [model, setModel] = useState<MemoryViewModel>(EMPTY_MEMORY);
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryFilter, setMemoryFilter] = useState('all');
  const [memoryPage, setMemoryPage] = useState(0);
  const [pinnedMemoryIds, setPinnedMemoryIds] = useState<string[]>([]);
  const [hiddenMemoryIds, setHiddenMemoryIds] = useState<string[]>([]);
  const [curationReceipts, setCurationReceipts] = useState(new Map<string, CurationReceipt>());
  const [curatingIds, setCuratingIds] = useState<string[]>([]);
  const curatingRef = useRef(new Set<string>());
  const stats = useMemo(() => buildMemoryStats(model.skills), [model.skills]);
  const topSkills = useMemo(
    () =>
      [...model.skills]
        .sort(
          (left, right) =>
            Number(right.confidence || 0) - Number(left.confidence || 0) ||
            Number(right.usage || 0) - Number(left.usage || 0)
        )
        .slice(0, 8),
    [model.skills]
  );
  const conflictGroups = useMemo(() => {
    const hidden = new Set(hiddenMemoryIds);
    return buildMemoryConflictGroups(
      model.events.filter((event) => !hidden.has(getMemoryEventKey(event)))
    );
  }, [hiddenMemoryIds, model.events]);
  const memoryHygiene = useMemo(() => {
    const hidden = new Set(hiddenMemoryIds);
    const pairedKeys = new Set(
      conflictGroups.flatMap(({ observations }) =>
        observations.map(({ event }) => getMemoryEventKey(event))
      )
    );
    return buildMemoryHygiene(
      model.events.filter((event) => !hidden.has(getMemoryEventKey(event))),
      pairedKeys
    );
  }, [conflictGroups, hiddenMemoryIds, model.events]);
  const filteredEvents = useMemo(() => {
    const hidden = new Set(hiddenMemoryIds);
    const buckets: Record<string, Set<string>> = {
      low_confidence: new Set(memoryHygiene.lowConfidence.map(getMemoryEventKey)),
      stale: new Set(memoryHygiene.stale.map(getMemoryEventKey)),
      needs_source: new Set(memoryHygiene.needsSource.map(getMemoryEventKey)),
      contradictions: new Set(memoryHygiene.contradictions.map(getMemoryEventKey)),
      compliance: new Set(memoryHygiene.compliance.map(getMemoryEventKey)),
      sensitive: new Set(memoryHygiene.sensitive.map(getMemoryEventKey)),
      stop_using: new Set(memoryHygiene.stopUsing.map(getMemoryEventKey)),
    };
    return model.events.filter((event) => {
      const eventKey = getMemoryEventKey(event);
      if (hidden.has(eventKey)) return false;
      if (!memoryEventMatches(event, memorySearch)) return false;
      if (memoryFilter === 'all') return true;
      return buckets[memoryFilter]?.has(eventKey) || false;
    });
  }, [hiddenMemoryIds, memoryFilter, memoryHygiene, memorySearch, model.events]);
  const pagedEvents = useMemo(
    () => getPageSlice(filteredEvents, memoryPage, OPERATOR_LIST_PAGE_SIZE),
    [filteredEvents, memoryPage]
  );
  const pinnedEvents = useMemo(() => {
    const pinned = new Set(pinnedMemoryIds);
    const hidden = new Set(hiddenMemoryIds);
    return model.events.filter(
      (event) => pinned.has(getMemoryEventKey(event)) && !hidden.has(getMemoryEventKey(event))
    );
  }, [hiddenMemoryIds, model.events, pinnedMemoryIds]);
  const visibleConflicts = useMemo(() => {
    const matches = new Set(filteredEvents.map(getMemoryEventKey));
    return conflictGroups.filter(({ observations }) =>
      observations.some(({ event }) => matches.has(getMemoryEventKey(event)))
    );
  }, [conflictGroups, filteredEvents]);

  useEffect(() => {
    setMemoryPage(0);
  }, [memoryFilter, memorySearch]);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(filteredEvents.length / OPERATOR_LIST_PAGE_SIZE));
    setMemoryPage((current) => Math.min(current, pageCount - 1));
  }, [filteredEvents.length]);

  const loadMemoryAnalytics = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const outcomesResponse = await fetchSkillOutcomesRequest();
      const skills = outcomesResponse.skills || [];
      const trendWarnings: string[] = [];
      const trendPairs = await Promise.all(
        skills.slice(0, 12).map(async (skill) => {
          const skillId = String(skill.id || skill.skillId || skill.skill_id || '').trim();
          const skillName = String(skill.name || skill.skillName || skill.skill_name || '').trim();
          const trendKey = skillId || skillName;
          try {
            const trends = await fetchSkillTrendsRequest({ skillId, skillName, days: 30 });
            return [trendKey, trends] as const;
          } catch (trendError) {
            if (trendKey) {
              trendWarnings.push(loadWarning(`Trend feed for ${skillName || skillId}`, trendError));
            }
            return [trendKey, { warning: loadWarning('Skill trend feed', trendError) }] as const;
          }
        })
      );
      const trendsBySkillId = Object.fromEntries(trendPairs.filter(([key]) => Boolean(key)));
      if (trendWarnings.length) {
        trendsBySkillId.__memoryAnalyticsTrends = { warning: trendWarnings.join(' ') };
      }
      const [experimentsResult, memoryEventsResult] = await Promise.allSettled([
        fetchActiveExperimentsRequest(),
        fetchMemoryEventsRequest({ limit: 100, offset: 0 }),
      ]);
      const experimentsResponse =
        experimentsResult.status === 'fulfilled'
          ? experimentsResult.value
          : {
              warning: loadWarning('Active experiment feed', experimentsResult.reason),
              experiments: [],
            };
      const memoryEventsResponse =
        memoryEventsResult.status === 'fulfilled'
          ? memoryEventsResult.value
          : { warning: loadWarning('Memory event feed', memoryEventsResult.reason), events: [] };
      setModel(
        buildMemoryAnalyticsViewModel({
          outcomesResponse,
          trendsBySkillId,
          experimentsResponse,
          memoryEventsResponse,
        })
      );
      setStatus('ready');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadMemoryAnalytics();
  }, [loadMemoryAnalytics]);

  const handleMemoryCuration = useCallback(
    async (event: MemoryEventMetric, action: 'pin' | 'unpin' | 'correct' | 'forget' | 'hide') => {
      const eventKey = getMemoryEventKey(event);
      if (!eventKey || curatingRef.current.has(eventKey)) return;
      curatingRef.current.add(eventKey);
      setCuratingIds((current) => [...current, eventKey]);
      try {
        const result = await curateMemoryEventRequest({
          eventId: eventKey,
          action,
          reason: `${action} requested from Memory control center for ${event.title || event.type}.`,
          correction:
            action === 'correct'
              ? `Review this memory for accuracy: ${event.title}. ${event.detail || ''}`
              : '',
        });
        if (result?.ok !== true) throw new Error('The bridge did not confirm the memory action.');
        if (action === 'pin') {
          setPinnedMemoryIds((current) => [...new Set([...current, eventKey])]);
        } else if (action === 'unpin') {
          setPinnedMemoryIds((current) => current.filter((id) => id !== eventKey));
        } else if (action === 'hide') {
          setHiddenMemoryIds((current) => [...new Set([...current, eventKey])]);
          setPinnedMemoryIds((current) => current.filter((id) => id !== eventKey));
        } else if (action === 'correct' || action === 'forget') {
          const receipt = action === 'correct' ? 'Correction queued' : 'Forget request recorded';
          setCurationReceipts((current) => new Map(current).set(eventKey, receipt));
          void loadMemoryAnalytics();
          return;
        }
        showUiToast({
          tone: 'success',
          title:
            action === 'pin'
              ? 'Memory pinned'
              : action === 'unpin'
                ? 'Memory unpinned'
                : 'Memory hidden',
          desc: 'Ava memory curation was recorded through the bridge.',
        });
      } catch (curationError) {
        showUiToast({
          tone: 'warning',
          title: 'Memory action not confirmed',
          desc:
            curationError instanceof Error
              ? curationError.message
              : 'The bridge did not confirm durable memory curation.',
        });
      } finally {
        curatingRef.current.delete(eventKey);
        setCuratingIds((current) => current.filter((id) => id !== eventKey));
      }
    },
    [loadMemoryAnalytics]
  );

  const renderMemoryEvent = (event: MemoryEventMetric) => {
    const eventKey = getMemoryEventKey(event);
    const pinned = pinnedMemoryIds.includes(eventKey);
    return (
      <MemoryEventCard
        key={eventKey}
        event={event}
        pinned={pinned}
        receipt={curationReceipts.get(eventKey)}
        busy={curatingIds.includes(eventKey)}
        onPin={() => void handleMemoryCuration(event, pinned ? 'unpin' : 'pin')}
        onHide={() => void handleMemoryCuration(event, 'hide')}
        onCorrect={() => void handleMemoryCuration(event, 'correct')}
        onForget={() => void handleMemoryCuration(event, 'forget')}
      />
    );
  };

  return (
    <div className="pbk-memory-surface min-h-full text-slate-100">
      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-4 py-5 pb-8">
        <MemoryHero status={status} model={model} stats={stats} onRefresh={loadMemoryAnalytics} />

        {status === 'error' && (
          <section className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
            <h2 className="text-sm font-semibold text-red-100">Ava could not refresh memory</h2>
            <p className="mt-1 text-sm text-red-200/80">
              Try again in a moment. If this keeps happening, the system sources panel has the
              technical detail for an admin.
            </p>
            {error && (
              <details className="mt-3 text-xs text-red-100/70">
                <summary>Admin detail</summary>
                {error}
              </details>
            )}
          </section>
        )}

        {model.warning && (
          <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            {model.warning}
          </section>
        )}

        <MemoryControlPanel
          search={memorySearch}
          filter={memoryFilter}
          hygiene={memoryHygiene}
          pinnedCount={pinnedEvents.length}
          visibleCount={filteredEvents.length}
          onSearch={setMemorySearch}
          onFilter={setMemoryFilter}
        />

        <MemoryConflictComparison groups={visibleConflicts} />

        {pinnedEvents.length > 0 && (
          <section className="pbk-memory-card" aria-labelledby="memory-pinned-title">
            <div className="mem-card-head">
              <h2 id="memory-pinned-title">Pinned memories</h2>
              <span className="more">operator watchlist</span>
            </div>
            <div className="mem-card-body pbk-memory-pinned-grid">
              {pinnedEvents.map(renderMemoryEvent)}
            </div>
          </section>
        )}

        <section
          className="pbk-memory-card pbk-memory-recent"
          aria-labelledby="memory-recent-title"
        >
          <div className="mem-card-head">
            <h2 id="memory-recent-title">Recent memory events</h2>
            <span className="more">{filteredEvents.length} matching</span>
          </div>
          <div className="mem-card-body">
            {pagedEvents.length ? (
              pagedEvents.map(renderMemoryEvent)
            ) : (
              <div className="pbk-memory-empty">
                <Database size={18} />
                {status === 'loading'
                  ? 'Loading recent learning...'
                  : 'No memories match this view. Clear the search or switch filters.'}
              </div>
            )}
            <CompactPager
              page={memoryPage}
              total={filteredEvents.length}
              label="Memory event pages"
              itemLabel="memories"
              onPageChange={setMemoryPage}
            />
          </div>
        </section>

        <section className="pbk-memory-body">
          <div className="pbk-memory-card span-2">
            <div className="mem-card-head">
              <h3>Skill performance - top {topSkills.length || 0}</h3>
              <span className="more">GET /api/skills/outcomes</span>
            </div>
            <div className="mem-card-body">
              <div className="pbk-memory-perf-row head">
                <div className="name">Skill</div>
                <div className="num">Use</div>
                <div className="num">Win</div>
                <div className="spark-wrap">Trend</div>
                <div className="num">Confidence</div>
              </div>
              {topSkills.length ? (
                topSkills.map((skill: SkillMetric) => (
                  <MemorySkillRow key={skill.id || skill.name} skill={skill} />
                ))
              ) : (
                <div className="pbk-memory-empty">
                  <Database size={18} />
                  {status === 'loading'
                    ? 'Loading Ava memory...'
                    : 'No learned skills yet. Add a skill or ask Ava to turn a strong reply into one.'}
                </div>
              )}
            </div>
          </div>

          <div className="pbk-memory-card">
            <div className="mem-card-head">
              <h3>Learning lanes</h3>
              <span className="more">derived</span>
            </div>
            <div className="mem-card-body">
              <div className="pbk-memory-lane">
                <span>Proven</span>
                <strong>{stats.provenSkills}</strong>
              </div>
              <div className="pbk-memory-lane">
                <span>Evolving</span>
                <strong>{stats.evolvingSkills}</strong>
              </div>
              <div className="pbk-memory-lane">
                <span>Usage events</span>
                <strong>{formatNumber(stats.totalUsage)}</strong>
              </div>
              <PbkDataSource
                endpoint="GET /api/memory/events"
                status="ships"
                note="canonical memory timeline"
              />
            </div>
          </div>

          <div className="pbk-memory-card">
            <div className="mem-card-head">
              <h3>Trend source</h3>
              <span className="more">30 days</span>
            </div>
            <div className="mem-card-body">
              <p className="pbk-memory-note">
                Trend lines are built from recorded skill usage history. Missing trend rows fall
                back to the latest success rate, not sample sparkline data.
              </p>
              <PbkDataSource endpoint="GET /api/skills/trends" status="ships" />
            </div>
          </div>

          <div className="span-2">
            {model.experiments.length ? (
              model.experiments.map((experiment: ExperimentMetric) => (
                <MemoryExperimentCard
                  key={experiment.id || experiment.name}
                  experiment={experiment}
                />
              ))
            ) : (
              <MemoryExperimentEmpty />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
