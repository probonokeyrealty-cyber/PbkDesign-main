import { readFileSync } from 'node:fs';

const BASE_URL = String(process.env.PBK_HOSTED_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com')
  .trim()
  .replace(/\/+$/g, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const RUN_MUTATION_TESTS = /^(1|true|yes)$/i.test(String(process.env.PBK_HOSTED_SMOKE_MUTATE || '').trim());
const SKIP_REVISION_CHECK = /^(1|true|yes)$/i.test(String(process.env.PBK_HOSTED_SMOKE_SKIP_REVISION_CHECK || '').trim());
const READY_TIMEOUT_MS = Math.max(
  30,
  Number(
    process.env.PBK_HOSTED_SMOKE_READY_TIMEOUT_SECONDS ||
      process.env.PBK_HOSTED_SMOKE_READY_SECONDS ||
      process.env.HOSTED_SMOKE_READY_TIMEOUT_SECONDS ||
      process.env.HOSTED_SMOKE_READY_SECONDS ||
      420,
  ),
) * 1000;
const READY_INTERVAL_MS = Math.max(
  5,
  Number(process.env.PBK_HOSTED_SMOKE_READY_INTERVAL_SECONDS || process.env.HOSTED_SMOKE_READY_INTERVAL_SECONDS || 15),
) * 1000;
const OPERATION_ATTEMPTS = Math.max(
  1,
  Number(process.env.PBK_HOSTED_SMOKE_OPERATION_ATTEMPTS || process.env.HOSTED_SMOKE_OPERATION_ATTEMPTS || 3),
);

function getExpectedBridgeRevision() {
  const explicitRevision = String(process.env.PBK_EXPECTED_BRIDGE_REVISION || '').trim();
  if (explicitRevision) return explicitRevision;

  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const match = source.match(/const\s+BUILD_REVISION\s*=\s*['"]([^'"]+)['"]/);
  return match?.[1] || '';
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  return response;
}

async function requestJson(pathname, options = {}) {
  const response = await request(pathname, options);
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      const contentType = response.headers.get('content-type') || 'unknown content-type';
      const preview = text.replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(
        `Hosted ${pathname} returned non-JSON ${response.status} (${contentType}): ${preview}`,
      );
    }
  }
  return { response, parsed };
}

function authHeaders() {
  assert(API_KEY, 'PBK_BRIDGE_API_KEY is required for hosted smoke tests.');
  return {
    Authorization: `Bearer ${API_KEY}`,
  };
}

function isDemoRuntimeApproval(approval = {}) {
  const source = String(approval.source || approval.fixture || approval.kind || approval.importSource || '').toLowerCase();
  const text = [
    approval.id,
    approval.taskId,
    approval.leadId,
    approval.leadName,
    approval.address,
    approval.title,
    approval.description,
    approval.notes,
    approval.fileName,
    approval.templateName,
    approval.type,
  ].filter(Boolean).join(' ');
  return source.includes('demo')
    || source.includes('fixture')
    || /approval-offer-202-cherry|approval-contract-robert-chen|approval-batch-akron|lead-diane-kowalski|lead-robert-chen|daily_probate_import\.csv|Diane Kowalski|Robert Chen|Akron Probate Batch|202 Cherry Ln|55 Birch Rd/i.test(text);
}

function validateHostedHealth(health, expectedRevision) {
  if (!health || typeof health !== 'object') return 'missing health payload';
  if (health.ok !== true) return 'health did not return ok: true';
  if (typeof health.revision !== 'string' || health.revision.length === 0) return 'missing revision';
  if (!SKIP_REVISION_CHECK) {
    if (!expectedRevision) return 'could not determine expected bridge revision';
    if (health.revision !== expectedRevision) {
      return `stale revision: expected ${expectedRevision}, got ${health.revision}`;
    }
  }
  if (health?.features?.authRequired !== true) return 'authRequired is not true';
  const configuredStateBackend =
    health?.features?.configuredStateBackend || health?.runtime?.configuredStateBackend || '';
  if (configuredStateBackend && configuredStateBackend !== 'postgres') {
    return `configuredStateBackend ${configuredStateBackend}`;
  }
  if (health?.features?.stateBackend !== 'postgres') {
    return `stateBackend ${health?.features?.stateBackend || 'missing'}`;
  }
  if (health?.runtime?.hosted !== true) return 'runtime.hosted is not true';
  const stateBootstrapReady =
    health?.components?.stateBootstrap?.ready === true ||
    health?.components?.stateBootstrap?.status === 'up' ||
    health?.runtime?.stateBootstrap?.ready === true;
  if (!stateBootstrapReady) return 'state bootstrap is not ready';
  if (health?.components?.bridge?.status !== 'up') return 'bridge component is not up';
  if (health?.components?.postgres?.status !== 'up') {
    return `postgres component is ${health?.components?.postgres?.status || 'missing'}`;
  }
  if (health?.components?.agentOrchestration?.status !== 'up') {
    return `agent orchestration component is ${health?.components?.agentOrchestration?.status || 'missing'}`;
  }
  if (Number(health?.componentSummary?.total || 0) < 10) return 'component summary is incomplete';
  return '';
}

