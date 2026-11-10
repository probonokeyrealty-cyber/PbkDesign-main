import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const lead = { id: 'qa-fleet-lead', name: 'Fixture seller', phone: '+12025550142' };
const agents = [
  {
    id: 'ava',
    name: 'Ava',
    role: 'Seller conversations',
    status: 'active',
    capabilities: ['voice'],
  },
  { id: 'rex', name: 'Rex', role: 'Operations', status: 'standby', capabilities: ['review'] },
  { id: 'max', name: 'Max', role: 'Contracts', status: 'active', capabilities: [] },
];

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    const requests = [];
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      const fixture = {
        '/api/agents/registry': { source: 'postgres', registry: { agents } },
        '/api/agents/health': {
          agents: [
            {
              id: 'ava',
              ready: true,
              source: 'Fixture probe',
              latencyP95Ms: 150,
              lastSeen: new Date().toISOString(),
            },
            { id: 'rex', ready: false, missingTools: ['qa-review-tool'], source: 'Fixture probe' },
          ],
        },
        '/api/tooling/status': { agents: [] },
        '/api/agents/snn-status': { workers: [] },
        '/api/qa/audit/latest': { audits: [] },
        '/api/leads': { leads: [lead] },
        '/state': { calls: [], leadImports: [lead] },
      };
      if (fixture[path] && req.method() === 'GET')
        return route.fulfill({ json: { ok: true, ...fixture[path] } });
      if (req.method() === 'POST' && path === '/invoke') {
        const { toolName, params } = req.postDataJSON();
        requests.push({ action: toolName, params });
        const responses = {
          previewAgentDealContext: {
            result: 'agent_deal_context_preview',
            writeMode: 'read_only',
            summary: 'Fixture read-only preview',
            recommendedAction: 'review_lead',
          },
          pbk_test_skill: { result: 'Fixture skill test result' },
          telnyx_call: { status: 'approval_required', approvalId: 'qa-call-approval' },
        };
        return responses[toolName]
          ? route.fulfill({ json: { ok: true, result: responses[toolName] } })
          : route.fulfill({ status: 400, json: { error: 'Unexpected fixture invocation' } });
      }
      if (req.method() === 'POST' && path === '/api/agents/deploy') {
        requests.push({ action: 'deploy', params: req.postDataJSON() });
        return route.fulfill({ json: { ok: true, approvalId: 'qa-deploy-approval' } });
      }
      if (url.origin !== origin || /^\/(api\/|health$|events$)/.test(path))
        return route.fulfill({ json: { ok: true } });
      return route.continue();
    });

    await page.goto(`${origin}/fleet`);
    await expect(page.getByRole('heading', { name: 'Agent Fleet', exact: true })).toBeVisible();
    const roster = page.getByRole('region', { name: 'Agent roster' });
    await expect(roster.getByText('Health ready', { exact: true })).toBeVisible();
    await expect(roster.getByText('Needs attention', { exact: true })).toBeVisible();
    await expect(roster.getByText('Health not verified', { exact: true })).toBeVisible();
    const detail = page.getByRole('region', { name: 'Selected agent' });
    await roster.getByRole('button', { name: 'Inspect Rex', exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Rex', exact: true })).toBeInViewport();
    await expect(detail.getByRole('button', { name: 'Request call' })).toBeDisabled();
    await detail.getByText('Health evidence', { exact: true }).click();
    await expect(detail.getByText('qa-review-tool', { exact: true })).toBeVisible();

    await roster.getByRole('button', { name: 'Inspect Ava', exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Ava', exact: true })).toBeInViewport();
    await expect(detail.getByRole('link', { name: 'Open Ava Chat' })).toHaveAttribute(
      'href',
      '/ava-chat?leadId=qa-fleet-lead'
    );
    await detail.getByRole('button', { name: 'Preview Ava' }).click();
    await expect(detail.getByText('Fixture read-only preview')).toBeVisible();
    await expect(detail.getByText('0% confidence', { exact: true })).toHaveCount(0);
    assert.equal(requests[0].params.leadId, lead.id);
    assert.equal(requests[0].params.agentId, 'ava');
    if (process.env.PBK_FLEET_SCREENSHOTS === '1') {
      await page.screenshot({
        path: `.pbk-local/agent-fleet-${engine.name()}-${viewport.width}.png`,
      });
    }

    await detail.getByRole('button', { name: 'Request call', exact: true }).click();
    await expect(page.getByText('Call queued for approval', { exact: true })).toBeVisible();
    assert.equal(requests[1].params.forceApproval, true);
    assert.equal(requests[1].params.requestApproval, true);
    const skill = detail.locator('.fleet-skill-card').filter({ hasText: 'Tactical Empathy' });
    await skill.getByRole('button', { name: 'Test on lead' }).click();
    await skill
      .getByRole('textbox', { name: 'Test scenario' })
      .fill('Fixture seller asks for time.');
    await skill.getByRole('button', { name: 'Run test', exact: true }).click();
    await expect(skill.getByText('Fixture skill test result')).toBeVisible();
    await detail.getByRole('button', { name: 'Request deployment', exact: true }).click();
    await expect(detail.getByText('Deployment approval queued for Ava.')).toBeVisible();
    assert.equal(requests[3].params.agentId, 'ava');
    assert.equal(requests[3].params.requestApproval, true);
    assert.deepEqual(
      requests.map(({ action }) => action),
      ['previewAgentDealContext', 'telnyx_call', 'pbk_test_skill', 'deploy']
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    console.log(
      `Agent roster, health evidence, manual runs and approval requests: ${engine.name()} ${viewport.width}px`
    );
  } finally {
    await browser.close();
  }
}

try {
  await verify(chromium, { width: 1440, height: 900 });
  await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
} finally {
  await server.close();
}
