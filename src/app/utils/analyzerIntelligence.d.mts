import type { DealData } from '../types';
import type { AttomPreviewAddress, PropertyIntelligenceResult } from './runtimeBridge';
export function hasCompleteAnalyzerAddress(address: string): boolean;
export function intelligenceRequest(deal: Partial<DealData>): {address:string;leadId?:string;expectedPropertyAddress?:AttomPreviewAddress};
export function mergeAnalyzerIntelligence(deal: DealData, response: PropertyIntelligenceResult, protectedFields?: ReadonlySet<string>): Partial<DealData>;
export function samePropertyAddress(a: unknown, b: unknown): boolean;
export const propertyContextFields: string[];
export function resetChangedProperty(deal: DealData, nextAddress: string): Partial<DealData>;
