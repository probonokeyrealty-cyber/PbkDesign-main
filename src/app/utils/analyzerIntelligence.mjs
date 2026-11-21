const key = value => String(value && typeof value === 'object' ? [value.street,value.city,[value.state,value.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : value || '').trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
export const samePropertyAddress = (a,b) => Boolean(key(a)) && key(a) === key(b);
const propertyContextDefaults = {
  price:0,agreedPrice:0,beds:0,baths:0,sqft:0,year:0,dom:0,arv:0,mao60:0,maoRBP:0,offer:0,balance:0,rate:0,rent:0,
  lotSize:'',landLotSizeSqFt:0,landPriceSqFt:0,builderPrice:0,builderTotal:0,zipCode:'',
  repairs:{low:0,mid:0,high:0,condition:''},confirmedTerms:{},
  cfDownPayment:0,cfRate:5,cfTerm:30,cfMonthlyPayment:0,cfType:'carry',
  mtUpfront:0,mtBalanceConfirm:0,mtRateConfirm:0,mtType:'subto',
  rbpPriceConfirm:0,rbpBuyerType:'',rbpSellerCosts:'',rbpCashAlternative:0,
  landLotSizeConfirm:'',landBuyerType:'',landSellerCosts:'',cashAsIs:'yes',cashClosePeriod:'21',
  notes:'',timeline:'',motivationScore:0,motivationLevel:'',vacantStatus:'',reductions:0,
  investorCashFlow:0,investorCOC:0,investorROI:0,investorIRR:0,
  comps:Object.fromEntries(['A','B','C'].map(slot=>[slot,{address:'',price:0,date:'',link:''}])),compManualSlots:[],isAnalyzed:false,verdict:'none'
};
export const propertyContextFields = Object.keys(propertyContextDefaults);
export function resetChangedProperty(deal, nextAddress) {
  if (samePropertyAddress(deal.address,nextAddress) || !(deal.leadId || deal.propertyRecordSnapshot || deal.listingSnapshot || deal.recordedSales)) return {};
  return structuredClone(propertyContextDefaults);
}

const analyzerAddressPattern = /^(\d[^,]+),\s*([^,]+),\s*([a-z]{2})\s+(\d{5}(?:-\d{4})?)$/i;

export function hasCompleteAnalyzerAddress(address) {
  return analyzerAddressPattern.test(address.trim());
}

export function intelligenceRequest(deal) {
  const match = String(deal.address || '').trim().match(analyzerAddressPattern);
  if (!match) throw Error('Enter the complete property address, city, state and ZIP.');
  return { address: deal.address.trim(), ...(deal.leadId ? {
    leadId: deal.leadId,
    expectedPropertyAddress: {street:match[1].trim(),city:match[2].trim(),state:match[3].toUpperCase(),zip:match[4]},
  } : {}) };
}

// Evidence fills gaps only. A manually cleared field remains protected by the
// draft's existing manual-field set; source values never imply seller consent.
export function mergeAnalyzerIntelligence(deal, response, protectedFields = new Set()) {
  if (!key(deal.address) || key(deal.address) !== key(response.address)) return {};
  const updates = {};
  const evidence = response.patch?.deal || {};
  for (const field of ['propertyRecordSnapshot','listingSnapshot']) {
    if (evidence[field]) updates[field] = evidence[field];
  }
  const sales = response.patch?.analyzer?.recordedSales || evidence.recordedSales;
  if (sales && key(sales.address) === key(deal.address)) updates.recordedSales = sales;
  const records = response.records?.status === 'matched' ? response.records.profile : {};
  const listing = response.listing?.cache?.hit === true ? response.listing.propertyData?.data || {} : {};
  const facts = listing.listingFacts || {};
  const values = { beds: records.beds ?? facts.beds, baths: records.baths ?? facts.baths,
    sqft: records.livingSqft ?? facts.sqft, year: records.yearBuilt ?? facts.year,
    dom: facts.dom, price: listing.priceBasis === 'asking_price' ? listing.askingPriceUsd : undefined };
  for (const [field,value] of Object.entries(values)) {
    if (!deal[field] && !protectedFields.has(field) && positive(value)) updates[field] = value;
  }
  if (deal.type === 'land' && positive(records.lotSqft) && !deal.landLotSizeSqFt && !protectedFields.has('landLotSizeSqFt')) updates.landLotSizeSqFt=records.lotSqft;
  if (deal.type === 'land' && positive(records.lotAcres) && !deal.lotSize && !protectedFields.has('lotSize')) updates.lotSize=String(records.lotAcres);
  if ((!protectedFields.has('comps') || Array.isArray(deal.compManualSlots)) && evidence.comps) {
    const comps = {...deal.comps};
    const used = new Set(Object.values(comps).map(comp=>key(comp?.address)).filter(Boolean));
    let changed = false;
    for (const slot of ['A','B','C']) {
      const current = comps[slot] || {};
      const candidate = evidence.comps[slot];
      if (!deal.compManualSlots?.includes(slot) && !current.address && !current.price && !current.date && !current.link && typeof candidate?.address === 'string' && key(candidate.address) && !used.has(key(candidate.address)) && positive(candidate.price)) {
        comps[slot] = {...candidate}; used.add(key(candidate.address)); changed = true;
      }
    }
    if (changed) { updates.comps = comps; updates.compManualSlots=[...(deal.compManualSlots || [])]; updates.isAnalyzed=false; }
  }
  return updates;
}
