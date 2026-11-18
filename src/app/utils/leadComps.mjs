const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value.trim() : '';

export function selectedCompPatch(result, selectedIds, address) {
  if (result?.status !== 'matched' || result.source !== 'ATTOM' || !Array.isArray(result.sales)) throw Error('Load verified recorded sales before saving.');
  const ids = [...new Set(selectedIds)];
  if (ids.length < 1 || ids.length > 3) throw Error('Select one to three sales.');
  const selected = ids.map(id => result.sales.find(sale => sale.id === id));
  if (selected.some(sale => !sale || !text(sale.address) || !(sale.price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(sale.soldDate))) throw Error('The selected sales changed. Review and select again.');
  const comps = Object.fromEntries(['A', 'B', 'C'].map((slot, i) => [slot, selected[i] ? {
    address: selected[i].address, price: selected[i].price, date: selected[i].soldDate, link: '',
  } : { address: '', price: 0, date: '', link: '' }]));
  return {
    actor: 'PBK operator', actionSource: 'lead-comps-reviewed', expectedPropertyAddress: address,
    analyzer: { comps, recordedSales: { provider: 'ATTOM', review: 'operator-selected', address,
      retrievedAt: result.retrievedAt, windowStart: result.windowStart, windowEnd: result.windowEnd,
      radiusMiles: result.radiusMiles, selectedIds: ids, sales: result.sales.slice(0, 20) } },
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
