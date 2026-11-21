import { registerHooks } from 'node:module';

if (process.argv.includes('--enabled')) {
  Object.assign(process.env, {
    PBK_PRODUCTION_RALEIGH_CANARY_ENABLED: 'true',
    PBK_PRODUCTION_RALEIGH_CANARY_EXPIRES_AT: new Date(Date.now() + 600_000).toISOString(),
    PBK_E2B_MARKET_WORKER_API_KEY: 'synthetic-cloud-worker',
  });
  let searches = 0;
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'e2b') {
        return { url: new URL('./public-market-sdk-fixture.mjs', import.meta.url).href, shortCircuit: true };
      }
      if (specifier === './public-market-connection.mjs') {
        const source = 'export const createPublicMarketConnectionCheck = () => async () => ({ connected: true, state: "connected_unverified" });';
        return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
      }
      if (specifier === './lib/composio-market-search.mjs') {
        const source = 'export const createComposioMarketSearch = () => ({search: globalThis.__raleighFixtureSearch});';
        return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  globalThis.__raleighFixtureSearch = async (query) => {
    if (++searches !== 1 || !query.includes('Raleigh, NC')) throw Error('Unexpected search.');
    return { ok: true, live: true, answer: 'Fictional Raleigh summary.', citations: ['https://example.org/report'] };
  };
}
await import('../openclaw-local-server.mjs');
