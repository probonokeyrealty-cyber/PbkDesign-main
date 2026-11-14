const MAX_ROSTER_SIZE = 10_000;
const record = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const identifier = (lead) => String(lead?.leadId || lead?.lead_id || lead?.id || '').trim();
const unavailable = (error) => ({ ok: false, complete: false, error });

function profileLead(row, includeRaw) {
  const raw = record(row.raw);
  const property = record(raw.property);
  const seller = record(raw.seller);
  return {
    ...(includeRaw ? raw : {}),
    id: row.id,
    leadId: row.id,
    address: row.address || raw.address || property.address,
    city: row.city || raw.city || property.city,
    state: row.state || raw.state || property.state,
    zip: row.postal_code || raw.zip || property.zip,
    leadName: row.lead_name || raw.leadName || seller.name,
    firstName: row.first_name || raw.firstName || seller.firstName,
    lastName: row.last_name || raw.lastName || seller.lastName,
    email: row.email || raw.email || seller.email,
    phone: row.phone || raw.phone || seller.phone,
    property,
    seller,
    phones: raw.phones,
    ...(includeRaw ? { dnc: row.dnc === true || raw.dnc === true } : {}),
  };
}

export async function loadBatchReviewRoster({ bridgeLeads, query, includeRaw = false }) {
  const result = await query(
    `SELECT id, address, city, state, postal_code, lead_name, first_name, last_name, email, phone, raw, dnc
     FROM public.lead_profiles
     WHERE COALESCE(workspace_id, 'pbk') = $1
     ORDER BY id
     LIMIT $2`,
    ['pbk', MAX_ROSTER_SIZE + 1]
  );
  if (!result.ok || !Array.isArray(result.rows)) {
    return unavailable('The saved Postgres lead roster is unavailable.');
  }
  if (result.rows.length > MAX_ROSTER_SIZE) {
    return unavailable('The saved roster exceeds the batch review limit.');
  }

  const saved = new Map();
  for (const row of result.rows) {
    const id = identifier(row);
    if (!id || saved.has(id)) return unavailable('The saved roster has an ambiguous profile ID.');
    saved.set(id, profileLead(row, includeRaw));
  }
  if (!Array.isArray(bridgeLeads)) return unavailable('The bridge lead roster is unavailable.');
  const seen = new Set();
  for (const lead of bridgeLeads) {
    const id = identifier(lead);
    if (!id || seen.has(id)) return unavailable('The bridge roster has an ambiguous lead ID.');
    seen.add(id);
    const profile = saved.get(id);
    const seller = typeof lead.seller === 'string' ? { name: lead.seller } : record(lead.seller);
    const property = record(lead.property);
    saved.set(id, {
      ...profile,
      ...lead,
      id,
      leadId: id,
      address: lead.address ?? property.address ?? profile?.address,
      leadName: lead.leadName ?? lead.name ?? seller.name ?? profile?.leadName,
      email: lead.email ?? seller.email ?? profile?.email,
      phone: lead.phone ?? seller.phone ?? profile?.phone,
      property: { ...record(profile?.property), ...property },
      seller: { ...record(profile?.seller), ...seller },
      ...(includeRaw && profile ? {
        ...Object.fromEntries(Object.entries(profile).filter(([, value]) =>
          value !== undefined && value !== null && value !== ''
        )),
        property: { ...property, ...record(profile.property) },
        seller: { ...seller, ...record(profile.seller) },
        dnc: profile.dnc === true || lead.dnc === true,
      } : {}),
    });
  }
  if (saved.size > MAX_ROSTER_SIZE)
    return unavailable('The saved roster exceeds the batch review limit.');
  return {
    ok: true,
    complete: true,
    source: 'postgres+bridge',
    leads: [...saved.values()],
  };
}
