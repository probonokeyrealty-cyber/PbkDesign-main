import type { DealData } from '../types';

export const ANALYZER_RETENTION_DAYS = 30;

export function getAnalyzerStorageEnv(hostname = window.location.hostname) {
  const host = String(hostname || 'local').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return 'local';
  if (host.includes('pbkcommandcenter') || host.includes('netlify.app')) return 'prod';
  return host.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'local';
}

export const ANALYZER_STORAGE_NAMESPACE = `pbk:${getAnalyzerStorageEnv()}:analyzer`;

export function getAnalyzerStorageKey(name: string) {
  return `${ANALYZER_STORAGE_NAMESPACE}:${name}`;
}

export const ANALYZER_CURRENT_DEAL_KEY = getAnalyzerStorageKey('current-deal');
export const ANALYZER_SAVED_DEALS_KEY = getAnalyzerStorageKey('saved-deals');
export const ANALYZER_ACTIVITY_KEY = getAnalyzerStorageKey('activity');

function encodeAnalyzerStoragePayload(payload: unknown) {
  const envelope = {
    version: 2,
    namespace: ANALYZER_STORAGE_NAMESPACE,
    savedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ANALYZER_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    payload,
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));
}

function decodeAnalyzerStoragePayload<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  const decoded = (() => {
    try {
      return decodeURIComponent(escape(atob(raw)));
    } catch {
      return raw;
    }
  })();

  try {
    const parsed = JSON.parse(decoded);
    if (parsed?.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) return fallback;
    return Object.prototype.hasOwnProperty.call(parsed, 'payload') ? parsed.payload : parsed;
  } catch {
    return fallback;
  }
}

function sanitizeAnalyzerDealForPersistentStorage(deal: Partial<DealData>) {
  const clone = JSON.parse(JSON.stringify(deal || {})) as Omit<Partial<DealData>, 'repairs'> & {
    repairs?: Record<string, unknown>;
    repairsMid?: unknown;
  };
  if (clone.repairs && typeof clone.repairs === 'object') {
    clone.repairs = {
      condition: String(clone.repairs.condition || ''),
      redacted: true,
    };
  }
  delete clone.repairsMid;
  return clone;
}

function sanitizeAnalyzerPayloadForLocalStorage(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => {
      if (item && typeof item === 'object' && 'dealData' in item) {
        return {
          ...item,
          dealData: sanitizeAnalyzerDealForPersistentStorage(
            (item as { dealData?: Partial<DealData> }).dealData || {}
          ),
        };
      }
      return sanitizeAnalyzerDealForPersistentStorage(item as Partial<DealData>);
    });
  }
  if ('deal' in payload) {
    return {
      ...payload,
      deal: sanitizeAnalyzerDealForPersistentStorage(
        (payload as { deal?: Partial<DealData> }).deal || {}
      ),
    };
  }
  return sanitizeAnalyzerDealForPersistentStorage(payload as Partial<DealData>);
}

function storageGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(store: Storage, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch (err) {
    console.warn('[PBK] Storage write blocked (private mode?):', err);
  }
}

function storageDel(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    /* ignore — read-only or private mode */
  }
}

export function readAnalyzerStorage<T>(key: string, fallback: T): T {
  return (
    decodeAnalyzerStoragePayload(storageGet(sessionStorage, `${key}:session`), fallback) ||
    decodeAnalyzerStoragePayload(storageGet(localStorage, key), fallback)
  );
}

export function writeAnalyzerStorage(key: string, payload: unknown) {
  storageSet(
    localStorage,
    key,
    encodeAnalyzerStoragePayload(sanitizeAnalyzerPayloadForLocalStorage(payload))
  );
  storageSet(sessionStorage, `${key}:session`, encodeAnalyzerStoragePayload(payload));
}

export function readAnalyzerDeal(fallback: DealData): DealData {
  const current = readAnalyzerStorage<Partial<DealData> | null>(ANALYZER_CURRENT_DEAL_KEY, null);
  if (current) return { ...fallback, ...current } as DealData;

  const legacy = storageGet(localStorage, 'pbk-deal-data');
  const parsed = decodeAnalyzerStoragePayload<Partial<DealData> | null>(legacy, null);
  if (parsed) {
    writeAnalyzerDeal({ ...fallback, ...parsed } as DealData);
    storageDel(localStorage, 'pbk-deal-data');
    return { ...fallback, ...parsed } as DealData;
  }

  return fallback;
}

export function writeAnalyzerDeal(deal: DealData) {
  writeAnalyzerStorage(ANALYZER_CURRENT_DEAL_KEY, deal);
}

export function clearAnalyzerDeal() {
  storageDel(localStorage, ANALYZER_CURRENT_DEAL_KEY);
  storageDel(sessionStorage, `${ANALYZER_CURRENT_DEAL_KEY}:session`);
  storageDel(localStorage, 'pbk-deal-data');
}
