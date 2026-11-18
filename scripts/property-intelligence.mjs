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

const salesCandidates = (result, address) => (Array.isArray(result?.sales) ? result.sales : []).filter(s =>
  typeof s?.address === 'string' && parseAttomAddress({ street: s.address }) &&
  attomStreetKey(s.address.split(',')[0]) !== attomStreetKey(address.street) &&
  Number.isFinite(s.price) && s.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.soldDate)).slice(0, 20);

function compPhotoEvidence(address, result, now) {
  // getPropertyData's top-level address echoes the request. Only the cache
  // entry's own address proves that these photos belong to this candidate.
  if (!sameAttomAddress({ street: result?.propertyData?.address }, address)) return undefined;
  const property = object(result?.propertyData);
  if (![property.data?.capturedAt, property.fetchedAt, property.fetched_at, property.updatedAt, property.createdAt].some(validTime)) return undefined;
  const snapshot = listingSnapshot(address, result, now);
  if (!snapshot?.photoUrls.length) return undefined;
  const { source, address: boundAddress, retrievedAt, photoUrls, sourceLinks } = snapshot;
  return { source, address: boundAddress, retrievedAt, photoUrls, sourceLinks };
}

function savedCompPhotoEvidence(address, evidence) {
  if (evidence?.source !== 'apify-for-sale' || !validTime(evidence.retrievedAt)) return undefined;
  return compPhotoEvidence(address, { cache: { hit: true }, propertyData: {
    address: evidence.address, source: evidence.source,
    data: { ...evidence, capturedAt: evidence.retrievedAt },
  } }, evidence.retrievedAt);
}

async function loadCompPhotos(result, address, listing, now, reviewedCandidates = []) {
  if (result?.status !== 'matched' || result.source !== 'ATTOM') return result;
  const candidates = salesCandidates(result, address);
  // Prioritize selected saved comps so an expired sales search window does not
  // prevent the operator's reviewed comparison from receiving cached photos.
  const seen = new Set();
  const photoCandidates = [...reviewedCandidates, ...candidates].filter(sale => {
    const parsed = parseAttomAddress({ street: sale.address });
    const key = `${attomStreetKey(parsed.street)}|${parsed.city.toUpperCase()}|${parsed.state}|${parsed.zip.slice(0, 5)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 20);
  const captures = new Map();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, photoCandidates.length) }, async () => {
    while (cursor < photoCandidates.length) {
      const sale = photoCandidates[cursor++];
      if (captures.has(sale.address)) continue;
      captures.set(sale.address, undefined);
      try {
        const cached = await listing({ address: sale.address, queueBrowserResearch: false, source: 'property-intelligence' });
        captures.set(sale.address, compPhotoEvidence(parseAttomAddress({ street: sale.address }), cached, now));
      } catch { /* A cache failure must not discard the sales candidate. */ }
    }
  }));
  const captureFor = sale => [...captures.values()].find(evidence => sameAttomAddress({ street: evidence?.address }, { street: sale.address }));
  const { reviewedPhotoEvidence: _untrustedCaptures, ...salesResult } = result;
  return { ...salesResult, ...(reviewedCandidates.length ? { reviewedPhotoEvidence: reviewedCandidates.map(captureFor).filter(Boolean) } : {}), sales: candidates.map(({ photoEvidence: _untrusted, ...sale }) => {
    const photoEvidence = captureFor(sale);
    return { ...sale, ...(photoEvidence ? { photoEvidence } : {}) };
  }) };
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
    const sales = salesCandidates(salesResult, address).map(({ photoEvidence: incoming, ...sale }) => {
      const compAddress = parseAttomAddress({ street: sale.address });
      const oldSale = priorCurrent && Array.isArray(prior.sales) ? prior.sales.find(s => sameAttomAddress({ street: s?.address }, compAddress)) : undefined;
      const photoEvidence = savedCompPhotoEvidence(compAddress, incoming) || savedCompPhotoEvidence(compAddress, oldSale?.photoEvidence);
      return { ...sale, ...(photoEvidence ? { photoEvidence } : {}) };
    });
    if (!(reviewed || (salesResult.partial && priorCurrent && Array.isArray(prior.sales) && prior.sales.length))) {
      analyzer.recordedSales = { provider: 'ATTOM', review: 'suggested-unreviewed', address, retrievedAt: salesResult.retrievedAt, windowStart: salesResult.windowStart, windowEnd: salesResult.windowEnd, radiusMiles: salesResult.radiusMiles, partial: Boolean(salesResult.partial), selectedIds: [], sales };
    } else if (priorCurrent && Array.isArray(prior.sales)) {
      // An explicit refresh may improve photo evidence without replacing the
      // reviewed selection, saved underwriting metrics or sales capture time.
      analyzer.recordedSales = { ...prior, sales: prior.sales.map(sale => {
        const savedPhoto = (Array.isArray(salesResult.reviewedPhotoEvidence) ? salesResult.reviewedPhotoEvidence : []).find(photo => sameAttomAddress({ street: photo?.address }, { street: sale?.address }));
        const freshPhoto = savedCompPhotoEvidence(parseAttomAddress({ street: sale?.address }), savedPhoto);
        const fresh = sales.find(s => sameAttomAddress({ street: s.address }, { street: sale?.address }));
        return freshPhoto || fresh?.photoEvidence ? { ...sale, photoEvidence: freshPhoto || fresh.photoEvidence } : sale;
      }) };
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
    const initial = await check();
    const priorSales = initial?.analyzer?.recordedSales;
    const reviewedCandidates = priorSales?.review === 'operator-selected' && sameAttomAddress(priorSales.address, address) && Array.isArray(priorSales.sales) ? priorSales.sales.filter(sale =>
      Array.isArray(priorSales.selectedIds) && priorSales.selectedIds.includes(sale?.id) &&
      parseAttomAddress({ street: sale?.address }) && attomStreetKey(sale.address.split(',')[0]) !== attomStreetKey(address.street)
    ).slice(0, 20) : [];
    const key = `${attomStreetKey(address.street)}|${address.city.toUpperCase()}|${address.state}|${address.zip.slice(0, 5)}|${radius}|${JSON.stringify(reviewedCandidates.map(s => s.address))}`;
    if (!pending.has(key)) {
      const work = Promise.allSettled([
        Promise.resolve().then(() => listing({ address: label(address), queueBrowserResearch: false, source: 'property-intelligence' })),
        Promise.resolve().then(() => records(address)),
        Promise.resolve().then(() => sales({ ...address, radius })),
      ]).then(async ([l, r, s]) => ({ listing: l.status === 'fulfilled' ? l.value : { cache: { hit: false }, propertyData: null }, records: r.status === 'fulfilled' ? r.value : { status: 'unavailable' }, sales: s.status === 'fulfilled' ? await loadCompPhotos(s.value, address, listing, now(), reviewedCandidates) : { status: 'unavailable' } })).finally(() => pending.delete(key));
      pending.set(key, work);
    }
    const evidence = await pending.get(key);
    const current = await check();
    const patch = propertyIntelligencePatch(current, address, evidence, now());
    if (leadId) await saveLead(leadId, patch);
    return { ok: true, address: label(address), ...evidence, patch, ...(leadId ? { leadId } : {}), saved: Boolean(leadId) };
  };
}
