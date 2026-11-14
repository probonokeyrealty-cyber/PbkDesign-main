import Papa from 'papaparse';

export const MAX_BATCH_BYTES = 5 * 1024 * 1024;
export const MAX_BATCH_ROWS = 5000;
const MAX_COLUMNS = 200;

export const batchStatuses = ['new', 'match', 'conflict', 'invalid'] as const;
export type BatchStatus = (typeof batchStatuses)[number];
type RowRecord = Record<string, unknown>;
type SourceRow = { number: number; record: RowRecord; issues: string[] };
type Candidate = { id: string; address: string };
type DncStatus = 'dnc' | 'not-dnc' | 'unknown';
type ReviewPhone = {
  slot: number;
  number: string;
  dnc: DncStatus;
  dncSource: string;
  type: string;
};
export type FieldComparison = {
  label: string;
  existing: string;
  incoming: string;
  disposition: 'same' | 'empty' | 'preserved' | 'incoming' | 'unmapped';
};
export type BatchReviewRow = {
  number: number;
  label: string;
  status: BatchStatus;
  issues: string[];
  candidates: Candidate[];
  fields: FieldComparison[];
  phones: ReviewPhone[];
};

const fieldDefinitions = {
  leadId: ['PBK lead ID', 'leadid', 'pbkleadid'],
  sourceId: ['Source record ID', 'sourcerecordid', 'sourceid', 'externalid', 'propertyid'],
  address: ['Property address', 'address', 'propertyaddress', 'situsaddress', 'streetaddress'],
  city: ['City', 'city', 'propertycity'],
  state: ['State', 'state', 'propertystate'],
  zip: ['ZIP', 'zip', 'zipcode', 'postalcode', 'propertyzip', 'propertyzipcode'],
  owner: ['Owner name', 'owner', 'ownername', 'sellername', 'leadname', 'name'],
  firstName: ['Owner first name', 'ownerfirstname', 'firstname'],
  lastName: ['Owner last name', 'ownerlastname', 'lastname'],
  owner2First: ['Second owner first name', 'owner2firstname'],
  owner2Last: ['Second owner last name', 'owner2lastname'],
  mailingCity: ['Mailing city', 'mailingcity'],
  mailingState: ['Mailing state', 'mailingstate'],
  phone: ['Phone', 'phone', 'ownerphone', 'sellerphone', 'phonenumber'],
  email: ['Email', 'email', 'owneremail', 'selleremail', 'emailaddress'],
  email2: ['Second email', 'email2', 'secondaryemail'],
  parcel: ['Parcel ID', 'parcelid', 'apn', 'assessorparcelnumber'],
  askingPrice: ['Asking price', 'askingprice', 'listprice', 'listingprice'],
  propertyType: ['Property type detail', 'propertytypedetail', 'propertytype'],
  vacant: ['Vacant', 'isvacant', 'vacant'],
  beds: ['Bedrooms', 'beds', 'bedrooms', 'bedroomcount'],
  baths: ['Bathrooms', 'baths', 'bathrooms', 'bathroomcount'],
  sqft: [
    'Living area (sq ft)',
    'sqft',
    'squarefeet',
    'livingsqft',
    'livingsquarefeet',
    'buildingarea',
    'totalbuildingareasquarefeet',
  ],
  lotSqft: ['Lot area (sq ft)', 'lotsqft', 'lotsquarefeet', 'lotsizesqft', 'lotsizesquarefeet'],
  yearBuilt: ['Year built', 'yearbuilt'],
  lastSaleDate: ['Last sale date', 'lastsaledate'],
  lastSalePrice: ['Last sale price', 'lastsaleprice'],
  estimatedValue: ['Estimated value', 'estimatedvalue'],
  assessedValue: ['Total assessed value', 'totalassessedvalue'],
  loanBalance: ['Total loan balance', 'totalloanbalance'],
  equityBalance: [
    'Estimated equity balance',
    'equitycurrentestimatedbalance',
    'estimatedequitybalance',
  ],
  foreclosureDocument: ['Foreclosure document type', 'foreclosuredocumenttype'],
  foreclosureStatus: ['Foreclosure status', 'foreclosurestatus'],
  foreclosureAuction: ['Foreclosure auction date', 'foreclosureauctiondate'],
  foreclosureDefault: ['Foreclosure loan default date', 'foreclosureloandefaultdate'],
  foreclosureRecording: ['Foreclosure recording date', 'foreclosurerecordingdate'],
  foreclosureCase: ['Foreclosure case number', 'foreclosurecasenumber'],
  foreclosureTrustee: ['Foreclosure trustee/attorney', 'foreclosuretrusteeattorneyname'],
  source: ['Source', 'source', 'datasource'],
  sourceUpdatedAt: ['Source updated at', 'sourceupdatedat'],
} as const;
type Field = keyof typeof fieldDefinitions;
const headerKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const aliases = new Map<string, Field>(
  Object.entries(fieldDefinitions).flatMap(([field, [, ...names]]) =>
    [...names, headerKey(field)].map((name) => [name, field as Field] as const)
  )
);
const moneyFields = new Set<Field>([
  'askingPrice',
  'lastSalePrice',
  'estimatedValue',
  'assessedValue',
  'loanBalance',
  'equityBalance',
]);
const dateFields = new Set<Field>([
  'lastSaleDate',
  'foreclosureAuction',
  'foreclosureDefault',
  'foreclosureRecording',
]);
const numericFields = new Set<Field>([
  ...moneyFields,
  'beds',
  'baths',
  'sqft',
  'lotSqft',
  'yearBuilt',
]);
const metadataFields = new Set<Field>(['source', 'sourceId', 'sourceUpdatedAt']);
const propertyFields = new Set<Field>([
  'address',
  'city',
  'state',
  'zip',
  'parcel',
  'propertyType',
  'vacant',
  ...dateFields,
  ...numericFields,
]);
const sellerFields = new Set<Field>([
  'owner',
  'firstName',
  'lastName',
  'email',
  'phone',
  'email2',
  'owner2First',
  'owner2Last',
  'mailingCity',
  'mailingState',
]);
const asRecord = (value: unknown): RowRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RowRecord)
    : null;
