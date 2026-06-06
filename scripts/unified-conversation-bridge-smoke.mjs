import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (filePath) => readFileSync(resolve(root, filePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const bridge = read('scripts/openclaw-local-server.mjs');
const storeSource = read('scripts/conversation-store.mjs');

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
    /assignedAgent:\s*url\.searchParams\.get\('assignedAgent'\)/.test(conversationRoutes) &&
    /unread:\s*parseConversationBooleanQuery/.test(conversationRoutes) &&
    /pinned:\s*parseConversationBooleanQuery/.test(conversationRoutes),
  'Conversation list route must map supported query filters without forwarding raw query objects.'
);

assert(
  /typeof filters\.assignedAgent === 'string' && filters\.assignedAgent\.trim\(\)/.test(
    storeSource
  ) && /t\.assigned_agent = \$\{addParam\(filters\.assignedAgent\.trim\(\)\)\}/.test(storeSource),
  'Conversation store must apply an exact parameterized assigned-agent filter.'
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
    /buildConversationLeadSummary\(pool,\s*thread\)/.test(conversationRoutes) &&
    /buildConversationSenderSummary\(store,\s*thread\)/.test(conversationRoutes) &&
    /thread,[\s\S]*leadSummary,[\s\S]*senderSummary/.test(conversationRoutes) &&
    /if \(!thread\)[\s\S]*leadSummary:\s*null,[\s\S]*senderSummary:\s*null/.test(
      conversationRoutes
    ),
  'GET /api/conversations/:threadId must return real thread, lead, and sender summaries.'
);

assert(
  /function buildConversationLeadSummary\(pool,\s*thread\)/.test(bridge) &&
    /FROM public\.lead_profiles/.test(bridge) &&
    /WHERE id = \$1[\s\S]*AND workspace_id = \$2/.test(bridge) &&
    /'postgres:lead_profiles'/.test(bridge) &&
    /buildLeadFullView\(thread\.leadId\)\?\.lead/.test(bridge) &&
    /mapConversationLeadSummary\(bridgeLead,\s*'bridge_state'\)/.test(bridge),
  'Conversation detail must load lead summaries from Postgres with a real bridge-state fallback.'
);

const leadSummaryStart = bridge.indexOf(
  'async function buildConversationLeadSummary(pool, thread)'
);
const leadSummaryEnd = bridge.indexOf(
  '\nfunction incrementConversationSummaryCount',
  leadSummaryStart
);
const leadSummaryHelper = bridge.slice(leadSummaryStart, leadSummaryEnd);

assert(
  leadSummaryStart >= 0 &&
    leadSummaryEnd > leadSummaryStart &&
    [
      'id',
      'lead_name',
      'phone',
      'email',
      'address',
      'city',
      'state',
      'postal_code',
      'stage',
      'status',
      'assigned_agent',
      'engagement_score',
      'motivation_score',
      'dnc',
      'raw',
    ].every((column) => new RegExp(`\\b${column}\\b`).test(leadSummaryHelper)) &&
    !/SELECT\s+\*/i.test(leadSummaryHelper),
  'Conversation lead summary must select only the reviewed stable lead columns.'
);

assert(
  /function buildConversationSenderSummary\(store,\s*thread\)/.test(bridge) &&
    /store\.listSenderIdentities\(\{\s*workspaceId:\s*thread\.workspaceId,?\s*\}\)/.test(bridge) &&
    /source:\s*'postgres:communication_sender_identities'/.test(bridge) &&
    /byChannel/.test(bridge) &&
    /byProvider/.test(bridge) &&
    /byLifecycle/.test(bridge) &&
    /isWorkspaceDefault/.test(bridge),
  'Conversation detail must summarize real sender identities without provider secrets.'
);

const senderSummaryStart = bridge.indexOf(
  'async function buildConversationSenderSummary(store, thread)'
);
const senderSummaryEnd = bridge.indexOf(
  '\nfunction getConversationRequestActor',
  senderSummaryStart
);
const senderSummaryHelper = bridge.slice(senderSummaryStart, senderSummaryEnd);

assert(
  senderSummaryStart >= 0 &&
    senderSummaryEnd > senderSummaryStart &&
    !/providerIdentityId|normalizedAddress|metadata|token|apiKey|secret/i.test(senderSummaryHelper),
  'Conversation sender summary must expose only the approved non-secret identity fields.'
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
  /parseConversationMergeBody\(body,\s*threadId\)/.test(conversationRoutes) &&
    /getConversationRequestActor\(request\)/.test(conversationRoutes),
  'Conversation merge route must strictly validate IDs and derive a safe request actor.'
);

assert(
  /function parseConversationMergeBody\(body,\s*threadId\)/.test(bridge) &&
    /Conversation merge body must be a plain JSON object/.test(bridge) &&
    /const allowedFields = new Set\(\['canonicalThreadId', 'mergedThreadId'\]\)/.test(bridge) &&
    /Unknown conversation merge fields/.test(bridge) &&
    /canonicalThreadId is required/.test(bridge) &&
    /mergedThreadId is required/.test(bridge) &&
    /Canonical thread ID must match the path thread ID/.test(bridge) &&
    /Canonical and merged thread IDs must be different/.test(bridge),
  'Conversation merge body must require exactly canonicalThreadId and mergedThreadId.'
);

assert(
  /function sendConversationPostgresUnavailable\(response\)/.test(bridge) &&
    /result:\s*'postgres_unavailable'/.test(bridge) &&
    /degraded:\s*true/.test(bridge) &&
    /Unified conversations require the Postgres conversation schema\./.test(bridge),
  'All conversation routes must share the required Postgres-unavailable response.'
);

assert(
  /function isConversationPostgresUnavailableError\(error\)/.test(bridge) &&
    /42P01/.test(bridge) &&
    /3F000/.test(bridge) &&
    /0800\[0-6\]/.test(bridge) &&
    /57P01[\s\S]*57P02[\s\S]*57P03/.test(bridge) &&
    /ECONNREFUSED/.test(bridge) &&
    /ECONNRESET/.test(bridge) &&
    /ETIMEDOUT/.test(bridge) &&
    /ENOTFOUND/.test(bridge) &&
    /relation.*does not exist/.test(bridge) &&
    /isConversationPostgresUnavailableError\(error\)[\s\S]*sendConversationPostgresUnavailable\(response\)/.test(
      bridge
    ),
  'Conversation store errors must degrade safely for connectivity and missing-schema failures.'
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
