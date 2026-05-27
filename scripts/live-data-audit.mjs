import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const indexPath = resolve(root, 'index.html');
const bridgePath = resolve(root, 'scripts/openclaw-local-server.mjs');
const heartbeatManagerPath = resolve(root, 'scripts/pbk-openclaw-heartbeat.ps1');
const widgetPath = resolve(root, 'public/ava-chat-widget.js');
const packagePath = resolve(root, 'package.json');
const productionCheckPath = resolve(root, 'scripts/production-pristine-check.mjs');
const callEmbeddingsScriptPath = resolve(root, 'scripts/generate-call-embeddings.mjs');
const callEmbeddingsMigrationPath = resolve(root, 'supabase/migrations/20260527010000_pbk_call_episodic_memory.sql');
const agentsPath = resolve(root, 'AGENTS.md');
const avaMasterclassPath = resolve(root, 'knowledge/ava-wholesale-conversation-masterclass.md');
const analyzerHtmlPath = resolve(root, 'analyzer.html');
const analyzerTypesPath = resolve(root, 'src/app/types/pbk-analyzer.d.ts');
const analyzerDocsPath = resolve(root, 'docs/analyzer-postmessage-api.md');
const agentDealContextPath = resolve(root, 'src/app/utils/agentDealContext.ts');
const scriptPanelPath = resolve(root, 'src/app/components/ScriptPanel.tsx');
const runtimeBridgePath = resolve(root, 'src/app/utils/runtimeBridge.ts');
const commandCenterPath = resolve(root, 'src/app/routes/CommandCenter.tsx');
const renderConfigPath = resolve(root, 'render.yaml');
const netlifyConfigPath = resolve(root, 'netlify.toml');
const netlifyPublicAvaFunctionPath = resolve(root, 'netlify/functions/public-ava-chat.ts');
const netlifyDocumentsPdfFunctionPath = resolve(root, 'netlify/functions/documents-pdf.ts');
const netlifyBridgeProxyFunctionPath = resolve(root, 'netlify/functions/pbk-bridge-proxy.ts');
const snnCorePath = resolve(root, 'src/app/agents/snn/lifCore.mjs');
const snnWorkerPath = resolve(root, 'src/app/agents/snn/agentBrain.worker.js');
const snnBridgePath = resolve(root, 'src/app/utils/snnWorkerBridge.ts');
const emotionOnnxExporterPath = resolve(root, 'scripts/train_emotion_world_model_onnx.py');
const emotionRequirementsPath = resolve(root, 'requirements-emotion-world-model.txt');
const index = readFileSync(indexPath, 'utf8');
const bridge = readFileSync(bridgePath, 'utf8');
const heartbeatManager = readFileSync(heartbeatManagerPath, 'utf8');
const widget = readFileSync(widgetPath, 'utf8');
const pkg = readFileSync(packagePath, 'utf8');
const productionCheck = readFileSync(productionCheckPath, 'utf8');
const callEmbeddingsScript = existsSync(callEmbeddingsScriptPath) ? readFileSync(callEmbeddingsScriptPath, 'utf8') : '';
const callEmbeddingsMigration = existsSync(callEmbeddingsMigrationPath) ? readFileSync(callEmbeddingsMigrationPath, 'utf8') : '';
const agents = readFileSync(agentsPath, 'utf8');
const avaMasterclass = readFileSync(avaMasterclassPath, 'utf8');
const analyzerHtml = readFileSync(analyzerHtmlPath, 'utf8');
const analyzerTypes = existsSync(analyzerTypesPath) ? readFileSync(analyzerTypesPath, 'utf8') : '';
const analyzerDocs = existsSync(analyzerDocsPath) ? readFileSync(analyzerDocsPath, 'utf8') : '';
const agentDealContext = existsSync(agentDealContextPath) ? readFileSync(agentDealContextPath, 'utf8') : '';
const scriptPanel = existsSync(scriptPanelPath) ? readFileSync(scriptPanelPath, 'utf8') : '';
const runtimeBridge = existsSync(runtimeBridgePath) ? readFileSync(runtimeBridgePath, 'utf8') : '';
const commandCenter = existsSync(commandCenterPath) ? readFileSync(commandCenterPath, 'utf8') : '';
const renderConfig = existsSync(renderConfigPath) ? readFileSync(renderConfigPath, 'utf8') : '';
const netlifyConfig = existsSync(netlifyConfigPath) ? readFileSync(netlifyConfigPath, 'utf8') : '';
const netlifyPublicAvaFunction = existsSync(netlifyPublicAvaFunctionPath) ? readFileSync(netlifyPublicAvaFunctionPath, 'utf8') : '';
const netlifyDocumentsPdfFunction = existsSync(netlifyDocumentsPdfFunctionPath) ? readFileSync(netlifyDocumentsPdfFunctionPath, 'utf8') : '';
const netlifyBridgeProxyFunction = existsSync(netlifyBridgeProxyFunctionPath) ? readFileSync(netlifyBridgeProxyFunctionPath, 'utf8') : '';
const netlifyApiProxyIndex = netlifyConfig.lastIndexOf('from = "/api/*"');
const netlifyBrainCleanIndex = netlifyConfig.lastIndexOf('from = "/brain"');
const netlifyBrainProxyIndex = netlifyConfig.lastIndexOf('from = "/brain/*"');
const netlifySpaFallbackIndex = netlifyConfig.lastIndexOf('from = "/*"');
const netlifySpaFallbackBlock = netlifySpaFallbackIndex >= 0 ? netlifyConfig.slice(netlifySpaFallbackIndex) : '';
const netlifySpaFallbackOrdered = /from\s*=\s*"\/\*"/.test(netlifySpaFallbackBlock)
  && /to\s*=\s*"\/index\.html"/.test(netlifySpaFallbackBlock)
  && /status\s*=\s*200/.test(netlifySpaFallbackBlock)
  && netlifyApiProxyIndex >= 0
  && netlifySpaFallbackIndex > netlifyApiProxyIndex;
const netlifyBrainCleanRouteOrdered = netlifyBrainCleanIndex >= 0
  && netlifyBrainProxyIndex >= 0
  && netlifyBrainCleanIndex < netlifyBrainProxyIndex
  && /from\s*=\s*"\/brain"[\s\S]*?to\s*=\s*"\/index\.html"[\s\S]*?status\s*=\s*200/.test(netlifyConfig.slice(netlifyBrainCleanIndex, netlifyBrainProxyIndex));