async function waitForHostedHealth(expectedRevision) {
  const startedAt = Date.now();
  let lastProblem = 'not checked yet';

  while (Date.now() - startedAt <= READY_TIMEOUT_MS) {
    try {
      const { response, parsed } = await requestJson('/health');
      if (!response.ok) {
        lastProblem = `/health returned ${response.status}`;
      } else {
        const healthProblem = validateHostedHealth(parsed, expectedRevision);
        if (!healthProblem) return { response, parsed };
        lastProblem = healthProblem;
      }
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }

    await sleep(READY_INTERVAL_MS);
  }

  throw new Error(`Hosted bridge did not become ready within ${Math.round(READY_TIMEOUT_MS / 1000)}s: ${lastProblem}.`);
}

async function requestJsonWithRetry(pathname, options = {}, validate = () => '') {
  let lastProblem = '';

  for (let attempt = 1; attempt <= OPERATION_ATTEMPTS; attempt += 1) {
    try {
      const result = await requestJson(pathname, options);
      const validationProblem = validate(result);
      if (!validationProblem) return result;
      lastProblem = validationProblem;
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }

    if (attempt < OPERATION_ATTEMPTS) await sleep(READY_INTERVAL_MS);
  }

  throw new Error(`Hosted ${pathname} did not pass after ${OPERATION_ATTEMPTS} attempt(s): ${lastProblem}`);
}

