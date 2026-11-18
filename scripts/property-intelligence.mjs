import { parseAttomAddress, sameAttomAddress, attomStreetKey } from './attom-property-preview.mjs';

const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const fail = (code, status, message) => Object.assign(new Error(message), { code, status });
const label = a => `${a.street}, ${a.city}, ${a.state} ${a.zip}`;
const leadAddress = lead => {
  const p = object(lead.property);
  return { street: p.address || lead.address, city: p.city || lead.city, state: p.state || lead.state, zip: p.zip || p.zipCode || lead.zip || lead.zipCode };
};
const belongs = (snapshot, address) => sameAttomAddress({ street: snapshot?.address }, address);
const occupied = comp => Object.values(object(comp)).some(v => typeof v === 'number' ? v !== 0 : typeof v === 'string' ? v.trim() : Boolean(v));
const validTime = v => typeof v === 'string' && Number.isFinite(Date.parse(v));

function listingSnapshot(address, result, now, previous) {
  const property = object(result?.propertyData), data = object(property.data);
  if (result?.cache?.hit !== true || property.source !== 'apify-for-sale') return previous;
  const photoUrls = [...new Set((Array.isArray(data.photoUrls) ? data.photoUrls : []).filter(v => typeof v === 'string' && /^https:\/\/ap\.rdcpix\.com\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(v)))].slice(0, 24);
  const sourceLinks = (Array.isArray(data.sourceLinks) ? data.sourceLinks : []).filter(v => {
    try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ['realtor.com', 'redfin.com', 'zillow.com'].includes(u.hostname.replace(/^www\./, '')); } catch { return false; }
  }).slice(0, 6);
  const facts = Object.fromEntries(['beds', 'baths', 'sqft', 'year', 'dom', 'lotSqft'].filter(k => Number.isFinite(data.listingFacts?.[k]) && data.listingFacts[k] >= 0).map(k => [k, data.listingFacts[k]]));
  const askingPrice = data.priceBasis === 'asking_price' && Number.isFinite(data.askingPriceUsd) && data.askingPriceUsd > 0 ? data.askingPriceUsd : null;
  // Retain the complete previous capture and its original timestamp when this
  // cache entry lost evidence; never relabel old photos as freshly retrieved.
  if (previous && ((previous.photoUrls?.length && !photoUrls.length) || (previous.askingPrice && !askingPrice) || Object.keys(object(previous.facts)).some(k => facts[k] === undefined))) return previous;
  const fetchedAt = [data.capturedAt, property.fetchedAt, property.fetched_at, property.updatedAt, property.createdAt].find(validTime);
  return { source: 'apify-for-sale', address: label(address), retrievedAt: validTime(fetchedAt) ? fetchedAt : now, photoUrls, sourceLinks, facts, askingPrice };
}

