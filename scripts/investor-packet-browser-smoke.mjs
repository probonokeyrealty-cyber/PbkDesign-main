import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';

// Local built application only. Every external request is intercepted; no live login or outreach.
const server = await preview({
  configFile: false,
  build: { outDir: '.pbk-local/investor-live' },
  preview: { host: '127.0.0.1', port: 0 },
});
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
const property = {
  id: 'fixture-packet',
  version: 1,
  revision: 1,
  fictional: true,
  title: 'Example property with a long title for responsive packet review',
  address: '123 Example Avenue',
  city: 'Example City',
  state: 'OH',
  zip: '00000',
  status: 'Available',
  askingCents: 12000000,
  rehabCents: 2500000,
  arvCents: 22000000,
  assetType: 'Single-family',
  market: 'Example market',
  beds: 0,
  baths: null,
  summary: 'Synthetic property summary for local testing.',
  knownIssues: '',
  source: 'Synthetic fixture',
  checkedAt: '2026-11-15',
  assets: [],
};
try {
  await mkdir('output/playwright', { recursive: true });
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    let expired = false;
    let unavailable = false;
    const errors = [];
    const consultations = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.pathname === '/functions/v1/pbk-investor-portal') {
        const { command, payload } = route.request().postDataJSON();
        if (expired) return route.fulfill({ status: 401, json: { error: 'Invalid session.' } });
        if (unavailable)
          return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable.' } });
        if (command === 'authVerify')
          return route.fulfill({
            status: 401,
            json: { error: 'That code is invalid or expired.' },
          });
        if (command === 'authPassword' && payload.password !== 'fixture-only-password')
          return route.fulfill({ status: 401, json: { error: 'Email or password is incorrect.' } });
        if (command === 'consultProperty') {
          consultations.push(payload);
          return route.fulfill({
            json: { version: 1, answer: 'Verify repair bids and recent comparable sales.' },
          });
        }
        const results = {
          authCallback: { expiresIn: 3600 },
          authPassword: { token: 'fixture-native', expiresIn: 3600 },
          setPassword: { passwordUpdated: true },
          authStart: { message: 'If approved, a link will arrive.' },
          session: {
            member: { id: 'fixture-investor', email: 'fixture@example.invalid', role: 'investor' },
            consultationEnabled: true,
          },
          list: { properties: [property] },
          inquiries: { inquiries: [] },
          saved: { ids: [] },
        };
        assert.ok(command in results, `Unexpected fixture command: ${command}`);
        return route.fulfill({ json: results[command] });
      }
      return route.abort();
    });
    await page.goto(`${origin}/investor-portal.html`);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'autocomplete',
      'current-password'
    );
    await page.screenshot({
      path: `output/playwright/investor-login-${width}.png`,
      fullPage: true,
    });
    await page.getByLabel('Email address', { exact: true }).fill('fixture@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await page.getByLabel('Password', { exact: true }).fill('fixture-only-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'View property packet', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'View property packet', exact: true }).click();
    const packet = page.getByRole('region', { name: 'Property packet' });
    await expect(packet.getByText('Estimated repairs', { exact: true })).toBeVisible();
    await expect(packet.getByText('After-repair value · estimate', { exact: true })).toBeVisible();
    await expect(packet.getByText('Not provided. Complete your own due diligence.')).toBeVisible();
    await packet.getByRole('tab', { name: 'Property record', exact: true }).click();
    assert.equal(consultations.length, 0);
    await packet.getByLabel('Review question').selectOption('renovation');
    assert.equal(consultations.length, 0);
    await packet.getByRole('button', { name: 'Ask DeepSeek' }).click();
    await expect(packet.getByText('Verify repair bids and recent comparable sales.')).toBeVisible();
    assert.deepEqual(consultations, [{ id: property.id, version: 1, topic: 'renovation' }]);
    await expect(packet.getByText('Unknown', { exact: true }).first()).toBeVisible();
    await expect(packet.getByText('0', { exact: true })).toBeVisible();
    await packet.getByRole('tab', { name: 'Photos', exact: true }).click();
    await expect(packet.getByText('No approved photos yet.', { exact: false })).toBeVisible();
    await packet.getByRole('tab', { name: 'Overview', exact: true }).click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false
    );
    await page.screenshot({
      path: `output/playwright/investor-packet-${width}.png`,
      fullPage: true,
    });
    unavailable = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Temporarily unavailable.');
    await expect(packet).toBeVisible();
    unavailable = false;
    expired = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Property packet' })).toHaveCount(0);
    await expect(page.getByText(property.address, { exact: true })).toHaveCount(0);
    expired = false;
    await page.getByRole('button', { name: 'Use an email link instead', exact: true }).click();
    await page.getByLabel('Email address', { exact: true }).fill('fixture@example.invalid');
    await page.getByRole('button', { name: 'Email my sign-in link', exact: true }).click();
    await page.getByLabel('Sign-in code or complete email link').fill('000000');
    await page.getByRole('button', { name: 'Verify and sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('That code is invalid or expired.');
    await expect(
      page.getByRole('button', { name: 'Verify and sign in', exact: true })
    ).toBeVisible();
    await page.goto(
      `${origin}/investor-portal.html?fixture=recovery#access_token=fixture-only&type=recovery`
    );
    await expect(
      page.getByRole('heading', { name: 'Set your password.', exact: true })
    ).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill('fixture-only-password');
    await page
      .getByLabel('Confirm new password', { exact: true })
      .fill('fixture-mismatch-password');
    await page.getByRole('button', { name: 'Save password', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Passwords do not match.');
    await page.getByLabel('Confirm new password', { exact: true }).fill('fixture-only-password');
    await page.getByRole('button', { name: 'Save password', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'View property packet', exact: true })
    ).toBeVisible();
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`investor-packet: ${width}px passed (isolated fixture)`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
