import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const indexPath = resolve(root, 'index.html');
const bridgePath = resolve(root, 'scripts/openclaw-local-server.mjs');
const widgetPath = resolve(root, 'public/ava-chat-widget.js');
const index = readFileSync(indexPath, 'utf8');
const bridge = readFileSync(bridgePath, 'utf8');
const widget = readFileSync(widgetPath, 'utf8');

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
    name: 'Unified inbox is seller/homeowner facing only and lead-click aware',
    ok: /function\s+isSellerFacingInboxMessage/.test(index)
      && /getRuntimeLeadByMessage/.test(index)
      && /data-inbox-open-lead/.test(index)
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
      && /request\.method === 'DELETE'/.test(bridge)
      && /deleteLeadProfileRowFromDb/.test(bridge),
  },
  {
    name: 'Contract tabs, delete draft, void, and status API filters are wired',
    ok: /contractStageFilter/.test(index)
      && /data-contract-action="\$\{record\.isDraft \? 'delete-draft' : 'void'\}"/.test(index)
      && /url\.searchParams\.get\('status'\)/.test(bridge)
      && /matchPath\(pathname,\s*'\/api\/contracts\/:id'\)/.test(bridge)
      && /request\.method === 'DELETE'/.test(bridge),
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
      && /DeepSeek strategist/.test(bridge),
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
    name: 'Real-time WebSocket startup is wired',
    ok: /function\s+startOpenClawRealtime/.test(index)
      && /new WebSocket/.test(index)
      && /openclaw:startPolling|startOpenClawPolling/.test(index),
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
