declare const __PBK_BUILD_ID__: string | undefined;

const BUILD_ID = typeof __PBK_BUILD_ID__ === 'string' ? __PBK_BUILD_ID__ : 'dev';
const MANIFEST_PATH = '/pbk-build-manifest.json';
const REFRESH_PREFIX = 'pbk:deploy-refresh';
const CHECK_INTERVAL_MS = 60_000;

let lastCheckAt = 0;
let inFlightCheck: Promise<boolean> | null = null;

type BuildManifest = {
  buildId?: string;
  generatedAt?: string;
};

function canUseDeployManifest() {
  return Boolean(
    import.meta.env.PROD && typeof window !== 'undefined' && typeof fetch === 'function'
  );
}

function refreshKey(reason: string) {
  if (typeof window === 'undefined') return `${REFRESH_PREFIX}:${reason}:${BUILD_ID}`;
  return [REFRESH_PREFIX, reason, window.location.origin, window.location.pathname, BUILD_ID].join(
    ':'
  );
}

export function currentPbkBuildId() {
  return BUILD_ID;
}

export function isStaleDynamicImportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to fetch dynamically imported module') ||
    lower.includes('error loading dynamically imported module') ||
    lower.includes('importing a module script failed') ||
    lower.includes('chunkloaderror') ||
    lower.includes('loading chunk') ||
    lower.includes('expected a javascript-or-wasm module script') ||
    lower.includes('mime type')
  );
}

export function reloadForCurrentDeploy(reason: string) {
  if (typeof window === 'undefined') return false;
  const key = refreshKey(reason);

  try {
    if (window.sessionStorage.getItem(key) === '1') return false;
    window.sessionStorage.setItem(key, '1');
  } catch {
    return false;
  }

  window.setTimeout(() => window.location.reload(), 80);
  return true;
}

async function fetchCurrentManifest(): Promise<BuildManifest | null> {
  const response = await fetch(`${MANIFEST_PATH}?t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  return (await response.json()) as BuildManifest;
}

export async function checkForNewDeploy(reason = 'manifest-check') {
  if (!canUseDeployManifest()) return false;
  if (inFlightCheck) return inFlightCheck;

  inFlightCheck = (async () => {
    try {
      const manifest = await fetchCurrentManifest();
      const deployedBuildId = String(manifest?.buildId || '').trim();
      if (deployedBuildId && deployedBuildId !== BUILD_ID) {
        return reloadForCurrentDeploy(reason);
      }
    } catch (error) {
      console.warn('[PBK] Deploy version check skipped:', error);
    } finally {
      lastCheckAt = Date.now();
      inFlightCheck = null;
    }
    return false;
  })();

  return inFlightCheck;
}

export async function loadCurrentRoute<T>(loader: () => Promise<T>): Promise<T> {
  const reloading = await checkForNewDeploy('route-import');
  if (reloading) return new Promise<T>(() => undefined);

  try {
    return await loader();
  } catch (error) {
    if (isStaleDynamicImportError(error)) {
      if (reloadForCurrentDeploy('route-import-error')) {
        return new Promise<T>(() => undefined);
      }
    }
    throw error;
  }
}

export function installPbkDeployGuard() {
  if (!canUseDeployManifest()) return;

  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForCurrentDeploy('vite-preload-error')) {
      event.preventDefault();
    }
  });

  const maybeCheck = () => {
    if (Date.now() - lastCheckAt < CHECK_INTERVAL_MS) return;
    void checkForNewDeploy('visibility-or-focus');
  };

  window.addEventListener('focus', maybeCheck);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') maybeCheck();
  });
  window.setInterval(maybeCheck, CHECK_INTERVAL_MS);
  void checkForNewDeploy('startup');
}
