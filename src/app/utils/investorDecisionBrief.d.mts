export type DecisionKey =
  | 'asIs'
  | 'arv'
  | 'rent'
  | 'rehab'
  | 'closing'
  | 'monthlyCarry'
  | 'months'
  | 'sellingPercent'
  | 'targetProfit'
  | 'resaleDrop'
  | 'extraRehab'
  | 'extraMonths';
export type DecisionInputs = Partial<Record<DecisionKey, number | string | null>>;
export type DecisionBasis = 'asIs' | 'arv' | 'rent';
export type DecisionComp = {
  basis: DecisionBasis;
  label: string;
  source: string;
  amount: number;
  date: string;
  saleId: string;
  condition: string;
  rationale: string;
};
export type DecisionCheck = {
  title: string;
  source: string;
  owner: string;
  due: string;
  verified: boolean;
};
export type DecisionScenario = {
  id: string;
  name: string;
  savedAt: string;
  evidence: string;
  askingPrice: number | null;
  inputs: DecisionInputs;
  comps: DecisionComp[];
  checks: DecisionCheck[];
};
type FlipResult = { ceiling: number; profit: number | null; cash: number | null };
export const maxDecisionScenarios: number;
export const decisionInputLimits: Record<DecisionKey, [number, number]>;
export function calculateFlipDecision(
  inputs: DecisionInputs,
  askingPrice: number | null
): {
  base: FlipResult | null;
  downside: FlipResult | null;
  missing: DecisionKey[];
  missingDownside: DecisionKey[];
};
export function decisionEvidenceVersion(
  records: unknown,
  sales: { retrievedAt?: string } | null,
  selectedSales: { id: string }[]
): string;
export function normalizeDecisionScenario(
  value: unknown,
  savedAt?: string
): DecisionScenario | null;
export function readDecisionScenarios(value: unknown): DecisionScenario[];
export function addDecisionScenario(
  current: DecisionScenario[],
  scenario: DecisionScenario
): DecisionScenario[] | null;
