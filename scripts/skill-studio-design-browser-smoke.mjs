import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const versionId = 'qa-skill-version';
const activationId = 'qa-activation';
const contentHash = 'fixture-content-hash';
const name = 'Fixture price follow-up';
const response = 'Acknowledge the price concern.';
const nextQuestion = 'What number would make this work?';

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    const writes = [];
    let item = null;
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (path === '/api/skills/governance/repository') {
        return route.fulfill({ json: { ok: true, items: item ? [item] : [] } });
      }
      if (path === '/api/skills/governance/status') {
        const state = item?.lifecycleState;
        return route.fulfill({
          json: {
            ok: true,
            candidates: Number(state === 'candidate'),
            approvedInactive: Number(state === 'approved_inactive'),
            canary: Number(state === 'canary'),
            active: Number(state === 'active'),
            snapshot: { available: true },
          },
        });
      }
      if (req.method() === 'POST' && path.startsWith('/api/skills/')) {
        const body = req.postDataJSON();
        writes.push({ path, body });
        if (path === '/api/skills/candidates') {
          item = {
            name: body.displayName,
            instructions: body.instructions,
            triggerPolicy: body.triggerPolicy,
            versionId,
            contentHash,
            lifecycleState: 'candidate',
            versionNumber: 1,
            riskClass: body.riskClass,
            sourceProvenance: { note: 'Browser test fixture only' },
          };
        } else if (path === `/api/skills/versions/${versionId}/approve`) {
          item = { ...item, lifecycleState: 'approved_inactive', approvalId: 'qa-approval' };
        } else if (path === `/api/skills/versions/${versionId}/activate`) {
          item = {
            ...item,
            lifecycleState: 'canary',
            activationId,
            activationStatus: 'canary',
            rolloutPercent: body.rolloutPercent,
            agentId: body.agentId,
          };
        } else if (path === `/api/skills/activations/${activationId}/rollback`) {
          item = {
            ...item,
            lifecycleState: 'rolled_back',
            activationStatus: 'rolled back',
            rolloutPercent: 0,
          };
        } else {
          return route.fulfill({ status: 400, json: { error: 'Unexpected fixture write' } });
        }
        return route.fulfill({ json: { ok: true, version: item } });
      }
      if (url.origin !== origin || /^\/(api\/|health$|state$|events$|invoke$)/.test(path)) {
        return route.fulfill({ json: { ok: true } });
      }
      return route.continue();
    });

    await page.goto(`${origin}/skills`);
    await expect(page.getByRole('heading', { name: 'Skill Studio', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Teach Ava', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'Teach Ava a new skill' });
    await wizard.getByLabel('Skill name').fill(name);
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    await wizard.getByLabel('What should Ava say?').fill(response);
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    await wizard.getByLabel('What should Ava ask next?').fill(nextQuestion);
    await wizard.getByRole('button', { name: 'Preview skill', exact: true }).click();
    await wizard.getByRole('button', { name: 'Create candidate', exact: true }).click();
    await expect(wizard).toHaveCount(0);
    assert.match(writes[0].body.instructions, /Acknowledge the price concern\./);
    assert.equal(writes[0].body.triggerPolicy.nextQuestion, nextQuestion);

    const evidence = page.getByRole('navigation', { name: 'Skill evidence' });
    await evidence.getByRole('link', { name: 'Simulator', exact: true }).click();
    const simulator = page.getByRole('region', { name: 'Skill simulator' });
    await expect(simulator.getByText('Simulation only', { exact: true })).toBeVisible();
    const sellerLine = 'I need time to think about this.';
    await simulator.getByLabel('Seller says').fill(sellerLine);
    await expect(simulator.getByRole('paragraph').filter({ hasText: sellerLine })).toBeVisible();
    await expect(simulator.getByText(response, { exact: true })).toBeVisible();
    await expect(simulator.getByText(nextQuestion, { exact: true })).toBeVisible();
    assert.equal(writes.length, 1);
    await evidence.getByRole('link', { name: 'Outcome evidence', exact: true }).click();
    await expect(page.getByText('Outcome proof:', { exact: true })).toBeVisible();
    const outcomes = page.getByRole('region', { name: 'Skill performance dashboard' });
    await expect(outcomes.getByRole('article').filter({ hasText: 'Success rate' })).toContainText(
      'N/A'
    );
    if (process.env.PBK_SKILL_SCREENSHOTS === '1') {
      await page.screenshot({
        path: `.pbk-local/skill-studio-${engine.name()}-${viewport.width}.png`,
      });
    }

    await evidence.getByRole('link', { name: 'Decision', exact: true }).click();
    const review = page.getByRole('button', { name: 'Review and approve this skill', exact: true });
    await review.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(writes.length, 1);
    await review.click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Start a small test', exact: true })
    ).toBeVisible();
    assert.equal(writes[1].body.expectedHash, contentHash);
    assert.equal(writes[1].body.decision, 'approved');
    assert.equal(writes.length, 2);

    await page.getByRole('combobox', { name: 'Rollout agent' }).selectOption('rex');
    const rollout = page.getByRole('slider', { name: 'Rollout percentage' });
    await rollout.focus();
    await rollout.press('ArrowRight');
    await page.getByRole('button', { name: 'Start a small test', exact: true }).click();
    await expect(page.getByText(/Start this skill for 15% of REX/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Turn this skill off', exact: true })
    ).toBeVisible();
    assert.equal(writes[2].body.agentId, 'rex');
    assert.equal(writes[2].body.rolloutMode, 'canary');
    assert.equal(writes[2].body.rolloutPercent, 15);
    assert.deepEqual(writes[2].body.rollbackThresholds, {
      complianceFailure: 1,
      sellerComplaint: 1,
      toolErrorRate: 0.1,
    });

    await page.getByRole('button', { name: 'Turn this skill off', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText(`${name} was removed from new runtime selections.`)).toBeVisible();
    assert.deepEqual(
      writes.map(({ path }) => path),
      [
        '/api/skills/candidates',
        `/api/skills/versions/${versionId}/approve`,
        `/api/skills/versions/${versionId}/activate`,
        `/api/skills/activations/${activationId}/rollback`,
      ]
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    console.log(
      `Skill candidate, simulator, approval, canary and rollback: ${engine.name()} ${viewport.width}px`
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
