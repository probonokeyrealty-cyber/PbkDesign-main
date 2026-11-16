type RecordValue = Record<string, unknown>;
export type StoredNextStep = {
  state: 'recorded' | 'empty' | 'unavailable';
  text: string;
};

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : {};
}

export function readStoredNextStep(value: unknown): StoredNextStep {
  const root = record(value);
  const lead = record(root.lead || root.profile || root);
  const expectedId = lead.id ?? lead.leadId;
  if (lead.id !== undefined && lead.leadId !== undefined && lead.id !== lead.leadId)
    return { state: 'unavailable', text: 'Next step unavailable' };
  const owned = (value: unknown) => {
    const source = record(value);
    return ['leadId', 'lead_id'].some(key => Object.hasOwn(source, key)
      && (!validId(expectedId) || source[key] !== expectedId)) ? {} : source;
  };
  const legacyContext = owned(lead.call_context);
  const currentContext = owned(lead.callContext);
  const context = { ...legacyContext, ...currentContext };
  const bant = { ...owned(legacyContext.bant), ...owned(currentContext.bant), ...owned(lead.bant) };
  const values = [bant.nextStep, bant.next_step, context.nextStep, context.next_step];
  const stored = values.find((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  if (stored !== undefined) return { state: 'recorded', text: stored };
  return values.some(item => typeof item === 'string')
    ? { state: 'empty', text: 'No next step recorded' }
    : { state: 'unavailable', text: 'Next step unavailable' };
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && Array.from(value).every(character => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    });
}

export function resolveTriageLead(
  item: { targetPath: string; leadId?: unknown; recordKind?: unknown; recordId?: unknown },
  roster: unknown[],
): { leadId: string; href: string; nextStep: StoredNextStep } | null {
  const reference = item.recordKind === 'lead' ? item.recordId : undefined;
  if (item.recordKind === 'lead' && !validId(reference)) return null;
  const match = item.targetPath.match(/^\/leads\/([^/?#]+)(?:[?#].*)?$/);
  let leadId: string;
  if (match) {
    try { leadId = decodeURIComponent(match[1]); } catch { return null; }
  } else if (/^\/leads(?:[?#].*)?$/.test(item.targetPath) && validId(reference)) {
    leadId = reference;
  } else return null;
  if (!validId(leadId) || (item.leadId !== undefined && item.leadId !== leadId)
    || (reference !== undefined && reference !== leadId)) return null;
  const matches = roster.map(record).filter(lead => {
    if (lead.id !== undefined && lead.leadId !== undefined && lead.id !== lead.leadId) return false;
    return (lead.id ?? lead.leadId) === leadId;
  });
  return { leadId, href: `/leads/${encodeURIComponent(leadId)}`, nextStep: readStoredNextStep(matches.length === 1 ? matches[0] : null) };
}
