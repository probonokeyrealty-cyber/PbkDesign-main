const closedStages = new Set(['closed', 'won', 'funded', 'closed_won', 'closed_funded', 'deal_closed', 'deal_funded']);

export function normalizeDealStage(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
}

export function isClosedDealStage(value) {
  return closedStages.has(normalizeDealStage(value));
}

export function readAnalyticsMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value.trim().replace(/[$,]/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function recordedDealRevenue(record = {}) {
  if (!isClosedDealStage(record.stage || record.status)) return null;
  for (const source of [record, record.payload, record.raw, record.deal, record.raw?.deal]) {
    if (source && typeof source === 'object' && Object.hasOwn(source, 'revenue')) {
      if (source.revenueBasis && source.revenueBasis !== 'recorded') return null;
      return readAnalyticsMoney(source.revenue);
    }
  }
  return null;
}

export function summarizeRecordedRevenue(records = []) {
  const closed = records.filter(record => isClosedDealStage(record.stage || record.status));
  const values = closed.map(recordedDealRevenue);
  const recordedRecords = values.filter(value => value !== null).length;
  const total = values.reduce((sum, value) => sum + (value ?? 0), 0);
  const complete = recordedRecords === closed.length && Number.isFinite(total);
  return {
    revenue: complete ? total : null,
    revenueBasis: complete ? 'recorded' : 'partial',
    revenueCoverage: { version: 1, totalRecords: closed.length, recordedRecords,
      missingRecords: closed.length - recordedRecords },
  };
}

export function hasCompleteRevenueCoverage(coverage, count) {
  return coverage?.version === 1 && Number.isSafeInteger(count) && count >= 0
    && coverage.totalRecords === count && coverage.recordedRecords === count && coverage.missingRecords === 0;
}

export function hasCompleteCostCoverage(coverage) {
  return coverage?.version === 1 && Number.isSafeInteger(coverage.totalRecords) && coverage.totalRecords >= 0
    && coverage.recordedRecords === coverage.totalRecords
    && coverage.estimatedRecords === 0 && coverage.missingRecords === 0;
}
