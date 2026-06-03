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
  revenue: number;
  updatedAt: string;
};

export type AnalyticsFunnelStage = {
  stage: string;
  label: string;
  total: number;
  revenue: number;
  leads: AnalyticsLeadMetric[];
};

export type AnalyticsDailyDeal = {
  day: string;
  count: number;
  revenue: number;
  leads: AnalyticsLeadMetric[];
};

export type AnalyticsAiMetric = {
  label: string;
  value: string;
  raw: number;
};

export type AnalyticsRoi = {
  aiSpend: number;
  revenue: number;
  costPerContactedLead: number;
  costPerQualifiedLead: number;
  roiMultiple: number;
  costPerClosedDeal: number;
};

export type AnalyticsViewModel = {
  source: string;
  generatedAt: string;
  warnings: string[];
  funnel: AnalyticsFunnelStage[];
  dailyDeals: AnalyticsDailyDeal[];
  aiMetrics: AnalyticsAiMetric[];
  roi: AnalyticsRoi;
};

export function numberOr(value: unknown, fallback?: number): number;
export function percentValue(value: unknown, digits?: number): number;
export function normalizeAnalyticsLead(item?: Record<string, unknown>): AnalyticsLeadMetric;
export function normalizeFunnel(stages?: Array<Record<string, unknown>>): AnalyticsFunnelStage[];
export function normalizeDailyDeals(days?: Array<Record<string, unknown>>): AnalyticsDailyDeal[];
export function normalizeAiMetrics(metrics?: Record<string, unknown>): AnalyticsAiMetric[];
export function computeAnalyticsRoi(options?: {
  contacted?: number;
  qualified?: number;
  closed?: number;
  aiSpend?: number;
  revenue?: number;
}): AnalyticsRoi;
export function buildAnalyticsViewModel(options?: {
  stagesResponse?: LeadStagesResponse;
  timelineResponse?: DealTimelineResponse;
  aiMetricsResponse?: AiMetricsResponse;
}): AnalyticsViewModel;
export function buildAnalyticsCsv(model?: Partial<AnalyticsViewModel>): string;
