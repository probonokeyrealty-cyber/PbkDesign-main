// This fixture resets public, so environment labels alone are not sufficient proof.
export async function validateTargetedEvalTarget({ env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const databaseUrl = env.PBK_TEST_DATABASE_URL;
  const projectId = env.NEON_PROJECT_ID || env.PBK_NEON_PROJECT_ID;
  const branchId = env.PBK_NEON_EVAL_BRANCH_ID;
  const name = env.PBK_NEON_EVAL_BRANCH_NAME;
  const token = env.PBK_NEON_API_KEY || env.NEON_API_KEY;
  if (!databaseUrl || databaseUrl !== env.PBK_EVAL_DATABASE_URL || env.PBK_DATABASE_URL || env.DATABASE_URL
    || !/^[a-z0-9-]+$/.test(projectId || '') || !/^br-[a-z0-9-]+$/.test(branchId || '')
    || !/^pbk-eval-targeted-readiness-/.test(name || '') || !token) {
    throw new Error('Disposable harness target/authority required');
  }
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) {
    throw new Error('Disposable harness target must be Neon');
  }
  const allowedParameters = { sslmode: ['require', 'verify-full'], channel_binding: ['require', 'prefer'] };
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!Object.hasOwn(allowedParameters, key) || !allowedParameters[key].includes(value) || seen.has(key)) {
      throw new Error('Disposable target connection parameter override rejected');
    }
    seen.add(key);
  }
  if (url.hash || (url.port && url.port !== '5432') || !url.username || !url.password
    || !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname) || !/^[a-z0-9.-]+$/.test(url.hostname)) {
    throw new Error('Disposable target connection fields rejected');
  }
  // Never let pg reparse a URI with target/session overrides after endpoint verification.
  const connectionConfig = { host: url.hostname, port: 5432, database: url.pathname.slice(1),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true }, enableChannelBinding: true };
  const base = `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}`;
  const get = async endpoint => {
    const response = await fetchImpl(endpoint, { redirect: 'error',
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Disposable branch verification failed');
    return response.json();
  };
  const { branch } = await get(base);
  const age = now - Date.parse(branch?.created_at);
  const ttl = Date.parse(branch?.expires_at) - now;
  if (branch?.id !== branchId || branch?.name !== name || !branch?.parent_id
    || branch.default !== false || branch.protected === true
    || !Number.isFinite(age) || age < 0 || age > 15 * 60_000
    || !Number.isFinite(ttl) || ttl <= 0 || ttl > 2 * 3600_000) {
    throw new Error('Target branch is not a fresh disposable branch');
  }
  const { endpoints } = await get(`${base}/endpoints`);
  if (!Array.isArray(endpoints) || !endpoints.some(endpoint => endpoint.branch_id === branchId
    && endpoint.type === 'read_write' && endpoint.host === url.hostname)) {
    throw new Error('Disposable branch endpoint does not match the database target');
  }
  return { databaseUrl, connectionConfig, projectId, branchId };
}
