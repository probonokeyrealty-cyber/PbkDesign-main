import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const source = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const mobileProof = readFileSync(resolve(root, 'scripts/mobile-browser-proof.mjs'), 'utf8');

assert(
  /function\s+isNetlifyHostedRuntimeShell\(\)/.test(source),
  'runtimeBridge must be able to identify Netlify-hosted production shells.'
);

assert(
  /function\s+isBridgeHostedRuntimeShell\(\)/.test(source) &&
    /function\s+isHostedRuntimeShell\(\)/.test(source),
  'runtimeBridge must also identify direct OpenClaw/Render-hosted shells for team login.'
);

assert(
  /host\.endsWith\('\.onrender\.com'\)/.test(source),
  'Direct Render-hosted OpenClaw shells must be treated as hosted production shells.'
);

assert(
  /export function isRuntimeTeamAuthRequired\(\) \{\s*return isHostedRuntimeShell\(\);/s.test(
    source
  ),
  'Team login must be required for every hosted production shell, not only Netlify.'
);

const getRuntimeConfigStart = source.indexOf('export function getRuntimeConfig()');
const getRuntimeConfigEnd = source.indexOf(
  'function isAuthOptionalRuntimePath',
  getRuntimeConfigStart
);
const getRuntimeConfigBody =
  getRuntimeConfigStart >= 0 && getRuntimeConfigEnd > getRuntimeConfigStart
    ? source.slice(getRuntimeConfigStart, getRuntimeConfigEnd)
    : '';
const hostedProxyIndex = getRuntimeConfigBody.indexOf('if (isHostedRuntimeShell())');
const storageIndex = getRuntimeConfigBody.indexOf('readRuntimeConfigFromStorage()');
const sameOriginReturnIndex = getRuntimeConfigBody.indexOf(
  'return { endpoint: window.location.origin }'
);
assert(
  hostedProxyIndex >= 0 && sameOriginReturnIndex > hostedProxyIndex,
  'Hosted shells must default runtime calls to their same-origin bridge/proxy.'
);

assert(
  hostedProxyIndex >= 0 && storageIndex >= 0 && hostedProxyIndex < storageIndex,
  'Hosted shells must prefer the mobile-safe same-origin path before stale browser storage.'
);

assert(
  /buildHostedRuntimeFallbackUrl/.test(source) && /DEFAULT_HOSTED_BRIDGE_ENDPOINT/.test(source),
  'runtimeBridge should keep direct Render as a fallback for same-origin proxy exhaustion.'
);

assert(
  /function\s+hasServerSideRuntimeAuth\(\)/.test(source),
  'runtimeBridge must recognize authenticated hosted same-origin sessions.'
);

assert(
  /endpoint === origin && Boolean\(getRuntimeTeamSession\(\)\)/.test(source),
  'Same-origin proxy authority must require an unexpired PBK team session.'
);

assert(
  /getRuntimeTeamSession/.test(source) &&
    /authenticateTeamSessionRequest/.test(source) &&
    /X-PBK-Team-Token/.test(source),
  'The shell must create, store, and send expiring team sessions without exposing the bridge key.'
);

assert(
  /const canRetryProtectedWithTeamToken = Boolean\(getRuntimeTeamSession\(\)\?\.token\)/.test(
    source
  ) &&
    /if \(!isAuthOptionalRuntimePath\(path\) && !canRetryProtectedWithTeamToken\) return false/.test(
      source
    ),
  'Protected requests may retry directly against Render only when an unexpired PBK team token is available.'
);

const publicPathBlock = bridge.match(/const PUBLIC_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
for (const endpoint of ['/api/auth/team/status', '/api/auth/team', '/api/auth/team/verify']) {
  assert(
    publicPathBlock.includes(`'${endpoint}'`),
    `Bridge must let ${endpoint} reach its own passcode/session validator without requiring PBK_BRIDGE_API_KEY.`
  );
}

assert(
  /function authorizeDirectTeamBridgeRequest/.test(bridge) &&
    /team_permission_denied/.test(bridge) &&
    /canDeleteLeads/.test(bridge) &&
    /canDeleteData/.test(bridge) &&
    /canSendContracts/.test(bridge) &&
    /canToggleKillSwitch/.test(bridge) &&
    /canChangeGuardrails/.test(bridge) &&
    /canManageSkills/.test(bridge),
  'Direct Render fallback must enforce the same team permission boundary as the Netlify bridge proxy.'
);
assert(
  /confirmedLeadDelete[\s\S]*permissions\.canDeleteLeads !== true[\s\S]*delete confirmed leads/.test(bridge) &&
    /normalizedMethod === ['"]DELETE['"] && !confirmedLeadDelete && permissions\.canDeleteData !== true/.test(bridge),
  'Direct Render fallback must allow confirmed lead deletes through canDeleteLeads without opening broad DELETE access.'
);
assert(
  /skillGovernanceRoute[\s\S]*\/api\\\/skills\\\/[\s\S]*permissions\.canManageSkills !== true/.test(bridge),
  'Direct Render team sessions must not approve, activate, roll back, import, reload, or write governed skills unless skill management is explicitly enabled.'
);

assert(
  /request\.pbkDirectTeamAuth = true/.test(bridge) && /X-PBK-Team-Token/.test(source),
  'Direct Render fallback must use a signed PBK team token instead of exposing PBK_BRIDGE_API_KEY.'
);

assert(
  /PBK_HOSTED_BRIDGE_URL/.test(mobileProof) &&
    /const authBases = uniqueUrls\(\[baseUrl, hostedBridgeUrl\]\)/.test(mobileProof) &&
    /auth via \$\{authHost\}/.test(mobileProof),
  'Mobile protected-page proof must fall back to direct hosted bridge team auth when the Netlify auth proxy is transiently unavailable.'
);

assert(
  /COMMAND_CENTER_APP_PATHS[\s\S]*'\/deal'/.test(bridge) &&
    /COMMAND_CENTER_APP_PREFIXES[\s\S]*'\/deal\/'/.test(bridge) &&
    /function isCommandCenterAppPath/.test(bridge),
  'Render-hosted command-center clean links must support /deal and /deal/:id like Netlify.'
);

assert(
  /getRenderCommandCenterShellFilePath/.test(bridge) &&
    /index\.shell\.html/.test(bridge) &&
    /getRenderStaticAsset/.test(bridge) &&
    /RENDER_STATIC_ASSET_PREFIXES[\s\S]*'\/assets\/'/.test(bridge),
  'Render-hosted command-center routes must serve the built React shell and Vite assets, not the legacy index document.'
);

assert(
  /function isPublicCommandCenterAssetRequest/.test(bridge) &&
    /isPublicCommandCenterAssetRequest\(method, pathname\)/.test(bridge),
  'Render-hosted command-center documents and assets must pass the public GET/HEAD auth allowlist before bridge-token enforcement.'
);

assert(
  /pathname === '\/api\/auth\/team\/status'[\s\S]*?authRequired: Boolean\(TEAM_PASSCODE\)/.test(
    bridge
  ),
  'Team auth status must report whether the hosted passcode gate is configured and required.'
);

assert(
  /const apiKey = env\.DEV/.test(source),
  'Production Vite bundles must not embed PBK bridge API keys.'
);

console.log(
  JSON.stringify({ ok: true, result: 'runtime_bridge_hosted_proxy_smoke_ready' }, null, 2)
);
