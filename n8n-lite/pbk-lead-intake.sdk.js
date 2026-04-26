import { workflow, node, trigger } from '@n8n/workflow-sdk';

const leadIntakeWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2,
  config: {
    name: 'Lead Intake Webhook',
    position: [-640, -40],
    parameters: {
      httpMethod: 'POST',
      path: 'pbk-lead-intake',
      responseMode: 'responseNode',
      options: {},
    },
  },
  output: [
    {
      body: {
        leadId: 'lead-123',
        source: 'manual-webhook',
        seller: { name: 'Diane Kowalski', phone: '+16145550142' },
        property: { address: '202 Cherry Ln, Columbus OH' },
        tags: ['probate', 'high-equity'],
      },
    },
  ],
});

const normalizeLeadPayload = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Lead Payload',
    position: [-380, -40],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const input = $input.first().json;
const lead = {
  leadId: input.leadId || input.id || \`lead-\${Date.now()}\`,
  source: input.source || 'manual-webhook',
  seller: {
    name: input?.seller?.name || input.name || 'Unknown seller',
    phone: input?.seller?.phone || input.phone || '',
    email: input?.seller?.email || input.email || ''
  },
  property: {
    address: input?.property?.address || input.address || '',
    city: input?.property?.city || input.city || '',
    state: input?.property?.state || input.state || ''
  },
  tags: Array.isArray(input.tags) ? input.tags : []
};
return [{ json: lead }];`,
    },
  },
  output: [
    {
      leadId: 'lead-123',
      source: 'manual-webhook',
      seller: { name: 'Diane Kowalski', phone: '+16145550142', email: '' },
      property: { address: '202 Cherry Ln, Columbus OH', city: '', state: '' },
      tags: ['probate', 'high-equity'],
    },
  ],
});

const pushToOpenClaw = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Push To OpenClaw',
    position: [-100, -40],
    parameters: {
      method: 'POST',
      url: "={{ $env.PBK_OPENCLAW_URL || 'https://pbk-openclaw-bridge.onrender.com' }}/events",
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ { eventType: 'lead-intake', payload: { ...$json, _source: 'n8n-lead-intake' } } }}",
      options: {},
    },
  },
  output: [
    {
      ok: true,
      eventType: 'lead-intake',
    },
  ],
});

const respondToLeadIntake = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.1,
  config: {
    name: 'Respond To Lead Intake',
    position: [160, -40],
    parameters: {
      respondWith: 'json',
      responseBody:
        "={{ { ok: true, message: 'Lead intake accepted by PBK local bridge', openclaw: $json } }}",
    },
  },
  output: [{ ok: true }],
});

export default workflow('pbk-lead-intake', 'PBK Lead Intake')
  .add(leadIntakeWebhook)
  .to(normalizeLeadPayload)
  .to(pushToOpenClaw)
  .to(respondToLeadIntake);
