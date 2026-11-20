import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { getAvaChatRequiredPermissions } from '../ava-team-chat-permissions.mjs';

const source = readFileSync(new URL('../../netlify/functions/pbk-bridge-proxy.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

function loadProxy(upstreamFetch, timers = {}) {
  if (typeof upstreamFetch !== 'function') throw new Error('An isolated upstream fixture is required');
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, URL, Buffer, AbortController, Error, DOMException,
    require: name => {
      if (name === '../../scripts/ava-team-chat-permissions.mjs') return { getAvaChatRequiredPermissions };
      throw new Error(`Unexpected proxy fixture import: ${name}`);
    },
    Request, Response, Headers, ReadableStream,
    setTimeout: timers.setTimeout || setTimeout,
    clearTimeout: timers.clearTimeout || clearTimeout,
    process: { env: { PBK_BRIDGE_URL: 'https://bridge-fixture.invalid', PBK_BRIDGE_API_KEY: 'fixture-only-authority' } },
    fetch: upstreamFetch,
  });
  return exports;
}

export function createProxyFixture(upstreamFetch, timers = {}) {
  return loadProxy(upstreamFetch, timers).legacyHandler;
}

export function createFetchProxyFixture(upstreamFetch, timers = {}) {
  return loadProxy(upstreamFetch, timers).default;
}