const display = (value: unknown): string =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function parseBatchFile(name: string, text: string): SourceRow[] {
  if (!text.trim()) throw new Error('The file is empty.');
  let rows: SourceRow[];
  if (/\.csv$/i.test(name)) {
    const result = Papa.parse<string[]>(text, {
      delimiter: ',',
      skipEmptyLines: true,
      preview: MAX_BATCH_ROWS + 2,
    });
    if (result.errors.length)
      throw new Error('Invalid CSV quoting. Check the source file and try again.');
    const [headers, ...data] = result.data;
    const keys = (headers || []).map(headerKey);
    if (!keys.length || keys.some((key) => !key) || new Set(keys).size !== keys.length) {
      throw new Error('CSV column names must be nonblank and unique.');
    }
    if (keys.length > MAX_COLUMNS) throw new Error(`The batch exceeds ${MAX_COLUMNS} columns.`);
    rows = data.map((cells, index) => ({
      number: index + 1,
      record: Object.fromEntries(
        Array.from(
          { length: Math.min(MAX_COLUMNS, Math.max(headers.length, cells.length)) },
          (_, column) => [headers[column] ?? `Extra column ${column + 1}`, cells[column] ?? '']
        )
      ),
      issues:
        cells.length > MAX_COLUMNS
          ? [`Row exceeds ${MAX_COLUMNS} fields. Extra fields are not shown.`]
          : cells.length === headers.length
            ? []
            : ['Column count does not match the CSV header.'],
    }));
  } else if (/\.json$/i.test(name)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('Invalid JSON. Check the source file and try again.');
    }
    if (!Array.isArray(parsed)) throw new Error('JSON must contain an array of lead objects.');
    if (parsed.length > MAX_BATCH_ROWS)
      throw new Error(`Review up to ${MAX_BATCH_ROWS} rows per batch.`);
    rows = parsed.map((value, index) => {
      const record = asRecord(value);
      if (!record)
        return {
          number: index + 1,
          record: { 'Raw row': value },
          issues: ['Expected a lead object.'],
        };
      const entries = Object.entries(record);
      const issues =
        entries.length > MAX_COLUMNS
          ? [`Row exceeds ${MAX_COLUMNS} fields. Extra fields are not shown.`]
          : [];
      return {
        number: index + 1,
        record: Object.fromEntries(entries.slice(0, MAX_COLUMNS)),
        issues,
      };
    });
  } else {
    throw new Error('Choose a CSV or JSON file.');
  }
  if (!rows.length) throw new Error('The file has no data rows.');
  if (rows.length > MAX_BATCH_ROWS)
    throw new Error(`Review up to ${MAX_BATCH_ROWS} rows per batch.`);
  return rows;
}

