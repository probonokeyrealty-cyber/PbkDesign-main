import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canProjectLeadField } from './lead-field-provenance.mjs';

const repoRoot = process.cwd();
const port = String(19350 + Math.floor(Math.random() * 2000));
const apiKey = 'ava-call-lead-projection-smoke-key';

async function waitForBridge(baseUrl, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) return;
    } catch {
      // Keep polling until the local bridge is reachable.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('OpenClaw bridge did not become ready for Ava call lead projection smoke.');
}

async function requestJson(baseUrl, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

async function main() {
  const stateDir = await mkdtemp(join(tmpdir(), 'pbk-ava-call-projection-'));
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
    const created = await requestJson(baseUrl, '/api/leads', {
      method: 'POST',
      body: {
        leadId: 'lead-ava-call-projection',
        name: 'Unknown seller',
        source: 'manual',
      },
    });
    assert.equal(created.status, 200, `lead create returned ${created.status}`);
    assert.equal(created.json?.ok, true, 'lead create should succeed.');
    const leadId = String(created.json?.leadId || created.json?.lead?.leadId || '');
    assert.equal(leadId, 'lead-ava-call-projection', 'smoke should use the requested lead id.');

    const transcript = [
      'Hi, my name is Maria Lopez.',
      'The property is 912 Birch Lane, Columbus.',
      'The roof needs work and I owe about $82,000 on the mortgage.',
      'I need to close before July and I would be happy with $125,000.',
      'Send me the contract tomorrow, email maria.lopez@example.com, and call me at 614-555-0177.',
    ].join(' ');
    const projection = await requestJson(baseUrl, '/api/calls/extract-bant', {
      method: 'POST',
      body: {
        leadId,
        transcript,
        actor: 'Ava smoke',
      },
    });
    assert.equal(projection.status, 200, `call projection returned ${projection.status}`);
    assert.equal(projection.json?.ok, true, 'call projection should succeed.');
    assert.equal(projection.json?.visibleLeadFacts?.leadName, 'Maria Lopez');
    assert.equal(projection.json?.visibleLeadFacts?.email, 'maria.lopez@example.com');
    assert.equal(projection.json?.visibleLeadFacts?.phone, '+16145550177');
    assert.match(projection.json?.visibleLeadFacts?.address || '', /912 Birch Lane/i);
    assert.equal(projection.json?.visibleLeadFacts?.askingPrice, 125000);
    assert.equal(projection.json?.visibleLeadFacts?.contractIntent, true);
    assert.equal(projection.json?.visibleLeadFacts?.callbackIntent, true);
    assert.equal(
      canProjectLeadField({
        leadId,
        fieldName: 'seller.email',
        fieldValue: projection.json?.visibleLeadFacts?.email,
        sourceChannel: 'call',
        sourceId: 'ava-call-lead-projection-smoke',
        confidence: 0.91,
      }),
      true,
      'high-confidence call facts should satisfy lead field provenance projection gates.'
    );

    const full = await requestJson(baseUrl, `/api/leads/${encodeURIComponent(leadId)}/full`);
    assert.equal(full.status, 200, `lead full view returned ${full.status}`);
    const lead = full.json?.lead || {};
    assert.equal(lead.seller?.name, 'Maria Lopez', 'lead page should show inferred seller name.');
    assert.equal(lead.seller?.email, 'maria.lopez@example.com', 'lead page should show inferred email.');
    assert.equal(lead.seller?.phone, '+16145550177', 'lead page should show inferred phone.');
    assert.match(lead.property?.address || '', /912 Birch Lane/i, 'lead page should show inferred address.');
    assert.match(lead.property?.condition || '', /roof needs work/i, 'lead page should show inferred condition context.');
    assert.equal(lead.property?.askingPrice, 125000, 'lead page should show inferred asking price.');
    assert.match(lead.motivation?.timeline || '', /before July/i, 'lead page should show inferred timeline.');
    assert.match(lead.motivation?.summary || '', /roof needs work|mortgage/i, 'lead page should show inferred motivation.');
    assert.deepEqual(
      ['ava-call-inferred', 'contract-intent', 'callback-intent'].every((tag) => (lead.tags || []).includes(tag)),
      true,
      'lead page should tag inferred call facts and next-step intent.'
    );
    assert.equal(
      lead.callContext?.visibleLeadFacts?.email,
      'maria.lopez@example.com',
      'lead call context should retain auditable inferred facts.'
    );

    const diagnosticLead = await requestJson(baseUrl, '/api/leads', {
      method: 'POST',
      body: {
        leadId: 'lead-ava-call-diagnostic-quarantine',
        name: 'Diagnostic Smoke',
        source: 'manual',
      },
    });
    assert.equal(diagnosticLead.status, 200, `diagnostic lead create returned ${diagnosticLead.status}`);
    const diagnosticTranscript =
      'Deepgram live stream closed (media stream stop) before a final transcript was available. Diagnostics: frames=0, bytes=0, model=nova-2-phonecall, encoding=mulaw, lastEvent=none.';
    const diagnosticProjection = await requestJson(baseUrl, '/api/calls/extract-bant', {
      method: 'POST',
      body: {
        leadId: 'lead-ava-call-diagnostic-quarantine',
        transcript: diagnosticTranscript,
        actor: 'Ava smoke',
      },
    });
    assert.equal(
      diagnosticProjection.json?.result,
      'operational_transcript_ignored',
      'provider diagnostics should be quarantined instead of projected as seller memory.'
    );
    assert.deepEqual(
      diagnosticProjection.json?.visibleLeadFacts || {},
      {},
      'provider diagnostics must not infer visible lead facts.'
    );
    const diagnosticFull = await requestJson(
      baseUrl,
      '/api/leads/lead-ava-call-diagnostic-quarantine/full'
    );
    assert.equal(diagnosticFull.status, 200, `diagnostic lead full view returned ${diagnosticFull.status}`);
    const diagnosticFullText = JSON.stringify(diagnosticFull.json?.lead || {});
    assert.doesNotMatch(
      diagnosticFullText,
      /Deepgram live stream closed|Diagnostics: frames=|before a final transcript/i,
      'provider diagnostics must not persist into lead profile raw/call context.'
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          result: 'ava_call_lead_projection_ready',
          leadId,
          visibleLeadFieldsUpdated: projection.json?.visibleLeadFieldsUpdated || [],
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
