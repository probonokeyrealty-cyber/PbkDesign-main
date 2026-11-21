type RuntimeRecord = Record<string, unknown>;

export type SavedRaleighReceipt = {
  jobId: string;
  completedAt: string;
  exa: { tool: 'EXA_ANSWER'; count: 1; logId: string; at: string };
  e2b: {
    count: 1; sandboxId: string; createdAt: string; createdEventId: string;
    killedAt: string; killedEventId: string; cleanupConfirmed: true;
  };
};

const record = (value: unknown): RuntimeRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RuntimeRecord : null;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

export function readSavedRaleighReceipt(meta: RuntimeRecord | undefined): SavedRaleighReceipt | null {
  const saved = record(meta?.savedRaleighReceipt);
  if (meta?.executionEnabled !== false || !saved || !id(saved.jobId) || !timestamp(saved.completedAt)) return null;
  const exa = record(saved.exa);
  const e2b = record(saved.e2b);
  if (!exa || exa.tool !== 'EXA_ANSWER' || exa.count !== 1 || !id(exa.logId) || !timestamp(exa.at) ||
      !e2b || e2b.count !== 1 || !id(e2b.sandboxId) || e2b.cleanupConfirmed !== true ||
      !id(e2b.createdEventId) || !id(e2b.killedEventId) || e2b.createdEventId === e2b.killedEventId ||
      !timestamp(e2b.createdAt) || !timestamp(e2b.killedAt) ||
      Date.parse(exa.at) > Date.parse(e2b.createdAt) || Date.parse(e2b.createdAt) > Date.parse(e2b.killedAt) ||
      Date.parse(e2b.killedAt) > Date.parse(saved.completedAt)) return null;
  return {
    jobId: saved.jobId, completedAt: saved.completedAt,
    exa: { tool: exa.tool, count: exa.count, logId: exa.logId, at: exa.at },
    e2b: {
      count: e2b.count, sandboxId: e2b.sandboxId, cleanupConfirmed: e2b.cleanupConfirmed,
      createdAt: e2b.createdAt, createdEventId: e2b.createdEventId, killedAt: e2b.killedAt, killedEventId: e2b.killedEventId,
    },
  };
}

export function lastCompletedPublicMarketRun(
  jobs: readonly RuntimeRecord[] | undefined,
  tasks: readonly RuntimeRecord[] | undefined,
): string | null {
  const approvals = new Set((tasks ?? [])
    .filter((task) => task.provider === 'e2b' && task.action === 'public_market_brief' &&
      task.status === 'complete' && typeof task.id === 'string' && task.id.length > 0)
    .map((task) => task.id));
  let latest = -Infinity;
  for (const job of jobs ?? []) {
    if (job.provider !== 'e2b' || job.source !== 'public-market-brief' ||
        job.status !== 'complete' || job.consumed !== true || job.cleanupConfirmed !== true ||
        !approvals.has(job.approvalTaskId) || typeof job.completedAt !== 'string') continue;
    const completed = Date.parse(job.completedAt);
    if (Number.isFinite(completed) && completed > latest) latest = completed;
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}
