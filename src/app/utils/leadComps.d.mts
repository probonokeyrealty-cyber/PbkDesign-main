import type { DealData } from '../types';
export function selectedCompPatch(result: unknown, selectedIds: string[], address: unknown): {
  actor: string; actionSource: string; expectedPropertyAddress: unknown;
  analyzer: { comps: DealData['comps']; recordedSales: Record<string, unknown> };
  deal: { comps: DealData['comps']; isAnalyzed: boolean };
};
export function savedLeadComps(lead: unknown): DealData['comps'] | null;
