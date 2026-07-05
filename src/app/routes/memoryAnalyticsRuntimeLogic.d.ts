import type {
  MemoryEventsResponse,
  SkillOutcomesResponse,
  SkillTrendsResponse,
} from '../utils/runtimeBridge';

export type MemorySkillMetric = {
  id: string;
  name: string;
  agentName: string;
  usage: number;
  wins: number;
  losses: number;
  successRate: number;
  confidence: number;
  status: string;
  source: string;
  trend: number[];
};

export type MemoryExperimentMetric = {
  id: string;
  name: string;
  status: string;
  confidence: number;
  variants: Array<Record<string, unknown>>;
};

export type MemoryEventMetric = {
  id: string;
  type: string;
  title: string;
  detail: string;
  agentName: string;
  createdAt: string;
  source: string;
  sourceHref: string;
  skillName: string;
  leadId: string;
  callId: string;
  chatId: string;
  campaignId: string;
  confidence: number;
  success: boolean | null;
  score: number | null;
  metadata: Record<string, unknown>;
};

export type MemoryAnalyticsViewModel = {
  source: string;
  generatedAt: string;
  warning: string;
  skills: MemorySkillMetric[];
  events: MemoryEventMetric[];
  experiments: MemoryExperimentMetric[];
};

export function normalizeSkillMetric(
  skill?: Record<string, unknown>,
  trendResponse?: SkillTrendsResponse | Record<string, unknown>
): MemorySkillMetric;
export function buildMemoryAnalyticsViewModel(options?: {
  outcomesResponse?: SkillOutcomesResponse;
  trendsBySkillId?: Record<string, SkillTrendsResponse | Record<string, unknown>>;
  experimentsResponse?: Record<string, unknown>;
  memoryEventsResponse?: MemoryEventsResponse | Record<string, unknown>;
}): MemoryAnalyticsViewModel;
