export function readAvaLeadSearch(value: unknown): string;
export function readLeadEvidenceTarget(hash: string): {
  sectionId: 'lead-numbers' | 'lead-property';
  propertyTab?: 'overview' | 'record' | 'comps' | 'photos';
} | null;
export function resolveAvaBrowserCommand(text: string, leadId?: string): {
  path: string | null;
  state?: { avaLeadSearch: string };
} | null;
