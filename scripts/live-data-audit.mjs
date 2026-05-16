import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const indexPath = resolve(root, 'index.html');
const bridgePath = resolve(root, 'scripts/openclaw-local-server.mjs');
const heartbeatManagerPath = resolve(root, 'scripts/pbk-openclaw-heartbeat.ps1');
const widgetPath = resolve(root, 'public/ava-chat-widget.js');
const packagePath = resolve(root, 'package.json');
const agentsPath = resolve(root, 'AGENTS.md');
const avaMasterclassPath = resolve(root, 'knowledge/ava-wholesale-conversation-masterclass.md');
const analyzerHtmlPath = resolve(root, 'analyzer.html');
const analyzerTypesPath = resolve(root, 'src/app/types/pbk-analyzer.d.ts');
const analyzerDocsPath = resolve(root, 'docs/analyzer-postmessage-api.md');
const agentDealContextPath = resolve(root, 'src/app/utils/agentDealContext.ts');
const scriptPanelPath = resolve(root, 'src/app/components/ScriptPanel.tsx');
const runtimeBridgePath = resolve(root, 'src/app/utils/runtimeBridge.ts');
const renderConfigPath = resolve(root, 'render.yaml');
const index = readFileSync(indexPath, 'utf8');
const bridge = readFileSync(bridgePath, 'utf8');
const heartbeatManager = readFileSync(heartbeatManagerPath, 'utf8');
const widget = readFileSync(widgetPath, 'utf8');
const pkg = readFileSync(packagePath, 'utf8');
const agents = readFileSync(agentsPath, 'utf8');
const avaMasterclass = readFileSync(avaMasterclassPath, 'utf8');
const analyzerHtml = readFileSync(analyzerHtmlPath, 'utf8');
const analyzerTypes = existsSync(analyzerTypesPath) ? readFileSync(analyzerTypesPath, 'utf8') : '';
const analyzerDocs = existsSync(analyzerDocsPath) ? readFileSync(analyzerDocsPath, 'utf8') : '';
const agentDealContext = existsSync(agentDealContextPath) ? readFileSync(agentDealContextPath, 'utf8') : '';
const scriptPanel = existsSync(scriptPanelPath) ? readFileSync(scriptPanelPath, 'utf8') : '';
const runtimeBridge = existsSync(runtimeBridgePath) ? readFileSync(runtimeBridgePath, 'utf8') : '';
const renderConfig = existsSync(renderConfigPath) ? readFileSync(renderConfigPath, 'utf8') : '';
const defaultAgentFleetBlock = bridge.match(/function buildDefaultAgentFleet\(\) \{[\s\S]*?\n\}/)?.[0] || '';

