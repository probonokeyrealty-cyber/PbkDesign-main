import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../netlify/functions/pbk-bridge-proxy.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

export function createProxyFixture(upstreamFetch) {
  if (typeof upstreamFetch !== 'function') throw new Error('An isolated upstream fixture is required');
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, URL, Buffer, AbortController, Error, setTimeout, clearTimeout,
    process: { env: { PBK_BRIDGE_URL: 'https://bridge-fixture.invalid', PBK_BRIDGE_API_KEY: 'fixture-only-authority' } },
    fetch: upstreamFetch,
  });
  return exports.handler;
}
