import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (filePath) => readFileSync(resolve(root, filePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const bridge = read('scripts/openclaw-local-server.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.scripts?.['test:unified-conversation-bridge'] ===
    'node ./scripts/unified-conversation-bridge-smoke.mjs',
  'package.json must expose the exact test:unified-conversation-bridge script.'
);

assert(
  /import\s+\{\s*ensureConversationSchema\s*\}\s+from\s+'\.\/conversation-schema\.mjs';/.test(
    bridge
  ),
  'Bridge must import ensureConversationSchema from conversation-schema.mjs.'
);

assert(
  /import\s+\{\s*createConversationStore\s*\}\s+from\s+'\.\/conversation-store\.mjs';/.test(bridge),
  'Bridge must import createConversationStore from conversation-store.mjs.'
);

const operationalSchemaStart = bridge.indexOf('async function ensurePbkOperationalTables(pool)');
const operationalSchemaEnd = bridge.indexOf(
  '\nasync function ensurePgSchema()',
  operationalSchemaStart
);
const operationalSchema = bridge.slice(operationalSchemaStart, operationalSchemaEnd);

assert(
  operationalSchemaStart >= 0 &&
    /await ensureConversationSchema\(pool\);/.test(operationalSchema) &&
    operationalSchema.indexOf('await ensureConversationSchema(pool);') <
      operationalSchema.indexOf('await ensureNurtureSchema(pool)'),
  'Operational schema ensure must run ensureConversationSchema after core tables and before auxiliary ensures.'
);

for (const table of [
  'conversation_threads',
  'conversation_thread_identities',
  'conversation_events',
  'communication_sender_identities',
]) {
  assert(
    new RegExp(`requiredTables\\s*=\\s*\\[[\\s\\S]*['"]${table}['"]`).test(bridge),
    `Admin schema status must require ${table}.`
  );
}

const conversationRoutesStart = bridge.indexOf(
  "if (request.method === 'GET' && pathname === '/api/conversations')"
);
const conversationRoutesEnd = bridge.indexOf(
  "if (request.method === 'GET' && pathname === '/api/campaigns/lead-sources')",
  conversationRoutesStart
);
const conversationRoutes = bridge.slice(conversationRoutesStart, conversationRoutesEnd);

assert(
  conversationRoutesStart >= 0 && conversationRoutesEnd > conversationRoutesStart,
  'Conversation route group must be placed before campaign routes.'
);

assert(
  /createConversationStore\(pool\)/.test(conversationRoutes) &&
    /store\.listThreads\(filters\)/.test(conversationRoutes),
  'GET /api/conversations must use the Postgres conversation store.'
);

assert(
  /cursor:\s*url\.searchParams\.get\('cursor'\)/.test(conversationRoutes) &&
    /search:\s*url\.searchParams\.get\('search'\)/.test(conversationRoutes) &&
    /status:\s*url\.searchParams\.get\('status'\)\s*\|\|\s*url\.searchParams\.get\('stage'\)/.test(
      conversationRoutes
    ) &&
    /channel:\s*url\.searchParams\.get\('channel'\)/.test(conversationRoutes) &&
    /unread:\s*parseConversationBooleanQuery/.test(conversationRoutes) &&
    /pinned:\s*parseConversationBooleanQuery/.test(conversationRoutes),
  'Conversation list route must map supported query filters without forwarding raw query objects.'
);

assert(
  /matchPath\(pathname,\s*'\/api\/conversations\/:threadId\/timeline'\)/.test(conversationRoutes) &&
    /request\.method === 'GET'/.test(conversationRoutes) &&
    /store\.listTimeline\(threadId,\s*\{[\s\S]*cursor:[\s\S]*limit:[\s\S]*includeHidden:/.test(
      conversationRoutes
    ),
  'GET /api/conversations/:threadId/timeline must call store.listTimeline with its contract.'
);

assert(
  /matchPath\(pathname,\s*'\/api\/conversations\/:threadId'\)/.test(conversationRoutes) &&
    /store\.getThread\(threadId\)/.test(conversationRoutes) &&
    /thread\s*\?\s*200\s*:\s*404/.test(conversationRoutes),
  'GET /api/conversations/:threadId must return a real store thread and 404 when absent.'
);

assert(
  /request\.method === 'PATCH'/.test(conversationRoutes) &&
    /buildConversationThreadPatch\(body,\s*currentThread\)/.test(conversationRoutes) &&
    /store\.patchThread\(threadId,\s*patch\)/.test(conversationRoutes),
  'PATCH /api/conversations/:threadId must translate semantic fields before patching the store.'
);

assert(
  /read:\s*'unreadCount'|patch\.unreadCount\s*=\s*0/.test(bridge) &&
    /Math\.max\(1,\s*Number\(currentThread\?\.unreadCount/.test(bridge) &&
    /patch\.archivedAt\s*=\s*value\s*\?\s*now\s*:\s*null/.test(bridge) &&
    /patch\.spamReportedAt\s*=\s*value\s*\?\s*now\s*:\s*null/.test(bridge),
  'Semantic thread patch helper must translate read, unread, archived, and spam fields strictly.'
);

assert(
  /const allowedFields = new Set\(\['read', 'unread', 'pinned', 'archived', 'assignedAgent', 'spam'\]\)/.test(
    bridge
  ) &&
    /Unknown conversation patch fields/.test(bridge) &&
    /No conversation patch fields provided/.test(bridge),
  'Conversation PATCH must reject unknown and empty semantic patches.'
);

assert(
  /matchPath\(pathname,\s*'\/api\/conversations\/:threadId\/merge'\)/.test(conversationRoutes) &&
    /request\.method === 'POST'/.test(conversationRoutes) &&
    /store\.mergeThreads\(\{[\s\S]*canonicalThreadId,[\s\S]*mergedThreadId,[\s\S]*actor,/.test(
      conversationRoutes
    ),
  'POST /api/conversations/:threadId/merge must call store.mergeThreads.'
);

assert(
  /Canonical thread ID must match the path thread ID/.test(conversationRoutes) &&
    /Canonical and merged thread IDs must be different/.test(conversationRoutes) &&
    /getConversationRequestActor\(request\)/.test(conversationRoutes),
  'Conversation merge route must validate IDs and derive a safe request actor.'
);

assert(
  /function sendConversationPostgresUnavailable\(response\)/.test(bridge) &&
    /result:\s*'postgres_unavailable'/.test(bridge) &&
    /degraded:\s*true/.test(bridge) &&
    /Unified conversations require the Postgres conversation schema\./.test(bridge),
  'All conversation routes must share the required Postgres-unavailable response.'
);

assert(
  /function decodeConversationPathId/.test(bridge) &&
    /decodeURIComponent/.test(bridge) &&
    /Invalid encoded conversation thread ID/.test(bridge),
  'Conversation path IDs must be decoded safely.'
);

assert(
  !/(?:items|threads|conversations|timeline|events)\s*:\s*\[\s*\]/.test(conversationRoutes),
  'Conversation routes must not return direct fake fallback arrays.'
);

assert(
  !/PUBLIC_(?:READ_)?PATHS[\s\S]{0,400}\/api\/conversations/.test(bridge),
  'Conversation routes must remain behind the existing bridge authentication gate.'
);

console.log('unified-conversation-bridge-smoke: ok');
