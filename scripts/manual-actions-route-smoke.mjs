import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { buildAgentRuntimeSmokeEnv } from './agent-runtime-smoke-isolation.mjs';

const repoRoot = process.cwd();
const port = String(19100 + Math.floor(Math.random() * 2500));
const apiKey = randomUUID();
const teamPasscode = randomUUID();

async function waitForBridge(baseUrl, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // Keep polling until OpenClaw is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('OpenClaw bridge did not become ready for manual action route smoke.');
}

async function requestJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

function assertManualRouteStructured(label, result) {
  assert.notEqual(result.status, 502, `${label} should not surface provider delivery as a bridge 502.`);
  assert.ok(
    result.json && typeof result.json === 'object',
    `${label} should return a structured bridge payload.`
  );
  if (result.json?.result === 'queued_for_approval' || result.json?.outcome === 'queued_for_approval') {
    assert.ok(result.json?.approval || result.json?.approvalId, `${label} queued for approval without approval proof.`);
  }
}

function assertPendingApproval(label, result, toolName, { usesOutbox = true } = {}) {
  assertManualRouteStructured(label, result);
  assert.equal(result.status, 202, `${label} must return HTTP 202 for pending approval.`);
  assert.equal(result.json?.result, 'queued_for_approval', `${label} must require approval before provider delivery.`);
  assert.ok(result.json?.approval?.id, `${label} must return a durable approval ID.`);
  assert.equal(result.json.approval.status, 'pending', `${label} must wait for an approval decision.`);
  assert.equal(result.json.approval.approvalAction, toolName, `${label} must queue the requested tool.`);
  assert.ok(result.json.approval.metadata?.actionBinding?.hash, `${label} must bind the exact provider action.`);
  if (usesOutbox) {
    assert.equal(result.json.outbox?.status, 'queued', `${label} must keep the outbox queued.`);
    assert.equal(result.json.outbox.retryable, false, `${label} must not offer a delivery retry while approval is pending.`);
    assert.equal(result.json.providerAttempted, false, `${label} must skip the provider while approval is pending.`);
  }
}