async function main() {
  const expectedRevision = getExpectedBridgeRevision();
  const { response: healthResponse, parsed: health } = await waitForHostedHealth(expectedRevision);
  assert(healthResponse.ok, `Hosted /health returned ${healthResponse.status}.`);
  assert(health?.ok === true, 'Hosted /health did not return ok: true.');
  assert(typeof health?.revision === 'string' && health.revision.length > 0, 'Hosted /health is missing revision.');
  if (!SKIP_REVISION_CHECK) {
    assert(expectedRevision, 'Hosted smoke could not determine expected bridge revision.');
    assert(
      health.revision === expectedRevision,
      `Hosted bridge revision is stale. Expected ${expectedRevision}, got ${health.revision}. Trigger a Render deploy for the latest commit.`,
    );
  }
  assert(health?.features?.authRequired === true, 'Hosted /health did not report authRequired: true.');
  assert(health?.features?.stateBackend === 'postgres', `Expected hosted stateBackend postgres, got ${health?.features?.stateBackend || 'missing'}.`);
  assert(health?.runtime?.hosted === true, 'Hosted /health did not report hosted runtime.');
  assert(health?.providers && typeof health.providers === 'object', 'Hosted /health did not expose providers block.');
  assert(health?.components?.bridge?.status === 'up', 'Hosted /health did not expose command-center health components.');
  assert(health?.components?.postgres?.status === 'up', `Hosted /health expected postgres component up, got ${health?.components?.postgres?.status || 'missing'}.`);
  assert(health?.components?.agentOrchestration?.status === 'up', `Hosted /health expected agent orchestration up, got ${health?.components?.agentOrchestration?.status || 'missing'}.`);
  assert(Number(health?.componentSummary?.total || 0) >= 10, 'Hosted /health component summary is incomplete.');

  const unauthorizedState = await request('/state');
  assert(unauthorizedState.status === 401, `Expected unauthenticated /state to return 401, got ${unauthorizedState.status}.`);

  const { response: stateResponse, parsed: state } = await requestJson('/state', {
    headers: authHeaders(),
  });
  assert(stateResponse.ok, `Authenticated /state returned ${stateResponse.status}.`);
  assert(Array.isArray(state?.approvals), 'Authenticated /state did not return approvals array.');

  const { response: agentOrchestrationResponse, parsed: agentOrchestration } = await requestJson('/api/agents/orchestration', {
    headers: authHeaders(),
  });
  assert(agentOrchestrationResponse.ok, `Hosted agent orchestration endpoint returned ${agentOrchestrationResponse.status}.`);
  assert(agentOrchestration?.ok === true, 'Hosted agent orchestration endpoint did not report ok.');
  assert(agentOrchestration?.orchestration?.supervisor?.id === 'ava', 'Hosted agent orchestration did not report Ava as supervisor.');
  assert((agentOrchestration?.orchestration?.workers || []).some((agent) => agent.id === 'rex'), 'Hosted agent orchestration did not include Rex.');
  assert((agentOrchestration?.orchestration?.workers || []).some((agent) => agent.id === 'hermes'), 'Hosted agent orchestration did not include Hermes.');

  const { response: invokeResponse, parsed: invoke } = await requestJsonWithRetry(
    '/invoke',
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'getBrainState',
        params: {
          query: 'Give me a plain English PBK operator summary.',
        },
      }),
    },
    ({ response, parsed }) => {
      if (!response.ok) return `returned ${response.status}`;
      if (parsed?.ok !== true) return 'did not succeed';
      return '';
    },
  );

  const pdfResponse = await request('/api/documents/pdf', {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      documentType: 'masterPackage',
      documentTitle: 'PBK Hosted Smoke Package',
      propertyAddress: '808 Hosted Smoke Ave, Columbus OH',
      selectedPathLabel: 'Cash Offer',
      companyName: 'Probono Key Realty',
      previewOrigin: 'https://pbkcommandcenter.netlify.app',
      content: 'Hosted smoke document payload.',
    }),
  });
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
  assert(pdfResponse.ok, `Hosted PDF endpoint returned ${pdfResponse.status}.`);
  assert((pdfResponse.headers.get('content-type') || '').includes('application/pdf'), 'Hosted PDF endpoint did not return application/pdf.');
  assert(pdfBuffer.subarray(0, 4).toString('utf8') === '%PDF', 'Hosted PDF endpoint did not return a valid PDF signature.');

  let leadReplaySafe = null;
  let approvalReplaySafe = null;

  if (RUN_MUTATION_TESTS) {
    const leadEventPayload = {
      eventType: 'lead-intake',
      payload: {
        eventId: 'hosted-smoke-lead-event-1',
        leadId: 'hosted-smoke-lead-1',
        source: 'hosted-smoke',
        seller: {
          name: 'Hosted Smoke Seller',
          phone: '+1 (614) 555-0155',
          email: 'hosted-smoke@example.com',
        },
        property: {
          address: '909 Hosted Smoke Dr, Columbus OH',
          city: 'Columbus',
          state: 'OH',
        },
        tags: ['hosted-smoke', 'qa'],
      },
    };

    const { parsed: firstLeadEvent } = await requestJson('/events', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leadEventPayload),
    });
    const { parsed: secondLeadEvent } = await requestJson('/events', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leadEventPayload),
    });
    leadReplaySafe = Boolean(firstLeadEvent?.ok === true && secondLeadEvent?.replayed === true);

    const pendingApproval = Array.isArray(state?.approvals)
      ? state.approvals.find((approval) => String(approval?.status || '').toLowerCase() === 'pending')
      : null;
    assert(pendingApproval?.id, 'Hosted mutation smoke could not find a pending approval to replay-test.');

    const approvalEventPayload = {
      eventType: 'approval-callback',
      payload: {
        id: pendingApproval.id,
        status: 'approved',
        actor: 'hosted-smoke',
        actedAt: '2026-04-27T08:00:00.000Z',
      },
    };

    const { parsed: firstApprovalEvent } = await requestJson('/events', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(approvalEventPayload),
    });
    const { parsed: secondApprovalEvent } = await requestJson('/events', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(approvalEventPayload),
    });

    approvalReplaySafe = Boolean(firstApprovalEvent?.ok === true && secondApprovalEvent?.replayed === true);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        revision: health.revision,
        expectedRevision,
        revisionFresh: !expectedRevision || health.revision === expectedRevision,
        healthStatus: health.status,
        authRequired: health.features.authRequired,
        stateBackend: health.features.stateBackend,
        healthComponents: Number(health?.componentSummary?.total || 0),
        providers: Object.fromEntries(
          Object.entries(health.providers || {}).map(([name, meta]) => {
            const isReady = meta?.ready === true
              || meta?.messagingReady === true
              || meta?.voiceReady === true;
            const isConfigured = meta?.configured === true;
            const missing = Array.isArray(meta?.missing) ? meta.missing : [];
            const status = isReady
              ? (name === 'telnyx'
                  ? `ready (${[meta.messagingReady && 'sms', meta.voiceReady && 'voice'].filter(Boolean).join('+') || 'partial'})`
                  : 'ready')
              : isConfigured
                ? 'configured but not ready'
                : missing.length
                  ? `missing ${missing.length} env`
                  : 'not configured';
            return [name, status];
          })
        ),
        hosted: health.runtime.hosted,
        agentOrchestration: agentOrchestration?.orchestration?.result || '',
        agentWorkers: (agentOrchestration?.orchestration?.workers || []).map((agent) => agent.id),
        approvals: Array.isArray(state?.approvals) ? state.approvals.filter((approval) => !isDemoRuntimeApproval(approval)).length : 0,
        rawApprovals: Array.isArray(state?.approvals) ? state.approvals.length : 0,
        pdfBytes: pdfBuffer.length,
        leadReplaySafe,
        approvalReplaySafe,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
