const BASE_URL = String(process.env.PBK_HOSTED_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com')
  .trim()
  .replace(/\/+$/g, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const RUN_MUTATION_TESTS = /^(1|true|yes)$/i.test(String(process.env.PBK_HOSTED_SMOKE_MUTATE || '').trim());

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  return response;
}

async function requestJson(pathname, options = {}) {
  const response = await request(pathname, options);
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { response, parsed };
}

function authHeaders() {
  assert(API_KEY, 'PBK_BRIDGE_API_KEY is required for hosted smoke tests.');
  return {
    Authorization: `Bearer ${API_KEY}`,
  };
}

async function main() {
  const { response: healthResponse, parsed: health } = await requestJson('/health');
  assert(healthResponse.ok, `Hosted /health returned ${healthResponse.status}.`);
  assert(health?.ok === true, 'Hosted /health did not return ok: true.');
  assert(typeof health?.revision === 'string' && health.revision.length > 0, 'Hosted /health is missing revision.');
  assert(health?.features?.authRequired === true, 'Hosted /health did not report authRequired: true.');
  assert(health?.features?.stateBackend === 'postgres', `Expected hosted stateBackend postgres, got ${health?.features?.stateBackend || 'missing'}.`);
  assert(health?.runtime?.hosted === true, 'Hosted /health did not report hosted runtime.');
  assert(health?.providers && typeof health.providers === 'object', 'Hosted /health did not expose providers block.');

  const unauthorizedState = await request('/state');
  assert(unauthorizedState.status === 401, `Expected unauthenticated /state to return 401, got ${unauthorizedState.status}.`);

  const { response: stateResponse, parsed: state } = await requestJson('/state', {
    headers: authHeaders(),
  });
  assert(stateResponse.ok, `Authenticated /state returned ${stateResponse.status}.`);
  assert(Array.isArray(state?.approvals), 'Authenticated /state did not return approvals array.');

  const { response: invokeResponse, parsed: invoke } = await requestJson('/invoke', {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      toolName: 'getBrainState',
      params: {
        query: 'What is the current bridge state?',
      },
    }),
  });
  assert(invokeResponse.ok, `Hosted /invoke returned ${invokeResponse.status}.`);
  assert(invoke?.ok === true, 'Hosted /invoke did not succeed.');

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
        authRequired: health.features.authRequired,
        stateBackend: health.features.stateBackend,
        providers: Object.keys(health.providers || {}),
        hosted: health.runtime.hosted,
        approvals: Array.isArray(state?.approvals) ? state.approvals.length : 0,
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
