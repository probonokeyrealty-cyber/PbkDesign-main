import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const docker = read('Dockerfile.openclaw');
const runtime = docker.slice(docker.lastIndexOf('FROM '));

test('closure runtime imports and fixed verifier SQL are explicitly packaged', () => {
  for (const file of ['dead-letter-closure-protocol.mjs', 'dead-letter-closure-evidence.mjs',
    'dead-letter-closure-migration.mjs', 'dead-letter-closure-store.mjs', 'dead-letter-closure-approval.mjs',
    'migrations/20261117-dead-letter-closure.sql']) {
    assert(runtime.includes(`COPY scripts/${file} ./scripts/${file}`), `missing runtime asset: ${file}`);
  }
  assert.match(runtime, /^FROM node:22-slim/m);
  assert.doesNotMatch(runtime, /^\s*(?:RUN|CMD|ENTRYPOINT).*dead-letter-closure-migration/gm);
});

test('closure scripts separate isolated units, bridge smoke and opt-in native proof', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.match(scripts['test:dead-letter-closure'] || '', /dead-letter-closure-packaging\.node-test\.mjs/);
  for (const suite of ['protocol', 'migration', 'evidence', 'store', 'approval', 'wiring']) {
    assert(read(`scripts/dead-letter-closure-${suite}.test.mjs`));
    assert((scripts['test:dead-letter-closure'] || '').includes(`scripts/dead-letter-closure-${suite}.test.mjs`), suite);
  }
  assert.equal(scripts['test:dead-letter-closure-bridge'], 'node ./scripts/dead-letter-closure-bridge-smoke.mjs');
  assert.equal(scripts['test:dead-letter-closure-postgres'], 'node ./scripts/dead-letter-closure-postgres-local.mjs');
});