function moneyOrNumber(value: string, field: Field) {
  let normalized = value.trim();
  if (moneyFields.has(field)) normalized = normalized.replace(/^(-?)\$\s*/, '$1');
  const negative = field === 'equityBalance' && normalized.startsWith('-');
  if (negative) normalized = normalized.slice(1);
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return NaN;
  const number = Number(normalized.replace(/,/g, '')) * (negative ? -1 : 1);
  if (!Number.isFinite(number)) return NaN;
  return field === 'yearBuilt' && (!Number.isInteger(number) || number < 1000 || number > 9999)
    ? NaN
    : number;
}

function dateKey(value: string) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}.*)?$/.exec(value.trim());
  const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value.trim());
  const parts = iso ? iso.slice(1) : us ? [us[3], us[1], us[2]] : [];
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day || year < 1000) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : '';
}

const normalizedText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const yes = /^(?:yes|y|true|1)$/i;
const no = /^(?:no|n|false|0)$/i;
const phoneSlotKey = (header: string) => /^phone([1-5])(dnc|type)?$/.exec(headerKey(header));
const dncStatus = (value: string): DncStatus =>
  yes.test(value) || /^dnc$/i.test(value)
    ? 'dnc'
    : no.test(value) || /^not dnc$/i.test(value)
      ? 'not-dnc'
      : 'unknown';
const phoneKey = (value: string) => value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

function readNumberedPhones(record: RowRecord, issues?: string[]): ReviewPhone[] {
  const slots = new Map<number, { number: string; dnc: string; type: string }>();
  for (const [header, value] of Object.entries(record)) {
    const match = phoneSlotKey(header);
    if (!match) continue;
    const slot = Number(match[1]);
    const entry = slots.get(slot) ?? { number: '', dnc: '', type: '' };
    const key = match[2] === 'dnc' ? 'dnc' : match[2] === 'type' ? 'type' : 'number';
    const incoming = display(value).trim();
    if (entry[key] && incoming && normalizedText(entry[key]) !== normalizedText(incoming)) {
      issues?.push(`Phone ${slot} has conflicting ${key} values.`);
    } else if (incoming) {
      entry[key] = incoming;
    }
    slots.set(slot, entry);
  }
  const phoneStatuses = new Map<string, DncStatus>();
  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([slot, entry]) => {
      const { number, dnc: dncSource, type } = entry;
      if (!number && !dncSource && !type) return [];
      const key = phoneKey(number);
      const status = dncStatus(dncSource);
      if (!number) issues?.push(`Phone ${slot} has metadata but no phone number.`);
      else if (!/^\d{10}$/.test(key) || !/^[+\d\s().-]+$/.test(number)) {
        issues?.push(`Phone ${slot} is not a valid 10-digit phone number.`);
      }
      if (dncSource && status === 'unknown' && !/^unknown$/i.test(dncSource)) {
        issues?.push(`Phone ${slot} DNC must be Yes, No, or Unknown.`);
      }
      if (key && status !== 'unknown') {
        const prior = phoneStatuses.get(key);
        if (prior && prior !== status)
          issues?.push('The same phone number has conflicting DNC flags.');
        phoneStatuses.set(key, status);
      }
      return [{ slot, number, dnc: status, dncSource, type }];
    });
}

