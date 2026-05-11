import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const indexPath = resolve(root, 'index.html');
const bridgePath = resolve(root, 'scripts/openclaw-local-server.mjs');
const heartbeatManagerPath = resolve(root, 'scripts/pbk-openclaw-heartbeat.ps1');
const widgetPath = resolve(root, 'public/ava-chat-widget.js');
const packagePath = resolve(root, 'package.json');
const index = readFileSync(indexPath, 'utf8');
const bridge = readFileSync(bridgePath, 'utf8');
const heartbeatManager = readFileSync(heartbeatManagerPath, 'utf8');
const widget = readFileSync(widgetPath, 'utf8');
const pkg = readFileSync(packagePath, 'utf8');

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
    name: 'Ava voice avoids fake listening and gives actionable connection diagnostics',
    ok: /Browser microphone streaming is disabled/.test(index)
      && /this browser is missing the private PBK Bridge API key/.test(index)
      && /Ava will stay in text mode instead of pretending to listen/.test(index)
      && /showAvaVoiceDiagnostic/.test(index),
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
];

const failed = checks.filter((check) => !check.ok);
const report = {
  ok: failed.length === 0,
  checkedAt: new Date().toISOString(),
  checks,
  remainingOperatorProof: [
    'One answered Telnyx -> Deepgram phone call with speech',
    'Authenticator enrollment verification before setting PBK_TOTP_REQUIRED=true',
    'Marketing-site snippet placement if that site is a separate repository',
  ],
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
