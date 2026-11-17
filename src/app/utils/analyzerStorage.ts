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
export const ANALYZER_DRAFT_LOCK_NAME = `${ANALYZER_CURRENT_DEAL_KEY}:write`;
export const ANALYZER_SAVED_DEALS_KEY = getAnalyzerStorageKey('saved-deals');
export const ANALYZER_ACTIVITY_KEY = getAnalyzerStorageKey('activity');

function encodeAnalyzerStoragePayload(payload: unknown, manualFields?: readonly string[], sharedBaseline?: string | null, unpublishedEdits = false) {
  const envelope = {
    version: 2,
    namespace: ANALYZER_STORAGE_NAMESPACE,
    savedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ANALYZER_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    payload,
    ...(manualFields ? { manualFields: [...manualFields] } : {}),
    ...(sharedBaseline !== undefined ? { sharedBaseline } : {}),
    ...(unpublishedEdits ? { unpublishedEdits: true } : {}),
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));
}

function decodeAnalyzerEnvelope(raw: string | null): unknown {
  if (!raw) return undefined;
  const decoded = (() => {
    try {
      return decodeURIComponent(escape(atob(raw)));
    } catch {
      return raw;
    }
  })();

  try {
    const parsed = JSON.parse(decoded);
    if (parsed?.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function decodeAnalyzerStoragePayload<T>(raw: string | null, fallback: T): T {
  const parsed = decodeAnalyzerEnvelope(raw);
  if (parsed === undefined) return fallback;
  return parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'payload')
    ? (parsed as { payload: T }).payload : parsed as T;
}

export function analyzerDraftManualFields(raw: string | null): string[] | null {
  const parsed = decodeAnalyzerEnvelope(raw) as { manualFields?: unknown } | undefined;
  return Array.isArray(parsed?.manualFields)
    ? parsed.manualFields.filter((field): field is string => typeof field === 'string') : null;
}

export function readAnalyzerDraftManualFields(): string[] | null {
  const key = `${ANALYZER_CURRENT_DEAL_KEY}:session`;
  const session = storageGet(sessionStorage, key);
  return analyzerDraftManualFields(decodeAnalyzerEnvelope(session) !== undefined
    ? session : storageGet(localStorage, ANALYZER_CURRENT_DEAL_KEY));
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

export function readSharedAnalyzerDraft(): string | null {
  return storageGet(localStorage, ANALYZER_CURRENT_DEAL_KEY);
}

export type AnalyzerDraftCommit = 'published' | 'cleared' | 'conflict' | 'superseded';

function openDraftCoordinator(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pbk-analyzer-draft-coordination', 1);
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error('Shared draft coordination timed out.'));
    }, 5000);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (settled) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export async function commitAnalyzerDraft(
  deal: DealData | null, manualFields: readonly string[],
  expected: string | null | undefined, force: boolean, isCurrent: () => boolean
): Promise<AnalyzerDraftCommit> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    throw new Error('Shared draft coordination is unavailable.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    return await navigator.locks.request(ANALYZER_DRAFT_LOCK_NAME,
      { mode: 'exclusive', signal: controller.signal }, async () => {
        if (!isCurrent()) return 'superseded';
        const database = await openDraftCoordinator();
        try {
          const persistent = deal === null ? null
            : encodeAnalyzerStoragePayload(sanitizeAnalyzerPayloadForLocalStorage(deal), manualFields);
          let previous: { raw: string | null } | undefined;
          // WebKit may cache localStorage per process. Commit the authoritative pointer first.
          const result = await new Promise<AnalyzerDraftCommit>((resolve, reject) => {
            const transaction = database.transaction('drafts', 'readwrite');
            const store = transaction.objectStore('drafts');
            const request = store.get(ANALYZER_CURRENT_DEAL_KEY);
            let outcome: AnalyzerDraftCommit = 'superseded';
            request.onsuccess = () => {
              previous = request.result;
              if (!isCurrent()) return;
              const local = readSharedAnalyzerDraft();
              const canonical = request.result ? request.result.raw as string | null : local;
              if (!force && (expected === undefined || canonical !== expected || local !== expected)) {
                outcome = 'conflict';
                return;
              }
              store.put({ raw: persistent }, ANALYZER_CURRENT_DEAL_KEY);
              outcome = deal === null ? 'cleared' : 'published';
            };
            transaction.oncomplete = () => resolve(outcome);
            transaction.onabort = () => reject(transaction.error || new Error('Shared draft coordination failed.'));
            transaction.onerror = () => reject(transaction.error);
          });
          const rollback = () => new Promise<void>((resolve, reject) => {
            const transaction = database.transaction('drafts', 'readwrite');
            const store = transaction.objectStore('drafts');
            if (previous === undefined) store.delete(ANALYZER_CURRENT_DEAL_KEY);
            else store.put(previous, ANALYZER_CURRENT_DEAL_KEY);
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error || new Error('Draft reservation rollback failed.'));
            transaction.onerror = () => reject(transaction.error);
          });
          if (result !== 'published' && result !== 'cleared') return result;
          if (!isCurrent()) { await rollback(); return 'superseded'; }
          try {
            if (persistent === null) localStorage.removeItem(ANALYZER_CURRENT_DEAL_KEY);
            else localStorage.setItem(ANALYZER_CURRENT_DEAL_KEY, persistent);
          } catch (error) {
            await rollback();
            throw error;
          }
          if (result === 'cleared') {
            storageDel(sessionStorage, `${ANALYZER_CURRENT_DEAL_KEY}:session`);
            storageDel(localStorage, 'pbk-deal-data');
          }
          if (result === 'published' && deal !== null && persistent !== null) {
            storageSet(sessionStorage, `${ANALYZER_CURRENT_DEAL_KEY}:session`,
              encodeAnalyzerStoragePayload(deal, manualFields, persistent));
            if (readSharedAnalyzerDraft() === persistent) storageDel(localStorage, 'pbk-deal-data');
          }
          return result;
        } finally {
          database.close();
        }
      });
  } finally {
    clearTimeout(timeout);
  }
}

