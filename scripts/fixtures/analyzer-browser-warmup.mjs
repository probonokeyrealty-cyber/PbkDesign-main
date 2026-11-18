import assert from 'node:assert/strict';

export function analyzerBrowserFixtureOptions(runId = String(process.pid)) {
  assert.match(runId, /^\d+$/, 'Fixture run must have a numeric process identity');
  return { cacheDir: `.pbk-local/analyzer-draft-recovery-vite-${runId}`,
    optimizeDeps: { entries: ['./scripts/fixtures/analyzer-draft-recovery.html'] } };
}

export async function warmAnalyzerBrowserFixture(server) {
  // Vite may schedule imported modules in the background; entries alone are not readiness.
  for (const path of ['/scripts/fixtures/analyzer-draft-recovery.tsx',
    '/src/app/components/TeamAccessGate.tsx', '/src/app/routes/DealView.tsx',
    '/src/app/App.tsx', '/src/styles/index.css']) {
    const result = await server.transformRequest(path);
    assert.ok(result && typeof result.code === 'string', `Fixture transform unavailable: ${path}`);
  }
  await server.environments.client.waitForRequestsIdle();
  // Optimized dependency responses can still be pending after source transforms finish.
  const optimizer = server.environments.client.depsOptimizer;
  await optimizer?.scanProcessing;
  for (const dependency of optimizer?.metadata.depInfoList || []) await dependency.processing;
}
