export function readAvaLeadSearch(value: unknown): string;
export function resolveAvaBrowserCommand(text: string, leadId?: string): {
  path: string | null;
  state?: { avaLeadSearch: string };
} | null;
