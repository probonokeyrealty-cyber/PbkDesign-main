import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { preview } from 'vite';

// Built staff shell with isolated Auth/runtime fixtures; never contacts a real account.
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
try {
  await mkdir('output/playwright', { recursive: true });
  for (const width of [390, 1440]) {
    for (const role of ['reviewer', 'editor', 'investor']) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const commands = [];
      const errors = [];
      const uploads = [];
      const property = {
        id: 'fixture-property',
        revision: 1,
        status: 'Draft',
        draft: { title: 'Fictional review property', address: '123 Example Avenue', checks: {} },
        assets: [],
      };
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(() => {
        window.PBK = {
          openclaw: { getConfig: () => ({ endpoint: location.origin, apiKey: 'fixture-only' }) },
        };
      });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/functions/v1/pbk-investor-portal') {
          if (route.request().headers()['content-type']?.startsWith('multipart/form-data')) {
            const form = await new Response(route.request().postDataBuffer(), {
              headers: { 'Content-Type': route.request().headers()['content-type'] },
            }).formData();
            const title = form.get('title');
            uploads.push(title);
            assert.equal(form.get('id'), property.id);
            assert.equal(form.get('revision'), String(property.revision));
            assert.equal(form.get('buyerVisible'), 'true');
            assert.equal(form.get('rights'), 'PBK-owned synthetic fixture');
            if (title !== 'packet.pdf') assert.ok(form.get('alt'));
            if (title === 'exterior.png' && uploads.filter((name) => name === title).length === 1)
              return route.abort('connectionreset');
            property.assets.push({
              id: String(property.revision++),
              title,
              kind: title === 'packet.pdf' ? 'packet' : 'photo',
              rights: form.get('rights'),
            });
            return route.fulfill({ json: { property } });
          }
          const { command, payload } = route.request().postDataJSON();
          commands.push(command);
          if (command === 'authPassword' && payload.password !== 'fixture-only-password')
            return route.fulfill({
              status: 401,
              json: { error: 'Email or password is incorrect.' },
            });
          if (command === 'verifyRecovery' && payload.code !== '123456')
            return route.fulfill({
              status: 401,
              json: {
                error: 'That recovery code is invalid or expired. Request a new recovery code.',
              },
            });
          const replies = {
            recoverPassword: { message: 'If approved, a recovery email will arrive.' },
            verifyRecovery: { token: 'fixture-only-staff', expiresIn: 3600 },
            authPassword: { token: 'fixture-only-staff', expiresIn: 3600 },
            session: { member: { id: 'fixture-staff', email: 'staff@example.invalid', role } },
            list: { properties: [property] },
            inquiries: { inquiries: [] },
            saved: { ids: [] },
            logout: { signedOut: true },
          };
          assert.ok(command in replies, `Unexpected portal action: ${command}`);
          return route.fulfill({ json: replies[command] });
        }
        if (url.origin !== origin) return route.abort();
        if (route.request().isNavigationRequest() && url.pathname === '/property-log')
          return route.fulfill({
            contentType: 'text/html',
            body: await readFile('dist/index.shell.html', 'utf8'),
          });
        if (/^\/(api\/|state$|health$|events$|invoke$)/.test(url.pathname))
          return route.fulfill({ json: { ok: true, leadImports: [], activity: [], calls: [] } });
        return route.continue();
      });
      await page.goto(`${origin}/property-log`);
      await expect(
        page.getByRole('heading', { name: 'Staff sign-in.', exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Back to Command Center', exact: true })
      ).toHaveAttribute('href', '/');
      await expect(page.getByRole('link', { name: /Share your Buy Box/ })).toHaveCount(0);
      await page.getByLabel('Email address', { exact: true }).fill('staff@example.invalid');
      await page.getByLabel('Password', { exact: true }).fill('wrong-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      if (role === 'reviewer') {
        await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
        await expect(page.getByLabel('Password recovery code', { exact: true })).toBeVisible();
        await page.getByLabel('Password recovery code', { exact: true }).fill('000000');
        await page.getByRole('button', { name: 'Continue to set password', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('invalid or expired');
        await page.getByLabel('Password recovery code', { exact: true }).fill('123456');
        await page.getByRole('button', { name: 'Continue to set password', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Set your password.', exact: true })
        ).toBeVisible();
        await page.screenshot({
          path: `output/playwright/staff-password-setup-${width}.png`,
          fullPage: true,
        });
        // Stop before entering any new credential; the account owner performs this step.
        await page.getByRole('button', { name: 'Cancel and sign out', exact: true }).click();
      }
      await page.getByLabel('Password', { exact: true }).fill('fixture-only-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      if (role === 'investor') {
        await expect(page.getByRole('alert')).toContainText('Staff access is required');
        await expect(
          page.getByRole('heading', { name: 'The property log.', exact: true })
        ).toHaveCount(0);
        assert.ok(commands.includes('logout'));
      } else {
        await expect(
          page.getByRole('heading', { name: 'The property log.', exact: true })
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add property', exact: true })).toBeVisible();
        assert.ok(commands.includes('list'));
        if (role === 'reviewer') {
          await page.getByRole('button', { name: 'Open draft', exact: true }).click();
          const panel = page.getByRole('region', { name: 'Packet files' });
          await expect(panel).toContainText('123 Example Avenue');
          const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZuoAAAAASUVORK5CYII=',
            'base64'
          );
          await panel.getByLabel('Choose packet files').setInputFiles([
            { name: 'packet.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
            { name: 'exterior.png', mimeType: 'image/png', buffer: png },
            { name: 'interior.png', mimeType: 'image/png', buffer: png },
          ]);
          const upload = panel.getByRole('button', { name: 'Upload private files' });
          await expect(upload).toBeDisabled();
          await expect(page.getByRole('button', { name: 'Preview as investor' })).toBeDisabled();
          for (const file of ['packet.pdf', 'exterior.png', 'interior.png']) {
            const row = panel.getByRole('group', { name: file, exact: true });
            await row
              .getByLabel('Rights basis and rights holder')
              .fill('PBK-owned synthetic fixture');
            if (file.endsWith('.png')) await row.getByLabel('Photo alt text').fill(file);
          }
          await upload.click();
          await expect(panel).toContainText('Upload could not be confirmed');
          assert.deepEqual(uploads, ['packet.pdf', 'exterior.png']);
          await upload.click();
          await expect(panel.getByText('Rights recorded', { exact: true })).toHaveCount(3);
          assert.deepEqual(uploads, ['packet.pdf', 'exterior.png', 'exterior.png', 'interior.png']);
          assert.equal(commands.includes('release'), false);
          await expect(
            page.getByRole('button', { name: 'Release reviewed version' })
          ).toBeDisabled();
          await expect(page.getByRole('button', { name: 'Preview as investor' })).toBeEnabled();
          await panel.screenshot({
            path: `output/playwright/staff-packet-files-${width}.png`,
          });
          await panel.getByLabel('Choose packet files').setInputFiles({
            name: 'unsupported.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('unsupported'),
          });
          await expect(panel).toContainText('Choose a PDF, JPG, PNG or WebP');
          await expect(upload).toBeDisabled();
          const { violations } = await new AxeBuilder({ page })
            .include('.portal-packet-files')
            .analyze();
          assert.deepEqual(
            violations.map(({ id }) => id),
            []
          );
          await panel.getByRole('button', { name: 'Remove from queue' }).click();
          await expect(panel.getByRole('group', { name: 'unsupported.txt' })).toHaveCount(0);
          await page.getByRole('button', { name: 'Back to property log' }).click();
          await page.getByRole('button', { name: 'Open draft', exact: true }).click();
          await expect(panel.getByText('Rights recorded', { exact: true })).toHaveCount(3);
        }
        await page.screenshot({
          path: `output/playwright/staff-property-log-${role}-${width}.png`,
          fullPage: true,
        });
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false
      );
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`staff-property-log: ${role} ${width}px passed (isolated fixture)`);
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
