type Variant = {
  name: string;
  attempts: number;
  successes: number;
  rate: number;
};

type SkillMetric = {
  name: string;
  usage: number;
  successRate: number;
  confidence: number;
  trend: number[];
};

const BASE_TRENDS = {
  up: [50, 51, 52, 52, 53, 54, 55, 55, 56, 57, 58, 58, 59, 61, 62, 63, 63, 65, 66, 67, 68, 69, 70, 72, 73, 75, 76, 77, 78, 80],
  down: [82, 82, 81, 80, 80, 79, 78, 77, 77, 76, 75, 75, 73, 72, 72, 70, 69, 68, 68, 66, 65, 65, 63, 62, 61, 60, 59, 58, 57, 56],
  flat: [66, 66, 67, 66, 66, 67, 66, 66, 67, 66, 66, 67, 66, 66, 67, 66, 66, 67, 66, 66, 67, 66, 66, 67, 66, 66, 67, 66, 66, 67],
};

const SKILLS: SkillMetric[] = [
  { name: 'Tactical Empathy', usage: 187, successRate: 71, confidence: 94, trend: BASE_TRENDS.up },
  { name: 'Mirroring', usage: 142, successRate: 68, confidence: 88, trend: BASE_TRENDS.flat },
  { name: 'Ackerman Negotiation v3', usage: 50, successRate: 48, confidence: 71, trend: BASE_TRENDS.up },
  { name: 'Silence Hold', usage: 14, successRate: 31, confidence: 42, trend: BASE_TRENDS.down },
];

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
    .map((value, index) => `${(index / maxIndex) * 60},${20 - (value / 100) * 18}`)
    .join(' ');

  return (
    <svg className={['sparkline', trendTone(values)].join(' ')} width="60" height="20" viewBox="0 0 60 20" aria-hidden="true">
      <polyline points={points} stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ABTestCard({
  testName,
  variantA,
  variantB,
  lift,
  daysRunning,
}: {
  testName: string;
  variantA: Variant;
  variantB: Variant;
  lift: number;
  daysRunning: number;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Active A/B test</div>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">{testName}</h2>
          <p className="text-xs text-slate-500">Running {daysRunning} days - static UI sample.</p>
        </div>
        <span className="rounded-full bg-lime-500/10 px-3 py-1 text-xs font-semibold text-lime-300">
          +{lift}% lift
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {[variantA, variantB].map((variant, index) => {
          const winner = index === 0;
          return (
            <div
              key={variant.name}
              className={[
                'rounded-2xl border p-4',
                winner
                  ? 'border-lime-400/60 bg-lime-400/10'
                  : 'border-slate-800 bg-slate-900/70',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{variant.name}</div>
                  <div className="text-xs text-slate-500">{variant.successes}/{variant.attempts} successes</div>
                </div>
                <div className={winner ? 'text-2xl font-semibold text-lime-300' : 'text-2xl font-semibold text-slate-200'}>
                  {variant.rate}%
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                <div className={winner ? 'h-full rounded-full bg-lime-300' : 'h-full rounded-full bg-sky-300'} style={{ width: `${variant.rate}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
        Statistical confidence: <span className="text-slate-100">86%</span> - test ends in <span className="text-slate-100">2 days</span>
      </div>
    </section>
  );
}

export function MemoryAnalytics() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Memory & Analytics</h1>
        <p className="text-sm text-slate-400">Self-modifying memory, skill performance, and experiment confidence.</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Skill performance</h2>
          <p className="text-xs text-slate-500">30-day confidence trend is cosmetic mock data for UI validation.</p>
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
              {SKILLS.map((skill) => (
                <tr key={skill.name} className="perf-row hover:bg-slate-900/70">
                  <td className="px-4 py-4 font-medium text-slate-100">{skill.name}</td>
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
                        <div className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-lime-300" style={{ width: `${skill.confidence}%` }} />
                      </div>
                      <span className="text-xs text-slate-400">{skill.confidence}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ABTestCard
        testName="Ackerman Negotiation"
        variantA={{ name: 'v3 (winner)', attempts: 50, successes: 24, rate: 48 }}
        variantB={{ name: 'v2 (control)', attempts: 50, successes: 19, rate: 38 }}
        lift={10}
        daysRunning={5}
      />
    </div>
  );
}
