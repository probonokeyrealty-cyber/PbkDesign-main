import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = readFileSync(path.resolve(__dirname, '../netlify/functions/public-ava-chat.ts'), 'utf8');

assert(!/pbk-openclaw-bridge\.onrender\.com/.test(source), 'Public Ava Netlify function should not fall back to the cold-start Render bridge.');
assert(/getRequiredEnv/.test(source), 'Public Ava Netlify function should validate required env vars through a helper.');
assert(/MAX_REQUEST_BODY_BYTES/.test(source), 'Public Ava Netlify function should cap request body size before forwarding.');
assert(/rate_limit_unavailable/.test(source), 'Public Ava rate limit failures should fail closed with a distinct reason.');
assert(/DEFAULT_ALLOWED_ORIGINS\s*=\s*\[\]/.test(source), 'Default CORS origins should be empty unless PBK_ALLOWED_ORIGINS is set.');
assert(/export\s+default\s+async/.test(source), 'Public Ava Netlify function should use modern default export syntax.');
assert(/export\s+const\s+config/.test(source), 'Public Ava Netlify function should declare a Netlify function config.');

console.log(JSON.stringify({ ok: true, result: 'public_ava_chat_smoke_ready' }, null, 2));
