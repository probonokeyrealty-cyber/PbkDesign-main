import { registerHooks } from 'node:module';

if (!process.send || !process.env.PBK_SMOKE_ISOLATION_NONCE ||
    process.env.PBK_REDIS_ENABLED !== 'false' ||
    !process.permission?.has('fs.write', process.env.PBK_OPENCLAW_STATE_DIR)) {
  throw new Error('Disabled Redis probe requires the isolated smoke harness');
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'redis') throw new Error('Disabled bridge eagerly loaded Redis');
    return nextResolve(specifier, context);
  },
});
await import('../openclaw-local-server.mjs');
