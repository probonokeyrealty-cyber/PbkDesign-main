export type LeadQueueFilter = 'all' | 'hot' | 'callable' | 'contract';
export type LeadQueueReturn = {
  path: '/' | '/command-center' | '/dashboard' | '/leads';
  search: string;
  scrollY: number;
  leadId: string;
  queue?: { query: string; filter: LeadQueueFilter; page: number };
};

export function readLeadQueueReturn(value: unknown): LeadQueueReturn | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.path !== '/' && record.path !== '/command-center' && record.path !== '/dashboard' && record.path !== '/leads') return null;
  if (typeof record.search !== 'string' || (record.search && !record.search.startsWith('?')) || record.search.length > 4000) return null;
  if (typeof record.leadId !== 'string' || record.leadId.length > 256 ||
    typeof record.scrollY !== 'number' || !Number.isFinite(record.scrollY) || record.scrollY < 0) return null;
  const result: LeadQueueReturn = {
    path: record.path, search: record.search, scrollY: record.scrollY, leadId: record.leadId,
  };
  if (record.queue) {
    const queue = record.queue as Record<string, unknown>;
    if (typeof queue.query !== 'string' || queue.query.length > 4000 ||
      !['all', 'hot', 'callable', 'contract'].includes(String(queue.filter)) ||
      !Number.isSafeInteger(queue.page) || Number(queue.page) < 0) return null;
    result.queue = { query: queue.query, filter: queue.filter as LeadQueueFilter, page: Number(queue.page) };
  }
  return result;
}
