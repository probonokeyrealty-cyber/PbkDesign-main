import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer, preview } from 'vite';

const built = process.env.PBK_FLEET_BUILT === '1';
const server = built
  ? await preview({ preview: { host: '127.0.0.1', port: 0 } })
  : await createServer({ server: { host: '127.0.0.1', port: 0 } });
if (!built) await server.listen();
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
const failureAt = '2026-11-14T03:17:19.443Z';
const measurement = {
  ready: false,
  generatedAt: '2026-11-14T03:20:00Z',
  result: 'stable_agent_fleet_measurement_gaps',
  agents: [
    {
      id: 'ava',
      ready: false,
      measured: false,
      blockers: [
        'latency_p95_above_budget',
        'last_success_missing',
        'dataFreshness_not_ready',
        'fleetReadiness_not_ready',
      ],
      metrics: {
        lastSuccessAt: '',
        lastFailureAt: failureAt,
        latencyP95Ms: 6544,
        latencySamples: 7,
        maxLatencyP95Ms: 2500,
      },
      missingTools: [],
    },
  ],
};
const readyMeasurement = {
  ready: true,
  generatedAt: '2026-11-14T03:10:00Z',
  agents: [
    {
      ...measurement.agents[0],
      ready: true,
      measured: true,
      blockers: [],
      metrics: {
        lastSuccessAt: '2026-11-14T03:09:00Z',
        lastFailureAt: '',
        latencyP95Ms: 100,
        latencySamples: 7,
      },
    },
  ],
};

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    await page.addInitScript(() => {
      window.PBK = {
        openclaw: { getConfig: () => ({ endpoint: location.origin, apiKey: 'fixture-only' }) },
      };
    });
    const requests = [];
    let measurementMode = 'failure';
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (built && req.isNavigationRequest() && path === '/fleet') {
        return route.fulfill({
          contentType: 'text/html',
          body: readFileSync('dist/index.shell.html', 'utf8'),
        });
      }
      if (req.method() === 'GET' && path === '/api/agents/measurement') {
        if (measurementMode === '401' || measurementMode === '403') {
          return route.fulfill({
            status: Number(measurementMode),
            json: { error: 'Measurement access denied' },
          });
        }
        if (measurementMode === 'newer-health') {
          return route.fulfill({ json: { ok: true, measurement: readyMeasurement } });
        }
        return route.fulfill({ status: 503, json: { ok: false, measurement } });
      }
      const fixture = {
        '/api/agents/registry': { source: 'postgres', registry: { agents } },
        '/api/agents/health': {
          measurement:
            measurementMode === 'newer-health'
              ? measurement
              : measurementMode === 'failure'
                ? undefined
                : readyMeasurement,
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
        '/api/agents/snn-status': {
          workers: [
            {
              agentId: 'ava',
              ready: true,
              lastActive: new Date().toISOString(),
              currentTask: 'findLead measurement failed',
            },
          ],
        },
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

    await page.goto(`${origin}/fleet`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: 'Agent Fleet', exact: true })).toBeVisible();
    const roster = page.getByRole('region', { name: 'Agent roster' });
    await expect(roster.getByRole('button', { name: 'Inspect Ava', exact: true })).toContainText(
      'Needs attention'
    );
    await expect(roster.getByRole('button', { name: 'Inspect Rex', exact: true })).toContainText(
      'Needs attention'
    );
    await expect(roster.getByText('Measurement unavailable', { exact: true })).toBeVisible();
    await expect(roster.getByText('Measured ready', { exact: true })).toHaveCount(0);
    const detail = page.getByRole('region', { name: 'Selected agent' });
    await roster.getByRole('button', { name: 'Inspect Rex', exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Rex', exact: true })).toBeInViewport();
    await expect(detail.getByRole('button', { name: 'Request call' })).toBeDisabled();
    await detail.getByText('Health evidence', { exact: true }).click();
    await expect(detail.getByText('qa-review-tool', { exact: true })).toBeVisible();
    await detail.getByText('Health evidence', { exact: true }).click();

    await roster.getByRole('button', { name: 'Inspect Max', exact: true }).click();
    await detail.getByText('Health evidence', { exact: true }).click();
    await expect(detail.getByText('tools unknown', { exact: true })).toBeVisible();
    await detail.getByText('Health evidence', { exact: true }).click();

    await roster.getByRole('button', { name: 'Inspect Ava', exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Ava', exact: true })).toBeInViewport();
    await detail.getByText('Health evidence', { exact: true }).click();
    const evidence = detail.locator('.pbk-fleet-health-evidence');
    await expect(evidence.getByText('No live record yet', { exact: true })).toBeVisible();
    await expect(evidence.locator(`strong[title="${failureAt}"]`)).toBeVisible();
    await expect(evidence.getByText('6.5s p95', { exact: true })).toBeVisible();
    await expect(
      evidence.getByText('Latency: 7 samples; 2.5s budget', { exact: true })
    ).toBeVisible();
    await expect(evidence.getByText('Not measured ready', { exact: true })).toBeVisible();
    await expect(evidence).toContainText('dataFreshness not ready');
    await expect(evidence).toContainText('fleetReadiness not ready');
    await expect(evidence.getByText('Tools and health clear', { exact: true })).toHaveCount(0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    if (process.env.PBK_FLEET_SCREENSHOTS === '1') {
      await evidence.screenshot({
        path: `output/playwright/fleet-evidence-${engine.name()}-${viewport.width}.png`,
      });
    }
    if (viewport.width < 720) {
      const lastSource = evidence.locator('.pbk-agent-health-source').last();
      const scrolled = await lastSource.evaluate((element) => {
        const scrollable = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (
            parent === document.scrollingElement ||
            /auto|scroll/.test(getComputedStyle(parent).overflowY)
          ) {
            scrollable.push({ element: parent, before: parent.scrollTop });
          }
        }
        element.scrollIntoView({ block: 'center', behavior: 'instant' });
        return scrollable.some(({ element: parent, before }) => parent.scrollTop > before);
      });
      assert.equal(scrolled, true, 'Evidence must move through a user-scrollable container.');
      await expect
        .poll(async () =>
          evidence.locator('p').evaluateAll((paragraphs) => {
            const navTop = document
              .querySelector('.pbk-mobile-shell-nav')
              .getBoundingClientRect().top;
            return paragraphs.every((paragraph) => {
              const rect = paragraph.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2
              );
              return rect.top >= 0 && rect.bottom <= navTop - 8 && paragraph.contains(hit);
            });
          })
        )
        .toBe(true);
      console.log(
        `Evidence blockers and final source reachable above mobile nav: ${engine.name()} ${viewport.width}px`
      );
      if (process.env.PBK_FLEET_SCREENSHOTS === '1') {
        await page.screenshot({
          path: `output/playwright/fleet-evidence-${engine.name()}-${viewport.width}-scrolled.png`,
        });
      }
    }
    await detail.getByText('Health evidence', { exact: true }).click();
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
    measurementMode = 'newer-health';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(roster.getByRole('button', { name: 'Inspect Ava', exact: true })).toContainText(
      'Needs attention'
    );
    await detail.getByText('Health evidence', { exact: true }).click();
    await expect(evidence).toContainText('GET /api/agents/health (measurement)');
    await expect(evidence.locator(`span[title="${measurement.generatedAt}"]`)).toBeVisible();
    await expect(evidence.locator(`strong[title="${failureAt}"]`)).toBeVisible();
    await expect(roster.getByText('Measured ready', { exact: true })).toHaveCount(0);
    for (const status of ['401', '403']) {
      measurementMode = status;
      await page.reload({ waitUntil: 'domcontentloaded' });
      const warning = page.getByRole('alert').filter({ hasText: 'Measurement request failed' });
      await expect(warning).toBeVisible();
      await expect(warning).toContainText('readiness is unverified');
      await expect(roster.getByRole('button', { name: 'Inspect Ava', exact: true })).toContainText(
        'Measurement unavailable'
      );
      await expect(roster.getByText('Measured ready', { exact: true })).toHaveCount(0);
      await detail.getByText('Health evidence', { exact: true }).click();
      await expect(evidence).toContainText('Measurement evidence unavailable');
      await expect(evidence.getByText('Capability pending proof', { exact: true })).toBeVisible();
      if (process.env.PBK_FLEET_SCREENSHOTS === '1' && status === '401') {
        await warning.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `output/playwright/fleet-auth-warning-${engine.name()}-${viewport.width}.png`,
        });
      }
    }
    console.log(
      `Newer snapshot provenance and visible 401/403 fail-closed warnings: ${engine.name()} ${viewport.width}px`
    );
  } finally {
    await browser.close();
  }
}

try {
  await verify(chromium, { width: 1440, height: 900 });
  await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
} finally {
  if (built) await new Promise((resolve) => server.httpServer.close(resolve));
  else await server.close();
}
