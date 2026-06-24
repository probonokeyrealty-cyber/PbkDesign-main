import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = readFileSync(path.resolve(__dirname, '../netlify/functions/public-ava-chat.ts'), 'utf8');
const netlifyConfig = readFileSync(path.resolve(__dirname, '../netlify.toml'), 'utf8');

assert(!/pbk-openclaw-bridge\.onrender\.com/.test(source), 'Public Ava Netlify function should not fall back to the cold-start Render bridge.');
assert(/getRequiredEnv/.test(source), 'Public Ava Netlify function should validate required env vars through a helper.');
assert(/MAX_REQUEST_BODY_BYTES/.test(source), 'Public Ava Netlify function should cap request body size before forwarding.');
assert(/rate_limit_unavailable/.test(source), 'Public Ava rate limit failures should fail closed with a distinct reason.');
assert(/DEFAULT_ALLOWED_ORIGINS\s*=\s*\[\]/.test(source), 'Default CORS origins should be empty unless PBK_ALLOWED_ORIGINS is set.');
assert(/export\s+default\s+async/.test(source), 'Public Ava Netlify function should use modern default export syntax.');
assert(/export\s+const\s+config/.test(source), 'Public Ava Netlify function should declare a Netlify function config.');

const publicAvaRedirectIndex = netlifyConfig.indexOf('from = "/api/public/ava-chat"');
const apiCatchallRedirectIndex = netlifyConfig.indexOf('from = "/api/*"');
assert(publicAvaRedirectIndex >= 0, 'Netlify must route /api/public/ava-chat to the dedicated public Ava function.');
assert(
  publicAvaRedirectIndex < apiCatchallRedirectIndex,
  'The /api/public/ava-chat redirect must appear before the forced /api/* bridge proxy redirect.',
);
assert(
  /from = "\/api\/public\/ava-chat"[\s\S]*to = "\/\.netlify\/functions\/public-ava-chat"/.test(netlifyConfig),
  'The public Ava route must call the public-ava-chat Netlify function, not the protected bridge proxy.',
);

console.log(JSON.stringify({ ok: true, result: 'public_ava_chat_smoke_ready' }, null, 2));
