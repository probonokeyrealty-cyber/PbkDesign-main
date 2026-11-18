const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value.trim() : '';
const addressKey = value => text(value).toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
export const compNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function compDate(value) {
  const date = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : '';
}
export function compPhotoEvidence(sale) {
  const item = record(record(sale).photoEvidence);
  const address = text(record(sale).address);
  if (!address || address.length > 500 || item.source !== 'apify-for-sale' || addressKey(item.address) !== addressKey(address) || !Number.isFinite(Date.parse(text(item.retrievedAt)))) return null;
  const photoUrls = [...new Set((Array.isArray(item.photoUrls) ? item.photoUrls.slice(0, 100) : []).filter(url => typeof url === 'string' && url.length <= 2048 && /^https:\/\/ap\.rdcpix\.com\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url)))].slice(0, 24);
  const sourceLinks = (Array.isArray(item.sourceLinks) ? item.sourceLinks.slice(0, 50) : []).filter(link => {
    if (typeof link !== 'string' || link.length > 2048) return false;
    try { const url = new URL(link); return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['realtor.com', 'redfin.com', 'zillow.com'].includes(url.hostname.replace(/^www\./, '')); } catch { return false; }
  }).slice(0, 6);
  return { source: 'apify-for-sale', address, retrievedAt: text(item.retrievedAt), photoUrls, sourceLinks };
}
export function reviewedCompIds(result) {
  if (result?.status !== 'matched' || result.review !== 'operator-selected' || !Array.isArray(result.sales) || !Array.isArray(result.selectedIds)) return [];
  return [...new Set(result.selectedIds.filter(id => typeof id === 'string' && result.sales.some(sale => sale.id === id)))].slice(0, 3);
}

export function selectedCompPatch(result, selectedIds, address) {
  if (result?.status !== 'matched' || result.source !== 'ATTOM' || !Array.isArray(result.sales)) throw Error('Load verified recorded sales before saving.');
  const ids = [...new Set(selectedIds)];
  if (ids.length < 1 || ids.length > 3) throw Error('Select one to three sales.');
  const selected = ids.map(id => result.sales.find(sale => sale.id === id));
  if (selected.some(sale => !sale || !text(sale.address) || !(compNumber(sale.price) > 0) || !compDate(sale.soldDate))) throw Error('The selected sales changed. Review and select again.');
  const evidenceSales = [...selected, ...result.sales.filter(sale => !ids.includes(sale.id))].slice(0, 20).map(sale => {
    const { photoEvidence: unused, ...facts } = sale;
    const photoEvidence = compPhotoEvidence(sale);
    return { ...facts, ...(photoEvidence ? { photoEvidence } : {}) };
  });
  const comps = Object.fromEntries(['A', 'B', 'C'].map((slot, i) => [slot, selected[i] ? {
    address: selected[i].address, price: selected[i].price, date: selected[i].soldDate, link: '',
  } : { address: '', price: 0, date: '', link: '' }]));
  return {
    actor: 'PBK operator', actionSource: 'lead-comps-reviewed', expectedPropertyAddress: address,
    analyzer: { comps, recordedSales: { provider: 'ATTOM', review: 'operator-selected', address,
      retrievedAt: result.retrievedAt, windowStart: result.windowStart, windowEnd: result.windowEnd,
      radiusMiles: result.radiusMiles, selectedIds: ids, sales: evidenceSales } },
    deal: { comps, isAnalyzed: false },
  };
}

export function savedLeadComps(lead) {
  const raw = record(lead);
  const research = record(record(raw.analyzer).recordedSales);
  if (research.address) {
    const property = record(raw.property);
    const saved = record(research.address);
    const normalize = value => text(value).toLowerCase().replace(/[.,]/g, '').replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\broad\b/g, 'rd').replace(/\bcourt\b/g, 'ct').replace(/\s+/g, ' ').trim();
    const current = [property.address || raw.address, property.city || raw.city, property.state || raw.state, property.zip || property.zipCode || raw.zip || raw.zipCode];
    if (current.some((value, index) => normalize(value) !== normalize([saved.street, saved.city, saved.state, saved.zip][index]))) return null;
  }
  const source = record(record(raw.analyzer).comps || record(raw.deal).comps);
  if (!Object.keys(source).length) return null;
  const comps = {};
  for (const key of ['A', 'B', 'C']) {
    const comp = record(source[key]);
    comps[key] = { address: text(comp.address), price: typeof comp.price === 'number' && Number.isFinite(comp.price) && comp.price > 0 ? comp.price : 0,
      date: text(comp.date), link: /^https:\/\//i.test(text(comp.link)) ? text(comp.link) : '',
      ...(comp.source === 'ATTOM' ? {source:'ATTOM'} : {}),
      ...(['suggested-unreviewed','operator-selected'].includes(comp.review) ? {review:comp.review} : {}) };
  }
  return comps;
}
