import { workflow, node, trigger } from '@n8n/workflow-sdk';

const approvalRequestWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2,
  config: {
    name: 'Approval Request Webhook',
    position: [-820, -180],
    parameters: {
      httpMethod: 'POST',
      path: 'pbk-approval-request',
      responseMode: 'responseNode',
      options: {},
    },
  },
  output: [
    {
      body: {
        id: 'approval-offer-202-cherry',
        leadId: 'lead-diane-kowalski',
        leadName: 'Diane Kowalski',
        address: '202 Cherry Ln, Columbus OH',
        offerPrice: 78000,
        mao: 91500,
        notes: 'Quick-close empathy anchor after probate rapport.',
        createdAt: '2026-04-25T00:00:00.000Z',
      },
    },
  ],
});

const normalizeApprovalRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Approval Request',
    position: [-560, -180],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const input = $input.first().json;
const source = input.body ?? input;
const id = source.id || \`approval-\${Date.now()}\`;
const baseUrl = 'https://probonokeyrealty1.app.n8n.cloud';
return [{
  json: {
    id,
    leadId: source.leadId || '',
    leadName: source.leadName || source.name || 'Unknown seller',
    address: source.address || '',
    offerPrice: source.offerPrice || 0,
    mao: source.mao || 0,
    notes: source.notes || '',
    createdAt: source.createdAt || new Date().toISOString(),
    approveUrl: \`\${baseUrl}/webhook/pbk-approval-decision?id=\${id}&status=approved\`,
    rejectUrl: \`\${baseUrl}/webhook/pbk-approval-decision?id=\${id}&status=rejected\`,
    notifyPayload: {
      eventType: 'approval-notify',
      payload: {
        actor: 'n8n',
        category: 'APPROVAL',
        status: 'fanned-out',
        text: \`Approval request ready for \${source.leadName || source.name || 'Unknown seller'} at \${source.address || ''}\`,
        target: source.address || '',
        id,
        leadName: source.leadName || source.name || 'Unknown seller',
        address: source.address || '',
        offerPrice: source.offerPrice || 0,
        mao: source.mao || 0,
        notes: source.notes || '',
        approveUrl: \`\${baseUrl}/webhook/pbk-approval-decision?id=\${id}&status=approved\`,
        rejectUrl: \`\${baseUrl}/webhook/pbk-approval-decision?id=\${id}&status=rejected\`
      }
    }
  }
}];`,
    },
  },
  output: [
    {
      id: 'approval-offer-202-cherry',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      offerPrice: 78000,
      mao: 91500,
      notes: 'Quick-close empathy anchor after probate rapport.',
      createdAt: '2026-04-25T00:00:00.000Z',
      approveUrl:
        'https://probonokeyrealty1.app.n8n.cloud/webhook/pbk-approval-decision?id=approval-offer-202-cherry&status=approved',
      rejectUrl:
        'https://probonokeyrealty1.app.n8n.cloud/webhook/pbk-approval-decision?id=approval-offer-202-cherry&status=rejected',
    },
  ],
});

const notifyApprovalChannel = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Notify Approval Channel',
    position: [-280, -180],
    parameters: {
      method: 'POST',
      authentication: 'none',
      url: 'https://pbk-openclaw-bridge.onrender.com/events',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '={{ $json.notifyPayload }}',
      options: {},
    },
  },
  output: [{ ok: true }],
});

const respondToApprovalRequest = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.1,
  config: {
    name: 'Respond To Approval Request',
    position: [0, -180],
    parameters: {
      respondWith: 'json',
      responseBody:
        "={{ { ok: true, message: 'Approval request fanned out', approveUrl: $node['Normalize Approval Request'].json.approveUrl, rejectUrl: $node['Normalize Approval Request'].json.rejectUrl } }}",
    },
  },
  output: [{ ok: true }],
});

const approvalDecisionWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2,
  config: {
    name: 'Approval Decision Webhook',
    position: [-820, 140],
    parameters: {
      httpMethod: 'GET',
      path: 'pbk-approval-decision',
      responseMode: 'responseNode',
      options: {},
    },
  },
  output: [
    {
      query: {
        id: 'approval-offer-202-cherry',
        status: 'approved',
        actor: 'n8n callback',
      },
    },
  ],
});

const normalizeApprovalDecision = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Approval Decision',
    position: [-560, 140],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const input = $input.first().json;
return [{
  json: {
    id: input.query?.id || input.id || '',
    status: input.query?.status || input.status || 'approved',
    actor: input.query?.actor || input.actor || 'n8n callback',
    actedAt: new Date().toISOString(),
    bridgeEvent: {
      eventType: 'approval-callback',
      payload: {
        id: input.query?.id || input.id || '',
        status: input.query?.status || input.status || 'approved',
        actor: input.query?.actor || input.actor || 'n8n callback',
        actedAt: new Date().toISOString()
      }
    }
  }
}];`,
    },
  },
  output: [
    {
      id: 'approval-offer-202-cherry',
      status: 'approved',
      actor: 'n8n callback',
      actedAt: '2026-04-25T00:00:00.000Z',
    },
  ],
});

const postDecisionToOpenClaw = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Post Decision To OpenClaw',
    position: [-280, 140],
    parameters: {
      method: 'POST',
      authentication: 'none',
      url: 'https://pbk-openclaw-bridge.onrender.com/events',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '={{ $json.bridgeEvent }}',
      options: {},
    },
  },
  output: [{ ok: true }],
});

const respondToApprovalDecision = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.1,
  config: {
    name: 'Respond To Approval Decision',
    position: [0, 140],
    parameters: {
      respondWith: 'json',
      responseBody:
        "={{ { ok: true, message: 'Approval decision forwarded to PBK local bridge', decision: $json } }}",
    },
  },
  output: [{ ok: true }],
});

export default workflow('pbk-approval-fanout', 'PBK Approval Fanout')
  .add(approvalRequestWebhook)
  .to(normalizeApprovalRequest)
  .to(notifyApprovalChannel)
  .to(respondToApprovalRequest)
  .add(approvalDecisionWebhook)
  .to(normalizeApprovalDecision)
  .to(postDecisionToOpenClaw)
  .to(respondToApprovalDecision);