function savedPhones(value: unknown, fields: Map<Field, string>): ReviewPhone[] {
  const envelope = asRecord(value);
  const record = asRecord(envelope?.lead) ?? asRecord(envelope?.leadImport) ?? envelope ?? {};
  const phones = readNumberedPhones({ ...asRecord(record.seller), ...record });
  for (const [index, value] of (Array.isArray(record.phones) ? record.phones : []).entries()) {
    const entry = asRecord(value);
    const number = display(entry?.number).trim();
    if (!number) continue;
    const dncSource = display(entry?.dnc).trim();
    phones.push({
      slot: Number(entry?.slot) || index + 1,
      number,
      dnc: dncSource === 'not-dnc' ? 'not-dnc' : dncStatus(dncSource),
      dncSource,
      type: display(entry?.type).trim(),
    });
  }
  const primary = fields.get('phone')?.trim();
  if (primary && !phones.some(({ number }) => phoneKey(number) === phoneKey(primary))) {
    phones.push({ slot: 1, number: primary, dnc: 'unknown', dncSource: '', type: '' });
  }
  return phones.filter(({ number }) => Boolean(number));
}

function formatPhone(phone: ReviewPhone) {
  const flag =
    phone.dnc === 'dnc'
      ? 'Yes'
      : phone.dnc === 'not-dnc'
        ? 'No'
        : phone.dncSource && !/^unknown$/i.test(phone.dncSource)
          ? `Unknown (${phone.dncSource})`
          : 'Unknown';
  return `${phone.number || 'No number'}\nDNC: ${flag}${phone.type ? `\nType: ${phone.type}` : ''}`;
}

