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
  /async function verifyTeamSession/.test(source),
  'Netlify bridge proxy must verify the PBK team session before attaching bridge authority.',
);

assert(
  /decodeURIComponent\(raw\)/.test(source) &&
    /segment === ['"]\.\.['"]/.test(source) &&
    /invalid_proxy_path/.test(source),
  'Netlify bridge proxy must reject encoded traversal before deciding whether a route is public.',
);

assert(
  /if\s*\(\s*!isPublicProxyRequest\(event\.httpMethod,\s*targetPath\)\s*\)[\s\S]*verifyTeamSession/.test(source),
  'Protected proxy requests must be rejected until the team session verifies.',
);

assert(
  /function authorizeTeamRequest/.test(source) &&
    /canDeleteData/.test(source) &&
    /canSendContracts/.test(source) &&
    /canSendSms/.test(source) &&
    /canSendEmail/.test(source) &&
    /canPlaceCalls/.test(source) &&
    /canApproveProviderActions/.test(source) &&
    /canToggleKillSwitch/.test(source) &&
    /canChangeGuardrails/.test(source) &&
    /team_permission_denied/.test(source),
  'Verified team permissions must be enforced before the bridge key is attached upstream.',
);
assert(
  /getAssistantChatText/.test(source) &&
    /\/api\/assistant\/chat/.test(source) &&
    /return deny\('canSendSms', 'send SMS messages'\)/.test(source) &&
    /return deny\('canSendEmail', 'send emails'\)/.test(source) &&
    /return deny\('canPlaceCalls', 'place calls'\)/.test(source) &&
    /return deny\('canApproveProviderActions', 'approve provider actions'\)/.test(source),
  'Hosted Ava assistant proxy requests must enforce call, SMS, email, and provider-approval permissions before bridge authority is attached.',
);
assert(
  /normalizedPath === ['"]\/api\/underwriting\/sign['"]/.test(source),
  'The underwriting sign route must require contract-send permission.',
);
assert(
  /\/api\\\/settings\(\?:\\\/\|\$\)/.test(source) &&
    /\/api\\\/desktop-sidecar\\\/command/.test(source),
  'Team sessions must not mutate settings or issue desktop-sidecar commands.',
);

const publicReadPaths = source.slice(
  source.indexOf('const PUBLIC_PROXY_READ_PATHS'),
  source.indexOf('const PUBLIC_PROXY_POST_PATHS'),
);
assert(
  !/\/api\/(leads|deals|skills|observability)\//.test(publicReadPaths),
  'Operational analytics and seller data must remain behind the PBK team session.',
);

assert(
  /headers\.Authorization\s*=\s*`Bearer \$\{bridgeApiKey\}`/.test(source),
  'Netlify bridge proxy must attach Authorization: Bearer <PBK_BRIDGE_API_KEY> upstream.',
);

assert(
  !/FORWARDED_REQUEST_HEADERS[\s\S]{0,220}['"]authorization['"]/.test(source),
  'The proxy must not forward caller-supplied Authorization headers upstream.',
);

assert(
  /headers\['X-PBK-Netlify-Proxy'\]\s*=\s*['"]pbk-bridge-proxy['"]/.test(source),
  'Netlify bridge proxy should continue tagging proxied requests.',
);

assert(
  /x-ratelimit-limit/.test(source) &&
    /x-ratelimit-remaining/.test(source) &&
    /retry-after/.test(source),
  'Rate-limit response headers must survive the Netlify proxy.',
);

console.log(JSON.stringify({ ok: true, result: 'netlify_bridge_proxy_auth_smoke_ready' }, null, 2));
