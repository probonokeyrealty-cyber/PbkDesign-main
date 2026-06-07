import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const source = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');

assert(
  /function\s+isNetlifyHostedRuntimeShell\(\)/.test(source),
  'runtimeBridge must be able to identify Netlify-hosted production shells.',
);

const getRuntimeConfigStart = source.indexOf('export function getRuntimeConfig()');
const getRuntimeConfigEnd = source.indexOf('function isAuthOptionalRuntimePath', getRuntimeConfigStart);
const getRuntimeConfigBody =
  getRuntimeConfigStart >= 0 && getRuntimeConfigEnd > getRuntimeConfigStart
    ? source.slice(getRuntimeConfigStart, getRuntimeConfigEnd)
    : '';
const hostedProxyIndex = getRuntimeConfigBody.indexOf('if (isNetlifyHostedRuntimeShell())');
const storageIndex = getRuntimeConfigBody.indexOf('readRuntimeConfigFromStorage()');
const sameOriginReturnIndex = getRuntimeConfigBody.indexOf('return { endpoint: window.location.origin }');
assert(
  hostedProxyIndex >= 0 && sameOriginReturnIndex > hostedProxyIndex,
  'Netlify-hosted shell must default runtime calls to the same-origin bridge proxy.',
);

assert(
  hostedProxyIndex >= 0 && storageIndex >= 0 && hostedProxyIndex < storageIndex,
  'Netlify-hosted shell must prefer the mobile-safe same-origin proxy before stale browser storage.',
);

assert(
  /buildHostedRuntimeFallbackUrl/.test(source) && /DEFAULT_HOSTED_BRIDGE_ENDPOINT/.test(source),
  'runtimeBridge should keep direct Render as a fallback for same-origin proxy exhaustion.',
);

assert(
  /function\s+hasServerSideRuntimeAuth\(\)/.test(source),
  'runtimeBridge must recognize authenticated Netlify same-origin sessions.',
);

assert(
  /endpoint === origin && Boolean\(getRuntimeTeamSession\(\)\)/.test(source),
  'Same-origin proxy authority must require an unexpired PBK team session.',
);

assert(
  /getRuntimeTeamSession/.test(source) &&
    /authenticateTeamSessionRequest/.test(source) &&
    /X-PBK-Team-Token/.test(source),
  'The shell must create, store, and send expiring team sessions without exposing the bridge key.',
);

assert(
  /if \(!isAuthOptionalRuntimePath\(path\)\) return false/.test(source),
  'Protected requests must never retry directly against Render without server-side bearer auth.',
);

assert(
  /const apiKey = env\.DEV/.test(source),
  'Production Vite bundles must not embed PBK bridge API keys.',
);

console.log(JSON.stringify({ ok: true, result: 'runtime_bridge_hosted_proxy_smoke_ready' }, null, 2));
