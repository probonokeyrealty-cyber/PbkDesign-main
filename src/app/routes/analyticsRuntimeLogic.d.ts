import type {
  AiMetricsResponse,
  AnalyticsLead,
  DealTimelineResponse,
  LeadStagesResponse,
} from '../utils/runtimeBridge';

export type AnalyticsLeadMetric = AnalyticsLead & {
  id: string;
  name: string;
  address: string;
  stage: string;
  stageLabel: string;
  revenue: number | null;
  revenueBasis: string;
  updatedAt: string;
};

export type AnalyticsFunnelStage = {
  stage: string;
  label: string;
  total: number;
  revenue: number | null;
  revenueBasis: string;
  leads: AnalyticsLeadMetric[];
};

export type AnalyticsDailyDeal = {
  day: string;
  count: number;
  revenue: number | null;
  revenueBasis: string;
  leads: AnalyticsLeadMetric[];
};

export type AnalyticsAiMetric = {
  label: string;
  value: string;
  raw: number;
};

export type AnalyticsRoi = {
  aiSpend: number | null;
  revenue: number | null;
  costPerContactedLead: number | null;
  costPerQualifiedLead: number | null;
  roiMultiple: number | null;
  costPerClosedDeal: number | null;
};

export type AnalyticsFinancial = {
  closedDeals: number;
  rosterLeads: number;
  rosterClosed: number;
  revenue: number | null;
  aiSpend: number | null;
  estimatedAiSpend: number | null;
  revenueComplete: boolean;
  costComplete: boolean;
  eligible: boolean;
  reportingPeriod: string;
  dateBasis: string;
  status: string;
  revenueCoverage: { totalRecords: number; recordedRecords: number; missingRecords: number } | null;
  costEvidence: { totalRecords: number; recordedRecords: number; estimatedRecords: number; missingRecords: number } | null;
};

export type AnalyticsViewModel = {
  source: string;
  generatedAt: string;
  warnings: string[];
  funnel: AnalyticsFunnelStage[];
  dailyDeals: AnalyticsDailyDeal[];
  aiMetrics: AnalyticsAiMetric[];
  roi: AnalyticsRoi;
  financial: AnalyticsFinancial;
};

export function numberOr(value: unknown, fallback?: number): number;
export function percentValue(value: unknown, digits?: number): number;
export function normalizeAnalyticsLead(item?: Record<string, unknown>): AnalyticsLeadMetric;
export function normalizeFunnel(stages?: Array<Record<string, unknown>>): AnalyticsFunnelStage[];
export function normalizeDailyDeals(days?: Array<Record<string, unknown>>): AnalyticsDailyDeal[];
export function normalizeAiMetrics(metrics?: Record<string, unknown>): AnalyticsAiMetric[];
export function readCampaignAttributionCost(row?: Record<string, unknown>): {
  basis: string; amount: number | null;
};
export function confirmAnalyticsPeriod(timeline?: DealTimelineResponse, costs?: AiMetricsResponse,
  period?: { days?: number; range?: string }): boolean;
export function computeAnalyticsRoi(options?: {
  contacted?: number;
  qualified?: number;
  closed?: number;
  aiSpend?: number | null;
  revenue?: number | null;
  eligible?: boolean;
}): AnalyticsRoi;
export function buildAnalyticsViewModel(options?: {
  stagesResponse?: LeadStagesResponse;
  timelineResponse?: DealTimelineResponse;
  aiMetricsResponse?: AiMetricsResponse;
}): AnalyticsViewModel;
export function buildAnalyticsCsv(model?: Partial<AnalyticsViewModel>): string;
