import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const source = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');

assert(
  /function\s+isNetlifyHostedRuntimeShell\(\)/.test(source),
  'runtimeBridge must be able to identify Netlify-hosted production shells.',
);

assert(
  /if\s*\(\s*isNetlifyHostedRuntimeShell\(\)\s*\)\s*return\s*\{\s*endpoint:\s*window\.location\.origin\s*\}/.test(
    source
  ),
  'Netlify-hosted shell must default runtime calls to the same-origin bridge proxy.',
);

assert(
  /buildHostedRuntimeFallbackUrl/.test(source) && /DEFAULT_HOSTED_BRIDGE_ENDPOINT/.test(source),
  'runtimeBridge should keep direct Render as a fallback for same-origin proxy exhaustion.',
);

assert(
  /shouldRetryRuntimeViaHosted/.test(source) && /usage_exceeded/i.test(source),
  'runtimeBridge should still retry direct Render when Netlify function usage is exhausted.',
);

console.log(JSON.stringify({ ok: true, result: 'runtime_bridge_hosted_proxy_smoke_ready' }, null, 2));
