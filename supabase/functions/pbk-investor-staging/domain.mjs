// Shared by the hosted staging function and Node security tests. No provider secrets.
export const emptyState = () => ({
  members: {},
  properties: {},
  inquiries: {},
  saved: {},
  audit: [],
});
const copy = (value) => structuredClone(value);
const fail = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
const text = (value, max = 2000) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const money = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 1e12)
    fail('Enter a valid nonnegative price in cents.');
  return value;
};
const number = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e8)
    fail('Enter a valid property number.');
  return value;
};
const fields = [
  'title',
  'address',
  'city',
  'state',
  'zip',
  'market',
  'assetType',
  'occupancy',
  'condition',
  'summary',
  'knownIssues',
  'source',
  'checkedAt',
  'owner',
  'internalNotes',
];
export function cleanDraft(input = {}) {
  const out = {};
  for (const key of fields)
    out[key] = text(
      input[key],
      key === 'summary' || key === 'knownIssues' || key === 'internalNotes' ? 4000 : 240
    );
  for (const key of ['askingCents', 'rehabCents', 'arvCents']) out[key] = money(input[key]);
  for (const key of ['beds', 'baths', 'sqft', 'lotSqft']) out[key] = number(input[key]);
  out.fictional = input.fictional === true;
  out.priceOnRequest = input.priceOnRequest === true;
  out.checks = {};
  for (const key of ['address', 'sources', 'estimates', 'rights', 'privacy'])
    out.checks[key] = input.checks?.[key] === true;
  if (!out.title || !out.address || !out.city || !out.market || !out.assetType || !out.owner)
    fail('Property title, address, city, market, type and owner are required.');
  if (!/^[A-Z]{2}$/.test(out.state) || !/^\d{5}(-\d{4})?$/.test(out.zip))
    fail('Enter a valid two-letter state and ZIP.');
  if (!out.source) fail('Enter a fact source.');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(out.checkedAt) ||
    Number.isNaN(Date.parse(out.checkedAt)) ||
    new Date(out.checkedAt).toISOString().slice(0, 10) !== out.checkedAt
  )
    fail('Enter a valid checked date.');
  return out;
}
export function verificationInput(email, code, providerUrl) {
  const value = String(code || '').trim();
  if (value.startsWith('https://')) {
    const link = new URL(value);
    if (
      link.origin !== providerUrl ||
      link.pathname !== '/auth/v1/verify' ||
      !['magiclink', 'email'].includes(link.searchParams.get('type'))
    )
      fail('Use the sign-in link from the PBK email.');
    const hash = link.searchParams.get('token_hash') || link.searchParams.get('token');
    if (!hash) fail('The email link is missing its verification token.');
    return { token_hash: hash, type: link.searchParams.get('type') };
  }
  return {
    email: String(email || '')
      .trim()
      .toLowerCase(),
    token: value,
    type: 'email',
  };
}
export function membership(state, uid) {
  if (!uid) fail('Sign in to continue.', 401);
  const member = state.members[uid];
  if (!member?.approved) fail('Your portal access is not approved.', 403);
  if (!['investor', 'editor', 'reviewer'].includes(member.role))
    fail('Your portal access is not approved.', 403);
  return member;
}
function staff(member) {
  if (!['editor', 'reviewer'].includes(member.role)) fail('Staff access is required.', 403);
}
function reviewer(member) {
  if (member.role !== 'reviewer') fail('Reviewer access is required.', 403);
}
function getProperty(state, id) {
  return state.properties[id] || fail('Property not available.', 404);
}
function visible(property) {
  return property.published && ['Available', 'Under review'].includes(property.published.status);
}
export function buyerView(property) {
  if (!visible(property)) fail('Property not available.', 404);
  return copy(property.published);
}
function snapshot(property) {
  const draft = property.draft;
  const dto = {
    id: property.id,
    version: property.releaseVersion + 1,
    status: 'Available',
    releasedAt: new Date().toISOString(),
    assets: property.assets
      .filter((a) => a.buyerVisible)
      .map(({ id, title, kind, alt, mime }) => ({ id, title, kind, alt, mime })),
  };
  for (const key of [
    'title',
    'address',
    'city',
    'state',
    'zip',
    'market',
    'assetType',
    'occupancy',
    'condition',
    'summary',
    'knownIssues',
    'source',
    'checkedAt',
    'askingCents',
    'rehabCents',
    'arvCents',
    'beds',
    'baths',
    'sqft',
    'lotSqft',
    'fictional',
    'priceOnRequest',
  ])
    dto[key] = draft[key];
  return dto;
}
function event(state, uid, action, entityId, detail = {}) {
  state.audit.push({
    id: crypto.randomUUID(),
    actor: uid,
    action,
    entityId,
    at: new Date().toISOString(),
    detail,
  });
}
function revision(property, expected) {
  if (!Number.isSafeInteger(expected) || property.revision !== expected)
    fail('This property changed. Reload before saving or releasing.', 409);
}
export function execute(original, uid, command, payload = {}) {
  const state = copy(original);
  const member = membership(state, uid);
  let changed = false,
    result;
  switch (command) {
    case 'session':
      result = { member: { id: uid, role: member.role, email: member.email }, staging: true };
      break;
    case 'list':
      result = {
        properties: Object.values(state.properties)
          .filter((p) => member.role !== 'investor' || visible(p))
          .map((p) => (member.role === 'investor' ? buyerView(p) : copy(p))),
      };
      break;
    case 'property': {
      const p = getProperty(state, payload.id);
      result = { property: member.role === 'investor' ? buyerView(p) : p };
      break;
    }
    case 'members':
      staff(member);
      result = {
        members: [
          ...Object.entries(state.members).map(([id, m]) => ({ id, ...m })),
          ...Object.values(state.invitations || {})
            .filter((i) => !Object.values(state.members).some((m) => m.email === i.email))
            .map((i) => ({ id: null, ...i })),
        ],
      };
      break;
    case 'approveInvestor': {
      reviewer(member);
      const email = text(payload.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid investor email.');
      state.invitations ||= {};
      state.invitations[email] = {
        email,
        role: 'investor',
        approved: true,
        approvedBy: uid,
        approvedAt: new Date().toISOString(),
        highLevelContactId: text(payload.highLevelContactId, 80),
      };
      for (const m of Object.values(state.members))
        if (m.email?.toLowerCase() === email && m.role === 'investor') m.approved = true;
      event(state, uid, 'investor_access_approved', email);
      changed = true;
      result = { approved: true, email };
      break;
    }
    case 'revokeInvestor': {
      reviewer(member);
      const email = text(payload.email, 254).toLowerCase();
      if (state.invitations?.[email]) state.invitations[email].approved = false;
      for (const m of Object.values(state.members))
        if (m.email?.toLowerCase() === email && m.role === 'investor') m.approved = false;
      event(state, uid, 'investor_access_revoked', email);
      changed = true;
      result = { revoked: true, email };
      break;
    }
    case 'history':
      staff(member);
      result = { events: state.audit.filter((e) => !payload.id || e.entityId === payload.id) };
      break;
    case 'inquiries':
      result = {
        inquiries: Object.values(state.inquiries).filter(
          (i) => member.role !== 'investor' || i.investorId === uid
        ),
      };
      break;
    case 'save': {
      staff(member);
      let p;
      if (payload.id) {
        p = getProperty(state, payload.id);
        revision(p, payload.revision);
      } else {
        p = {
          id: crypto.randomUUID(),
          revision: 0,
          releaseVersion: 0,
          status: 'Draft',
          assets: [],
          published: null,
          createdAt: new Date().toISOString(),
        };
        state.properties[p.id] = p;
      }
      const oldRevision = p.revision;
      p.draft = cleanDraft(payload.draft);
      p.revision++;
      p.status = 'Draft';
      p.updatedAt = new Date().toISOString();
      p.previewedRevision = null;
      event(state, uid, 'draft_saved', p.id, {
        fromRevision: oldRevision,
        toRevision: p.revision,
        draft: copy(p.draft),
      });
      changed = true;
      result = { property: p };
      break;
    }
    case 'preview': {
      staff(member);
      const p = getProperty(state, payload.id);
      p.previewedRevision = p.revision;
      event(state, uid, 'investor_previewed', p.id, { revision: p.revision });
      changed = true;
      result = { property: snapshot(p) };
      break;
    }
    case 'release': {
      reviewer(member);
      const p = getProperty(state, payload.id);
      revision(p, payload.revision);
      if (p.previewedRevision !== p.revision)
        fail('Preview this draft as an investor before release.');
      if (!Object.values(p.draft.checks).every(Boolean) || Object.keys(p.draft.checks).length !== 5)
        fail('Complete every review checklist item.');
      if (p.draft.askingCents === null && !p.draft.priceOnRequest)
        fail('Provide an asking price or select price on request.');
      if (p.assets.some((a) => a.buyerVisible && !a.rights))
        fail('Record rights for every buyer-visible attachment.');
      p.published = snapshot(p);
      p.releaseVersion++;
      p.status = 'Available';
      p.revision++;
      event(state, uid, 'property_released', p.id, {
        version: p.releaseVersion,
        snapshot: copy(p.published),
      });
      changed = true;
      result = { property: p };
      break;
    }
    case 'withdraw': {
      reviewer(member);
      const p = getProperty(state, payload.id);
      revision(p, payload.revision);
      p.status = 'Withdrawn';
      if (p.published) p.published.status = 'Withdrawn';
      p.revision++;
      event(state, uid, 'property_withdrawn', p.id, { version: p.releaseVersion });
      changed = true;
      result = { property: p };
      break;
    }
    case 'status': {
      reviewer(member);
      const p = getProperty(state, payload.id);
      revision(p, payload.revision);
      const transitions = {
        Available: ['Under review', 'Under contract'],
        'Under review': ['Available', 'Under contract'],
        'Under contract': ['Sold', 'Available'],
      };
      if (!p.published || !transitions[p.published.status]?.includes(payload.status))
        fail('That status transition is not available.');
      const from = p.published.status;
      p.published.status = payload.status;
      p.status = payload.status;
      p.revision++;
      event(state, uid, 'status_changed', p.id, { from, to: payload.status });
      changed = true;
      result = { property: p };
      break;
    }
    case 'asset': {
      staff(member);
      const p = getProperty(state, payload.id);
      revision(p, payload.revision);
      const a = payload.asset;
      if (
        !a ||
        !a.id ||
        !a.path ||
        !['photo', 'packet'].includes(a.kind) ||
        !a.rights ||
        !a.title ||
        !a.mime
      )
        fail('Attachment metadata and media rights are required.');
      p.assets.push(copy(a));
      p.revision++;
      p.previewedRevision = null;
      event(state, uid, 'asset_added', p.id, { assetId: a.id });
      changed = true;
      result = { property: p };
      break;
    }
    case 'saved':
      result = { ids: state.saved[uid] || [] };
      break;
    case 'toggleSaved': {
      const p = getProperty(state, payload.id);
      buyerView(p);
      const ids = state.saved[uid] || [];
      state.saved[uid] = ids.includes(p.id) ? ids.filter((id) => id !== p.id) : [...ids, p.id];
      changed = true;
      result = { ids: state.saved[uid] };
      break;
    }
    case 'inquire': {
      if (member.role !== 'investor') fail('An approved investor account is required.', 403);
      const message = text(payload.message);
      const key = text(payload.key, 100);
      const proposedCents = money(payload.proposedCents);
      const timing = text(payload.timing, 100);
      if (message.length < 5 || !key || key.length < 10)
        fail('Enter a message and a valid request key.');
      const fingerprint = JSON.stringify({
        propertyId: payload.id,
        message,
        proposedCents,
        timing,
      });
      const previous = Object.values(state.inquiries).find(
        (i) => i.investorId === uid && i.key === key
      );
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          fail('Request key already used for different content.', 409);
        result = { inquiry: previous };
        break;
      }
      const p = getProperty(state, payload.id);
      const published = buyerView(p);
      const inquiry = {
        id: crypto.randomUUID(),
        propertyId: p.id,
        propertyTitle: published.title,
        propertyVersion: published.version,
        investorId: uid,
        investorEmail: member.email || '',
        message,
        proposedCents,
        timing,
        key,
        fingerprint,
        status: 'Received',
        createdAt: new Date().toISOString(),
      };
      state.inquiries[inquiry.id] = inquiry;
      event(state, uid, 'inquiry_received', p.id, { inquiryId: inquiry.id });
      changed = true;
      result = { inquiry };
      break;
    }
    default:
      fail('Unknown portal action.', 404);
  }
  if (changed && JSON.stringify(state).length > 8_000_000)
    fail('Staging capacity reached. No changes were saved.', 507);
  return { state, result, changed };
}
