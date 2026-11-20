type RuntimeRecord = Record<string, unknown>;

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
