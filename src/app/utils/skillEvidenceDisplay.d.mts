export function readRecordedCount(value: unknown): number | null;

export function readSkillEvidenceDisplay(item: unknown): {
  usageCount: number | null;
  successPercent: number | null;
  confidencePercent: number | null;
  changePercent: number | null;
  lastTriggeredAt: string | null;
};

export function formatSkillMetric(
  value: number | null,
  kind: 'count' | 'percent' | 'change'
): string;

export function getSkillStageDisplay(
  state: unknown,
  labels: Readonly<Record<string, string>>,
  steps: Readonly<Record<string, number>>
): { label: string; index: number | null };
