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

assert(
  fs.existsSync(path.join(root, 'src/app/routes/AvaChat.tsx')),
  'AvaChat route file must exist.'
);
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
  'Promise.allSettled',
  'Search command history',
  'Replay',
  'getResultText',
  'role="alert"',
  'role="radiogroup"',
  'text-[16px]',
  'h-full max-h-full',
  'pbk-ava-chat-quick-strip',
  'Open Ava context',
].forEach((token) => {
  assert(avaChat.includes(token), `AvaChat.tsx must include ${token}.`);
});
assert(
  !avaChat.includes('h-[calc(100dvh-188px)]') && !avaChat.includes('md:h-[calc(100dvh-96px)]'),
  'AvaChat must use shell-owned height instead of stale viewport subtractions.'
);

assert(
  /command: 'Check OpenClaw sidecar status',[\s\S]*action: 'status'/.test(avaChat),
  'Status quick prompt must select the status action instead of leaving operator_command active.'
);
assert(
  /command: 'Take a screenshot of the current desktop',[\s\S]*action: 'screenshot'/.test(avaChat),
  'Screenshot quick prompt must select the screenshot action.'
);
assert(
  /showUiToast\(\{[\s\S]*title: result\.result[\s\S]*setSubmitting\(false\);[\s\S]*Promise\.allSettled/.test(
    avaChat
  ),
  'A successful queue response must be acknowledged before non-critical refresh work.'
);
assert(
  !avaChat.includes('Ava Chat with voice-controlled local operations.'),
  'Ava Chat must use the conversation workspace instead of the legacy marketing hero.'
);
assert(
  !avaChat.includes('Supabase-backed command record'),
  'Ava Chat must not overstate the command store durability source.'
);

assert(
  /PbkDataSource[\s\S]*endpoint="POST \/api\/local\/commands"[\s\S]*status="ships"/.test(avaChat),
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
  'dispatchApprovedLocalCommand',
].forEach((token) => {
  assert(bridge.includes(token), `openclaw-local-server.mjs must include ${token}.`);
});
assert(
  /incomingStatus === 'approved'[\s\S]*dispatchApprovedLocalCommand/.test(bridge),
  'Approved UI or Slack callbacks must dispatch sidecar-safe local commands through the shared bridge path.'
);
assert(
  /local_command_waiting_for_sidecar/.test(bridge) &&
    /status: 'approved'[\s\S]*waiting for the desktop sidecar to reconnect/.test(bridge),
  'Approved commands must stay queued when the desktop sidecar is offline.'
);
assert(
  /local_command_waiting_for_local_agent/.test(bridge) &&
    /unsupported_sidecar_action/.test(bridge),
  'Unsupported desktop actions must remain queued for the allowlisted local agent instead of executing unsafely.'
);
assert(
  /UPDATE public\.pbk_local_commands[\s\S]*status = 'dispatched'[\s\S]*status = 'approved'[\s\S]*RETURNING \*/.test(
    bridge
  ) &&
    /localCommandDispatchClaims/.test(bridge),
  'Approved sidecar commands must use a database conditional claim plus an in-process dispatch guard.'
);

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