const addressKey = (value: string) =>
  normalizedText(value.replace(/[.,]/g, ' ').replace(/\s*#\s*/g, ' #'));
const streetKey = (value: string) => addressKey(value.split(',')[0]);

function comparisonKey(field: Field, value: string) {
  if (field === 'leadId' || field === 'sourceId') return value.trim();
  if (field === 'address') return addressKey(value);
  if (field === 'phone') return phoneKey(value);
  if (dateFields.has(field)) return dateKey(value) || normalizedText(value);
  if (field === 'vacant')
    return yes.test(value.trim()) ? 'yes' : no.test(value.trim()) ? 'no' : normalizedText(value);
  if (numericFields.has(field)) {
    const number = moneyOrNumber(value, field);
    if (Number.isFinite(number)) return String(number);
  }
  return normalizedText(value);
}

function readSavedFields(value: unknown) {
  const envelope = asRecord(value);
  if (!envelope) throw new Error('The saved lead roster contains unreadable records.');
  const record = asRecord(envelope.lead) ?? asRecord(envelope.leadImport) ?? envelope;
  const fields = new Map<Field, string>();
  for (const [source, allowed] of [
    [record, undefined],
    [asRecord(record.property), propertyFields],
    [
      typeof record.seller === 'string' ? { name: record.seller } : asRecord(record.seller),
      sellerFields,
    ],
  ] as const) {
    for (const [key, value] of Object.entries(source ?? {})) {
      const field = aliases.get(headerKey(key));
      if (!field || (allowed && !allowed.has(field))) continue;
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      if (String(value).trim() && !fields.has(field)) fields.set(field, String(value));
    }
  }
  // Prefer the canonical bridge identifier to an envelope's storage ID.
  const id =
    display(record.leadId).trim() || display(record.lead_id).trim() || display(record.id).trim();
  if (id) fields.set('leadId', id);
  return fields;
}

type SavedLead = { fields: Map<Field, string>; candidate: Candidate; phones: ReviewPhone[] };
const addIndex = <T>(index: Map<string, T[]>, key: string, value: T) => {
  if (!key) return;
  const entries = index.get(key);
  if (entries) entries.push(value);
  else index.set(key, [value]);
};

function readIncoming(row: SourceRow) {
  const fields = new Map<Field, string>();
  const unmapped: FieldComparison[] = [];
  const issues = [...row.issues];
  const phones = readNumberedPhones(row.record, issues);
  for (const [header, value] of Object.entries(row.record)) {
    if (phoneSlotKey(header)) continue;
    const field = aliases.get(headerKey(header));
    const incoming = display(value);
    if (!incoming.trim()) continue;
    if (!field) {
      unmapped.push({ label: header, incoming, existing: '', disposition: 'unmapped' });
      continue;
    }
    const label = fieldDefinitions[field][0];
    if (typeof value !== 'string' && typeof value !== 'number') {
      issues.push(`${label} must be text or a number.`);
    } else if (numericFields.has(field) && !Number.isFinite(moneyOrNumber(incoming, field))) {
      issues.push(`${label} is not a valid number.`);
    } else if (dateFields.has(field) && !dateKey(incoming)) {
      issues.push(`${label} is not a valid date.`);
    } else if (field === 'vacant' && !yes.test(incoming.trim()) && !no.test(incoming.trim())) {
      issues.push('Vacant must be Yes or No.');
    } else if (field === 'zip' && !/^\d{5}(?:-\d{4})?$/.test(incoming.trim())) {
      issues.push('ZIP must have five digits or ZIP+4.');
    } else if (
      (field === 'email' || field === 'email2') &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(incoming.trim())
    ) {
      issues.push(`${label} is not valid.`);
    }
    const prior = fields.get(field);
    if (prior !== undefined && comparisonKey(field, prior) !== comparisonKey(field, incoming)) {
      issues.push(`More than one value was provided for ${label}.`);
      unmapped.push({ label: header, incoming, existing: '', disposition: 'unmapped' });
    } else {
      fields.set(field, incoming);
    }
  }
  if (!fields.has('owner') && (fields.has('firstName') || fields.has('lastName'))) {
    fields.set(
      'owner',
      [fields.get('firstName'), fields.get('lastName')].filter(Boolean).join(' ')
    );
  }
  const id = fields.get('leadId')?.trim() || '';
  const address = fields.get('address')?.trim() || '';
  if (!id && (!address || /^(unknown|n\/a|no property|-)$/i.test(address))) {
    issues.push('A property address or PBK lead ID is required.');
  }
  const sourceId = fields.get('sourceId')?.trim() || '';
  const sourceKey = sourceId
    ? JSON.stringify([normalizedText(fields.get('source') || ''), sourceId])
    : '';
  return { row, id, address, sourceKey, fields, issues, unmapped, phones };
}

export function buildBatchReview(rows: SourceRow[], roster: readonly unknown[]): BatchReviewRow[] {
  const byId = new Map<string, SavedLead[]>();
  const byStreet = new Map<string, SavedLead[]>();
  for (const record of roster) {
    const fields = readSavedFields(record);
    const id = fields.get('leadId') || '';
    const address = fields.get('address') || '';
    const lead = { fields, candidate: { id, address }, phones: savedPhones(record, fields) };
    addIndex(byId, id, lead);
    addIndex(byStreet, streetKey(address), lead);
  }

  const incoming = rows.map(readIncoming);
  const idCounts = new Map<string, number[]>();
  const sourceCounts = new Map<string, number[]>();
  const addressCounts = new Map<string, number[]>();
  for (const row of incoming) {
    addIndex(idCounts, row.id, row.row.number);
    addIndex(sourceCounts, row.sourceKey, row.row.number);
    addIndex(addressCounts, streetKey(row.address), row.row.number);
  }

  return incoming.map(({ row, id, address, sourceKey, fields, issues, unmapped, phones }) => {
    const idMatches = byId.get(id) ?? [];
    const streetMatches = byStreet.get(streetKey(address)) ?? [];
    const candidates = [...new Set([...idMatches, ...streetMatches])];
    const exact = idMatches.length === 1 ? idMatches[0] : undefined;
    // A sole address candidate is shown for review, never selected automatically.
    const existing = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    const comparisons: FieldComparison[] = [...fields].map(([field, incoming]) => {
      const saved = metadataFields.has(field) ? '' : (existing?.fields.get(field) ?? '');
      const disposition =
        !existing || metadataFields.has(field)
          ? 'incoming'
          : !saved
            ? 'empty'
            : comparisonKey(field, saved) === comparisonKey(field, incoming)
              ? 'same'
              : 'preserved';
      return { label: fieldDefinitions[field][0], existing: saved, incoming, disposition };
    });
    for (const phone of phones) {
      const matching =
        existing?.phones.filter(({ number }) => phoneKey(number) === phoneKey(phone.number)) ?? [];
      // When saved copies disagree, a positive DNC flag takes precedence in the review.
      const saved =
        matching.find(({ dnc }) => dnc === 'dnc') ??
        matching[0] ??
        existing?.phones.find(({ slot }) => slot === phone.slot);
      const sameNumber = saved && phoneKey(saved.number) === phoneKey(phone.number);
      const sameFlag = saved?.dnc === phone.dnc;
      const sameType =
        !saved?.type || !phone.type || normalizedText(saved.type) === normalizedText(phone.type);
      comparisons.push({
        label: `Phone ${phone.slot}`,
        existing: saved ? formatPhone(saved) : '',
        incoming: formatPhone(phone),
        disposition: saved
          ? sameNumber && sameFlag && sameType
            ? 'same'
            : 'preserved'
          : existing
            ? 'empty'
            : 'incoming',
      });
    }

    const conflicts: string[] = [];
    if (id && !idMatches.length) conflicts.push('PBK lead ID was not found in the saved roster.');
    if (idMatches.length > 1) conflicts.push('More than one saved lead has this PBK lead ID.');
    if (!id && streetMatches.length)
      conflicts.push('Address candidate only. Confirm the PBK lead ID.');
    if (exact && streetMatches.some((lead) => lead !== exact)) {
      conflicts.push('The address also points to another saved lead.');
    }
    if (
      (idCounts.get(id)?.length ?? 0) > 1 ||
      (sourceCounts.get(sourceKey)?.length ?? 0) > 1 ||
      (addressCounts.get(streetKey(address))?.length ?? 0) > 1
    ) {
      conflicts.push('Possible duplicate in this batch.');
    }
    if (comparisons.some(({ disposition }) => disposition === 'preserved')) {
      conflicts.push('Incoming values differ. Saved values are preserved.');
    }
    const primary = fields.get('phone')?.trim();
    const contactPhones =
      primary && !phones.some(({ number }) => phoneKey(number) === phoneKey(primary))
        ? [
            ...phones,
            { slot: 0, number: primary, dnc: 'unknown' as const, dncSource: '', type: '' },
          ]
        : phones;
    return {
      number: row.number,
      label: address || id || `Row ${row.number}`,
      status: issues.length ? 'invalid' : conflicts.length ? 'conflict' : exact ? 'match' : 'new',
      issues: [...issues, ...conflicts],
      candidates: candidates.map(({ candidate }) => candidate),
      fields: [...comparisons, ...unmapped],
      phones: contactPhones,
    };
  });
}

export type BatchContactEntry = {
  phone: string;
  rows: number[];
} & ({ status: 'candidate'; row: number } | { status: 'dnc' | 'unknown' | 'not-reviewed' });

export function buildBatchContactPlan(
  rows: readonly BatchReviewRow[],
  roster: readonly RowRecord[],
  reviewed: ReadonlySet<number>,
  workspaceDncPhones: readonly string[] = []
): BatchContactEntry[] {
  const blocked = new Set(workspaceDncPhones.map(phoneKey));
  for (const lead of roster) {
    for (const phone of savedPhones(lead, readSavedFields(lead))) {
      if (phone.dnc === 'dnc') blocked.add(phoneKey(phone.number));
    }
  }
  const groups = new Map<
    string,
    { rows: Set<number>; eligible: Set<number>; candidates: Set<number> }
  >();
  for (const row of rows) {
    const eligible = reviewed.has(row.number) && (row.status === 'new' || row.status === 'match');
    for (const phone of row.phones) {
      const key = phoneKey(phone.number);
      if (!/^\d{10}$/.test(key)) continue;
      const group = groups.get(key) ?? {
        rows: new Set(),
        eligible: new Set(),
        candidates: new Set(),
      };
      groups.set(key, group);
      group.rows.add(row.number);
      // Excluding a property row must never discard a positive DNC signal.
      if (phone.dnc === 'dnc') blocked.add(key);
      if (!eligible) continue;
      group.eligible.add(row.number);
      if (phone.dnc === 'not-dnc') group.candidates.add(row.number);
    }
  }
  return Array.from(groups, ([phone, group]): BatchContactEntry => {
    const base = { phone, rows: [...group.rows].sort((a, b) => a - b) };
    if (blocked.has(phone)) return { ...base, status: 'dnc' };
    if (!group.eligible.size) return { ...base, status: 'not-reviewed' };
    if (!group.candidates.size) return { ...base, status: 'unknown' };
    return { ...base, status: 'candidate', row: Math.min(...group.candidates) };
  });
}

// Local rehearsal only. Live workers need a durable atomic reservation for the same batch and number.
export function createBatchContactGuard(
  plan: readonly BatchContactEntry[],
  isCurrentlyDnc: (phone: string) => Promise<boolean>
) {
  const entries = new Map(plan.map((entry) => [entry.phone, { ...entry }]));
  const reserved = new Set<string>();
  return {
    async reserve(row: number, number: string) {
      const phone = phoneKey(number);
      const entry = entries.get(phone);
      if (!entry) return 'not-in-plan';
      if (entry.status !== 'candidate') return entry.status;
      try {
        const blocked = await isCurrentlyDnc(phone);
        if (blocked !== false) return blocked === true ? 'dnc' : 'dnc-unavailable';
      } catch {
        return 'dnc-unavailable';
      }
      if (entry.row !== row) return 'wrong-row';
      if (reserved.has(phone)) return 'already-reserved';
      reserved.add(phone);
      return 'reserved';
    },
  };
}

export type BatchApplySummary = {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  invalid: number;
  unreviewed: number;
};

// Plan against the current roster and return a new snapshot. No IO or delivery hooks.
export function applyReviewedBatch(
  rows: SourceRow[],
  roster: readonly RowRecord[],
  reviewedRows: readonly number[],
  newLeadId: (row: number) => string,
  workspaceDncPhones: readonly string[] = []
) {
  const reviewed = new Set(reviewedRows);
  const appliedLeadIds = new Map<number, string>();
  const leads = [...roster];
  const byId = new Map(roster.map((lead, index) => [readSavedFields(lead).get('leadId'), index]));
  const summary: BatchApplySummary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    conflicts: 0,
    invalid: 0,
    unreviewed: 0,
  };
  const classified = buildBatchReview(rows, roster);
  for (const [index, review] of classified.entries()) {
    if (review.status === 'conflict' || review.status === 'invalid') {
      summary[review.status === 'conflict' ? 'conflicts' : 'invalid']++;
      continue;
    }
    if (!reviewed.has(review.number)) {
      summary.unreviewed++;
      continue;
    }
    const incoming = readIncoming(rows[index]);
    if (review.status === 'new') {
      const id = newLeadId(review.number);
      if (!id || byId.has(id)) {
        summary.conflicts++;
        continue;
      }
      byId.set(id, leads.length);
      leads.push({
        ...Object.fromEntries(incoming.fields),
        id,
        leadId: id,
        ...(incoming.phones.length ? { phones: incoming.phones } : {}),
      });
      summary.created++;
      appliedLeadIds.set(review.number, id);
      continue;
    }
    const savedIndex = byId.get(incoming.id);
    if (savedIndex === undefined) {
      summary.conflicts++;
      continue;
    }
    const saved = leads[savedIndex];
    const existing = readSavedFields(saved);
    const patch: RowRecord = Object.fromEntries(
      [...incoming.fields].filter(
        ([field]) => field !== 'leadId' && !metadataFields.has(field) && !existing.has(field)
      )
    );
    const existingPhones = savedPhones(saved, existing);
    const extraPhones: ReviewPhone[] = [];
    for (const phone of incoming.phones) {
      if (
        [...existingPhones, ...extraPhones].some(
          (candidate) =>
            candidate.slot === phone.slot || phoneKey(candidate.number) === phoneKey(phone.number)
        )
      )
        continue;
      extraPhones.push(phone);
    }
    if (extraPhones.length) {
      patch.phones = [...(Array.isArray(saved.phones) ? saved.phones : []), ...extraPhones];
    }
    if (Object.keys(patch).length) {
      leads[savedIndex] = { ...saved, ...patch };
      summary.updated++;
    } else {
      summary.unchanged++;
    }
    appliedLeadIds.set(review.number, incoming.id);
  }
  return {
    leads,
    summary,
    appliedLeadIds,
    contactPlan: buildBatchContactPlan(
      classified,
      roster,
      new Set(appliedLeadIds.keys()),
      workspaceDncPhones
    ),
  };
}
