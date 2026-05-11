const baseUrl = String(process.env.PBK_BRIDGE_URL || process.env.PBK_PUBLIC_BASE_URL || 'http://127.0.0.1:8788')
  .trim()
  .replace(/\/+$/g, '');
const apiKey = String(process.env.PBK_BRIDGE_API_KEY || '').trim();

function headers(extra = {}) {
  return {
    Accept: 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...extra,
  };
}

async function readJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: headers(options.headers || {}),
  });
  const body = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const report = {
  ok: false,
  checkedAt: new Date().toISOString(),
  baseUrl,
  checks: [],
};

try {
  const health = await readJson('/health');
  assert(health.response.ok, `/health returned ${health.response.status}`);
  assert(health.body.providers?.deepSeek, 'DeepSeek provider metadata missing from /health.');
  assert(health.body.providers?.hermes, 'Hermes provider metadata missing from /health.');
  report.checks.push({
    name: 'health exposes DeepSeek and Hermes',
    ok: true,
    deepSeekReady: Boolean(health.body.providers.deepSeek.ready),
    hermesReady: Boolean(health.body.providers.hermes.ready),
  });

  const status = await readJson('/api/hermes/status');
  assert(status.response.ok || status.response.status === 503, `/api/hermes/status returned ${status.response.status}`);
  assert(status.body.hermes?.writeMode === 'suggest-only', 'Hermes is not marked suggest-only.');
  assert(status.body.safety?.providerWrites === 'blocked', 'Hermes safety envelope does not block provider writes.');
  report.checks.push({
    name: 'Hermes status safety envelope is present',
    ok: true,
    status: status.response.status,
    mode: status.body.hermes?.mode || '',
    gatewayStatus: status.body.gateway?.status || '',
  });

  if (/^(1|true|yes)$/i.test(String(process.env.PBK_HERMES_RUN_RECOMMENDATION || '').trim())) {
    const recommendation = await readJson('/api/hermes/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        situation: 'Smoke test: seller says roof needs work and wants to sell quickly.',
        confidence: 0.72,
        attemptedActions: ['confirm motivation', 'protect MAO'],
        metadata: { smoke: true },
      }),
    });
    assert(recommendation.response.ok, `/api/hermes/recommend returned ${recommendation.response.status}`);
    assert(recommendation.body.recommendation?.immediateScript, 'Hermes recommendation missing immediateScript.');
    report.checks.push({
      name: 'Hermes recommendation path works',
      ok: true,
      provider: recommendation.body.request?.provider || '',
    });
  }

  report.ok = true;
} catch (error) {
  report.error = error?.message || String(error);
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