const cleanPathRouterWired = /const\s+cleanPagePathAliases\s*=/.test(index)
  && /['"]\/settings['"]\s*:\s*['"]settings['"]/.test(index)
  && /['"]\/deals\/analyzer['"]\s*:\s*['"]analyzer['"]/.test(index)
  && /['"]\/leads['"]\s*:\s*['"]leads['"]/.test(index)
  && /['"]\/contracts['"]\s*:\s*['"]contracts['"]/.test(index)
  && /['"]\/brain['"]\s*:\s*['"]brain['"]/.test(index)
  && /function\s+getInitialPageFromLocation/.test(index)
  && /const\s+initialPage\s*=\s*getInitialPageFromLocation\(\)/.test(index);
const snnCore = existsSync(snnCorePath) ? readFileSync(snnCorePath, 'utf8') : '';
const snnWorker = existsSync(snnWorkerPath) ? readFileSync(snnWorkerPath, 'utf8') : '';
const snnBridge = existsSync(snnBridgePath) ? readFileSync(snnBridgePath, 'utf8') : '';
const agentDecisionSmoke = readFileSync(resolve(root, 'scripts/agent-decision-smoke.mjs'), 'utf8');
const emotionPipelineSmoke = existsSync(resolve(root, 'scripts/emotion-pipeline-smoke.mjs'))
  ? readFileSync(resolve(root, 'scripts/emotion-pipeline-smoke.mjs'), 'utf8')
  : '';
const emotionWorldModelSmoke = existsSync(resolve(root, 'scripts/emotion-world-model-smoke.mjs'))
  ? readFileSync(resolve(root, 'scripts/emotion-world-model-smoke.mjs'), 'utf8')
  : '';
const emotionWorldModelTrainingSmoke = existsSync(resolve(root, 'scripts/emotion-world-model-training-smoke.mjs'))
  ? readFileSync(resolve(root, 'scripts/emotion-world-model-training-smoke.mjs'), 'utf8')
  : '';
const emotionWorldModelTrainer = existsSync(resolve(root, 'scripts/train-emotion-world-model.mjs'))
  ? readFileSync(resolve(root, 'scripts/train-emotion-world-model.mjs'), 'utf8')
  : '';
const emotionWorldModelServer = existsSync(resolve(root, 'scripts/serve-emotion-world-model.mjs'))
  ? readFileSync(resolve(root, 'scripts/serve-emotion-world-model.mjs'), 'utf8')
  : '';
const xFactorDimensionsSmoke = existsSync(resolve(root, 'scripts/x-factor-dimensions-smoke.mjs'))
  ? readFileSync(resolve(root, 'scripts/x-factor-dimensions-smoke.mjs'), 'utf8')
  : '';
const openclawSmoke = existsSync(resolve(root, 'scripts/openclaw-smoke.mjs'))
  ? readFileSync(resolve(root, 'scripts/openclaw-smoke.mjs'), 'utf8')
  : '';
const productionPristineCheck = existsSync(resolve(root, 'scripts/production-pristine-check.mjs'))
  ? readFileSync(resolve(root, 'scripts/production-pristine-check.mjs'), 'utf8')
  : '';
const emotionOnnxExporter = existsSync(emotionOnnxExporterPath) ? readFileSync(emotionOnnxExporterPath, 'utf8') : '';
const emotionRequirements = existsSync(emotionRequirementsPath) ? readFileSync(emotionRequirementsPath, 'utf8') : '';
const defaultAgentFleetBlock = bridge.match(/function buildDefaultAgentFleet\(\) \{[\s\S]*?\n\}/)?.[0] || '';

const checks = [
  {
    name: 'Brain page uses operator-friendly language for core research actions',
    ok: /PBK Brain - research, scripts, memory, and market notes/.test(index)
      && /This is PBK's shared memory/.test(index)
      && />Update Brain</.test(index)
      && />Research Web</.test(index)
      && />Export Notes</.test(index)
      && />Connection Help</.test(index)
      && />\+ Add Source</.test(index)
      && /Ask Rex about leads, scripts, deals, market notes, or the next best move/.test(index),
  },
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
    name: 'Slack approval buttons ACK fast, parse Block Kit values, and Ava thread replies',
    ok: /valuePayload\s*=\s*JSON\.parse/.test(bridge)
      && /selected_option/.test(bridge)
      && /view\?\.private_metadata/.test(bridge)
      && /slack_interaction_ack_queued/.test(bridge)
      && /void handleSlackApprovalInteraction/.test(bridge)
      && /pbk_send_slack_reply/.test(bridge)
      && /chat\.postMessage/.test(bridge),
  },
  {
    name: 'Slack notifications and approval board have live bridge APIs',
    ok: /\/api\/slack\/notify/.test(bridge)
      && /\/api\/v1\/slack\/notify/.test(bridge)
      && /SLACK_BOT_TOKEN && channel/.test(bridge)
      && /bot_to_webhook_fallback/.test(bridge)
      && /fallbackFrom:\s*'bot'/.test(bridge)
      && /\/api\/slack\/health/.test(bridge)
      && /auth\.test/.test(bridge)
      && /botAuthError/.test(bridge)
      && /notifyReady/.test(bridge)
      && /approvalPostReady/.test(bridge)
      && /url\.searchParams\.get\('status'\)/.test(bridge)
      && /filteredApprovals/.test(bridge)
      && /stateIncluded:\s*includeState/.test(bridge)
      && /Slack ping request complete/.test(index)
      && /getRealRuntimeApprovals/.test(index)
      && /fetchOpenClawSlackHealth/.test(index)
      && /Outbound live - rotate bot token for buttons/.test(index)
      && /openClawNeedsBridgeApiKey/.test(index)
      && /PBK Bridge key required/.test(index)
      && /assertOpenClawAuthReady\(config,\s*'\/state'\)/.test(index),
  },
  {
    name: 'Approval list fetch stays compact unless state is explicitly requested',
    ok: /const includeState = \['1', 'true', 'yes'\]\.includes/.test(bridge)
      && /stateIncluded:\s*includeState/.test(bridge)
      && /\.\.\.\(includeState \? \{ state: buildStateSnapshot\(\) \} : \{\}\)/.test(bridge),
  },
  {
    name: 'Live calls and messages endpoints honor pagination to keep external dashboards responsive',
    ok: /pathname === '\/api\/calls'[\s\S]*?const limit = Math\.max\(1, Math\.min\(200, Number\(url\.searchParams\.get\('limit'\)/.test(bridge)
      && /calls: allCalls\.slice\(offset, offset \+ limit\)/.test(bridge)
      && /pathname === '\/api\/messages'[\s\S]*?const limit = Math\.max\(1, Math\.min\(200, Number\(url\.searchParams\.get\('limit'\)/.test(bridge)
      && /messages: allMessages\.slice\(offset, offset \+ limit\)/.test(bridge),
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
      && /type:\s*'diagnostic'/.test(bridge)
      && /function restoreApprovalCardDecision/.test(index)
      && /button\.textContent = normalizeRuntimeStatus\(action\) === 'cancelled' \? 'Cancelling\.\.\.' : 'Sending\.\.\.'/.test(index),
  },
  {
    name: 'Approval BANT context stays informational and hidden from non-lead approval types',
    ok: /function\s+shouldShowApprovalBantCheck/.test(index)
      && /contract\|docusign\|doc\|outbound\|campaign\|call\|sms\|email\|admin\|schema\|settings/.test(index)
      && /lead\|qualification\|qualify\|bant/.test(index)
      && /const bantInfo = shouldShowApprovalBantCheck/.test(index)
      && /BANT\+ is optional context/.test(index)
      && !/PBK decision check/.test(index)
      && !/Wrong path/.test(index)
      && !/Bad timing/.test(index)
      && !/Wrong doc path/.test(index),
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
      && /removeToastNode/.test(index)
      && /TOAST_LOW_SIGNAL_TITLES/.test(index)
      && /shouldSuppressToast/.test(index)
      && /pbk-toast-muted/.test(index),
  },
  {
    name: 'Optional BatchData is not shown as a live production blocker',
    ok: /BatchData optional\/off/.test(index)
      && /Optional\/off this production run/.test(index)
      && /PBK_OPTIONAL_PROVIDER_GAPS\s*\|\|\s*'batchdata,openclawgateway'/.test(productionCheck),
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
      && /speakAvaBrowserTtsFallback/.test(index)
      && /SpeechSynthesisUtterance/.test(index)
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
    name: 'Live web search keeps DeepSeek as fallback LLM when Tavily/OpenAI are unavailable',
    ok: /function runTavilySearch/.test(bridge)
      && /function runDeepSeekWebSearchFallback/.test(bridge)
      && /source:\s*'rex-web-search-deepseek-fallback'/.test(bridge)
      && /DeepSeek is the LLM\. Tavily is only the live-search retriever\./.test(bridge)
      && /result:\s*'deepseek_brain_fallback'/.test(bridge)
      && /function runLiveWebSearch/.test(bridge)
      && /runDeepSeekWebSearchFallback\(query,\s*params/.test(bridge)
      && /async getBrainState[\s\S]*runLiveWebSearch\(query/.test(bridge)
      && /deepSeekFallbackActive/.test(bridge)
      && /function buildWebSearchSpikeInjection/.test(bridge)
      && /snnSpikeInjection/.test(bridge)
      && /symbolicFacts/.test(bridge)
      && /event:\s*'pbk_web_search_provider'/.test(bridge)
      && /tavilySecretPresent/.test(bridge)
      && /openaiQuotaError/.test(bridge)
      && /queryPreview/.test(bridge),
  },
  {
    name: 'Ava chat TTS diagnostics cannot be misparsed as lead targets or provider writes',
    ok: /function looksLikeAvaTtsDiagnosticCommand/.test(bridge)
      && /ttsDiagnosticCommand/.test(bridge)
      && /suppressLeadContext/.test(bridge)
      && /providerWritesBlocked/.test(bridge)
      && /function looksLikeAvaTtsDiagnosticText/.test(index)
      && /shouldPreEnrichAgentCommand/.test(index)
      && /source:\s*'ava-chat-bubble-tts'/.test(index)
      && /skipPreEnrichment/.test(index),
  },
  {
    name: 'Approval board decisions render from write responses without blocking on full refresh',
    ok: /let decisionResponse = null/.test(index)
      && /decisionResponse = await requestOpenClawApi\(approvalPath/.test(index)
      && /decisionResponse = await updateAdminTaskDecision/.test(index)
      && /decisionResponse\?\.state[\s\S]*renderOpenClawState\(decisionResponse\.state\)/.test(index)
      && /scheduleApprovalBoardRefreshRetry/.test(index),
  },
  {
    name: 'Command Center displays web-search cognition fallback status',
    ok: /function getWebSearchProviderStatus/.test(bridge)
      && /\/api\/brain\/web-search\/status/.test(bridge)
      && /tavilySecretPresent/.test(bridge)
      && /pbk-web-search-spikes-v1/.test(bridge)
      && /fetchWebSearchStatusRequest/.test(runtimeBridge)
      && /Web Search Cognition/.test(commandCenter)
      && /Probe Status/.test(commandCenter)
      && /fetchWebSearchStatusRequest/.test(commandCenter),
  },
  {
    name: 'SNN worker consumes web-search spike injections',
    ok: /function createLifNetwork/.test(snnCore)
      && /function applySpikeInjection/.test(snnCore)
      && /function stepLifNetwork/.test(snnCore)
      && /message\.type === 'inject_spikes'/.test(snnWorker)
      && /spikes_injected/.test(snnWorker)
      && /createPbkSnnWorker/.test(snnBridge)
      && /injectSearchCognition/.test(snnBridge)
      && /createPbkSnnWorker/.test(runtimeBridge)
      && /injectSearchCognition/.test(runtimeBridge)
      && /snnAdapter/.test(runtimeBridge)
      && /pbk-web-search-spikes-v1/.test(snnBridge),
  },
  {
    name: 'X-factor replay buffer records agent decisions for world-model training',
    ok: /CREATE TABLE IF NOT EXISTS public\.pbk_agent_decisions/.test(bridge)
      && /function summarizeAgentDecisionBuffer/.test(bridge)
      && /async function recordAgentDecisionRecord/.test(bridge)
      && /\/api\/agent-decisions/.test(bridge)
      && /status\.worldModel/.test(bridge)
      && /agent_decision_replay_buffer_ready/.test(agentDecisionSmoke)
      && /test:x-factor/.test(pkg)
      && /test:x-factor/.test(pkg.match(/"test:founder":[^\n]+/)?.[0] || ''),
  },
  {
    name: 'Emotional intelligence pipeline records call emotion, memory, and predicted transitions',
    ok: /CREATE TABLE IF NOT EXISTS public\.pbk_call_emotions/.test(bridge)
      && /CREATE TABLE IF NOT EXISTS public\.pbk_emotional_memory/.test(bridge)
      && /CREATE TABLE IF NOT EXISTS public\.pbk_emotional_policy_experiments/.test(bridge)
      && /CREATE TABLE IF NOT EXISTS public\.pbk_emotional_policy_outcomes/.test(bridge)
      && /emotion_state JSONB/.test(bridge)
      && /async function recordCallEmotionRecord/.test(bridge)
      && /function buildEmotionalMemoryPromptContext/.test(bridge)
      && /emotional_memory_prompt_context/.test(bridge)
      && /emotionalMemoryPresent/.test(bridge)
      && /De-escalate before offer/.test(bridge)
      && /function predictEmotionTransition/.test(bridge)
      && /async function createEmotionalPolicyExperimentRecord/.test(bridge)
      && /async function assignEmotionalPolicyVariantRecord/.test(bridge)
      && /async function recordEmotionalPolicyOutcomeRecord/.test(bridge)
      && /PBK_EMOTION_WORLD_MODEL_ENDPOINT/.test(bridge)
      && /async function runEmotionWorldModelProvider/.test(bridge)
      && /modelProvider:\s*'external_world_model'/.test(bridge)
      && /modelProvider:\s*'heuristic_fallback'/.test(bridge)
      && /\/api\/emotions\/call/.test(bridge)
      && /\/api\/emotion\/predict/.test(bridge)
      && /\/api\/emotion\/policies\/experiments/.test(bridge)
      && /\/api\/emotion\/policies\/assign/.test(bridge)
      && /\/api\/emotion\/policies\/outcome/.test(bridge)
      && /\/api\/leads\/:id\/emotional-state/.test(bridge)
      && /status\.emotionalIntelligence/.test(bridge)
      && /worldModelConfigured/.test(bridge)
      && /dominantEmotion/.test(bridge)
      && /emotion_pipeline_ready/.test(emotionPipelineSmoke)
      && /promptEmotion/.test(emotionPipelineSmoke)
      && /emotionalPolicyVariant/.test(emotionPipelineSmoke)
      && /emotional_policy_experiment_created/.test(emotionPipelineSmoke)
      && /emotional_policy_outcome_recorded/.test(emotionPipelineSmoke)
      && /Ava prompt frame did not include dominant emotional memory/.test(emotionPipelineSmoke)
      && /\/api\/emotions\/call/.test(emotionPipelineSmoke)
      && /\/api\/emotion\/predict/.test(emotionPipelineSmoke)
      && /\/api\/leads\/smoke-emotion-lead\/emotional-state/.test(emotionPipelineSmoke)
      && /emotion_world_model_provider_ready/.test(emotionWorldModelSmoke)
      && /PBK_EMOTION_WORLD_MODEL_ENDPOINT/.test(emotionWorldModelSmoke)
      && /mock-emotional-onnx-v0/.test(emotionWorldModelSmoke)
      && /emotion_world_model_training_pipeline_ready/.test(emotionWorldModelTrainingSmoke)
      && /emotion_world_model_training_ready/.test(emotionWorldModelTrainer)
      && /pbk-emotional-transition-regressor-v1/.test(emotionWorldModelTrainer)
      && /--export-onnx/.test(emotionWorldModelTrainingSmoke)
      && /blocked_missing_dependencies/.test(emotionWorldModelTrainingSmoke)
      && /emotion-world-model-dataset\.jsonl/.test(emotionWorldModelTrainer)
      && /PYTHONIOENCODING:\s*'utf-8'/.test(emotionWorldModelTrainer)
      && /PYTHONUTF8:\s*'1'/.test(emotionWorldModelTrainer)
      && /train_emotion_world_model_onnx\.py/.test(emotionWorldModelTrainer)
      && /torch\.onnx\.export/.test(emotionOnnxExporter)
      && /numpy/.test(emotionRequirements)
      && /torch/.test(emotionRequirements)
      && /onnx/.test(emotionRequirements)
      && /onnxscript/.test(emotionRequirements)
      && /onnxruntime/.test(emotionRequirements)
      && /emotion_world_model_server_ready/.test(emotionWorldModelServer)
      && /onnxruntime-node/.test(emotionWorldModelServer)
      && /sanitizeOnnxRunner/.test(emotionWorldModelServer)
      && /runner:\s*'onnxruntime-node'/.test(emotionWorldModelServer)
      && /runner:\s*'json_baseline_fallback'/.test(emotionWorldModelServer)
      && /\/predict/.test(emotionWorldModelServer)
      && /emotion-world-model:train/.test(pkg)
      && /emotion-world-model:export-onnx/.test(pkg)
      && /emotion-world-model:serve/.test(pkg)
      && /test:emotion/.test(pkg)
      && /test:emotion/.test(pkg.match(/"test:founder":[^\n]+/)?.[0] || ''),
  },
  {
    name: 'X-factor dimensions expose production-safe control-plane endpoints',
    ok: /function buildXFactorCapabilitySnapshot/.test(bridge)
      && /function predictSpeechEmotionRecord/.test(bridge)
      && /function inferEmotionalTagsRecord/.test(bridge)
      && /function recordEmotionalLearningInteractionRecord/.test(bridge)
      && /function createProactiveOutreachRule/.test(bridge)
      && /function evaluateSelfImprovementDecision/.test(bridge)
      && /function createEmotionProsodyPlan/.test(bridge)
      && /function classifyInterruptionRecord/.test(bridge)
      && /function recommendCrossLeadSkillTransfer/.test(bridge)
      && /function createPostCallCoachingReport/.test(bridge)
      && /function decomposeGoalPlan/.test(bridge)
      && /\/api\/intelligence\/capabilities/.test(bridge)
      && /\/api\/emotion\/ser\/predict/.test(bridge)
      && /\/api\/emotion\/infer-tags/.test(bridge)
      && /\/api\/emotion\/learning\/interactions/.test(bridge)
      && /\/api\/outreach\/automations\/propose/.test(bridge)
      && /\/api\/self-improvement\/evaluate/.test(bridge)
      && /\/api\/voice\/emotion-prosody/.test(bridge)
      && /\/api\/interruption\/classify/.test(bridge)
      && /\/api\/skills\/transfer\/recommend/.test(bridge)
      && /\/api\/post-call\/coach/.test(bridge)
      && /\/api\/goals\/decompose/.test(bridge)
      && /approval_first/.test(bridge)
      && /providerWritesBlocked/.test(bridge)
      && /x_factor_dimensions_ready/.test(xFactorDimensionsSmoke)
      && /speech_emotion_prediction/.test(xFactorDimensionsSmoke)
      && /emotional_learning_loop/.test(xFactorDimensionsSmoke)
      && /proactive_outreach_rule_created/.test(xFactorDimensionsSmoke)
      && /self_improvement_decision_recorded/.test(xFactorDimensionsSmoke)
      && /emotion_synchronized_prosody/.test(xFactorDimensionsSmoke)
      && /interruption_intent_classified/.test(xFactorDimensionsSmoke)
      && /cross_lead_skill_recommendations/.test(xFactorDimensionsSmoke)
      && /post_call_coaching_report_created/.test(xFactorDimensionsSmoke)
      && /goal_plan_created/.test(xFactorDimensionsSmoke)
      && /test:x-dimensions/.test(pkg)
      && /test:x-dimensions/.test(pkg.match(/"test:founder":[^\n]+/)?.[0] || ''),
  },
  {
    name: 'Founder Approval Board shows locked state instead of fake zero approvals when bridge key is missing',
    ok: /function renderApprovalBridgeKeyRequired/.test(index)
      && /textContent = '- Locked'/.test(index)
      && /textContent = `\$\{label\} Locked`/.test(index)
      && /function renderRuntimeLoadingState/.test(index)
      && /openClawNeedsBridgeApiKey\(config, '\/state'\)[\s\S]*renderApprovalBridgeKeyRequired/.test(index),
  },
  {
    name: 'Background bridge health sync cannot erase a saved API key',
    ok: /function saveOpenClawConfig\(partial = \{\}, options = \{\}\)/.test(index)
      && /!options\.allowEmptyApiKey && current\.apiKey && partial\.apiKey === ''/.test(index)
      && /allowEmptyApiKey: Object\.prototype\.hasOwnProperty\.call\(config, 'apiKey'\)/.test(index),
  },
  {
    name: 'Ava and Rex production debugging exposes status, thought stream, call replay, and manual-control contracts',
    ok: /function buildAgentStatusBundle/.test(bridge)
      && /function buildAgentThoughtStream/.test(bridge)
      && /function buildCallReplayBundle/.test(bridge)
      && /function buildManualControlStatus/.test(bridge)
      && /\/api\/agents\/status/.test(bridge)
      && /\/api\/debug\/agent-thoughts/.test(bridge)
      && /\/api\/calls\/:id\/replay/.test(bridge)
      && /\/api\/manual\/status/.test(bridge)
      && /Human-initiated work stays available/.test(bridge)
      && /ai_initiated_calls/.test(bridge)
      && /contract_sends/.test(bridge),
  },
  {
    name: 'Ava typed responses do not route negated safety instructions into provider writes',
    ok: /function stripNegatedActionInstructions/.test(bridge)
      && /function looksLikeAvaTextResponseCommand/.test(bridge)
      && /responseOnlyCommand/.test(bridge)
      && /routedTo = 'ava_conversation_intelligence'/.test(bridge)
      && /detectToolFirstIntent\(intentCommand/.test(bridge)
      && /const lower = intentCommand\.toLowerCase/.test(bridge)
      && /result\.answer[\s\S]*result\.nextBestPhrase[\s\S]*toolResponse\.message/.test(index)
      && /avaResponseOnlyCommand/.test(openclawSmoke)
      && /Do not call, text, email, or create contracts/.test(openclawSmoke)
      && /ava_conversation_intelligence/.test(openclawSmoke),
  },
  {
    name: 'Ava call intelligence probes, locks, and closes down PBK deal paths',
    ok: /PBK_PATH_SCRIPT_TRIGGERS/.test(bridge)
      && /PBK_PATH_PROBE_QUESTIONS/.test(bridge)
      && /function inferAvaDealPathDecision/.test(bridge)
      && /pathDecision/.test(bridge)
      && /Path locked: stop broad probing/.test(bridge)
      && /smoke-test-path-decision/.test(openclawSmoke)
      && /expectedPath: 'mt'/.test(openclawSmoke)
      && /expectedPath: 'land'/.test(openclawSmoke),
  },
  {
    name: 'Ava live-call intelligence embeds the additive $100K War Manual layer',
    ok: /PBK_100K_WAR_MANUAL_REVISION/.test(bridge)
      && /PBK_WAR_MANUAL_EMOTIONAL_STATES/.test(bridge)
      && /PBK_WAR_MANUAL_HIDDEN_MOTIVATORS/.test(bridge)
      && /PBK_WAR_MANUAL_OBJECTION_DECODER/.test(bridge)
      && /PBK_WAR_MANUAL_PATHS/.test(bridge)
      && /function buildAvaWarManualContext/.test(bridge)
      && /function selectAvaListenProbeStep/.test(bridge)
      && /function selectAvaPsychologyMove/.test(bridge)
      && /function getAvaWarManualToneMode/.test(bridge)
      && /warManual/.test(bridge)
      && /War manual:/.test(bridge)
      && /7-second path picker/.test(bridge)
      && /L\\.I\\.S\\.T\\.E\\.N\\./.test(bridge)
      && /cash_scout/.test(bridge)
      && /rbp_land/.test(bridge)
      && /fifty_plus_objection_decoder/.test(bridge),
  },
  {
    name: 'Ava active-listening call flow makes live replies feel present and turn-based',
    ok: /PBK_ACTIVE_LISTENING_REVISION/.test(bridge)
      && /PBK_CALL_FLOW_SCHEMA_SQL/.test(bridge)
      && /CREATE TABLE IF NOT EXISTS public\.call_flow/.test(bridge)
      && /CREATE TABLE IF NOT EXISTS public\.call_flow_edges/.test(bridge)
      && /ALTER TABLE public\.call_flow ENABLE ROW LEVEL SECURITY/.test(bridge)
      && /function extractAvaSellerKeyPhrase/.test(bridge)
      && /function ensureAvaSellerReplyHook/.test(bridge)
      && /function selectAvaCallFlowNextStep/.test(bridge)
      && /function buildAvaActiveListeningContext/.test(bridge)
      && /async function waitForSellerResponse/.test(bridge)
      && /responseRequired/.test(bridge)
      && /waitingForSeller/.test(bridge)
      && /strategicPauseMs/.test(bridge)
      && /twenty_year_pro_ready/.test(bridge)
      && /call_flow\/call_flow_edges/.test(bridge)
      && /Seller just said/.test(bridge),
  },
  {
    name: 'Ava master probing separates owner, agent, and decision-maker paths safely',
    ok: /PBK_CALLER_ROLE_REVISION/.test(bridge)
      && /PBK_AGENT_ONLY_PATH_ALIASES/.test(bridge)
      && /function detectAvaCallerRole/.test(bridge)
      && /function buildAvaMasterProbe/.test(bridge)
      && /function guardAvaAgentOnlyPathDecision/.test(bridge)
      && /function enforceAvaOwnerSafeReply/.test(bridge)
      && /full commission/.test(bridge)
      && /keep you in the deal/.test(bridge)
      && /are you the property owner, or are you a real estate agent representing the seller/.test(bridge)
      && /Creative Finance and Multi-Family are agent-only/.test(bridge)
      && /Ava did not reassure the agent that commission stays protected before probing/.test(openclawSmoke)
      && /Ava allowed an owner call to stay on a CF\/MF path/.test(openclawSmoke),
  },
  {
    name: 'Ava full-intelligence mode promotes best context on weak transcripts',
    ok: /PBK_AVA_FULL_INTELLIGENCE_REVISION/.test(bridge)
      && /PBK_INTELLIGENCE_MODE/.test(bridge)
      && /function isAvaFullIntelligenceMode/.test(bridge)
      && /function selectAvaBestContextTranscript/.test(bridge)
      && /function buildAvaFullIntelligenceContext/.test(bridge)
      && /fullIntelligence/.test(bridge)
      && /bestTranscript/.test(bridge)
      && /weakTranscript/.test(bridge)
      && /weak_seller_utterance_context_promoted/.test(bridge)
      && /Ava full intelligence mode was not enabled for a weak transcript turn/.test(openclawSmoke)
      && /Ava did not promote recent seller context over the weak current transcript/.test(openclawSmoke),
  },
  {
    name: 'Ava voice uses DeepSeek call-state context and a speech-safe TTS boundary',
    ok: /function buildAvaCallStateSummary/.test(bridge)
      && /Call state summary/.test(bridge)
      && /Use the call-state summary as the source of truth/.test(bridge)
      && /Never speak phone numbers, call_control_id values, stream_id values/.test(bridge)
      && /function sanitizeAvaSpokenOutput/.test(bridge)
      && /function buildElevenLabsTtsRequest[\s\S]*sanitizeAvaSpokenOutput/.test(bridge)
      && /async function speakTelnyxCall[\s\S]*sanitizeAvaSpokenOutput/.test(bridge)
      && /call_control_id cc-smoke-123456/.test(openclawSmoke)
      && /Live reply preview leaked internal IDs or phone-like text/.test(openclawSmoke),
  },
  {
    name: 'OpenAI exhaustion and chat-bubble TTS fall back safely',
    ok: /runOpenAiWebSearch\(query, \{ \.\.\.params, fallback: false \}\)/.test(bridge)
      && /return runDeepSeekWebSearchFallback\(cleanQuery, params/.test(bridge)
      && /providerKey === 'deepseek'[\s\S]*\? 'DeepSeek fallback'/.test(bridge)
      && /leadCaptureSuppressed/.test(bridge)
      && /speakAvaBrowserTtsFallback\(clean,\s*`elevenlabs-\$\{response\.status\}`\)/.test(index)
      && /source: 'ava-chat-bubble-tts'/.test(openclawSmoke)
      && /Public Ava TTS diagnostic text still created a lead/.test(openclawSmoke),
  },
  {
    name: 'Live voice diagnostics expose hearing, last spoken output, and compact loading',
    ok: /BUILD_REVISION = '2026-05-(?:25-(?:ava-call-repair-hardening|war-manual-live-call-intelligence)|26-(?:active-listening-call-flow|live-call-diagnostic-loop)|27-(?:ava-turn-taking-hardening|ava-role-probing-guardrails|ava-full-intelligence-context|ava-live-quality-inline|ava-context-resolver))'/.test(bridge)
      && /function recordAvaSpokenOutputDiagnostics/.test(bridge)
      && /lastAvaSpokenOutput/.test(bridge)
      && /\/api\/voice\/status/.test(bridge)
      && /\/api\/debug\/last-spoken/.test(bridge)
      && /\/api\/debug\/call-state/.test(bridge)
      && /\/api\/debug\/call-trace/.test(bridge)
      && /\/api\/debug\/inject-transcript/.test(bridge)
      && /\/api\/debug\/reset-lead-cache/.test(bridge)
      && /function buildTelnyxMediaSessionDiagnostics/.test(bridge)
      && /async function injectDebugTranscriptIntoLiveCall/.test(bridge)
      && /deepgramSocketOpen/.test(bridge)
      && /lastAvaPreview/.test(bridge)
      && /lastAvaSpoken/.test(bridge)
      && /bantStatus/.test(bridge)
      && /prosody/.test(bridge)
      && /telnyxAvaTurnLocksByCallId/.test(bridge)
      && /caller_requested_floor/.test(bridge)
      && /weak_seller_utterance/.test(bridge)
      && /duplicate_media_stream_replaced/.test(bridge)
      && /maskPhoneForDiagnostics/.test(bridge)
      && /leadResolver: inboundDiagnostic/.test(bridge)
      && /redis_call_state_active_resurrection_blocked/.test(bridge)
      && /REDIS_ACTIVE_CALL_STALE_MS/.test(bridge)
      && /recordCallTrace\('lead_context_resolved'/.test(bridge)
      && /recordCallTrace\('deepgram_transcript'/.test(bridge)
      && /recordCallTrace\('ava_phone_reply'/.test(bridge)
      && /recordCallTrace\('debug_injected_transcript'/.test(bridge)
      && /buildStateSnapshot\(\{ compact \}\)/.test(bridge)
      && /state\?compact=1/.test(index)
      && /openClawReadCache/.test(index)
      && /OPENCLAW_READ_CACHE_TTL_MS/.test(index)
      && /Voice status endpoint did not return live diagnostics/.test(openclawSmoke)
      && /Call-state debug endpoint did not return a safe diagnostic envelope/.test(openclawSmoke)
      && /Call-trace debug endpoint did not return a safe diagnostic envelope/.test(openclawSmoke)
      && /Inject-transcript debug endpoint did not safely report a missing active media session/.test(openclawSmoke)
      && /Compact state endpoint did not report compact mode/.test(openclawSmoke),
  },
  {
    name: 'Optional Redis shared state prepares bridge for multi-instance calls and singleton loops',
    ok: /createClient as createRedisClient/.test(bridge)
      && /PBK_REDIS_URL/.test(bridge)
      && /function getSharedRedisClient/.test(bridge)
      && /function syncTelnyxSessionToRedis/.test(bridge)
      && /function getSharedTelnyxCallStates/.test(bridge)
      && /redisAcquireLease\(`closed-loop:\$\{label\}`/.test(bridge)
      && /sharedMediaSessions/.test(bridge)
      && /providers:\s*\{[\s\S]*redis: getRedisProviderMeta\(\)/.test(bridge)
      && /PBK_REDIS_URL/.test(renderConfig)
      && /Voice status endpoint did not expose optional Redis shared-state diagnostics/.test(openclawSmoke),
  },
  {
    name: 'Production pristine debugging script names remaining ops gaps without mutating live state',
    ok: /production-pristine-check\.mjs/.test(pkg)
      && /debug:production/.test(pkg)
      && /\/api\/agents\/status/.test(productionPristineCheck)
      && /\/api\/manual\/status/.test(productionPristineCheck)
      && /\/api\/debug\/agent-thoughts/.test(productionPristineCheck) === false
      && /\/api\/slack\/health\?force=1/.test(productionPristineCheck)
      && /slack_interactive_bot_auth_invalid/.test(productionPristineCheck)
      && /PBK_SLACK_BOT_TOKEN/.test(productionPristineCheck)
      && /slackHealth/.test(productionPristineCheck)
      && /\/api\/emotion\/predict/.test(productionPristineCheck)
      && /pending_approvals_not_cleared/.test(productionPristineCheck)
      && /openclaw_gateway_not_live/.test(productionPristineCheck)
      && /PBK_CHECK_OPENCLAW_GATEWAY_GAP/.test(productionPristineCheck)
      && /local desktop\/file\/terminal automation is required/.test(productionPristineCheck)
      && /emotion_transition_samples_low/.test(productionPristineCheck)
      && /onnx_world_model_inactive/.test(productionPristineCheck)
      && /manual_control_contract_missing/.test(productionPristineCheck)
      && /Do not bulk-close without founder\/business decision/.test(productionPristineCheck),
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
      && /BROWSER_VOICE_DEEPGRAM_KEEPALIVE_MS/.test(bridge)
      && /type:\s*'KeepAlive'/.test(bridge)
      && /type:\s*'Finalize'/.test(bridge)
      && /type:\s*'CloseStream'/.test(bridge)
      && /buildBrowserVoiceReplayChunks/.test(bridge)
      && /firstAudioChunk/.test(bridge)
      && /containerizedAudio:\s*true/.test(bridge)
      && /listenVersion:\s*isDeepgramFluxModel\(normalizedModel\)\s*\?\s*'v2'\s*:\s*'v1'/.test(bridge)
      && /BROWSER_VOICE_DEEPGRAM_FALLBACK_MODEL/.test(bridge)
      && /normalizeBrowserVoiceDeepgramModel/.test(bridge)
      && /nova-2/.test(bridge)
      && /utteranceEndMs:\s*1000/.test(bridge)
      && /model\s*===\s*'nova-2-general'\s*\|\|\s*model\s*===\s*'nova-2-meeting'\)\s*return\s*'nova-2'/.test(bridge)
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
      && /session\.frameCount === 1/.test(bridge)
      && /session\.audioBytes \+= frame\.length/.test(bridge)
      && /firstFrameBytes/.test(bridge),
  },
  {
    name: 'Telnyx voice routing diagnostic compares default number to bridge Call Control connection',
    ok: /buildTelnyxVoiceRoutingDiagnostic/.test(bridge)
      && /getTelnyxCallControlApplication/.test(bridge)
      && /\/api\/telnyx\/voice-routing/.test(bridge)
      && /connectionMatchesBridge/.test(bridge)
      && /defaultNumberConnectionId/.test(bridge)
      && /expectedInboundWebhookUrls/.test(bridge)
      && /webhookMatchesBridge/.test(bridge),
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
    name: 'Telnyx inbound webhook keeps SMS away from call-control routing',
    ok: /function\s+isTelnyxMessageWebhook/.test(bridge)
      && /telnyxWebhookPath && !isTelnyxInboundCallWebhook\(body\)/.test(bridge)
      && /mappedEvent:\s*mapped\.eventType/.test(bridge)
      && /webhookType:\s*isTelnyxMessageWebhook\(body\)\s*\?\s*'message'\s*:\s*'non-call'/.test(bridge),
  },
  {
    name: 'Inbound Ava calls do not speak placeholder caller names',
    ok: /function\s+isPlaceholderInboundLeadName/.test(bridge)
      && /function\s+getSpokenLeadName/.test(bridge)
      && /lead\.found && spokenLeadName/.test(bridge)
      && /seller:\s*\{\s*name:\s*''/.test(bridge),
  },
  {
    name: 'After-hours voicemail is opt-in and still streams caller audio when enabled',
    ok: /PBK_INBOUND_AFTER_HOURS_VOICEMAIL_ENABLED/.test(bridge)
      && /INBOUND_AFTER_HOURS_VOICEMAIL_ENABLED && options\.forceAfterHours !== false/.test(bridge)
      && /route === 'after_hours_voicemail'[\s\S]*action:\s*'streaming_start'/.test(bridge)
      && /streamRequired = \['ava_qualify', 'after_hours_voicemail'\]/.test(bridge),
  },
  {
    name: 'Telnyx Deepgram live socket uses phone-safe model and captures 400 bodies',
    ok: /PBK_DEEPGRAM_TELNYX_LIVE_MODEL/.test(bridge)
      && /nova-2-phonecall/.test(bridge)
      && /const telnyxLiveModel = getTelnyxDeepgramLiveModel\(\)/.test(bridge)
      && /model:\s*telnyxLiveModel/.test(bridge)
      && /utteranceEndMs:\s*1000/.test(bridge)
      && /Unexpected server response: \$\{response\.statusCode\}\$\{body/.test(readFileSync(resolve(root, 'scripts/pbk-deepgram-client.mjs'), 'utf8')),
  },
  {
    name: 'Telnyx Deepgram no-transcript diagnostics expose bytes, model, and last event',
    ok: /Deepgram media stream ended without a final transcript/.test(bridge)
      && /frames=\$\{session\.frameCount\}, bytes=\$\{session\.audioBytes\}/.test(bridge)
      && /model=\$\{session\.deepgramModel/.test(bridge)
      && /lastEvent=\$\{session\.lastDeepgramEvent/.test(bridge)
      && /telnyxLiveModel:\s*getTelnyxDeepgramLiveModel\(\)/.test(bridge),
  },
  {
    name: 'Telnyx Deepgram STT falls back from PCMU to decoded linear16 when audio has no words',
    ok: /function\s+decodeG711FrameToLinear16/.test(bridge)
      && /TELNYX_DEEPGRAM_NO_TRANSCRIPT_FALLBACK_MS/.test(bridge)
      && /rotateTelnyxDeepgramToLinear16Fallback/.test(bridge)
      && /encoding:\s*'linear16'/.test(bridge)
      && /replayedFrameCount/.test(bridge)
      && /Deepgram Telnyx STT rotated to linear16 fallback/.test(bridge),
  },
  {
    name: 'Telnyx Deepgram live socket sends KeepAlive during caller pauses',
    ok: /TELNYX_DEEPGRAM_KEEPALIVE_MS/.test(bridge)
      && /startTelnyxDeepgramKeepAliveTimer/.test(bridge)
      && /type:\s*'KeepAlive'/.test(bridge)
      && /Deepgram KeepAlive could not be sent for Telnyx media/.test(bridge),
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
      && /function\s+sanitizeAvaSpokenOutput/.test(bridge)
      && /sanitizeAvaSpokenOutput\(text,\s*fallback\)/.test(bridge)
      && /provider_reasoning_only/.test(bridge)
      && !/message\.content\s*\|\|\s*message\.reasoning_content/.test(bridge),
  },
  {
    name: 'Ava live Telnyx replies prioritize inline full-intelligence strategist without robotic anti-repeat',
    ok: /function\s+buildFastTelnyxLiveAvaReplyText/.test(bridge)
      && /TELNYX_LIVE_REPLY_STRATEGIST_MODE[^;\n]+inline/.test(bridge)
      && /TELNYX_LIVE_REPLY_STRATEGIST_TIMEOUT_MS[^;\n]+1200/.test(bridge)
      && /replyMode:\s*'strategist_inline'/.test(bridge)
      && /replyMode:\s*'fast_local'/.test(bridge)
      && /session\.masterProbe\?\.mustAskBeforePitch && mode !== 'inline'/.test(bridge)
      && /maxTokens:\s*320/.test(bridge)
      && /deepseek_call_started/.test(bridge)
      && /deepseek_call_completed/.test(bridge)
      && /staleExpired/.test(bridge)
      && !/I do not want to repeat myself here/.test(bridge)
      && /[Ww]hat would help me answer that the right way/.test(bridge),
  },
  {
    name: 'Ava live Telnyx replies are written back as conversation turns',
    ok: /lastAvaReplyTranscript/.test(bridge)
      && /speaker:\s*'Ava'/.test(bridge)
      && /source:\s*'pbk-live-reply'/.test(bridge)
      && /transcriptForReply === session\.lastAvaReplyTranscript/.test(bridge),
  },
  {
    name: 'Ava live-call context resolver decides the next move before DeepSeek phrases it',
    ok: /async function resolveAvaLiveCallContext/.test(bridge)
      && /function buildAvaResolvedNextMove/.test(bridge)
      && /function buildAvaPhrasingEnginePrompt/.test(bridge)
      && /Promise\.all\(\[/.test(bridge)
      && /withTimeout\([^,\n]+,\s*150,\s*'ava live context resolver'/.test(bridge)
      && /strategyLocked:\s*true/.test(bridge)
      && /Do not change the strategy\. Only phrase it\./.test(bridge)
      && /contextResolver/.test(bridge)
      && /exactNextMove/.test(bridge),
  },
  {
    name: 'Ava episodic memory embeds calls and retrieves similar winning calls in the resolver',
    ok: /CREATE TABLE IF NOT EXISTS public\.call_embeddings/.test(callEmbeddingsMigration)
      && /embedding VECTOR\(1536\)/.test(callEmbeddingsMigration)
      && /CREATE OR REPLACE FUNCTION public\.match_call_embeddings/.test(callEmbeddingsMigration)
      && /text-embedding-3-small/.test(callEmbeddingsScript)
      && /INSERT INTO public\.call_embeddings/.test(callEmbeddingsScript)
      && /async function createOpenAiEmbedding/.test(bridge)
      && /async function retrieveSimilarCallMemories/.test(bridge)
      && /episodicMemory/.test(bridge)
      && /match_call_embeddings/.test(bridge)
      && /Similar past winning call/.test(bridge),
  },
  {
    name: 'Ava live RAG retrieves Brain knowledge inside the call resolver before DeepSeek phrases',
    ok: /AVA_LIVE_RAG_ENABLED/.test(bridge)
      && /async function retrieveLiveBrainKnowledge/.test(bridge)
      && /function formatLiveBrainKnowledgeForPrompt/.test(bridge)
      && /live_brain_rag_retrieved/.test(bridge)
      && /live_brain_rag/.test(bridge)
      && /liveKnowledge/.test(bridge)
      && /Live Brain RAG knowledge/.test(bridge)
      && /answerBrainQuery\(state,\s*cleanQuery\)/.test(bridge)
      && /queryPbkKnowledgeRecords/.test(bridge)
      && /withTimeout\(retrieveLiveBrainKnowledge/.test(bridge),
  },
  {
    name: 'Ava GOOD-style goal inference tracks multiple seller goals and uncertainty every turn',
    ok: /AVA_GOAL_INFERENCE_GOALS/.test(bridge)
      && /function buildAvaGoalInference/.test(bridge)
      && /function updateAvaGoalInference/.test(bridge)
      && /goal_uncertainty_high/.test(bridge)
      && /goal_inference_updated/.test(bridge)
      && /session\.userGoals/.test(bridge)
      && /goalInference/.test(bridge)
      && /topGoal/.test(bridge)
      && /secondaryGoals/.test(bridge)
      && /goalClarifyingQuestion/.test(bridge)
      && /user_goals/.test(bridge),
  },
  {
    name: 'Normal inbound Ava calls request Telnyx audio recording once before route branching',
    ok: /PBK_TELNYX_RECORD_INBOUND_CALLS/.test(bridge)
      && /async function maybeRecordInboundTelnyxCall/.test(bridge)
      && /inbound_recording_start/.test(bridge)
      && /action:\s*'record',\s*result:\s*await maybeRecordInboundTelnyxCall/.test(bridge)
      && !/after_hours_voicemail'[\s\S]{0,1400}action:\s*'record',\s*result:\s*await recordTelnyxCall/.test(bridge),
  },
  {
    name: 'Inbound lead context never falls back to another seller when phone or lead id is explicit',
    ok: /explicitLeadId/.test(bridge)
      && /hasExplicitContext/.test(bridge)
      && /matchedLeadImport/.test(bridge)
      && /matchedCall/.test(bridge)
      && /hasExplicitContext \? '' : fallbackApproval\.leadName/.test(bridge)
      && /hasExplicitContext \? '' : fallbackApproval\.address/.test(bridge)
      && /lead_context_cache_cleared/.test(bridge),
  },
  {
    name: 'Ava live-call repair replies bypass anti-repeat and skip empty acknowledgements',
    ok: /buildTelnyxLiveConversationalRepairReply/.test(bridge)
      && /audio_check_repair/.test(bridge)
      && /conversational_repair_bypass/.test(bridge)
      && /shouldSkipTelnyxLiveAckOnlyReply/.test(bridge)
      && /ava_phone_reply_skipped/.test(bridge),
  },
  {
    name: 'Call trace diagnostics preserve transcript arrays and phone playback send details',
    ok: /Array\.isArray\(value\)/.test(bridge)
      && /speaker = item\.speaker/.test(bridge)
      && /speakOutputFormat/.test(bridge)
      && /speakBytes/.test(bridge)
      && /mediaPlaybackMode/.test(bridge),
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
      && /bridge_ava_primary/.test(bridge)
      && /shouldStartTelnyxHostedAiAssistant/.test(bridge)
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
    ok: /api\/public\/ava-chat/.test(bridge)
      && /pbk-ava-public-chat/.test(widget)
      && /export\s+const\s+handler/.test(netlifyPublicAvaFunction)
      && /from\s*=\s*"\/api\/public\/ava-chat"/.test(netlifyConfig)
      && /to\s*=\s*"\/\.netlify\/functions\/public-ava-chat"/.test(netlifyConfig),
  },
  {
    name: 'Public Ava chat keeps seller-facing replies separate from internal brain summaries',
    ok: /function\s+buildPublicAvaLeadAnswer/.test(bridge)
      && /function\s+isPublicAvaBrainAnswerSafe/.test(bridge)
      && /lead\.hasLeadSignal\s*\?\s*null\s*:\s*answerBrainQuery/.test(bridge)
      && /Rex here\|Mentor:\|PBK Research Technique/.test(bridge),
  },
  {
    name: 'Netlify public Ava chat is rate-limited before forwarding to the bridge',
    ok: /PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_MAX/.test(netlifyPublicAvaFunction)
      && /PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_WINDOW_MS/.test(netlifyPublicAvaFunction)
      && /Rate limit exceeded/.test(netlifyPublicAvaFunction)
      && /Retry-After/.test(netlifyPublicAvaFunction)
      && /X-RateLimit-Remaining/.test(netlifyPublicAvaFunction),
  },
  {
    name: 'Netlify operational proxy propagates request IDs for cross-layer debugging',
    ok: /X-Request-ID/.test(netlifyBridgeProxyFunction)
      && /getRequestId/.test(netlifyBridgeProxyFunction)
      && /headers\['X-Request-ID'\]\s*=/.test(netlifyBridgeProxyFunction)
      && /responseHeaders\['X-Request-ID'\]\s*=/.test(netlifyBridgeProxyFunction),
  },
  {
    name: 'Hosted settings include a safe clear-key action for stale bridge sessions',
    ok: /data-plugin-action="clear-key"/.test(index)
      && /action === 'clear-key'/.test(index)
      && /stopOpenClawRealtime\(\)/.test(index)
      && /stopOpenClawPolling\(\)/.test(index)
      && /Bridge key cleared/.test(index),
  },
  {
    name: 'Netlify document PDF function is explicitly routed',
    ok: /export\s+const\s+handler/.test(netlifyDocumentsPdfFunction)
      && /from\s*=\s*"\/api\/documents\/pdf"/.test(netlifyConfig)
      && /to\s*=\s*"\/\.netlify\/functions\/documents-pdf"/.test(netlifyConfig),
  },
  {
    name: 'Netlify hosted app proxies operational bridge routes through same-origin functions',
    ok: /export\s+const\s+handler/.test(netlifyBridgeProxyFunction)
      && /PBK_BRIDGE_URL/.test(netlifyBridgeProxyFunction)
      && /authorization/.test(netlifyBridgeProxyFunction)
      && /X-PBK-Team-Token/.test(netlifyBridgeProxyFunction)
      && /isBase64Encoded/.test(netlifyBridgeProxyFunction)
      && /from\s*=\s*"\/state"/.test(netlifyConfig)
      && /from\s*=\s*"\/invoke"/.test(netlifyConfig)
      && /from\s*=\s*"\/api\/\*"/.test(netlifyConfig)
      && /from\s*=\s*"\/brain\/\*"/.test(netlifyConfig)
      && /to\s*=\s*"\/\.netlify\/functions\/pbk-bridge-proxy\?path=/.test(netlifyConfig)
      && /host\.includes\('pbkcommandcenter'\) \|\| host\.endsWith\('\.netlify\.app'\)/.test(index)
      && /PBK hosted bridge proxy is preconfigured through Netlify/.test(index),
  },
  {
    name: 'Netlify hosted app preserves direct clean links without stealing API rewrites',
    ok: netlifySpaFallbackOrdered && netlifyBrainCleanRouteOrdered,
  },
  {
    name: 'Direct Netlify clean links open the intended Command Center page',
    ok: cleanPathRouterWired,
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
    'TOTP is intentionally optional; verify enrollment only before enabling PBK_TOTP_REQUIRED=true',
    'Marketing-site snippet placement if that site is a separate repository',
  ],
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
