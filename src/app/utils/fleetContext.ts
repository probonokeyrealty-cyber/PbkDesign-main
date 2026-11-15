import { readLeadQueueReturn, type LeadQueueReturn } from './leadQueueReturn.ts';

export type FleetReturn = {
  leadId: string;
  agentId: string;
  query: string;
  scrollY: number;
  workspaceEntry: boolean;
  restoreFocus: boolean;
  leadReturn: LeadQueueReturn | null;
};

function validLeadId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
  );
}

function validAgentId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
}

export function readFleetRoute(search: string) {
  const params = new URLSearchParams(search);
  const explicitLead = params.has('leadId');
  const explicitAgent = params.has('agent');
  const lead = params.get('leadId');
  const agent = params.get('agent');
  const invalidLead = explicitLead && (params.getAll('leadId').length !== 1 || !validLeadId(lead));
  const invalidAgent =
    explicitAgent && (params.getAll('agent').length !== 1 || !validAgentId(agent));
  return {
    leadId: validLeadId(lead) && !invalidLead ? lead : '',
    agentId: validAgentId(agent) && !invalidAgent ? agent : '',
    explicitLead,
    explicitAgent,
    invalid: search.length > 4000 || invalidLead || invalidAgent,
  };
}

export function fleetHref(leadId: string, agentId: string) {
  if (!validLeadId(leadId) || !validAgentId(agentId)) throw new TypeError('Invalid fleet context');
  return `/fleet?${new URLSearchParams({ leadId, agent: agentId })}`;
}

export function readFleetReturn(value: unknown, leadId: string): FleetReturn | null {
  if (!value || typeof value !== 'object' || !validLeadId(leadId)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.leadId !== leadId ||
    !validAgentId(record.agentId) ||
    typeof record.query !== 'string' ||
    record.query.length > 4000 ||
    typeof record.scrollY !== 'number' ||
    !Number.isFinite(record.scrollY) ||
    record.scrollY < 0 ||
    record.scrollY > 10_000_000 ||
    typeof record.workspaceEntry !== 'boolean' ||
    typeof record.restoreFocus !== 'boolean'
  )
    return null;
  const leadReturn = record.leadReturn === null ? null : readLeadQueueReturn(record.leadReturn);
  if (record.leadReturn !== null && !leadReturn) return null;
  return {
    leadId,
    agentId: record.agentId,
    query: record.query,
    scrollY: record.scrollY,
    workspaceEntry: record.workspaceEntry,
    restoreFocus: record.restoreFocus,
    leadReturn,
  };
}
