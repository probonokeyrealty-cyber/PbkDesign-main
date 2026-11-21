import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = 'https://pbkcenter.netlify.app';
const paths = ['/', '/leads', '/settings'];

export async function checkProductionPrivacy(fetchImpl = globalThis.fetch) {
  const checks = [];
  for (const path of paths) {
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      checks.push({ path, status: response.status, protected: response.status === 401 });
    } catch (error) {
      checks.push({
        path,
        status: null,
        protected: false,
        error:
          error?.name === 'TimeoutError' || error?.name === 'AbortError'
            ? 'timeout'
            : 'network_error',
      });
    }
  }
  return { ok: checks.every((check) => check.protected), origin, checks };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await checkProductionPrivacy();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    console.error(
      'Production privacy check failed. Inspect pbkcenter visitor access; never unprotect it to repair a test.'
    );
    process.exitCode = 1;
  }
}
