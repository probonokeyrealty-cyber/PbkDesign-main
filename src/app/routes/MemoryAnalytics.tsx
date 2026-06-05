import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { PbkDataSource } from '../../components/pbk/index';
import {
  fetchActiveExperimentsRequest,
  fetchSkillOutcomesRequest,
  fetchSkillTrendsRequest,
} from '../utils/runtimeBridge';
import { buildMemoryAnalyticsViewModel } from './memoryAnalyticsRuntimeLogic.js';

type MemoryViewModel = ReturnType<typeof buildMemoryAnalyticsViewModel>;
type SkillMetric = MemoryViewModel['skills'][number];
type ExperimentMetric = MemoryViewModel['experiments'][number];
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
    <div className="pbk-memory-source-rail" aria-label="Memory Analytics data sources">
      <PbkDataSource endpoint="GET /api/skills/outcomes" status="ships" />
      <PbkDataSource endpoint="GET /api/skills/trends" status="ships" />
      <PbkDataSource
        endpoint="GET /api/memory/events"
        status="needs-wiring"
        note="premium memory timeline and agent learning events"
      />
      <PbkDataSource
        endpoint="GET /api/emotion/policies/experiments"
        status="ships"
        note="active emotion-policy experiment rows"
      />
    </div>
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
  const sourceLabel = model.source || 'runtime';
  return (
    <section className="pbk-memory-hero">
      <div className="pbk-memory-hero-top">
        <div>
          <div className="pbk-eyebrow">
            Self-modifying memory - {stats.activeSkills} active skills - {sourceLabel}
          </div>
          <h1 className="pbk-display pbk-h1">
            Memory &amp; <em>analytics</em>.
          </h1>
          <p>
            Every skill outcome and confidence trend across the PBK fleet. Rex learns from call
            outcomes, promotes what works, and keeps weak skills visible without inventing a fake
            training story.
          </p>
        </div>
        <button
          type="button"
          className="pbk-memory-refresh"
          onClick={onRefresh}
          disabled={status === 'loading'}
        >
          <RefreshCw size={15} className={status === 'loading' ? 'animate-spin' : ''} />
          {status === 'loading' ? 'Refreshing' : 'Refresh memory'}
        </button>
      </div>
      <MemoryStatRibbon stats={stats} generatedAt={model.generatedAt} />
      <MemorySourceRail />
    </section>
  );
}

function MemoryStatRibbon({ stats, generatedAt }: { stats: MemoryStats; generatedAt: string }) {
  const generatedLabel = generatedAt
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(generatedAt))
    : 'runtime';
  return (
    <div className="pbk-memory-grid">
      <div className="pbk-memory-stat">
        <div className="l">Active skills</div>
        <div className="v sky">{formatNumber(stats.activeSkills)}</div>
        <div className="delta">from skill outcomes</div>
      </div>
      <div className="pbk-memory-stat">
        <div className="l">Recorded uses</div>
        <div className="v">{formatNumber(stats.totalUsage)}</div>
        <div className="delta">wins, losses, attempts</div>
      </div>
      <div className="pbk-memory-stat">
        <div className="l">Avg confidence</div>
        <div className="v lime">{stats.averageConfidence}%</div>
        <div className="delta">{stats.provenSkills} proven skills</div>
      </div>
      <div className="pbk-memory-stat">
        <div className="l">Last refresh</div>
        <div className="v">{generatedLabel}</div>
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
          {skill.agentName || skill.source || skill.status || 'PBK runtime'}
        </span>
      </div>
      <div className="num">{formatNumber(Number(skill.usage || 0))}x</div>
      <div
        className={`num ${skill.successRate >= 60 ? 'good' : skill.successRate < 35 ? 'warn' : ''}`.trim()}
      >
        {skill.successRate}%
      </div>
      <div className="spark-wrap">
        <Sparkline values={skill.trend} />
      </div>
      <div className="bar">
        <div
          className={`bar-fill ${tone}`.trim()}
          style={{ width: `${Math.max(0, Math.min(100, confidence))}%` }}
        />
      </div>
    </div>
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
        {experiment.status || 'Experiment data came from the bridge outcome payload.'}
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
        The bridge returned no active emotional policy experiments. No sample variants are rendered.
      </p>
      <PbkDataSource endpoint="GET /api/emotion/policies/experiments" status="ships" />
    </section>
  );
}

const EMPTY_MEMORY = buildMemoryAnalyticsViewModel();

export function MemoryAnalytics() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [model, setModel] = useState<MemoryViewModel>(EMPTY_MEMORY);
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

  const loadMemoryAnalytics = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const outcomesResponse = await fetchSkillOutcomesRequest();
      const skills = outcomesResponse.skills || [];
      const trendPairs = await Promise.all(
        skills.slice(0, 12).map(async (skill) => {
          const skillId = String(skill.id || skill.skillId || skill.skill_id || '').trim();
          const skillName = String(skill.name || skill.skillName || skill.skill_name || '').trim();
          const trends = await fetchSkillTrendsRequest({ skillId, skillName, days: 30 });
          return [skillId || skillName, trends] as const;
        })
      );
      const trendsBySkillId = Object.fromEntries(trendPairs.filter(([key]) => Boolean(key)));
      const experimentsResponse = await fetchActiveExperimentsRequest();
      setModel(
        buildMemoryAnalyticsViewModel({ outcomesResponse, trendsBySkillId, experimentsResponse })
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

  return (
    <div className="pbk-memory-surface min-h-full text-slate-100">
      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-4 py-5 pb-8">
        <MemoryHero status={status} model={model} stats={stats} onRefresh={loadMemoryAnalytics} />

        {status === 'error' && (
          <section className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
            <h2 className="text-sm font-semibold text-red-100">
              Memory analytics bridge unavailable
            </h2>
            <p className="mt-1 text-sm text-red-200/80">{error}</p>
          </section>
        )}

        {model.warning && (
          <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            {model.warning}
          </section>
        )}

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
                    ? 'Loading skills from the bridge...'
                    : 'No skill outcome rows returned yet.'}
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
                status="needs-wiring"
                note="timeline requires canonical event feed"
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
