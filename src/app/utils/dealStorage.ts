import { DealData } from '../types';

export interface SavedDealRecord {
  id: string;
  address: string;
  status: 'active' | 'pending' | 'closed' | 'archived';
  lastUpdated: string;
  dealData: DealData;
}

export interface DealActivityRecord {
  id: string;
  dealId: string;
  address: string;
  timestamp: string;
  content: string;
  type: 'note' | 'call' | 'email' | 'meeting' | 'pdf';
}

const SAVED_DEALS_KEY = 'pbk-saved-deals';
const DEAL_ACTIVITY_KEY = 'pbk-notes';

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function getDealStorageId(deal: Partial<DealData>) {
  const address = String(deal.address || '').trim().toLowerCase();
  if (!address) return 'unsaved';
  return `deal_${stableHash(address)}`;
}

export function readSavedDeals(): SavedDealRecord[] {
  try {
    const raw = localStorage.getItem(SAVED_DEALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Failed to read saved deals', error);
    return [];
  }
}

export function writeSavedDeals(deals: SavedDealRecord[]) {
  localStorage.setItem(SAVED_DEALS_KEY, JSON.stringify(deals));
}

export function upsertSavedDeal(deal: DealData, status: SavedDealRecord['status'] = 'active') {
  const id = getDealStorageId(deal);
  if (id === 'unsaved') {
    throw new Error('Enter a property address before saving this deal.');
  }

  const existing = readSavedDeals();
  const previous = existing.find((item) => item.id === id);
  const next: SavedDealRecord = {
    id,
    address: deal.address || 'Untitled Deal',
    status: previous?.status || status,
    lastUpdated: new Date().toLocaleString(),
    dealData: deal,
  };
  const merged = [next, ...existing.filter((item) => item.id !== id)];
  writeSavedDeals(merged);
  return next;
}

export function isDealSaved(deal: Partial<DealData>) {
  const id = getDealStorageId(deal);
  if (id === 'unsaved') return false;
  return readSavedDeals().some((item) => item.id === id);
}

function readDealActivity(): DealActivityRecord[] {
  try {
    const raw = localStorage.getItem(DEAL_ACTIVITY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Failed to read deal activity', error);
    return [];
  }
}

export function appendSavedDealActivity(
  deal: Partial<DealData>,
  activity: Pick<DealActivityRecord, 'content' | 'type'>,
) {
  const dealId = getDealStorageId(deal);
  if (dealId === 'unsaved' || !isDealSaved(deal)) return null;

  const record: DealActivityRecord = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dealId,
    address: deal.address || 'Saved deal',
    timestamp: new Date().toLocaleString(),
    ...activity,
  };
  const next = [record, ...readDealActivity()];
  localStorage.setItem(DEAL_ACTIVITY_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('pbk:deal-activity', { detail: record }));
  return record;
}
