import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const repoRoot = process.cwd();
const port = String(19100 + Math.floor(Math.random() * 2500));
const apiKey = 'manual-actions-route-smoke-key';

async function waitForBridge(baseUrl, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) return;
    } catch {
      // Keep polling until OpenClaw is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('OpenClaw bridge did not become ready for manual action route smoke.');
}

async function requestJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
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

function assertNotApprovalGate(label, result) {
  assert.notEqual(result.status, 202, `${label} should not be queued for approval.`);
  assert.notEqual(result.status, 502, `${label} should not surface provider delivery as a bridge 502.`);
  assert.notEqual(result.json?.result, 'queued_for_approval', `${label} returned queued_for_approval.`);
  assert.notEqual(result.json?.outcome, 'queued_for_approval', `${label} returned approval outcome.`);
  assert.equal(Boolean(result.json?.approval), false, `${label} should not create an approval payload.`);
}

async function main() {
  const stateDir = await mkdtemp(join(tmpdir(), 'pbk-manual-actions-'));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/openclaw-local-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: port,
      HOST: '127.0.0.1',
      PBK_OPENCLAW_STATE_DIR: stateDir,
      PBK_BRIDGE_API_KEY: apiKey,
      PBK_TEAM_PASSCODE: 'pbkway',
      PBK_SUPABASE_ENABLED: '0',
      PBK_DISABLE_POSTGRES: '1',
      PBK_ALLOW_UNAUTHENTICATED_HOSTED_BRIDGE: '1',
      RESEND_API_KEY: '',
      TELNYX_API_KEY: '',
      INSTANTLY_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  try {
    await waitForBridge(baseUrl);
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

    const sms = await requestJson(baseUrl, '/api/lead/send-message', {
      leadId,
      channel: 'sms',
      phone: '+16145550177',
      message: 'Manual SMS route smoke.',
      manual: true,
      manualSend: true,
      source: 'lead_portal_manual',
    });
    assertNotApprovalGate('manual SMS', sms);
    assert.ok([200, 202, 207, 400, 409, 502, 503].includes(sms.status), 'manual SMS should return a structured bridge status.');

    const email = await requestJson(baseUrl, '/api/lead/send-message', {
      leadId,
      channel: 'email',
      email: 'manual.actions@example.com',
      subject: 'Manual email route smoke',
      message: 'Manual email route smoke.',
      manual: true,
      manualSend: true,
      source: 'lead_portal_manual',
    });
    assertNotApprovalGate('manual email', email);

    const immediateEmail = await requestJson(baseUrl, '/api/messages', {
      leadId,
      channel: 'email',
      email: 'manual.actions@example.com',
      subject: 'Immediate email route smoke',
      message: 'Immediate email route smoke.',
      manual: true,
      manualSend: true,
      source: 'unified_inbox_manual',
    });
    assertNotApprovalGate('immediate /api/messages email', immediateEmail);
    assert.notEqual(
      immediateEmail.json?.provider,
      'Telnyx',
      'Immediate /api/messages email must route through email delivery, not Telnyx SMS.'
    );
    assert.equal(
      immediateEmail.json?.message?.channel,
      'email',
      'Immediate /api/messages email should persist as an email message.'
    );

    const immediateSms = await requestJson(baseUrl, '/api/messages', {
      leadId,
      channel: 'sms',
      phone: '+16145550177',
      message: 'Immediate SMS route smoke.',
      manual: true,
      manualSend: true,
      source: 'unified_inbox_manual',
    });
    assertNotApprovalGate('immediate /api/messages SMS', immediateSms);
    assert.ok(
      immediateSms.json?.telnyx || immediateSms.json?.message?.channel === 'sms',
      'Immediate /api/messages SMS should stay on the Telnyx/SMS path.'
    );

    const call = await requestJson(baseUrl, '/api/calls', {
      leadId,
      phone: '+16145550177',
      leadName: 'Manual Actions Smoke Seller',
      manual: true,
      manualSend: true,
      source: 'call_floor_manual',
    });
    assertNotApprovalGate('manual call', call);

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
    assertNotApprovalGate('manual nurture', nurture);
    assert.equal(nurture.json?.result, 'manual_nurture_plan_saved', 'manual nurture should save a manual plan.');

    const sellerDocs = await requestJson(baseUrl, '/api/send-seller-docs', {
      leadId,
      leadName: 'Manual Actions Smoke Seller',
      email: 'manual.actions@example.com',
      address: '177 Manual Action Ave, Columbus OH',
      selectedDocuments: ['seller'],
      documentSet: {
        seller: 'This clean seller document should be attached as a PDF without internal renderer errors.',
      },
      manual: true,
      manualSend: true,
      source: 'seller_docs_manual',
    });
    assertNotApprovalGate('manual seller documents', sellerDocs);
    assert.ok(
      sellerDocs.json?.outbox || sellerDocs.json?.delivery || sellerDocs.json?.result,
      'manual seller documents should return delivery or outbox state.'
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          result: 'manual_actions_routes_ready',
          statuses: {
            lead: lead.status,
            sms: sms.status,
            email: email.status,
            immediateEmail: immediateEmail.status,
            immediateSms: immediateSms.status,
            call: call.status,
            nurture: nurture.status,
            sellerDocs: sellerDocs.status,
          },
        },
        null,
        2
      )
    );
  } finally {
    if (!child.killed) child.kill();
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]).catch(() => {});
    await rm(stateDir, { recursive: true, force: true }).catch(() => {});
    if (child.exitCode && child.exitCode !== 0) {
      console.warn(stderr.join('').split('\n').slice(-8).join('\n'));
    }
  }
}

await main();
