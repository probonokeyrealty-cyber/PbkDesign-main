import type { DealData } from '../types';
import type { RecordedSale } from './runtimeBridge';
export function compNumber(value: unknown): number | null;
export function compDate(value: unknown): string;
export function compPhotoEvidence(sale: unknown): NonNullable<RecordedSale['photoEvidence']> | null;
export function reviewedCompIds(result: unknown): string[];
export function selectedCompPatch(result: unknown, selectedIds: string[], address: unknown): {
  actor: string; actionSource: string; expectedPropertyAddress: unknown;
  analyzer: { comps: DealData['comps']; recordedSales: Record<string, unknown> };
  deal: { comps: DealData['comps']; isAnalyzed: boolean };
};
export function savedLeadComps(lead: unknown): DealData['comps'] | null;