export function propertyIntelligencePatch(lead, address, evidence, now = new Date().toISOString()) {
  const deal = { ...object(lead?.deal) }, analyzer = { ...object(lead?.analyzer) };
  const oldRecord = belongs(deal.propertyRecordSnapshot, address) ? deal.propertyRecordSnapshot : undefined;
  const profile = evidence.records?.status === 'matched' ? evidence.records.profile : null;
  if (profile && sameAttomAddress({ street: profile.address }, address)) {
    const facts = { ...object(oldRecord?.facts) }, fieldRetrievedAt = { ...object(oldRecord?.fieldRetrievedAt) };
    for (const [key, value] of Object.entries(facts)) if (value !== null && value !== undefined && !fieldRetrievedAt[key]) fieldRetrievedAt[key] = oldRecord.retrievedAt;
    for (const [key, value] of Object.entries(profile)) if (value !== null && value !== undefined) { facts[key] = value; fieldRetrievedAt[key] = now; }
    deal.propertyRecordSnapshot = { source: 'attom', address: label(address), retrievedAt: now, facts, fieldRetrievedAt };
  }
  const oldListing = belongs(deal.listingSnapshot, address) ? deal.listingSnapshot : undefined;
  const listing = listingSnapshot(address, evidence.listing, now, oldListing);
  if (listing) deal.listingSnapshot = listing;
  const salesResult = evidence.sales;
  const prior = object(analyzer.recordedSales);
  const reviewed = prior.review === 'operator-selected';
  const priorCurrent = sameAttomAddress(prior.address, address);
  if (salesResult?.status === 'matched' && salesResult.source === 'ATTOM' && Array.isArray(salesResult.sales)) {
    const sales = salesResult.sales.filter(s => typeof s.address === 'string' && attomStreetKey(s.address.split(',')[0]) !== attomStreetKey(address.street) && Number.isFinite(s.price) && s.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.soldDate)).slice(0, 20);
    if (!(reviewed || (salesResult.partial && priorCurrent && Array.isArray(prior.sales) && prior.sales.length))) {
      analyzer.recordedSales = { provider: 'ATTOM', review: 'suggested-unreviewed', address, retrievedAt: salesResult.retrievedAt, windowStart: salesResult.windowStart, windowEnd: salesResult.windowEnd, radiusMiles: salesResult.radiusMiles, partial: Boolean(salesResult.partial), selectedIds: [], sales };
    }
    if (!reviewed) {
      const comps = Object.fromEntries(['A', 'B', 'C'].map(slot => [slot, occupied(analyzer.comps?.[slot]) ? analyzer.comps[slot] : object(deal.comps?.[slot])]));
      const used = new Set(Object.values(comps).map(c => String(c?.address || '').trim().toLowerCase()));
      let added = false;
      for (const slot of ['A', 'B', 'C']) {
        if (Array.isArray(deal.compManualSlots) && deal.compManualSlots.includes(slot)) continue;
        if (occupied(deal.comps?.[slot]) || occupied(analyzer.comps?.[slot])) continue;
        const sale = sales.find(s => !used.has(s.address.trim().toLowerCase()));
        if (!sale) break;
        comps[slot] = { address: sale.address, price: sale.price, date: sale.soldDate, link: '', source: 'ATTOM', review: 'suggested-unreviewed' };
        used.add(sale.address.trim().toLowerCase()); added = true;
      }
      if (added) { deal.comps = comps; deal.isAnalyzed = false; analyzer.comps = comps; }
    }
  }
  return { deal, analyzer };
}

export function createPropertyIntelligence({ getLead, saveLead, listing, records, sales, now = () => new Date().toISOString() }) {
  const pending = new Map();
  return async function enrich(input = {}) {
    const address = typeof input.address === 'string' && input.address.length <= 500 ? parseAttomAddress({ street: input.address }) : null;
    if (!address) throw fail('invalid_address', 400, 'Enter a complete property address.');
    const radius = input.radiusMiles === undefined ? 1 : input.radiusMiles;
    if (![0.5, 1, 2, 5].includes(radius)) throw fail('invalid_radius', 400, 'Choose a supported sales radius.');
    if (input.leadId !== undefined && (typeof input.leadId !== 'string' || !input.leadId.trim())) throw fail('invalid_lead_id', 400, 'A valid lead ID is required.');
    const leadId = input.leadId?.trim();
    const check = async () => {
      if (!leadId) return null;
      const lead = await getLead(leadId);
      if (!lead) throw fail('lead_not_found', 404, 'Lead not found.');
      if (!sameAttomAddress(input.expectedPropertyAddress, address) || !sameAttomAddress(leadAddress(lead), address)) throw fail('property_context_changed', 409, 'The lead property changed. Refresh the lead before enriching.');
      return lead;
    };
    await check();
    const key = `${attomStreetKey(address.street)}|${address.city.toUpperCase()}|${address.state}|${address.zip.slice(0, 5)}|${radius}`;
    if (!pending.has(key)) {
      const work = Promise.allSettled([
        Promise.resolve().then(() => listing({ address: label(address), queueBrowserResearch: false, source: 'property-intelligence' })),
        Promise.resolve().then(() => records(address)),
        Promise.resolve().then(() => sales({ ...address, radius })),
      ]).then(([l, r, s]) => ({ listing: l.status === 'fulfilled' ? l.value : { cache: { hit: false }, propertyData: null }, records: r.status === 'fulfilled' ? r.value : { status: 'unavailable' }, sales: s.status === 'fulfilled' ? s.value : { status: 'unavailable' } })).finally(() => pending.delete(key));
      pending.set(key, work);
    }
    const evidence = await pending.get(key);
    const current = await check();
    const patch = propertyIntelligencePatch(current, address, evidence, now());
    if (leadId) await saveLead(leadId, patch);
    return { ok: true, address: label(address), ...evidence, patch, ...(leadId ? { leadId } : {}), saved: Boolean(leadId) };
  };
}
