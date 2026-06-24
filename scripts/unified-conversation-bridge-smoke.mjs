import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (filePath) => readFileSync(resolve(root, filePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const bridge = read('scripts/openclaw-local-server.mjs');
const storeSource = read('scripts/conversation-store.mjs');
const identitySource = read('scripts/conversation-identity.mjs');
const liveProjectorSource = read('scripts/conversation-live-projector.mjs');
const providerDispatchSource = read('scripts/provider-action-dispatch.mjs');
const providerDispatchPolicySource = read(
  'scripts/provider-action-dispatch-policy.mjs'
);
const providerDispatchMigration = read(
  'supabase/migrations/20260606194638_pbk_provider_action_dispatch_leases.sql'
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.scripts?.['test:unified-conversation-bridge'] ===
    'node ./scripts/unified-conversation-bridge-smoke.mjs',
  'package.json must expose the exact test:unified-conversation-bridge script.'
);

assert(
  packageJson.scripts?.['test:provider-action-dispatch']?.includes(
    'provider-action-dispatch.test.mjs'
  ) &&
    packageJson.scripts?.['test:founder']?.includes(
      'test:provider-action-dispatch'
    ),
  'Provider action dispatch behavior tests must remain in the founder verification gate.'
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
  'provider_action_dispatches',
]) {
  assert(
    new RegExp(`requiredTables\\s*=\\s*\\[[\\s\\S]*['"]${table}['"]`).test(bridge),
    `Admin schema status must require ${table}.`
  );
}

const conversationRoutesStart = bridge.indexOf(
  "if (request.method === 'POST' && pathname === '/api/conversations/resolve')"
);
const conversationRoutesEnd = bridge.indexOf(
  "if (request.method === 'GET' && pathname === '/api/campaigns/lead-sources')",
  conversationRoutesStart
);
const conversationRoutes = bridge.slice(conversationRoutesStart, conversationRoutesEnd);
const providerApprovalStart = bridge.indexOf(
  "if (approval.status === 'approved' && String(approval.type || '').toLowerCase() === 'provider-action')"
);
const providerApprovalEnd = bridge.indexOf(
  '\n    if (retryConversationProjectionOnly)',
  providerApprovalStart
);
const providerApprovalSource = bridge.slice(
  providerApprovalStart,
  providerApprovalEnd
);
const providerLeaseStart = providerDispatchSource.indexOf(
  'async function executeProviderActionWithSharedLease'
);
const providerLeaseEnd = providerDispatchSource.length;
const providerLeaseSource = providerDispatchSource.slice(
  providerLeaseStart
);
const telnyxWebhookMapStart = bridge.indexOf('function mapTelnyxWebhook(body = {})');
const telnyxWebhookMapEnd = bridge.indexOf(
  '\nfunction mapDocuSignWebhook(body = {})',
  telnyxWebhookMapStart
);
const telnyxWebhookMap = bridge.slice(telnyxWebhookMapStart, telnyxWebhookMapEnd);
const callStatusHandlerStart = bridge.indexOf(
  "if (normalizedEvent === 'call-status')"
);
const callStatusHandlerEnd = bridge.indexOf(
  "\n  if (normalizedEvent === 'call-transcript')",
  callStatusHandlerStart
);
const callStatusHandler = bridge.slice(
  callStatusHandlerStart,
  callStatusHandlerEnd
);
const recordingRouteStart = bridge.indexOf(
  "if (request.method === 'POST' && pathname === '/api/recordings')"
);
const recordingRouteEnd = bridge.indexOf(
  "\n    if (request.method === 'GET' && pathname === '/api/contracts')",
  recordingRouteStart
);
const recordingRoute = bridge.slice(recordingRouteStart, recordingRouteEnd);
const docusignWebhookMapStart = telnyxWebhookMapEnd;
const docusignWebhookMapEnd = bridge.indexOf(
  '\nfunction normalizeDeepgramLiveSentiment',
  docusignWebhookMapStart
);
const docusignWebhookMap = bridge.slice(
  docusignWebhookMapStart,
  docusignWebhookMapEnd
);

assert(
  conversationRoutesStart >= 0 && conversationRoutesEnd > conversationRoutesStart,
  'Conversation route group must be placed before campaign routes.'
);

assert(
  /createConversationStore\(pool\)/.test(conversationRoutes) &&
    /workspaceId:\s*CONVERSATION_WORKSPACE_ID/.test(conversationRoutes) &&
    /store\.listThreads\(filters\)/.test(conversationRoutes),
  'GET /api/conversations must use the Postgres conversation store.'
);
assert(
  /request\.method === 'POST' && pathname === '\/api\/conversations\/resolve'/.test(
    conversationRoutes
  ) &&
    /parseConversationResolveBody\(await readBody\(request\)\)/.test(conversationRoutes) &&
    /loadConversationLeadForResolve\(pool, leadId\)/.test(conversationRoutes) &&
    /store\.resolveThread\(\{[\s\S]*leadId:\s*lead\.id[\s\S]*phone:\s*lead\.phone[\s\S]*email:\s*lead\.email/.test(
      conversationRoutes
    ) &&
    /source:\s*'unified-inbox-compose'/.test(conversationRoutes),
  'POST /api/conversations/resolve must open the canonical persisted seller thread.'
);
assert(
  /function parseConversationResolveBody\(body\)/.test(bridge) &&
    /rejectUnknownConversationFields\(body, new Set\(\['leadId'\]\), 'conversation resolve'\)/.test(
      bridge
    ) &&
    /leadId is required and must be a nonempty string/.test(bridge),
  'Conversation resolve must validate its narrow leadId-only request contract.'
);

assert(
  /cursor:\s*url\.searchParams\.get\('cursor'\)/.test(conversationRoutes) &&
    /search:\s*url\.searchParams\.get\('search'\)/.test(conversationRoutes) &&
    /status:\s*url\.searchParams\.get\('status'\)\s*\|\|\s*url\.searchParams\.get\('stage'\)/.test(
      conversationRoutes
    ) &&
    /channel:\s*url\.searchParams\.get\('channel'\)/.test(conversationRoutes) &&
    /activity:\s*url\.searchParams\.get\('activity'\)/.test(conversationRoutes) &&
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
  /filters\.activity === 'live'/.test(storeSource) &&
    /FROM public\.conversation_events AS live_event/.test(storeSource) &&
    /filters\.activity === 'approvals'/.test(storeSource) &&
    /FROM public\.conversation_events AS approval_event/.test(storeSource),
  'Conversation store must apply live and approval activity filters before pagination.'
);

assert(
  /matchPath\(pathname,\s*'\/api\/conversations\/:threadId\/timeline'\)/.test(conversationRoutes) &&
    /request\.method === 'GET'/.test(conversationRoutes) &&
    /store\.getThread\(threadId,\s*\{\s*workspaceId:\s*CONVERSATION_WORKSPACE_ID,?\s*\}\)/.test(
      conversationRoutes
    ) &&
    /if \(!thread\)[\s\S]*Conversation thread not found/.test(conversationRoutes) &&
    /store\.listTimeline\(threadId,\s*\{[\s\S]*workspaceId:\s*CONVERSATION_WORKSPACE_ID[\s\S]*cursor:[\s\S]*limit:[\s\S]*includeHidden:/.test(
      conversationRoutes
    ),
  'GET /api/conversations/:threadId/timeline must guard canonical existence and pass workspace.'
);
assert(
  /store\.getThreadContactIdentities\(thread\.id/.test(conversationRoutes) &&
    /recipientSummary/.test(conversationRoutes),
  'Conversation detail must expose canonical phone/email context for the sender-aware composer.'
);

assert(
  /matchPath\(pathname,\s*'\/api\/conversations\/:threadId'\)/.test(conversationRoutes) &&
    /store\.getThread\(threadId,\s*\{\s*workspaceId:\s*CONVERSATION_WORKSPACE_ID,?\s*\}\)/.test(
      conversationRoutes
    ) &&
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
assert(
  /SELECT l\.id,[\s\S]*l\.stage,[\s\S]*FROM public\.lead_profiles l/.test(bridge) &&
    /FROM public\.lead_profiles l[\s\S]*l\.workspace_id = 'pbk'/.test(bridge) &&
    /source:\s*'supabase-lead-profiles'/.test(bridge) &&
    /Stage: \$\{lead\.stage \|\| 'unknown'\}/.test(bridge),
  'Inbound Ava calls must read canonical lead_profiles and keep workflow stage distinct from status.'
);
assert(
  /normalizeConversationPhone/.test(bridge) &&
    /async function findInboundConversationThreadContext/.test(bridge) &&
    /FROM public\.conversation_thread_identities AS identity[\s\S]*identity\.identity_type = 'phone'/.test(
      bridge
    ),
  'Inbound Ava calls must reuse canonical unified-conversation phone identities before creating a new seller.'
);
assert(
  /async function ensureInboundLeadProfileContext/.test(bridge) &&
    /persistLeadProfileRowToDb\(profile,\s*'inbound-call'\)/.test(bridge) &&
    /persistence\.leadId !== \(profile\.leadId \|\| profile\.id\)/.test(bridge) &&
    /patchLeadImport\(state,\s*lookup,\s*profile\)/.test(bridge) &&
    !/if \(!lead\.found && parsed\.from\)[\s\S]{0,500}addLeadImport\(state/.test(bridge),
  'Inbound Ava calls must durably upsert the lead profile, honor the resolved durable id, and not blindly append placeholder sellers.'
);
assert(
  /existingIsInboundPlaceholder/.test(bridge) &&
    /incomingIsInboundPlaceholder/.test(bridge) &&
    /regexp_replace\(COALESCE\(phone/.test(bridge),
  'Lead profile persistence must merge same-phone inbound placeholders into the canonical durable seller profile.'
);
assert(
  /async function reconcileInboundLeadProfiles/.test(bridge) &&
    /ensureInboundLeadProfileContext\(/.test(bridge) &&
    /scheduleRuntimeStateBroadcast\('inbound-lead-reconcile'\)/.test(bridge) &&
    /\/api\/admin\/reconcile-inbound-leads/.test(bridge),
  'Admin reconciliation must repair existing inbound call lead profiles and broadcast the refreshed runtime state.'
);
assert(
  /const persistence = await persistLeadProfileRowToDb\(nextLead, 'instantly-reply'\)/.test(
    bridge
  ) &&
    /!persistence\.ok && STATE_BACKEND === 'postgres'/.test(bridge) &&
    /instantly_lead_persistence_failed/.test(bridge),
  'Instantly replies must fail retryably before downstream side effects when canonical lead persistence fails in production.'
);
assert(
  /async function unifiedMessageAlreadyPersisted/.test(bridge) &&
    /FROM public\.unified_messages/.test(bridge) &&
    /result:\s*'instantly_reply_already_processed'/.test(bridge),
  'Instantly reply replays must be deduplicated against durable unified message ids.'
);

const leadSummaryStart = bridge.indexOf('function mapConversationLeadSummary(row, source)');
const leadSummaryEnd = bridge.indexOf(
  '\nasync function buildConversationSenderSummary',
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
    ].every((column) => new RegExp(`\\b${column}\\b`).test(leadSummaryHelper)) &&
    !/SELECT\s+\*|\braw\b/i.test(leadSummaryHelper),
  'Conversation lead summary must select only safe stable lead columns and exclude raw.'
);

assert(
  /function buildConversationSenderSummary\(store,\s*thread\)/.test(bridge) &&
    /store\.getSenderIdentitySummary\(\{\s*workspaceId:\s*thread\.workspaceId,?\s*\}\)/.test(
      bridge
    ) &&
    /source:\s*'postgres:communication_sender_identities'/.test(bridge) &&
    /itemsTruncated:\s*false/.test(storeSource),
  'Conversation detail must use the exact untruncated sender identity summary contract.'
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
    /store\.markThreadRead\(threadId,\s*\{\s*workspaceId:\s*CONVERSATION_WORKSPACE_ID,?\s*\}\)/.test(
      conversationRoutes
    ) &&
    /delete patch\.unreadCount/.test(conversationRoutes) &&
    /store\.patchThread\(threadId,\s*patch,\s*\{\s*workspaceId:\s*CONVERSATION_WORKSPACE_ID,?\s*\}\)/.test(
      conversationRoutes
    ),
  'PATCH /api/conversations/:threadId must persist read state on events before applying remaining thread fields.'
);

assert(
  /read:\s*'unreadCount'|patch\.unreadCount\s*=\s*0/.test(bridge) &&
    /Math\.max\(1,\s*Number\(currentThread\?\.unreadCount/.test(bridge) &&
    /UPDATE public\.conversation_events[\s\S]*direction = 'inbound'[\s\S]*read_at IS NULL[\s\S]*hidden_at IS NULL/.test(
      storeSource
    ) &&
    /recomputeThreadAggregates\(client,\s*\[id\],\s*workspace\)/.test(storeSource) &&
    /patch\.archivedAt\s*=\s*value\s*\?\s*now\s*:\s*null/.test(bridge) &&
    /patch\.spamReportedAt\s*=\s*value\s*\?\s*now\s*:\s*null/.test(bridge),
  'Semantic thread patching must update event-level read state and translate unread, archived, and spam fields strictly.'
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
    /store\.mergeThreads\(\{[\s\S]*workspaceId:\s*CONVERSATION_WORKSPACE_ID,[\s\S]*canonicalThreadId,[\s\S]*mergedThreadId,[\s\S]*actor,/.test(
      conversationRoutes
    ),
  'POST /api/conversations/:threadId/merge must call store.mergeThreads with workspace.'
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
  /\['22007', '22P02'\]\.includes\(String\(error\?\.code/.test(bridge) &&
    /Invalid conversation request syntax/.test(bridge),
  'Known Postgres input syntax errors must return a sanitized 400.'
);

assert(
  /function conversationCursorError/.test(storeSource) &&
    /statusCode:\s*400/.test(storeSource) &&
    /UUID/.test(storeSource) &&
    /Date\.parse/.test(storeSource) &&
    /includeHidden must be a boolean/.test(storeSource),
  'Conversation cursors must validate UUIDs, timestamps, and visibility before querying Postgres.'
);

assert(
  /async function getThread\(threadId,\s*options = \{ workspaceId: 'pbk' \}\)/.test(storeSource) &&
    /WHERE id = \$1[\s\S]*workspace_id = \$2[\s\S]*merged_into_thread_id IS NULL/.test(
      storeSource
    ) &&
    /async function listTimeline\(threadId,\s*options = \{\}\)/.test(storeSource) &&
    /JOIN public\.conversation_threads AS thread/.test(storeSource) &&
    /thread\.workspace_id = \$2/.test(storeSource) &&
    /async function patchThread\(\s*threadId,\s*patch = \{\},\s*options = \{ workspaceId: 'pbk' \}\s*\)/.test(
      storeSource
    ) &&
    /async function mergeThreads\(\{\s*workspaceId:[\s\S]*canonicalThreadId/.test(storeSource),
  'Direct conversation store operations must be workspace scoped.'
);

assert(
  /async function getSenderIdentitySummary\(\{ workspaceId:[\s\S]*\} = \{\}\)/.test(storeSource) &&
    /COUNT\(\*\)::integer/.test(storeSource) &&
    /GROUP BY channel/.test(storeSource) &&
    /GROUP BY provider/.test(storeSource) &&
    /GROUP BY lifecycle_status/.test(storeSource) &&
    /WHERE workspace_id = \$1[\s\S]*lifecycle_status = 'active'[\s\S]*is_workspace_default = TRUE/.test(
      storeSource
    ),
  'Sender identity summary must use exact aggregate SQL and an unbounded safe item query.'
);

assert(
  /normalizeTelnyxSenderIdentity/.test(identitySource) &&
    /normalizeInstantlySenderIdentity/.test(identitySource) &&
    /normalizeTelnyxSenderIdentity,\s*normalizeInstantlySenderIdentity/.test(bridge),
  'Bridge must import the provider sender identity normalizers.'
);

const instantlyAdapterStart = bridge.indexOf(
  'function normalizeInstantlySenderRecord(record = {})'
);
const instantlyAdapterEnd = bridge.indexOf(
  '\nasync function getInstantlySenderOptions()',
  instantlyAdapterStart
);
const instantlyAdapter = bridge.slice(instantlyAdapterStart, instantlyAdapterEnd);
assert(
  instantlyAdapterStart >= 0 &&
    instantlyAdapterEnd > instantlyAdapterStart &&
    /status:\s*record\.status\s*\?\?\s*''/.test(instantlyAdapter) &&
    /warmupStatus/.test(instantlyAdapter) &&
    /warmup_status/.test(instantlyAdapter) &&
    /setupPending/.test(instantlyAdapter) &&
    /setup_pending/.test(instantlyAdapter) &&
    !/status:\s*record\.status\s*\|\|\s*record\.warmup_status/.test(instantlyAdapter),
  'Instantly adapter must preserve status and warmup status as independent normalizer inputs.'
);

const identityRoutesStart = bridge.indexOf(
  "if (request.method === 'GET' && pathname === '/api/communication-identities')"
);
const identityRoutesEnd = bridge.indexOf(
  "if (request.method === 'GET' && pathname === '/api/conversations')",
  identityRoutesStart
);
const identityRoutes = bridge.slice(identityRoutesStart, identityRoutesEnd);

assert(
  identityRoutesStart >= 0 && identityRoutesEnd > identityRoutesStart,
  'Communication identity routes must be grouped before conversation routes.'
);

assert(
  /getPgPool\(\)/.test(identityRoutes) &&
    /sendConversationPostgresUnavailable\(response\)/.test(identityRoutes) &&
    /store\.getSenderIdentitySummary\(\{\s*workspaceId:\s*CONVERSATION_WORKSPACE_ID/.test(
      identityRoutes
    ) &&
    /store\.listSenderIdentities\(\{[\s\S]*workspaceId:\s*CONVERSATION_WORKSPACE_ID[\s\S]*channel:[\s\S]*provider:[\s\S]*lifecycleStatus:/.test(
      identityRoutes
    ),
  'GET /api/communication-identities must be degraded-safe, workspace scoped, and filter through the store.'
);

assert(
  /pathname === '\/api\/communication-identities\/sync'/.test(identityRoutes) &&
    /Promise\.allSettled\(\[\s*getTelnyxNumberOptions\(\),\s*getInstantlySenderOptions\(\)/.test(
      identityRoutes
    ) &&
    /normalizeTelnyxSenderIdentity/.test(identityRoutes) &&
    /normalizeInstantlySenderIdentity/.test(identityRoutes) &&
    /store\.syncSenderIdentity/.test(identityRoutes) &&
    /if \(providerResult\.ok !== true\)[\s\S]*valid:\s*0,[\s\S]*synced:\s*0,[\s\S]*continue;/.test(
      identityRoutes
    ) &&
    /providers:\s*providerSync/.test(identityRoutes),
  'Sender identity sync must isolate provider failures, reject fallback mutation, and persist live inventory only.'
);

assert(
  /function parseCommunicationIdentityPatchBody/.test(bridge) &&
    /new Set\(\['active', 'paused', 'quarantined', 'retired'\]\)/.test(bridge) &&
    /const allowedFields = new Set\(\['lifecycleStatus', 'reason'\]\)/.test(bridge) &&
    /Unknown communication identity patch fields/.test(bridge) &&
    /decodeCommunicationIdentityPathId/.test(identityRoutes) &&
    /store\.getSenderIdentity\(identityId,\s*\{\s*workspaceId:\s*CONVERSATION_WORKSPACE_ID/.test(
      identityRoutes
    ) &&
    /store\.patchSenderIdentity\(identityId,\s*patch,\s*\{\s*workspaceId:\s*CONVERSATION_WORKSPACE_ID/.test(
      identityRoutes
    ) &&
    /operatorManaged:\s*true/.test(bridge) &&
    /lifecycleSource:\s*'operator'/.test(bridge) &&
    /inboundGraceUntil/.test(identityRoutes) &&
    /retiredAt/.test(identityRoutes),
  'Lifecycle PATCH must decode paths, validate the exact body, preserve the row, and scope reads/writes.'
);

const identityPatchStart = identityRoutes.indexOf(
  "if (communicationIdentityMatch && request.method === 'PATCH')"
);
const identityPatchEnd = identityRoutes.indexOf(
  "if (communicationIdentityReleaseRequestMatch && request.method === 'POST')",
  identityPatchStart
);
const identityPatchRoute = identityRoutes.slice(identityPatchStart, identityPatchEnd);
assert(
  identityPatchStart >= 0 &&
    identityPatchEnd > identityPatchStart &&
    !/delete|releaseTelnyx|updateTelnyxPhoneNumber|fireTelnyxRequest|fireInstantlyRequest/i.test(
      identityPatchRoute
    ),
  'Lifecycle PATCH must never invoke provider release or delete operations.'
);

assert(
  /parseCommunicationIdentityReleaseRequestBody/.test(bridge) &&
    /const approvalId = randomUUID\(\)/.test(identityRoutes) &&
    /store\.reserveSenderIdentityRelease/.test(identityRoutes) &&
    /if \(!reservation\.reserved\)/.test(identityRoutes) &&
    /store\.cancelSenderIdentityReleaseReservation/.test(identityRoutes) &&
    /createApproval\(\{\s*id:\s*approvalId/.test(identityRoutes) &&
    /type:\s*'provider_identity_release'/.test(identityRoutes) &&
    /approvalAction:\s*'release_communication_identity'/.test(identityRoutes) &&
    /payload:\s*\{\s*identityId,\s*provider:\s*identity\.provider,\s*address:\s*identity\.address/.test(
      identityRoutes
    ) &&
    /existingApprovalId/.test(identityRoutes),
  'Release requests must reserve one approval ID, replay idempotently, and roll back failed approval creation.'
);

assert(
  /parseCommunicationIdentityReleaseBody/.test(bridge) &&
    /const allowedFields = new Set\(\['approvalId'\]\)/.test(bridge) &&
    /approval\.status[\s\S]*approved/.test(identityRoutes) &&
    /approval\.type[\s\S]*provider_identity_release/.test(identityRoutes) &&
    /approval\.approvalAction[\s\S]*release_communication_identity/.test(identityRoutes) &&
    /approval\.payload\?\.identityId[\s\S]*identityId/.test(identityRoutes) &&
    /approval\.payload\?\.provider[\s\S]*identity\.provider/.test(identityRoutes) &&
    /approval\.payload\?\.address[\s\S]*identity\.address/.test(identityRoutes) &&
    /identity\.metadata\?\.releaseApprovalId\s*===\s*approvalId/.test(identityRoutes) &&
    /json\(response,\s*501,\s*\{\s*ok:\s*false,\s*result:\s*'provider_release_not_configured',?\s*\}\)/.test(
      identityRoutes
    ),
  'Internal release must verify the exact approved payload and return 501 without faking provider success.'
);

assert(
  /async function getSenderIdentity\(identityId,\s*options = \{ workspaceId: 'pbk' \}\)/.test(
    storeSource
  ) &&
    /function chooseSyncedLifecycle\(existing,\s*incoming\)/.test(storeSource) &&
    /async function syncSenderIdentity\(identity = \{\}\)/.test(storeSource) &&
    /async function reserveSenderIdentityRelease/.test(storeSource) &&
    /async function cancelSenderIdentityReleaseReservation/.test(storeSource) &&
    /async function patchSenderIdentity\(\s*identityId,\s*patch = \{\},\s*options = \{ workspaceId: 'pbk' \}\s*\)/.test(
      storeSource
    ) &&
    /WHERE id = \$1[\s\S]*workspace_id = \$2/.test(storeSource),
  'Sender identity get/patch/sync store operations must preserve lifecycle and workspace scope.'
);

const senderListStart = storeSource.indexOf('async function listSenderIdentities(filters = {})');
const senderListEnd = storeSource.indexOf('\n  async function getSenderIdentity(', senderListStart);
const senderListSource = storeSource.slice(senderListStart, senderListEnd);
const senderListProjection =
  senderListSource.match(/SELECT([\s\S]*?)FROM public\.communication_sender_identities/)?.[1] || '';
assert(
  senderListStart >= 0 &&
    senderListEnd > senderListStart &&
    senderListProjection &&
    !/\*/.test(senderListProjection) &&
    !/provider_identity_id|normalized_address|metadata/.test(senderListProjection),
  'Communication identity lists must project only approved safe fields.'
);

assert(
  !/(?:PUBLIC_(?:READ_)?PATHS|isPublicBridgeRequest)[\s\S]{0,400}\/api\/communication-identities/.test(
    bridge
  ),
  'Communication identity routes must remain behind the existing bridge authentication gate.'
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

for (const route of [
  '/api/conversations/:threadId/sender-recommendation',
  '/api/conversations/:threadId/messages',
  '/api/conversations/messages/run-due',
  '/api/conversations/:threadId/refine-draft',
  '/api/conversation-events/:eventId',
  '/api/conversation-events/:eventId/restore',
  '/api/conversation-events/:eventId/report-spam',
]) {
  assert(
    bridge.includes(route),
    `Bridge must expose the authenticated unified conversation route ${route}.`
  );
}

assert(
    /rankEligibleSenderIdentities/.test(bridge) &&
    /getPreviousSuccessfulSenderIdentityId/.test(bridge) &&
    /leadRegion/.test(bridge) &&
    /recommended,[\s\S]*alternatives:\s*publicRanked\.slice\(1\),[\s\S]*reasonCodes:/.test(bridge),
  'Sender recommendations must rank safe eligible identities using continuity and lead region.'
);

assert(
  /executeManualProviderRouteWithOutbox\(\{[\s\S]*toolName:\s*parsed\.channel === 'sms' \? 'telnyx_sms' : 'sendColdEmail'/.test(conversationRoutes) &&
    /from:\s*senderIdentity\.address/.test(conversationRoutes) &&
    /fromNumber:\s*senderIdentity\.address/.test(conversationRoutes) &&
    /fromEmail:\s*senderIdentity\.address/.test(conversationRoutes) &&
    /senderEmail:\s*senderIdentity\.address/.test(conversationRoutes) &&
    /outbox:\s*send\.outbox/.test(conversationRoutes) &&
    /idempotencyKey:\s*send\.idempotencyKey/.test(conversationRoutes),
  'Conversation sends must reuse provider tools through the outbox wrapper and propagate the explicitly selected sender.'
);
assert(
  /result:\s*classification\.result,[\s\S]*approval:\s*providerResult\?\.approval \|\| null,[\s\S]*providerResult/.test(
    conversationRoutes
  ),
  'Conversation send responses must expose approval metadata at the top level during rolling deploys.'
);

assert(
  /new Set\(\[[\s\S]*'requestedBy'[\s\S]*\]\)/.test(bridge) &&
    /new Set\(\[[\s\S]*'source'[\s\S]*'manual'[\s\S]*'manualSend'[\s\S]*\]\)/.test(
      bridge
    ) &&
    !/new Set\(\[[\s\S]{0,300}'approvalId'[\s\S]{0,300}\]\),\s*'conversation send'/.test(
      bridge
    ) &&
    !/approvalId:\s*String\(body\.approvalId/.test(bridge) &&
    !/approvalId:\s*parsed\.approvalId/.test(conversationRoutes) &&
    /manualSend = body\.manual === true \|\| body\.manualSend === true/.test(bridge) &&
    /source = String\(body\.source \|\| \(manualSend \? 'manual' : ''\)\)/.test(
      bridge
    ) &&
    /manual:\s*manualSend/.test(bridge),
  'Public conversation sends must not accept or forward an arbitrary approvalId.'
);

assert(
  /requestedBy:\s*parsed\.requestedBy \|\| actor/.test(conversationRoutes) &&
    /source:\s*parsed\.source \|\| \(parsed\.manualSend \? 'unified_conversation_manual' : 'unified_conversation'\)/.test(
      conversationRoutes
    ) &&
    /manual:\s*parsed\.manual/.test(conversationRoutes) &&
    /manualSend:\s*parsed\.manualSend/.test(conversationRoutes),
  'Manual conversation sends must pass explicit source/manual metadata into provider execution.'
);

assert(
  /function isTrustedManualConversationProviderSend\(toolName = '', params = \{\}\)/.test(
    bridge
  ) &&
    /\['telnyx_sms', 'sendColdEmail', 'telnyx_call', 'sendSellerDocs'\]\.includes\(toolName\)/.test(bridge) &&
    /params\.manual !== true \|\| params\.manualSend !== true/.test(bridge) &&
    /'unified_inbox_manual'/.test(bridge) &&
    /'unified_conversation_manual'/.test(bridge) &&
    /'seller_docs_manual'/.test(bridge) &&
    /isTrustedManualConversationProviderSend\(toolName, params\)[\s\S]*!forceApproval[\s\S]*!safetyReviewRequired[\s\S]*return null/.test(
      bridge
    ),
  'Only trusted manual SMS/email/call/seller-doc operator actions may bypass operating-mode approval after safety validation.'
);

assert(
  /function buildConversationSendEventPayload\(\{[\s\S]*source,[\s\S]*manual,[\s\S]*manualSend,[\s\S]*requestedBy/.test(
    bridge
  ) &&
    /source:\s*source \|\| result\?\.source \|\| ''/.test(bridge) &&
    /manual:\s*manual === true \|\| result\?\.manual === true/.test(bridge) &&
    /manualSend:\s*manualSend === true \|\| result\?\.manualSend === true/.test(bridge) &&
    /requestedBy:\s*requestedBy \|\| result\?\.requestedBy \|\| ''/.test(bridge),
  'Conversation timeline events must preserve manual send source metadata.'
);

assert(
  /evaluateConversationSenderRecommendationCompliance\(\{[\s\S]*channel,[\s\S]*dncBlocked:\s*dnc\.blocked,[\s\S]*consentStatus:\s*getConversationConsentStatus/.test(
    conversationRoutes
  ) &&
    /if \(!compliance\.allowed\)/.test(conversationRoutes) &&
    /reasonCodes:\s*compliance\.reasonCodes/.test(conversationRoutes) &&
    /\.\.\.\(compliance\.reasonCodes \|\| \[\]\)/.test(conversationRoutes) &&
    /recommended:\s*null,[\s\S]*alternatives:\s*\[\]/.test(conversationRoutes),
  'Sender recommendations must hard-block DNC or denied consent while carrying approval reasons for reviewable consent.'
);

assert(
  /const sendCompliance = evaluateConversationSenderRecommendationCompliance\(\{[\s\S]*channel:\s*parsed\.channel[\s\S]*consentStatus/.test(
    conversationRoutes
  ) &&
    /const manualOneToOneSend = parsed\.manual === true && parsed\.manualSend === true/.test(
      conversationRoutes
    ) &&
    /const reviewableSmsConsent = \(sendCompliance\.reasonCodes \|\| \[\]\)\.includes\('approval_required'\)/.test(
      conversationRoutes
    ) &&
    /if \(!sendCompliance\.allowed\)/.test(conversationRoutes) &&
    /result:\s*'sms_consent_blocked'/.test(conversationRoutes) &&
    /status:\s*'blocked'/.test(conversationRoutes) &&
    /parsed\.channel === 'sms'[\s\S]*reviewableSmsConsent[\s\S]*!manualOneToOneSend[\s\S]*forceApproval:\s*true/.test(
      conversationRoutes
    ),
  'Conversation sends must hard-block denied consent, but manual one-to-one SMS may bypass reviewable-consent approval.'
);

assert(
  /persistUnifiedMessageRecord\(message\)/.test(conversationRoutes) &&
    /senderIdentityId/.test(conversationRoutes) &&
    /scheduledFor/.test(conversationRoutes) &&
    /runDueConversationMessages\(parsed\)/.test(conversationRoutes) &&
    /claimDueScheduledMessages/.test(bridge) &&
    /beginScheduledMessageDispatch/.test(bridge) &&
    /completeScheduledMessage/.test(bridge) &&
    /reconcileStaleDispatchingMessages/.test(bridge) &&
    /FOR UPDATE SKIP LOCKED/.test(storeSource) &&
    /schedulerClaimExpiresAt/.test(storeSource) &&
    /schedulerDispatchStartedAt/.test(storeSource) &&
    /delivery_unknown/.test(storeSource) &&
    /reconciliation_required/.test(bridge) &&
    /senderIdentityId:\s*scheduledMessage\.senderIdentityId/.test(
      bridge
    ) &&
    /projectConversationSendOutcome\(store/.test(conversationRoutes) &&
    /store\.upsertEvent/.test(bridge),
  'Scheduled messages must be claimed idempotently, retain their selected sender, execute, and project outcomes.'
);

assert(
  /conversationSendBinding/.test(bridge) &&
    /conversationEventId/.test(bridge) &&
    /validateConversationApprovalBinding/.test(bridge) &&
    /updateEventOutcome/.test(bridge) &&
    /approval_projection_failed/.test(bridge) &&
    /providerActionAttemptedAt/.test(bridge) &&
    /providerActionClassification/.test(bridge) &&
    /conversationProjection\?\.projectedAt/.test(bridge) &&
    /retryUnavailableProviderLease/.test(bridge) &&
    /providerActionDispatch\?\.status === 'lease_unavailable'/.test(bridge) &&
    /delete approval\.metadata\.providerActionClassification/.test(
      providerApprovalSource
    ) &&
    /delete approval\.metadata\.conversationProjection/.test(
      providerApprovalSource
    ) &&
    /if\s*\(!alreadyAttempted\)/.test(bridge) &&
    /retryConversationProjectionOnly/.test(bridge) &&
    /providerActionResult[\s\S]*!approval\.metadata\.conversationProjection\?\.projectedAt/.test(
      bridge
    ) &&
    providerApprovalStart >= 0 &&
    providerApprovalEnd > providerApprovalStart &&
    (providerApprovalSource.match(/executeToolHandlerWithQa\(/g) || []).length === 1 &&
    providerApprovalSource.indexOf('if (!alreadyAttempted)') <
      providerApprovalSource.indexOf('executeToolHandlerWithQa(') &&
    /status:\s*classification\.status/.test(providerApprovalSource) &&
    /if\s*\(!projectedEvent\)/.test(providerApprovalSource) &&
    /projectedAt:\s*isoNow\(\)/.test(providerApprovalSource),
  'Approval replay must execute the provider once and retry only the original event projection until projected.'
);

const providerDispatchMarkerIndex = providerApprovalSource.indexOf(
  "status: 'dispatching'"
);
const providerDispatchPersistIndex = providerApprovalSource.indexOf(
  'await persistState(state);',
  providerDispatchMarkerIndex
);
const providerDispatchExecuteIndex = providerApprovalSource.indexOf(
  'executeToolHandlerWithQa('
);
assert(
    /providerActionDispatch/.test(providerApprovalSource) &&
    /executeProviderActionWithSharedLease/.test(providerApprovalSource) &&
    /executeProviderActionWithSharedLeaseCore/.test(bridge) &&
    /resolveProviderActionDispatchBackend/.test(providerDispatchSource) &&
    /return isHosted \? 'unavailable' : 'local'/.test(
      providerDispatchPolicySource
    ) &&
    /backend === 'unavailable'/.test(providerLeaseSource) &&
    /provider_dispatch_lease_unavailable/.test(providerDispatchSource) &&
    /backend === 'local'/.test(providerLeaseSource) &&
    providerLeaseStart >= 0 &&
    providerLeaseEnd > providerLeaseStart &&
    /provider_action_dispatches/.test(providerLeaseSource) &&
    /pg_advisory_lock\(hashtextextended\(\$1,\s*0\)\)/.test(
      providerLeaseSource
    ) &&
    /pg_advisory_unlock\(hashtextextended\(\$1,\s*0\)\)/.test(
      providerLeaseSource
    ) &&
    /const attemptToken = createId\(\)/.test(providerLeaseSource) &&
    providerLeaseSource.indexOf(
      'INSERT INTO public.provider_action_dispatches'
    ) < providerLeaseSource.lastIndexOf('const value = await execute(') &&
    /status:\s*'dispatching'/.test(providerApprovalSource) &&
    /dispatchStartedAt/.test(providerApprovalSource) &&
    /leasePolicy:\s*'manual_reconciliation'/.test(providerApprovalSource) &&
    /leaseExpiresAt:\s*null/.test(providerApprovalSource) &&
    /reclaimable:\s*false/.test(providerApprovalSource) &&
    providerDispatchMarkerIndex >= 0 &&
    providerDispatchPersistIndex > providerDispatchMarkerIndex &&
    providerDispatchExecuteIndex > providerDispatchPersistIndex &&
    /providerActionDispatch\?\.status\s*===\s*'dispatching'/.test(
      providerApprovalSource
    ) &&
    /provider_delivery_unknown/.test(providerApprovalSource) &&
    /reconciliation_required/.test(providerApprovalSource) &&
    providerApprovalSource.indexOf(
      "providerActionDispatch?.status === 'dispatching'"
    ) < providerDispatchExecuteIndex,
  'Approval replay must durably lease provider dispatch before execution and never replay an unresolved dispatch.'
);

assert(
  /CREATE TABLE IF NOT EXISTS public\.provider_action_dispatches/.test(
    providerDispatchMigration
  ) &&
    /approval_id TEXT PRIMARY KEY/.test(providerDispatchMigration) &&
    /ALTER TABLE public\.provider_action_dispatches ENABLE ROW LEVEL SECURITY/.test(
      providerDispatchMigration
    ) &&
    /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'anon'\)/.test(
      providerDispatchMigration
    ) &&
    /REVOKE ALL ON public\.provider_action_dispatches FROM anon/.test(
      providerDispatchMigration
    ) &&
    /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'\)/.test(
      providerDispatchMigration
    ) &&
    /REVOKE ALL ON public\.provider_action_dispatches FROM authenticated/.test(
      providerDispatchMigration
    ),
  'Provider dispatch lease schema must ship as a server-only Supabase migration.'
);

assert(
  /dispatchStarted\s*\?\s*'provider_delivery_unknown'\s*:\s*'scheduled_execution_failed'/.test(
    bridge
  ) &&
    /status:\s*dispatchStarted\s*\?\s*'delivery_unknown'\s*:\s*'failed'/.test(
      bridge
    ) &&
    /reconciliationRequired:\s*dispatchStarted/.test(bridge),
  'Scheduled send exceptions after provider dispatch starts must be finalized as delivery unknown, never as retryable failures.'
);

assert(
  /askStrategistRecord\(\{[\s\S]*responseFormat:\s*'text'/.test(conversationRoutes) &&
    /Rewrite only the operator's draft/.test(bridge) &&
    /Preserve factual claims, numbers, consent boundaries, and requested channel/.test(bridge) &&
    /slice\(0,\s*12\)/.test(conversationRoutes) &&
    !/leadName:\s*recipientContext\.leadName/.test(
      conversationRoutes.slice(
        conversationRoutes.indexOf('/api/conversations/:threadId/refine-draft')
      )
    ) &&
    /rawDraft:\s*parsed\.draft,[\s\S]*refinedDraft:/.test(conversationRoutes),
  'Ava refinement must use the strategist with bounded visible context and never auto-send.'
);

assert(
  /store\.patchEvent/.test(conversationRoutes) &&
    /store\.reportEventSpam/.test(conversationRoutes) &&
    /explicitOptOut/.test(conversationRoutes) &&
    /hiddenAt/.test(bridge) &&
    /important/.test(bridge) &&
    /readAt/.test(bridge),
  'Event actions must be reversible, workspace-safe, and create DNC only from explicit opt-out.'
);

assert(
  /async function getEvent/.test(storeSource) &&
    /async function patchEvent/.test(storeSource) &&
    /async function reportEventSpam/.test(storeSource) &&
    /async function getThreadContactIdentities/.test(storeSource) &&
    /async function getPreviousSuccessfulSenderIdentityId/.test(storeSource),
  'Conversation store must expose workspace-safe contact, continuity, and event mutation helpers.'
);

assert(
  /createLiveConversationProjector/.test(bridge) &&
    /createConversationStore/.test(liveProjectorSource) &&
    /store\.resolveThread/.test(liveProjectorSource) &&
    /store\.upsertEvent/.test(liveProjectorSource) &&
    /\[pbk-conversations\] live projection failed/.test(liveProjectorSource),
  'Live conversation projection must resolve canonical threads, upsert idempotently, and isolate failures.'
);

assert(
  /event\.channel === 'call' && event\.direction === 'internal'/.test(
    liveProjectorSource
  ) &&
    /payload\.callDirection/.test(liveProjectorSource) &&
    /contactDirection === 'inbound'[\s\S]*event\.senderAddress/.test(
      liveProjectorSource
    ),
  'Internal recording events must resolve seller identity from their original call direction.'
);

assert(
  /persistUnifiedMessageRecord[\s\S]*projectLiveConversationRecord\(\{[\s\S]*projector:\s*projectMessageEvent/.test(
    bridge
  ) &&
    /source:\s*'telnyx-call-start'/.test(bridge) &&
    /source:\s*'telnyx-inbound-call-start'/.test(bridge) &&
    /source:\s*'telnyx-call-status'/.test(bridge) &&
    /source:\s*'telnyx-call-transcript'/.test(bridge) &&
    /source:\s*'docusign-envelope-send'/.test(bridge) &&
    /source:\s*'docusign-contract-status'/.test(bridge) &&
    /source:\s*'instantly-webhook'/.test(bridge) &&
    /source:\s*'approval-created'/.test(bridge) &&
    /source:\s*'approval-decided'/.test(bridge) &&
    /source:\s*'slack-approval-needs-review'/.test(bridge) &&
    /source:\s*'lead-note'/.test(bridge) &&
    /source:\s*'lead-updated'/.test(bridge),
  'Live provider, approval, and lead mutations must project into canonical seller timelines.'
);

assert(
  /from:\s*parsed\.from,[\s\S]*to:\s*parsed\.to,[\s\S]*direction:\s*'inbound'/.test(
    bridge
  ) &&
    /await persistState\(state\);[\s\S]*source:\s*'telnyx-inbound-call-start'/.test(
      bridge
    ),
  'Inbound Telnyx routes must preserve seller-to-PBK direction and project call start after persistence.'
);

assert(
  /normalizedEvent === 'call-transcript'[\s\S]*projectLiveConversationRecord\(\{[\s\S]*source:\s*'telnyx-call-transcript'[\s\S]*scheduleRuntimeStateBroadcast\('call-transcript'\)/.test(
    bridge
  ),
  'Call transcript events must update live dashboards immediately after canonical timeline projection.'
);

assert(
  /id:\s*body\.id\s*\|\|\s*body\.message_id\s*\|\|\s*body\.messageId\s*\|\|\s*body\.event_id\s*\|\|\s*body\.eventId/.test(
    bridge
  ) &&
    /const message = createMessageRecord\(\{[\s\S]*provider:\s*body\.provider\s*\|\|\s*'email-webhook'/.test(
      bridge
    ) &&
    /await persistUnifiedMessageRecord\(message\)/.test(bridge),
  'Email webhooks must use retry-stable provider IDs and durable unified-message persistence.'
);

assert(
  telnyxWebhookMapStart >= 0 &&
    telnyxWebhookMapEnd > telnyxWebhookMapStart &&
    /telnyx-message-\$\{Math\.abs\(/.test(telnyxWebhookMap) &&
    /telnyx-call-\$\{Math\.abs\(/.test(telnyxWebhookMap) &&
    docusignWebhookMapStart >= 0 &&
    docusignWebhookMapEnd > docusignWebhookMapStart &&
    /docusign-envelope-\$\{Math\.abs\(/.test(docusignWebhookMap) &&
    !/randomUUID\(\)/.test(docusignWebhookMap),
  'Provider webhook fallbacks must derive retry-stable source IDs instead of generating random IDs.'
);

assert(
  /const callDirection = inbound \? 'inbound' : outbound \? 'outbound' : ''/.test(
    telnyxWebhookMap
  ) &&
    /direction:\s*callDirection/.test(telnyxWebhookMap) &&
    /const nextDirection = payload\.direction \|\| existingCall\?\.direction \|\| 'outbound'/.test(
      callStatusHandler
    ) &&
    /const nextPhone = normalizePhone\(existingCall\?\.phone \|\| payload\.phone \|\| payload\.to \|\| ''\)/.test(
      callStatusHandler
    ),
  'Directionless Telnyx status callbacks must preserve the existing call direction and seller phone.'
);

assert(
  /const envelopeSummary = body\.data\?\.envelopeSummary \|\| \{\}/.test(bridge) &&
    /envelopeSummary\.envelopeId/.test(docusignWebhookMap) &&
    /envelopeId,/.test(docusignWebhookMap),
  'DocuSign Connect must preserve nested envelope IDs across lifecycle callbacks.'
);

assert(
  /if \(retryConversationProjectionOnly\)[\s\S]*source:\s*'approval-decided'[\s\S]*replayed:\s*true/.test(
    bridge
  ),
  'Approval outcome recovery must also retry the approval.decided timeline event.'
);

assert(
  /lead_id = COALESCE\(EXCLUDED\.lead_id, unified_messages\.lead_id\)/.test(
    bridge
  ) &&
    /if \(\/violates foreign key constraint\/i\.test\(messageText\)\)/.test(
      bridge
    ) &&
    /await pool\.query\(baseSql, retryValues\)/.test(bridge),
  'Unified message fallback must preserve or later heal lead association while tolerating stale schemas.'
);

assert(
  /msg-recording-\$\{Math\.abs\(/.test(bridge) &&
    /msg-deepgram-live-\$\{slugify\([\s\S]*Math\.abs\(/.test(bridge) &&
    /callDirection:\s*contextCall\?\.direction/.test(bridge),
  'Recording and Deepgram transcript events must retain stable IDs and call direction.'
);

assert(
  recordingRouteStart >= 0 &&
    recordingRouteEnd > recordingRouteStart &&
    /const recordingIdentitySeed = \[/.test(recordingRoute) &&
    /msg-recording-\$\{Math\.abs\(hashString\(recordingIdentitySeed\)\)\}/.test(
      recordingRoute
    ) &&
    (recordingRoute.match(/direction:\s*'recording'/g) || []).length >= 2 &&
    !/direction:\s*body\.direction/.test(recordingRoute) &&
    /callDirection:\s*recordingCallDirection/.test(recordingRoute) &&
    /const recordingActivityId = `activity-recording-\$\{messageId\}`/.test(
      recordingRoute
    ) &&
    /!state\.activity\.some\(\(entry\) => entry\.id === recordingActivityId\)/.test(
      recordingRoute
    ) &&
    !/Date\.now\(\)/.test(recordingRoute),
  'Manual recording uploads must be retry-idempotent and preserve call direction.'
);

console.log('unified-conversation-bridge-smoke: ok');
