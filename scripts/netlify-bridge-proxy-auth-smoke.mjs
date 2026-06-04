import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const source = readFileSync(resolve(root, 'netlify/functions/pbk-bridge-proxy.ts'), 'utf8');

assert(
  /process\.env\.PBK_BRIDGE_API_KEY/.test(source),
  'Netlify bridge proxy must read PBK_BRIDGE_API_KEY server-side.',
);

assert(
  /const\s+incomingAuthorization\s*=\s*getHeader\(event,\s*['"]authorization['"]\)/i.test(source),
  'Netlify bridge proxy must detect caller Authorization before injecting fallback auth.',
);

assert(
  /if\s*\(\s*!\s*incomingAuthorization\s*&&\s*bridgeApiKey\s*\)/.test(source),
  'Netlify bridge proxy must inject bridge auth only when the caller did not provide Authorization.',
);

assert(
  /headers\.Authorization\s*=\s*`Bearer \$\{bridgeApiKey\}`/.test(source),
  'Netlify bridge proxy must attach Authorization: Bearer <PBK_BRIDGE_API_KEY> upstream.',
);

assert(
  /headers\['X-PBK-Netlify-Proxy'\]\s*=\s*['"]pbk-bridge-proxy['"]/.test(source),
  'Netlify bridge proxy should continue tagging proxied requests.',
);

console.log(JSON.stringify({ ok: true, result: 'netlify_bridge_proxy_auth_smoke_ready' }, null, 2));
