import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchSkillOutcomesRequest, fetchSkillTrendsRequest } from '../utils/runtimeBridge';
import { buildMemoryAnalyticsViewModel } from './memoryAnalyticsRuntimeLogic.js';

type MemoryViewModel = ReturnType<typeof buildMemoryAnalyticsViewModel>;
type SkillMetric = MemoryViewModel['skills'][number];
type ExperimentMetric = MemoryViewModel['experiments'][number];

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
      className={['sparkline', trendTone(values)].join(' ')}
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

function LiveExperimentCard({ experiment }: { experiment: ExperimentMetric }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
            Active experiment
          </div>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">{experiment.name}</h2>
          <p className="text-xs text-slate-500">{experiment.status || 'Runtime experiment'}</p>
        </div>
        <span className="rounded-full bg-lime-500/10 px-3 py-1 text-xs font-semibold text-lime-300">
          {experiment.confidence}% confidence
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {experiment.variants.map((variant: Record<string, unknown>, index: number) => {
          const name = String(variant.name || variant.id || `Variant ${index + 1}`);
          const attempts = Number(variant.attempts || variant.uses || 0);
          const successes = Number(variant.successes || variant.wins || 0);
          const rate = attempts
            ? Math.round((successes / attempts) * 100)
            : Number(variant.rate || 0);
          return (
            <div key={name} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{name}</div>
                  <div className="text-xs text-slate-500">
                    {successes}/{attempts} successes
                  </div>
                </div>
                <div className="text-2xl font-semibold text-slate-200">{rate}%</div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-sky-300"
                  style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const EMPTY_MEMORY = buildMemoryAnalyticsViewModel();

export function MemoryAnalytics() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [model, setModel] = useState<MemoryViewModel>(EMPTY_MEMORY);

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
      setModel(buildMemoryAnalyticsViewModel({ outcomesResponse, trendsBySkillId }));
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
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Memory & Analytics</h1>
          <p className="text-sm text-slate-400">
            Live skill outcomes, confidence, and trend history from the PBK bridge.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {status === 'loading'
              ? 'Loading skill outcomes...'
              : `${model.skills.length} skills returned from ${model.source}`}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={loadMemoryAnalytics}
          disabled={status === 'loading'}
        >
          <RefreshCw size={15} />
          Retry
        </button>
      </div>

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

      <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Skill performance</h2>
          <p className="text-xs text-slate-500">
            Trend lines are built from recorded skill usage history.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-900/80 text-[11px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Skill</th>
                <th className="px-4 py-3 font-semibold">Usage</th>
                <th className="px-4 py-3 font-semibold">Success rate</th>
                <th className="px-4 py-3 font-semibold">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {model.skills.length ? (
                model.skills.map((skill: SkillMetric) => (
                  <tr key={skill.id || skill.name} className="perf-row hover:bg-slate-900/70">
                    <td className="px-4 py-4 font-medium text-slate-100">
                      <div>{skill.name}</div>
                      <div className="mt-1 text-xs font-normal text-slate-500">
                        {skill.agentName || skill.source || skill.status || 'PBK'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-400">{skill.usage}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-2 text-slate-200">
                        {skill.successRate}%
                        <Sparkline values={skill.trend} />
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-lime-300"
                            style={{ width: `${skill.confidence}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400">{skill.confidence}%</span>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                    {status === 'loading'
                      ? 'Loading skills...'
                      : 'No skill outcome rows returned yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {model.experiments.length ? (
        model.experiments.map((experiment: ExperimentMetric) => (
          <LiveExperimentCard key={experiment.id || experiment.name} experiment={experiment} />
        ))
      ) : (
        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
            Experiment data
          </div>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">
            No active runtime experiments
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            When the bridge publishes live experiment results, this section will render those
            variants and confidence values.
          </p>
        </section>
      )}
    </div>
  );
}
