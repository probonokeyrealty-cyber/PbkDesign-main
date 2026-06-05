import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pkg = JSON.parse(read('package.json'));
const router = read('src/app/shell/router.tsx');
const sidebar = read('src/app/shell/Sidebar.tsx');
const layout = read('src/app/shell/ParadiseLayout.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const bridge = read('scripts/openclaw-local-server.mjs');
const netlify = read('netlify.toml');
const migrations = fs
  .readdirSync(path.join(root, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => [name, read(`supabase/migrations/${name}`)]);

assert(
  pkg.scripts?.['test:ava-chat-local-command'] ===
    'node ./scripts/ava-chat-local-command-smoke.mjs',
  'package.json must expose test:ava-chat-local-command.'
);

assert(fs.existsSync(path.join(root, 'src/app/routes/AvaChat.tsx')), 'AvaChat route file must exist.');
const avaChat = read('src/app/routes/AvaChat.tsx');

[
  'SpeechRecognition',
  'webkitSpeechRecognition',
  'queueLocalCommandRequest',
  'fetchLocalCommandsRequest',
  'fetchDesktopSidecarStatusRequest',
  'executeLocalCommandRequest',
  'requiresApproval',
  'Command history',
  'OpenClaw',
  'ClickUI',
].forEach((token) => {
  assert(avaChat.includes(token), `AvaChat.tsx must include ${token}.`);
});

assert(
  /PbkDataSource[\s\S]*endpoint="POST \/api\/local\/commands"[\s\S]*status="ships"/.test(
    avaChat
  ),
  'AvaChat must mark POST /api/local/commands as shipped.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/desktop-sidecar\/status"[\s\S]*status="ships"/.test(
    avaChat
  ),
  'AvaChat must mark GET /api/desktop-sidecar/status as shipped.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="POST \/invoke executeLocalCommand"[\s\S]*status="ships"/.test(
    avaChat
  ),
  'AvaChat must mark invoke executeLocalCommand as shipped.'
);

assert(/const AvaChat = lazy/.test(router), 'router must lazy-load AvaChat.');
assert(/path: 'ava-chat'/.test(router), 'router must expose /ava-chat.');
assert(/\/ava-chat/.test(sidebar) && /Ava Chat/.test(sidebar), 'sidebar must include Ava Chat.');
assert(/\/ava-chat/.test(layout), 'saved-route validation must allow /ava-chat.');
assert(/from = "\/ava-chat"/.test(netlify), 'Netlify must rewrite /ava-chat to the shell entry.');

[
  'type LocalCommandRecord',
  'export async function queueLocalCommandRequest',
  'export async function fetchLocalCommandsRequest',
  'export async function fetchDesktopSidecarStatusRequest',
  'export async function executeLocalCommandRequest',
  '/api/local/commands',
  '/api/desktop-sidecar/status',
  'executeLocalCommand',
].forEach((token) => {
  assert(runtimeBridge.includes(token), `runtimeBridge.ts must include ${token}.`);
});

[
  "'executeLocalCommand'",
  'async executeLocalCommand',
  'pbk_local_commands',
  '/api/local/commands',
  '/api/local/commands/pending',
  '/api/local/commands/:id/result',
  'createApproval',
  'syncLocalCommandApprovalDecision',
].forEach((token) => {
  assert(bridge.includes(token), `openclaw-local-server.mjs must include ${token}.`);
});

const commandMigration = migrations.find(([, sql]) =>
  /CREATE TABLE IF NOT EXISTS public\.pbk_local_commands/.test(sql)
);
assert(commandMigration, 'Supabase migration must create public.pbk_local_commands.');
assert(
  /ALTER TABLE public\.pbk_local_commands ENABLE ROW LEVEL SECURITY/.test(commandMigration[1]),
  'pbk_local_commands migration must enable RLS.'
);
assert(
  /CREATE INDEX IF NOT EXISTS .*pbk_local_commands.*status/.test(commandMigration[1]),
  'pbk_local_commands migration must index command status for polling.'
);

console.log('[ava-chat-local-command-smoke] ok');