const checks = [
  {
    name: 'Lead table renders live bridge leads',
    ok: /function\s+renderRuntimeLeads/.test(index) && /getRuntimeLeads\(snapshot\)/.test(index),
  },
  {
    name: 'Lead detail uses selected live lead',
    ok: /function\s+renderLeadDetail/.test(index) && /function\s+openLeadEditModal/.test(index) && /PATCH/.test(bridge) && /\/api\/leads\/:id/.test(bridge),
  },
  {
    name: 'Unified inbox is seller/homeowner facing only and lead-edit aware',
    ok: /function\s+isSellerFacingInboxMessage/.test(index)
      && /getRuntimeLeadByMessage/.test(index)
      && /agentSurface/.test(index)
      && /inboxChannelFilter/.test(index)
      && /selectedInboxId/.test(index)
      && /setSelectedInboxId/.test(index)
      && /syncInboxItemToLead/.test(index)
      && /wireInboxLeadEdit/.test(index)
      && /data-inbox-edit-lead/.test(index)
      && /data-inbox-filter="calls"/.test(index)
      && /data-openclaw-convo-actions/.test(index)
      && /Conversation only/.test(index)
      && !/data-inbox-open-lead/.test(index)
      && !/data-inbox-delete-message/.test(index)
      && !/Swipe left to delete/.test(index)
      && !/>Lead profile</.test(index)
      && !/>Call now</.test(index)
      && /exclude|agent_log|system_notification|website_chat|public-ava-chat/i.test(index),
  },
  {
    name: 'Instantly replies create or update lead records',
    ok: /upsertLeadFromInstantlyReply/.test(bridge)
      && /getInstantlyReplyText/.test(bridge)
      && /'instantly_reply'/.test(bridge)
      && /persistLeadProfileRowToDb\(saved \|\| nextLead,\s*'instantly-reply'\)/.test(bridge),
  },
  {
    name: 'Lead edit modal enriches from last call and full lead context',
    ok: /getLeadEditDefaultsWithCallContext/.test(index)
      && /\/api\/leads\/\$\{encodeURIComponent\(defaults\.leadId\)\}\/last-call/.test(index)
      && /Latest call:/.test(index),
  },
  {
    name: 'Analyzer can load selected lead and sync selected deal path back',
    ok: /loadActiveLeadIntoAnalyzer/.test(index)
      && /syncAnalyzerDealPathToLead/.test(index)
      && /data-analyzer-action="load-lead"/.test(index)
      && /selected_path/.test(index),
  },
  {
    name: 'Analyzer storage is namespaced, retained, normalized, and exportable',
    ok:
      /ANALYZER_STORAGE_NAMESPACE/.test(index)
      && /getAnalyzerStorageKey/.test(index)
      && /ANALYZER_RETENTION_DAYS/.test(index)
      && /pruneAnalyzerStorage/.test(index)
      && /writeAnalyzerSecureStorage/.test(index)
      && /readAnalyzerSecureStorage/.test(index)
      && /ANALYZER_SAVED_DEALS_KEY/.test(index)
      && /ANALYZER_COMPS_CACHE_KEY/.test(index)
      && /ANALYZER_PRESETS_KEY/.test(index)
      && /ANALYZER_UNDO_KEY/.test(index)
      && /normalizeRepairEstimate/.test(index)
      && /exportAnalyzerLocalState/.test(index),
  },
  {
    name: 'Analyzer iframe/state API is subdirectory-safe, lazy, documented, and bidirectional',
    ok:
      !/src="\/src\/main\.tsx"/.test(analyzerHtml)
      && /src="\.\/src\/main\.tsx"/.test(analyzerHtml)
      && /src="\.\/analyzer\.html\?embedded=1"/.test(index)
      && /loading="lazy"/.test(index)
      && /pbk:analyzer:state-request/.test(index)
      && /pbk:analyzer:shell-state/.test(index)
      && /ANALYZER_POSTMESSAGE_API/.test(index)
      && /interface PBKAnalyzerBridgeApi/.test(analyzerTypes)
      && /postMessage API/.test(analyzerDocs),
  },
  {
    name: 'Bridge analyzer/PDF controls are idempotent, versioned, and rate-limited',
    ok:
      /PDF_IDEMPOTENCY_CACHE/.test(bridge)
      && /buildPdfIdempotencyKey/.test(bridge)
      && /X-PBK-PDF-Idempotency-Key/.test(bridge)
      && /checkAnalyzeDealRateLimit/.test(bridge)
      && /validateMortgageTakeoverInputs/.test(bridge)
      && /\/api\/v1\/analyzeDeal/.test(bridge)
      && /\/api\/v1\/documents\/pdf/.test(bridge)
      && /\/api\/webhooks\/external-events/.test(bridge)
      && /PBK_API_DEPRECATION_POLICY/.test(bridge),
  },
  {
    name: 'Analyzer scripts and deal context remain agent-readable for Ava/Rex/Max',
    ok:
      /export function buildAgentDealContext/.test(agentDealContext)
      && /allPathScripts/.test(agentDealContext)
      && /activeScriptBundle/.test(agentDealContext)
      && /analyzerNumbers/.test(agentDealContext)
      && /agentDealContext/.test(runtimeBridge)
      && /onPushScriptToAgent/.test(scriptPanel)
      && /Push to Ava/.test(scriptPanel)
      && /getAgentDealContext/.test(index)
      && /getAgentDealContext/.test(analyzerTypes),
  },
  {
    name: 'Lead delete button and bridge DELETE route are wired',
    ok: /deleteRuntimeLead/.test(index)
      && /data-lead-row-action="delete"/.test(index)
      && /getLeadRuntimeId\(lead\)/.test(index)
      && /clearActiveLeadId/.test(index)
      && /request\.method === 'DELETE'/.test(bridge)
      && /findLeadImportByLookup/.test(bridge)
      && /lead\.importId/.test(bridge)
      && /deleteLeadProfileRowFromDb/.test(bridge)
      && /uniqueLeadLookupValues/.test(bridge)
      && /REGEXP_REPLACE\(COALESCE\(phone/.test(bridge)
      && !/OR email = \$2/.test(bridge),
  },
  {
    name: 'Lead intake dedupe does not collapse blank-address blank-phone leads',
    ok: /leadAddressKey\s*=\s*slugify/.test(bridge)
      && /leadPhoneKey\s*=\s*normalizePhone/.test(bridge)
      && /leadEmailKey/.test(bridge)
      && /Boolean\(leadAddressKey && leadPhoneKey/.test(bridge)
      && !/dedupeKey\s*=\s*`\$\{slugify\(leadImport\.property\.address\)\}::\$\{normalizePhone\(leadImport\.seller\.phone\)\}`/.test(bridge),
  },
  {
    name: 'Contract tabs, delete draft, void, and status API filters are wired',
    ok: /contractStageFilter/.test(index)
      && /data-contract-action="\$\{record\.isDraft \? 'delete-draft' : 'void'\}"/.test(index)
      && /force:\s*true/.test(index)
      && /filter\(\(contract\) => getContractStage\(contract\) !== 'void'\)/.test(index)
      && /url\.searchParams\.get\('status'\)/.test(bridge)
      && /matchPath\(pathname,\s*'\/api\/contracts\/:id'\)/.test(bridge)
      && /request\.method === 'DELETE'/.test(bridge),
  },
  {
    name: 'Inbox message archive route and Supabase schema ensure endpoints are available',
    ok: /matchPath\(pathname,\s*'\/api\/messages\/:id'\)/.test(bridge)
      && /deleteUnifiedMessageRecordFromDb/.test(bridge)
      && /\/api\/admin\/schema\/ensure/.test(bridge)
      && /pbk_memories/.test(bridge)
      && /pbk_feedback/.test(bridge)
      && /pbk_intent_events/.test(bridge)
      && /pbk_knowledge/.test(bridge),
  },
  {
    name: 'Slack approval buttons accept Block Kit JSON payloads and Ava thread replies',
    ok: /valuePayload\s*=\s*JSON\.parse/.test(bridge)
      && /pbk_send_slack_reply/.test(bridge)
      && /chat\.postMessage/.test(bridge),
  },
  {
    name: 'Slack notifications and approval board have live bridge APIs',
    ok: /\/api\/slack\/notify/.test(bridge)
      && /\/api\/v1\/slack\/notify/.test(bridge)
      && /SLACK_BOT_TOKEN && channel/.test(bridge)
      && /notifyReady/.test(bridge)
      && /approvalPostReady/.test(bridge)
      && /url\.searchParams\.get\('status'\)/.test(bridge)
      && /filteredApprovals/.test(bridge)
      && /state:\s*buildStateSnapshot\(\)/.test(bridge)
      && /Slack ping request complete/.test(index)
      && /getRealRuntimeApprovals/.test(index),
  },
  {
    name: 'OpenAI and DeepSeek token usage is tracked',
    ok: /pbk_token_usage/.test(bridge)
      && /recordTokenUsage\('openai'/.test(bridge)
      && /recordTokenUsage\('deepseek'/.test(bridge),
  },
  {
    name: 'Rex answers synthesize instead of dumping facts',
    ok: /Summary:/.test(bridge)
      && /Key insight:/.test(bridge)
      && /Follow-up question:/.test(bridge)
      && /looksLikeRexTroubleshootingQuery/.test(bridge)
      && /buildRexTroubleshootingAnswer/.test(bridge)
      && /DeepSeek strategist/.test(bridge),
  },
  {
    name: 'Ava command router force-runs required tools for high-confidence intents',
    ok: /TOOL_FIRST_INTENT_TO_TOOL/.test(bridge)
      && /detectToolFirstIntent/.test(bridge)
      && /executeToolFirstIntent/.test(bridge)
      && /tool_first_required/.test(bridge)
      && /search_leads/.test(bridge)
      && /analyze_deal/.test(bridge)
      && /prepare_contract/.test(bridge)
      && /pbk_recall_memory/.test(bridge),
  },
  {
    name: 'PBK tool usage is persisted for monitoring and missed-tool learning',
    ok: /CREATE TABLE IF NOT EXISTS public\.pbk_tool_usage/.test(bridge)
      && /recordPbkToolUsage/.test(bridge)
      && /tool_missed/.test(bridge)
      && /pbk_tool_usage_tool_idx/.test(bridge),
  },
  {
    name: 'Approval board is compact and Ava voice diagnostics are visible',
    ok: /qcard-summary/.test(index)
      && /qcard-meta/.test(index)
      && /compactBoardCopy/.test(index)
      && /formatAdminTaskSummary/.test(index)
      && /sanitizeAdminApprovalCopy/.test(bridge)
      && !/Original params:\s*\$\{paramPreview/.test(bridge)
      && !/Legacy raw admin copy/.test(index)
      && /showAvaVoiceDiagnostic/.test(index)
      && /type:\s*'diagnostic'/.test(bridge),
  },
  {
    name: 'Approval BANT review only appears for lead or qualification approval types',
    ok: /function\s+shouldShowApprovalBantCheck/.test(index)
      && /contract\|docusign\|doc\|outbound\|campaign\|call\|sms\|email\|admin\|schema\|settings/.test(index)
      && /lead\|qualification\|qualify\|bant/.test(index)
      && /const bantReviewButton = shouldShowApprovalBantCheck/.test(index),
  },
  {
    name: 'Campaign detail can add and remove leads through bridge actions',
    ok: /function\s+saveCampaignLeadSelector/.test(index)
      && /removeCampaignLeadLocally/.test(index)
      && /action === 'add_leads'/.test(bridge)
      && /action === 'remove_lead'/.test(bridge),
  },
  {
    name: 'Brain library, market pulse, and reading suggestions render from runtime state',
    ok: /function\s+renderBrainLibrary/.test(index)
      && /data-brain-market-pulse/.test(index)
      && /suggestedReading/.test(index),
  },
  {
    name: 'Recordings library replaces static samples with live recording state',
    ok: /function\s+renderRecordingsLibrary/.test(index)
      && /getRuntimeRecordingItems/.test(index)
      && /No live recordings yet/.test(index),
  },
  {
    name: 'Metadata-only smoke recordings do not spam Supabase signed URL errors',
    ok: /function isMetadataOnlySmokeRecording/.test(bridge)
      && /metadata_only_smoke_recording/.test(bridge)
      && /skipped:\s*true/.test(bridge),
  },
  {
    name: 'Recordings can be deleted from UI and bridge storage/state',
    ok: /deleteRuntimeRecording/.test(index)
      && /data-recording-delete/.test(index)
      && /data-recording-delete-active/.test(index)
      && /recordingMatch && request\.method === 'DELETE'/.test(bridge)
      && /deleteSupabaseRecording/.test(bridge)
      && /GET\/DELETE \/api\/recordings\/:messageId/.test(bridge),
  },
  {
    name: 'Real-time WebSocket startup is wired',
    ok: /function\s+startOpenClawRealtime/.test(index)
      && /new WebSocket/.test(index)
      && /queueOpenClawRealtimePayload/.test(index)
      && /flushOpenClawRealtimePayloads/.test(index)
      && /startOpenClawRealtimeHeartbeat/.test(index)
      && /authRequired && !String\(config\.apiKey/.test(index)
      && /perMessageDeflate/.test(bridge)
      && /runtimeWsHeartbeatTimer/.test(bridge)
      && /socket\.ping\(\)/.test(bridge)
      && /openclaw:startPolling|startOpenClawPolling/.test(index),
  },
  {
    name: 'OpenClaw gateway status is first-class in bridge health and dashboard diagnostics',
    ok: /OPENCLAW_GATEWAY_WS_HANDSHAKE_TIMEOUT_MS/.test(bridge)
      && /buildOpenClawGatewayStatus/.test(bridge)
      && /\/api\/gateway\/status/.test(bridge)
      && /\/api\/gateway\/heartbeat/.test(bridge)
      && /openClawGatewayHeartbeat/.test(bridge)
      && /OPENCLAW_GATEWAY_HEARTBEAT_MAX_AGE_MS/.test(bridge)
      && /openclaw:heartbeat/.test(pkg)
      && /openclaw:heartbeat:start/.test(pkg)
      && /PBK-OpenClaw-Gateway-Heartbeat/.test(heartbeatManager)
      && /Get-HeartbeatStatus/.test(heartbeatManager)
      && /openclawGateway: getOpenClawGatewayHealthComponent/.test(bridge)
      && /fetchOpenClawGatewayStatus/.test(index)
      && /PBK\.state\.openclawGatewayStatus/.test(index)
      && /OpenClaw Brain Gateway/.test(index),
  },
  {
    name: 'Hosted bridge never direct-dials local OpenClaw loopback gateway URLs',
    ok: /IS_HOSTED\s*\?\s*''\s*:\s*'ws:\/\/127\.0\.0\.1:18789'/.test(bridge)
      && /function isLoopbackGatewayUrl/.test(bridge)
      && /function shouldSkipHostedGatewayProbe/.test(bridge)
      && /shouldSkipHostedGatewayProbe\(raw\)/.test(bridge)
      && /shouldSkipHostedGatewayProbe\(explicit\)/.test(bridge),
  },
  {
    name: 'Optional OpenClaw gateway diagnostics do not create browser console 503 noise',
    ok: /function shouldReturnGatewayStatusOk/.test(bridge)
      && /const statusCode = shouldReturnGatewayStatusOk\(gatewayStatus\) \? 200 : 503/.test(bridge),
  },
  {
    name: 'OpenClaw hosted diagnostics use heartbeat-only language instead of retry errors',
    ok: /function isOpenClawDirectGatewayConfigured/.test(bridge)
      && /connectionMode/.test(bridge)
      && /heartbeat_only/.test(bridge)
      && !/bridge keeps retrying/.test(bridge)
      && /OpenClaw gateway \$\{gatewayStatus\.ready \? 'healthy' : gatewayStatus\.directProbeConfigured \? 'direct probe unavailable' : 'standby'\}/.test(index),
  },
  {
    name: 'Toast noise is capped and deduplicated',
    ok: /TOAST_LIMIT\s*=\s*3/.test(index)
      && /data-toast-id/.test(index)
      && /findToastById/.test(index)
      && /removeToastNode/.test(index),
  },
  {
    name: 'UX responsiveness controls are wired for voice, mobile inbox, loading, and offline states',
    ok: /avaConnectionDot/.test(index)
      && /avaAvatarStop/.test(index)
      && /avaTranscriptHistory/.test(index)
      && /stopCurrentVoiceAudio/.test(index)
      && /data-inbox-mobile-mode/.test(index)
      && /data-inbox-mobile-back/.test(index)
      && /pbk-inbox-fullscreen-flow-fix/.test(index)
      && /data-inbox-mobile-mode="list"[\s\S]*\.inbox-sidebar/.test(index)
      && /data-inbox-mobile-mode="conversation"[\s\S]*\.ib-convo/.test(index)
      && /renderRuntimeLoadingState/.test(index)
      && /runtime-skeleton-card/.test(index)
      && /offlineBanner/.test(index)
      && /refreshNetworkBanner/.test(index)
      && /validateModalForm/.test(index)
      && /requestSubmit/.test(index),
  },
  {
    name: 'Agent Fleet research source saves into Brain Blog for Rex review',
    ok: /action === 'train_source'/.test(index)
      && /\/api\/brain\/ingest/.test(index)
      && /\/api\/brain\/blog/.test(index)
      && /Research source saved to Brain Blog/.test(index)
      && /sourceSurface:\s*'agent-fleet'/.test(index),
  },
  {
    name: 'Agent Fleet defaults are honest runtime records, not fake live/demo activity',
    ok: /function buildDefaultAgentFleet/.test(bridge)
      && /activity:\s*'Waiting for approved PBK work.'/.test(defaultAgentFleetBlock)
      && /Ready for approved Rex research and strategist proposals/.test(defaultAgentFleetBlock)
      && /status:\s*'idle'/.test(defaultAgentFleetBlock)
      && !/id:\s*'max'|id:\s*'nora'|id:\s*'zed'|Diane Kowalski|Probate Warm-up Q2|On call with Diane|Spanish acquisitions|Outbound SMS/i.test(defaultAgentFleetBlock),
  },
  {
    name: 'Agent orchestration exposes Ava supervisor with Rex and Hermes workers',
    ok: /function buildAgentOrchestrationSnapshot/.test(bridge)
      && /function buildAgentHealthProbe/.test(bridge)
      && /function ensureRequiredAgentRoster/.test(bridge)
      && /orchestrationRole:\s*'supervisor'/.test(defaultAgentFleetBlock)
      && /supervises:\s*\[\s*'rex',\s*'hermes'\s*\]/.test(defaultAgentFleetBlock)
      && /id:\s*'hermes'/.test(defaultAgentFleetBlock)
      && /supervisor:\s*'ava'/.test(defaultAgentFleetBlock)
      && /\/api\/agents\/orchestration/.test(bridge)
      && /agentTasks/.test(bridge)
      && /Ava is the supervisor/.test(agents),
  },
  {
    name: 'Agent handoff smoke proves Ava, Rex, and Hermes use existing PBK lanes',
    ok: /async function runAgentOrchestrationSmoke/.test(bridge)
      && /recordAgentHandoffTask/.test(bridge)
      && /tool_first:analyze_deal/.test(bridge)
      && /createRexDecision/.test(bridge)
      && /getHermesProviderMeta/.test(bridge)
      && /\/api\/agents\/orchestration\/smoke/.test(bridge)
      && /providerWrites:\s*'blocked'/.test(bridge),
  },
  {
    name: 'Ava voice avoids fake listening and gives actionable connection diagnostics',
    ok: /Browser microphone streaming is disabled/.test(index)
      && /this browser is missing the private PBK Bridge API key/.test(index)
      && /Ava will stay in text mode instead of pretending to listen/.test(index)
      && /showAvaVoiceDiagnostic/.test(index)
      && /avaVoiceDoctor/.test(index)
      && /inspectBrowserAudioInputs/.test(index)
      && /Chrome sees 0 microphone input devices/.test(index),
  },
  {
    name: 'ElevenLabs streaming TTS is bridge-backed with dashboard fallback',
    ok: /ELEVENLABS_STREAMING_TTS_ENABLED/.test(bridge)
      && /sendElevenLabsTtsStream/.test(bridge)
      && /\/api\/voice\/tts\/stream/.test(bridge)
      && /X-PBK-TTS-Streaming/.test(bridge)
      && /playAvaTtsStream/.test(index)
      && /MediaSource\.isTypeSupported/.test(index)
      && /\/api\/voice\/tts\/stream/.test(index)
      && /\/api\/voice\/tts/.test(index),
  },
  {
    name: 'Ava/Rex flow-state layer enhances existing tools without bypassing approvals',
    ok: /function buildAvaFlowTurn/.test(bridge)
      && /looksLikeDashboardOperatorCommand/.test(bridge)
      && /buildAvaCommandFlowReply/.test(bridge)
      && /invokeToolWithOperatingGuard/.test(bridge)
      && /source:\s*'browser-voice'/.test(bridge)
      && /stageCommand = async/.test(index)
      && /submitAgentCommand\(command/.test(index)
      && /conversation flow layer/.test(agents)
      && /Enhance instead of replacing/.test(agents)
      && /Rex should feel like a strategist/.test(agents),
  },
  {
    name: 'Ava PBK Jarvis mode stays Slack/Electron-first and blocks non-PBK tool drift',
    ok: /detectAvaJarvisCommand/.test(bridge)
      && /applyAvaJarvisCommand/.test(bridge)
      && /ava_pbk_jarvis_mode/.test(bridge)
      && /No Telegram, inventory, ERP, or sales-order lane/.test(bridge)
      && /Slack approvals \+ Electron\/dashboard voice/.test(bridge)
      && /PBK control is Slack-first/.test(agents)
      && /Ava's Jarvis\/work mode means PBK wholesale real-estate execution only/.test(agents),
  },
  {
    name: 'Ava masterclass knowledge is seeded, routable, and source-of-truth aware',
    ok: /AVA_MASTERCLASS_KNOWLEDGE_REVISION/.test(bridge)
      && /buildAvaMasterclassKnowledgeFacts/.test(bridge)
      && /seedAvaMasterclassKnowledgeToPg/.test(bridge)
      && /looksLikeAvaMasterclassCommand/.test(bridge)
      && /getAvaMasterclassKnowledgeMatches/.test(bridge)
      && /sports_politics_deflection/.test(bridge)
      && /phone_emotional_intelligence_decoder/.test(bridge)
      && /wholesale_deal_path_audience_matrix/.test(bridge)
      && /legal_compliance_guardrails/.test(bridge)
      && /launch_gap_register/.test(bridge)
      && /elevenlabs_streaming_tts_requirement/.test(bridge)
      && /Ava must treat the Ava masterclass facts/.test(agents)
      && /Ava's missing-pieces suite/.test(agents)
      && /All proprietary PBK business material lives in `pbk_knowledge`/.test(avaMasterclass)
      && /Mortgage Takeover \/ subject-to/.test(avaMasterclass)
      && /Politics pattern/.test(avaMasterclass)
      && /Ava has none/.test(avaMasterclass)
      && /Complete Missing Pieces Suite/.test(avaMasterclass)
      && /Streaming TTS/.test(avaMasterclass),
  },
  {
    name: 'Ava can retrieve closing intelligence from PBK knowledge during live objections',
    ok: /function buildClosingIntelligenceAdvice/.test(bridge)
      && /function retrieveClosingKnowledge/.test(bridge)
      && /pbk_retrieve_closing_intelligence/.test(bridge)
      && /retrieveClosingIntelligence/.test(bridge)
      && /\/api\/v1\/brain\/retrieve/.test(bridge)
      && /closing_intelligence/.test(bridge)
      && /selectedPath/.test(bridge)
      && /seller_type/.test(bridge)
      && /nextBestPhrase/.test(bridge)
      && /doNotSay/.test(bridge)
      && /confidence:\s*advice\.confidence/.test(bridge),
  },
  {
    name: 'Ava 9-level conversation intelligence composes RAG, memory, prosody, similar deals, QA, and handoff',
    ok: /function buildAvaConversationIntelligence/.test(bridge)
      && /function buildAvaProsodyProfile/.test(bridge)
      && /function buildRealTimeConversationReaction/.test(bridge)
      && /function retrieveSimilarDealProof/.test(bridge)
      && /function recallConversationMemoryForDeal/.test(bridge)
      && /function scoreCallQualityRecord/.test(bridge)
      && /function recordSkillOutcomeRecord/.test(bridge)
      && /function runRexSkillAutopilotRecord/.test(bridge)
      && /function requestHumanHandoffRecord/.test(bridge)
      && /\/api\/v1\/ava\/conversation-intelligence/.test(bridge)
      && /\/api\/v1\/voice\/prosody/.test(bridge)
      && /\/api\/v1\/calls\/qa-score/.test(bridge)
      && /\/api\/v1\/handoff\/human/.test(bridge)
      && /\/api\/v1\/deals\/similar/.test(bridge)
      && /\/api\/v1\/memory\/conversation/.test(bridge)
      && /\/api\/v1\/skills\/outcomes/.test(bridge)
      && /PBK_TAVILY_API_KEY/.test(bridge)
      && /DIRECT_ENV_UPDATE_ALLOWLIST[\s\S]*PBK_TAVILY_API_KEY/.test(bridge)
      && /synthesizeClosingAnswerWithDeepSeek/.test(bridge),
  },
  {
    name: 'Render blueprint keeps Tavily as a protected live-search secret',
    ok: /key:\s*PBK_TAVILY_API_KEY/.test(renderConfig)
      && /key:\s*PBK_TAVILY_API_KEY\s*\n\s*sync:\s*false/.test(renderConfig)
      && !/tvly-[A-Za-z0-9_-]+/.test(renderConfig),
  },
  {
    name: 'React runtime bridge exposes Ava 9-level intelligence endpoints',
    ok: /retrieveClosingIntelligenceRequest/.test(runtimeBridge)
      && /\/api\/v1\/brain\/retrieve/.test(runtimeBridge)
      && /getAvaConversationIntelligenceRequest/.test(runtimeBridge)
      && /\/api\/v1\/ava\/conversation-intelligence/.test(runtimeBridge)
      && /getProsodyAdviceRequest/.test(runtimeBridge)
      && /\/api\/v1\/voice\/prosody/.test(runtimeBridge)
      && /scoreCallQualityRequest/.test(runtimeBridge)
      && /\/api\/v1\/calls\/qa-score/.test(runtimeBridge)
      && /recordSkillOutcomeRequest/.test(runtimeBridge)
      && /\/api\/v1\/skills\/outcomes/.test(runtimeBridge)
      && /runRexSkillAutopilotRequest/.test(runtimeBridge)
      && /\/api\/v1\/rex\/skill-autopilot/.test(runtimeBridge)
      && /requestHumanHandoffRequest/.test(runtimeBridge)
      && /\/api\/v1\/handoff\/human/.test(runtimeBridge)
      && /retrieveSimilarDealsRequest/.test(runtimeBridge)
      && /\/api\/v1\/deals\/similar/.test(runtimeBridge)
      && /recallConversationMemoryRequest/.test(runtimeBridge)
      && /\/api\/v1\/memory\/conversation/.test(runtimeBridge)
      && /webSearchRequest/.test(runtimeBridge)
      && /\/api\/brain\/web-search/.test(runtimeBridge),
  },
  {
    name: 'Browser voice sends WebM container audio to Deepgram and falls back when no words arrive',
    ok: /PBK_DEEPGRAM_BROWSER_LIVE_MODEL/.test(bridge)
      && /BROWSER_VOICE_DEEPGRAM_MODEL/.test(bridge)
      && /BROWSER_VOICE_NO_TRANSCRIPT_FALLBACK_MS/.test(bridge)
      && /buildBrowserVoiceDeepgramOptions/.test(bridge)
      && /rotateBrowserVoiceToFallback/.test(bridge)
      && /recentAudioChunks/.test(bridge)
      && /containerizedAudio:\s*true/.test(bridge)
      && /listenVersion:\s*isDeepgramFluxModel\(normalizedModel\)\s*\?\s*'v2'\s*:\s*'v1'/.test(bridge)
      && /BROWSER_VOICE_DEEPGRAM_FALLBACK_MODEL/.test(bridge)
      && /normalizeBrowserVoiceDeepgramModel/.test(bridge)
      && /nova-2-general/.test(bridge)
      && /deepgram:\$\{normalizedModel\}/.test(bridge)
      && !/deepgram-nova-v1/.test(bridge)
      && /manualWebSocket:\s*true/.test(bridge)
      && /normalizeDeepgramLiveTranscript/.test(bridge)
      && /audioTransport:\s*'binary-mediarecorder'/.test(index)
      && /voiceSocket\.send\(audioChunk\)/.test(index)
      && /startVoiceRecorderWhenBridgeReady/.test(index)
      && /voiceRecorder\.start\(recorderTimesliceMs\)/.test(index)
      && /earlyBrowserMessages/.test(bridge)
      && /lastDeepgramEvent/.test(bridge)
      && /webm-opus-container/.test(bridge)
      && /createManualDeepgramLiveConnection/.test(readFileSync(resolve(root, 'scripts/pbk-deepgram-client.mjs'), 'utf8'))
      && /Authorization:\s*`Token \$\{config\.apiKey\}`/.test(readFileSync(resolve(root, 'scripts/pbk-deepgram-client.mjs'), 'utf8')),
  },
  {
    name: 'Deepgram phone proof writes call transcript memory and intent analytics',
    ok: /memoryType:\s*'call_transcript'/.test(bridge)
      && /source:\s*'telnyx-deepgram'/.test(bridge)
      && /recordPbkIntentEvent\(\{[\s\S]*source:\s*'telnyx-media-stream'/.test(bridge)
      && /finalTranscriptItems/.test(bridge)
      && /transcriptFinal/.test(bridge),
  },
  {
    name: 'PBK transcript memory and intent analytics dual-write to Supabase REST',
    ok: /persistPbkMemoryToSupabaseRest/.test(bridge)
      && /upsertSupabaseRestRows\('pbk_memories'/.test(bridge)
      && /upsertSupabaseRestRows\('pbk_intent_events'/.test(bridge)
      && /SUPABASE_SERVICE_ROLE_KEY/.test(bridge)
      && /supabaseRest/.test(bridge),
  },
  {
    name: 'Live Telnyx transcripts persist fallback sentiment when Deepgram sentiment is absent',
    ok: /function\s+estimatePbkLiveSentiment/.test(bridge)
      && /pbk-lexical-fallback/.test(bridge)
      && /session\.sentiment\s*=\s*estimatePbkLiveSentiment\(transcriptText\)/.test(bridge),
  },
  {
    name: 'Outbound Telnyx calls authenticate media streaming and classify stream webhooks',
    ok: /requestPayload\.stream_auth_token\s*=\s*TELNYX_MEDIA_STREAM_TOKEN/.test(bridge)
      && /eventType\.includes\('streaming'\)/.test(bridge)
      && /eventType:\s*'call-stream'/.test(bridge)
      && /normalizedEvent === 'call-stream'/.test(bridge)
      && /mediaStreamError:\s*status === 'failed'/.test(bridge),
  },
  {
    name: 'Telnyx media WebSocket diagnostics prove connection and first audio frame',
    ok: /Telnyx media WebSocket connected to PBK bridge/.test(bridge)
      && /Telnyx media stream delivered first audio frame/.test(bridge)
      && /session\.frameCount === 1/.test(bridge),
  },
  {
    name: 'Telnyx media handler buffers immediately and diagnoses Deepgram live open',
    ok: /TELNYX_DEEPGRAM_OPEN_TIMEOUT_MS/.test(bridge)
      && /pendingTelnyxMediaFrames/.test(bridge)
      && /flushPendingTelnyxMediaFrames/.test(bridge)
      && /withTimeout\(deepgramConnection\.waitForOpen\(\),\s*TELNYX_DEEPGRAM_OPEN_TIMEOUT_MS/.test(bridge)
      && /Deepgram live stream connected for Telnyx media/.test(bridge)
      && /Deepgram live stream failed before Telnyx media could be transcribed/.test(bridge)
      && /Telnyx media stream started for/.test(bridge),
  },
  {
    name: 'Telnyx Deepgram live socket uses phone-safe model and captures 400 bodies',
    ok: /PBK_DEEPGRAM_TELNYX_LIVE_MODEL/.test(bridge)
      && /model:\s*getTelnyxDeepgramLiveModel\(\)/.test(bridge)
      && /utteranceEndMs:\s*1000/.test(bridge)
      && /Unexpected server response: \$\{response\.statusCode\}\$\{body/.test(readFileSync(resolve(root, 'scripts/pbk-deepgram-client.mjs'), 'utf8')),
  },
  {
    name: 'Telnyx Deepgram live socket flushes buffered audio before closing',
    ok: /sendDeepgramControl/.test(bridge)
      && /type:\s*'Finalize'/.test(bridge)
      && /type:\s*'CloseStream'/.test(bridge)
      && /TELNYX_DEEPGRAM_FINALIZE_GRACE_MS/.test(bridge)
      && /Deepgram close-stream flush requested for Telnyx media/.test(bridge),
  },
  {
    name: 'Outbound Telnyx answered calls get an Ava greeting instead of silent dead air',
    ok: /outboundAvaGreetingSpoken/.test(bridge)
      && /speakAvaPhoneReplyByCallId\(call\.telnyxCallControlId/.test(bridge)
      && /Ava outbound greeting/.test(bridge),
  },
  {
    name: 'Ava live Telnyx replies never speak strategist meta-commentary',
    ok: /function\s+looksLikeStrategistMetaText/.test(bridge)
      && /function\s+normalizeAvaSpokenScript/.test(bridge)
      && /normalizeAvaSpokenScript\(text\)\s*\|\|\s*normalizeAvaSpokenScript\(fallback\)/.test(bridge)
      && /provider_reasoning_only/.test(bridge)
      && !/message\.content\s*\|\|\s*message\.reasoning_content/.test(bridge),
  },
  {
    name: 'Ava live Telnyx replies are written back as conversation turns',
    ok: /lastAvaReplyTranscript/.test(bridge)
      && /speaker:\s*'Ava'/.test(bridge)
      && /source:\s*'pbk-live-reply'/.test(bridge)
      && /transcriptForReply === session\.lastAvaReplyTranscript/.test(bridge),
  },
  {
    name: 'Ava phone replies can use ElevenLabs over Telnyx bidirectional media',
    ok: /PBK_TELNYX_ELEVENLABS_MEDIA_REPLY_ENABLED/.test(bridge)
      && /stream_bidirectional_mode:\s*'mp3'/.test(bridge)
      && /stream_establish_before_call_originate/.test(bridge)
      && /sendElevenLabsTtsToTelnyxMediaStream/.test(bridge)
      && /event:\s*'media'/.test(bridge)
      && /X-PBK-TTS-Provider/.test(bridge),
  },
  {
    name: 'Inbound Telnyx calls answer, speak, stream to Deepgram, and clean the live UI safely',
    ok: /startTelnyxMediaStream/.test(bridge)
      && /\/actions\/streaming_start/.test(bridge)
      && /decodeTelnyxClientState/.test(bridge)
      && /buildTelnyxLiveAvaReply/.test(bridge)
      && /PBK_TELNYX_BRIDGE_AVA_REPLY_ENABLED/.test(bridge)
      && /telnyxAiAssistantStarted/.test(bridge)
      && /action:\s*'streaming_start'/.test(bridge)
      && /action:\s*'speak'/.test(bridge)
      && /manualWebSocket:\s*true/.test(bridge)
      && /encoding:\s*'mulaw'/.test(bridge)
      && /scheduleRuntimeStateBroadcast\('telnyx-transcript'\)/.test(bridge)
      && /telnyxCallControlId === payload\.call_control_id/.test(bridge)
      && /telnyxCallLegId === payload\.call_leg_id/.test(bridge)
      && /endedAt:\s*eventType\.includes\('hangup'\)/.test(bridge)
      && /function\s+getSafeLiveCallNextMove/.test(index)
      && /unsafePattern/.test(index)
      && /getSafeLiveCallNextMove\(active\)/.test(index)
      && /turn\.transcript/.test(index),
  },
  {
    name: 'Public Ava chat proxy and widget are present',
    ok: /api\/public\/ava-chat/.test(bridge) && /pbk-ava-public-chat/.test(widget),
  },
  {
    name: 'TOTP enrollment flow is safe before enforcement',
    ok: /api\/security\/totp\/enrollment/.test(bridge)
      && /totp\/enroll\/verify/.test(bridge)
      && /safeToEnforce/.test(bridge)
      && /PBK_TOTP_SECRET/.test(bridge)
      && /Direct protected env updates/.test(bridge)
      && /openTotpEnrollmentModal/.test(index),
  },
  {
    name: 'DeepSeek strategist lane is implemented without hardcoded secrets',
    ok: /avaAskStrategist/.test(bridge)
      && /PBK_DEEPSEEK_API_KEY/.test(bridge)
      && !/sk-[A-Za-z0-9]{20,}/.test(index + bridge),
  },
  {
    name: 'Hermes analyst lane is suggest-only and visible in production health',
    ok: /getHermesProviderMeta/.test(bridge)
      && /\/api\/hermes\/status/.test(bridge)
      && /\/api\/hermes\/recommend/.test(bridge)
      && /PBK_HERMES_SUGGEST_ONLY/.test(bridge)
      && /providerWrites:\s*'blocked'/.test(bridge)
      && /Hermes Analyst/.test(index)
      && /deepSeek: sanitizeOpenClawProviderMeta/.test(index)
      && /hermes: sanitizeOpenClawProviderMeta/.test(index)
      && !/sk-[A-Za-z0-9]{20,}/.test(index + bridge),
  },
];

const failed = checks.filter((check) => !check.ok);
const report = {
  ok: failed.length === 0,
  checkedAt: new Date().toISOString(),
  checks,
  completedProductionProof: [
    'One answered Telnyx -> Deepgram phone call with speech created durable transcript and sentiment rows',
  ],
  remainingOperatorProof: [
    'Authenticator enrollment verification before setting PBK_TOTP_REQUIRED=true',
    'Marketing-site snippet placement if that site is a separate repository',
  ],
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