export function readAnalyzerDraftBaseline(): string | null | undefined {
  const shared = readSharedAnalyzerDraft();
  const sessionRaw = storageGet(sessionStorage, `${ANALYZER_CURRENT_DEAL_KEY}:session`);
  const envelope = decodeAnalyzerEnvelope(sessionRaw) as { sharedBaseline?: unknown; unpublishedEdits?: boolean } | undefined;
  if (envelope?.unpublishedEdits) return undefined;
  if (envelope && Object.prototype.hasOwnProperty.call(envelope, 'sharedBaseline')) {
    return envelope.sharedBaseline === shared ? shared : undefined;
  }
  const session = decodeAnalyzerStoragePayload<unknown>(
    sessionRaw, undefined
  );
  const persistent = decodeAnalyzerStoragePayload<unknown>(shared, undefined);
  const canonical = (value: unknown): unknown => value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(canonical)
      : Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)])) : value;
  if (session && (!persistent || JSON.stringify(canonical(sanitizeAnalyzerPayloadForLocalStorage(session))) !== JSON.stringify(canonical(persistent)))) {
    return undefined;
  }
  return shared;
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
  const session = decodeAnalyzerStoragePayload<T | undefined>(storageGet(sessionStorage, `${key}:session`), undefined);
  return session ?? decodeAnalyzerStoragePayload(storageGet(localStorage, key), fallback);
}

export function writeAnalyzerStorage(key: string, payload: unknown, manualFields?: readonly string[]) {
  const persistent = encodeAnalyzerStoragePayload(sanitizeAnalyzerPayloadForLocalStorage(payload), manualFields);
  storageSet(localStorage, key, persistent);
  storageSet(sessionStorage, `${key}:session`, encodeAnalyzerStoragePayload(payload, manualFields,
    key === ANALYZER_CURRENT_DEAL_KEY ? persistent : undefined));
  if (key === ANALYZER_CURRENT_DEAL_KEY && readSharedAnalyzerDraft() === persistent) {
    storageDel(localStorage, 'pbk-deal-data');
  }
}

export function writeAnalyzerSessionDeal(deal: Partial<DealData>, manualFields: readonly string[], sharedBaseline?: string | null, unpublishedEdits = false) {
  storageSet(sessionStorage, `${ANALYZER_CURRENT_DEAL_KEY}:session`, encodeAnalyzerStoragePayload(deal, manualFields, sharedBaseline, unpublishedEdits));
}

export function readAnalyzerDeal(fallback: DealData): DealData {
  const current = readAnalyzerStorage<Partial<DealData> | null>(ANALYZER_CURRENT_DEAL_KEY, null);
  if (current) return { ...fallback, ...current } as DealData;

  const legacy = storageGet(localStorage, 'pbk-deal-data');
  const parsed = decodeAnalyzerStoragePayload<Partial<DealData> | null>(legacy, null);
  if (parsed) {
    return { ...fallback, ...parsed } as DealData;
  }

  return fallback;
}

export function writeAnalyzerDeal(deal: DealData, manualFields?: readonly string[]) {
  writeAnalyzerStorage(ANALYZER_CURRENT_DEAL_KEY, deal, manualFields);
}

export function clearAnalyzerDeal() {
  storageDel(localStorage, ANALYZER_CURRENT_DEAL_KEY);
  storageDel(sessionStorage, `${ANALYZER_CURRENT_DEAL_KEY}:session`);
  storageDel(localStorage, 'pbk-deal-data');
}