async function main() {
  const bridgeSource = await readFile(join(repoRoot, 'scripts/openclaw-local-server.mjs'), 'utf8');
  assert.doesNotMatch(
    bridgeSource,
    /messageProvider\s*===\s*['"]telnyx['"][\s\S]{0,120}\[['"]queued['"],\s*['"]sent['"],\s*['"]delivered['"]\]\.includes\(messageStatus\)/,
    'Telnyx SMS handoff statuses must not be treated as handset delivery proof.'
  );
  assert.match(
    bridgeSource,
    /toolName\s*===\s*['"]telnyx_sms['"]\s*&&\s*messageStatus\s*!==\s*['"]delivered['"]/,
    'Durable Telnyx SMS proof must require delivered status.'
  );

  const stateDir = await mkdtemp(join(tmpdir(), 'pbk-manual-actions-'));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', './scripts/agent-runtime-smoke-isolation.mjs', 'scripts/openclaw-local-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...buildAgentRuntimeSmokeEnv(),
      PBK_AGENT_SMOKE_ISOLATED: '1',
      PORT: port,
      HOST: '127.0.0.1',
      PBK_OPENCLAW_STATE_DIR: stateDir,
      PBK_BRIDGE_API_KEY: apiKey,
      PBK_TEAM_PASSCODE: teamPasscode,
      PBK_SUPABASE_ENABLED: '0',
      PBK_DISABLE_POSTGRES: '1',
      PBK_ALLOW_UNAUTHENTICATED_HOSTED_BRIDGE: '1',
      RESEND_API_KEY: '',
      TELNYX_API_KEY: '',
      INSTANTLY_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  child.stdout.resume();

  try {
    await waitForBridge(baseUrl);
    const session = await requestJson(baseUrl, '/api/auth/team', { passcode: teamPasscode, actor: 'Fictional staff reviewer' });
    assert.equal(session.status, 200, 'Fictional staff sign-in should succeed.');
    assert.ok(session.json.token, 'Fictional staff sign-in must return a session token.');
    assert.equal(session.json.permissions?.canPlaceCalls, true);
    const staffHeaders = { 'X-PBK-Team-Token': session.json.token };

    const lead = await requestJson(baseUrl, '/api/leads', {
      name: 'Manual Actions Smoke Seller',
      phone: '+16145550177',
      email: 'manual.actions@example.com',
      address: '177 Manual Action Ave, Columbus OH',
      source: 'manual',
    });
    assert.equal(lead.status, 200, `manual lead save returned ${lead.status}`);
    assert.equal(lead.json?.ok, true, 'manual lead save should succeed.');
    const leadId = String(lead.json?.leadId || lead.json?.lead?.leadId || lead.json?.lead?.id || '');
    assert.ok(leadId, 'manual lead save should return a lead id.');
    assert.equal(String(lead.json?.leadId || ''), leadId, 'manual lead save should expose a top-level leadId.');
    const readOptions = { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) };
    const rosterResponse = await fetch(`${baseUrl}/api/leads`, readOptions);
    assert.equal(rosterResponse.status, 200);
    const roster = await rosterResponse.json();
    assert.ok(roster.leads.some((item) => String(item.leadId || item.id) === leadId), 'Created lead must appear in the roster.');
    const detailResponse = await fetch(`${baseUrl}/api/leads/${encodeURIComponent(leadId)}/full`, readOptions);
    assert.equal(detailResponse.status, 200, 'Created lead detail must load.');
    const detail = await detailResponse.json();
    assert.equal(detail.lead?.name, 'Manual Actions Smoke Seller', 'Lead detail must retain the seller name.');
    const saved = JSON.parse(await readFile(join(stateDir, 'openclaw-state.json'), 'utf8'));
    assert.ok(saved.leadImports.some((item) => String(item.leadId || item.id) === leadId), 'Save must reach the isolated durable backend.');

    const sms = await requestJson(baseUrl, '/api/lead/send-message', {
      leadId,
      channel: 'sms',
      phone: '+16145550177',
      message: 'Manual SMS route smoke.',
      manual: true,
      manualSend: true,
      source: 'lead_portal_manual',
    }, staffHeaders);
    assertPendingApproval('manual SMS', sms, 'telnyx_sms');

    const email = await requestJson(baseUrl, '/api/lead/send-message', {
      leadId,
      channel: 'email',
      email: 'manual.actions@example.com',
      subject: 'Manual email route smoke',
      message: 'Manual email route smoke.',
      manual: true,
      manualSend: true,
      source: 'lead_portal_manual',
    }, staffHeaders);
    assertPendingApproval('manual email', email, 'sendColdEmail');

    const immediateEmail = await requestJson(baseUrl, '/api/messages', {
      leadId,
      channel: 'email',
      email: 'manual.actions@example.com',
      subject: 'Immediate email route smoke',
      message: 'Immediate email route smoke.',
      manual: true,
      manualSend: true,
      source: 'unified_inbox_manual',
    }, staffHeaders);
    assertPendingApproval('immediate /api/messages email', immediateEmail, 'sendColdEmail');

    const immediateSms = await requestJson(baseUrl, '/api/messages', {
      leadId,
      channel: 'sms',
      phone: '+16145550177',
      message: 'Immediate SMS route smoke.',
      manual: true,
      manualSend: true,
      source: 'unified_inbox_manual',
    }, staffHeaders);
    assertPendingApproval('immediate /api/messages SMS', immediateSms, 'telnyx_sms');

    const callRequest = {
      leadId,
      phone: '+16145550177',
      fromNumber: '+16145550188',
      leadName: 'Manual Actions Smoke Seller',
      manual: true,
      manualSend: true,
      source: 'call_floor_manual',
      forceApproval: false,
      requestApproval: false,
      idempotencyKey: randomUUID(),
    };
    const call = await requestJson(baseUrl, '/api/calls', callRequest);
    assertPendingApproval('manual call without staff session', call, 'telnyx_call');
    assert.equal(call.json.approval.metadata?.executionParams?.fromNumber, '+16145550188',
      'The pending call approval must retain the selected sender.');

    const directCall = await requestJson(baseUrl, '/api/calls', callRequest, staffHeaders);
    assert.equal(directCall.json.result, 'provider_missing', JSON.stringify(directCall));
    assert.equal(directCall.status, 409);
    assert.equal(directCall.json.approval, undefined, 'The signed-in staff call must skip the extra approval.');
    assert.ok(directCall.json.idempotencyKey, 'The direct call must have a request identity.');
    assert.equal(directCall.json.telnyx?.live, false);
    const repeatedCall = await requestJson(baseUrl, '/api/calls', callRequest, staffHeaders);
    assert.equal(repeatedCall.json.idempotencyKey, directCall.json.idempotencyKey, 'A retransmission must retain the same request identity.');

    const mismatchedCall = await requestJson(baseUrl, '/api/calls', {
      ...callRequest,
      phone: '+16145550199',
    }, staffHeaders);
    assert.equal(mismatchedCall.status, 409);
    assert.equal(mismatchedCall.json.result, 'saved_phone_mismatch');

    const approvalCall = await requestJson(baseUrl, '/api/calls', {
      ...callRequest,
      forceApproval: true,
      requestApproval: true,
      idempotencyKey: randomUUID(),
    }, staffHeaders);
    assertPendingApproval('staff call requesting approval', approvalCall, 'telnyx_call');

    const nurture = await requestJson(baseUrl, '/api/leads/nurture', {
      leadId,
      leadName: 'Manual Actions Smoke Seller',
      address: '177 Manual Action Ave, Columbus OH',
      channels: ['sms', 'email'],
      manual: true,
      manualSend: true,
      source: 'leads_page_manual',
    });
    assert.equal(nurture.status, 200, `manual nurture returned ${nurture.status}`);
    assertManualRouteStructured('manual nurture', nurture);
    assert.equal(nurture.json?.result, 'manual_nurture_plan_saved', 'manual nurture should save a manual plan.');

    const sellerDocs = await requestJson(baseUrl, '/api/send-seller-docs', {
      leadId,
      leadName: 'Manual Actions Smoke Seller',
      email: 'manual.actions@example.com',
      address: '177 Manual Action Ave, Columbus OH',
      fromEmail: 'documents.sender@example.net',
      selectedDocuments: ['seller'],
      documentSet: {
        seller: 'This clean seller document should be attached as a PDF without internal renderer errors.',
      },
      manual: true,
      manualSend: true,
      source: 'seller_docs_manual',
    });
    assertPendingApproval('manual seller documents', sellerDocs, 'sendSellerDocs');
    assert.equal(sellerDocs.json.approval.metadata?.executionParams?.fromEmail, 'documents.sender@example.net',
      'The pending document approval must retain the selected Outlook sender.');

    const coldEmail = await requestJson(baseUrl, '/api/cold-email/send', {
      leadId,
      email: 'manual.actions@example.com',
      subject: 'Manual cold email route smoke',
      fromEmail: 'fictional.sender@example.net',
      message: 'Manual cold email route smoke.',
      manual: true,
      manualSend: true,
      source: 'leads_page_manual',
    });
    assertPendingApproval('manual cold email', coldEmail, 'sendColdEmail', { usesOutbox: false });
    assert.equal(coldEmail.json.approval.metadata?.executionParams?.fromEmail, 'fictional.sender@example.net',
      'The pending email approval must retain the selected sender.');

    const dnc = await requestJson(baseUrl, '/api/dnc', { phone: callRequest.phone, reason: 'Fictional opt-out' });
    assert.equal(dnc.status, 200);
    const restrictedCall = await requestJson(baseUrl, '/api/calls', {
      ...callRequest,
      idempotencyKey: randomUUID(),
    }, staffHeaders);
    assert.equal(restrictedCall.json.result, 'safety_blocked');
    assert.equal(restrictedCall.json.providerAttempted, false);

    console.log(
      JSON.stringify(
        {
          ok: true,
          result: 'manual_actions_offline_routes_verified',
          providerDeliveryVerified: false,
          note: 'Provider credentials and outbound network are disabled; these checks prove local save/read and approval routing.',
          statuses: {
            lead: lead.status,
            sms: sms.status,
            email: email.status,
            immediateEmail: immediateEmail.status,
            immediateSms: immediateSms.status,
            call: call.status,
            directCall: directCall.status,
            mismatchedCall: mismatchedCall.status,
            approvalCall: approvalCall.status,
            restrictedCall: restrictedCall.status,
            nurture: nurture.status,
            sellerDocs: sellerDocs.status,
            coldEmail: coldEmail.status,
          },
        },
        null,
        2
      )
    );
  } finally {
    if (!child.killed) child.kill();
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]).catch(() => {});
    const tempRelative = relative(tmpdir(), stateDir);
    assert.ok(tempRelative && !tempRelative.startsWith('..') && !isAbsolute(tempRelative));
    await rm(stateDir, { recursive: true, force: true }).catch(() => {});
    if (child.exitCode && child.exitCode !== 0) {
      console.warn(stderr.join('').split('\n').slice(-8).join('\n'));
    }
  }
}

await main();
