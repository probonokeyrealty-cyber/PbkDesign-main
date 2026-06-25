import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const artifactRoot = path.join(root, '.tmp', 'playwright-ui-smoke', 'latest');
const host = '127.0.0.1';
const oldCopy = [
  'operator cockpit',
  'waiting on you',
  'Web Search Cognition',
  'Tooling Readiness',
  'Production gaps',
  'approval gated',
  'bridge-backed',
  'from runtime snapshot',
  'bridge queued messages',
  'Tavily live',
  'Fallback active',
  'pbk-web-search-spikes',
  'Runtime action complete',
  'Human-sent SMS uses the manual bridge lane',
  'System of record',
  'Load more messages',
  'Load 50 more',
];

const routeChecks = [
  {
    path: '/command-center',
    title: 'Command Center | PBK',
    pagerLabels: ['Workspace task pages', 'Activity feed pages', 'Approval board pages'],
  },
  {
    path: '/inbox',
    title: 'Inbox | PBK',
    pagerLabels: ['Approval board pages', 'Message stream pages'],
  },
  {
    path: '/leads',
    title: 'Leads | PBK',
    pagerLabels: ['Seller roster pages'],
  },
  {
    path: '/skill-studio',
    title: 'Skill Studio | PBK',
    pagerLabels: ['Ava skill pages'],
    waitForText: 'Ava skill pages',
  },
  {
    path: '/ava-chat',
    title: 'Ava Chat | PBK',
    pagerLabels: [],
    avaSendCheck: true,
  },
];

const warmupModules = [
  '/src/styles/index.css',
  '/src/app/utils/uiPrefs.ts',
  '/src/app/shell/ParadiseLayout.tsx',
  '/src/app/shell/router.tsx',
  '/src/app/routes/CommandCenter.tsx',
  '/src/app/routes/Inbox.tsx',
  '/src/app/routes/Leads.tsx',
  '/src/app/routes/SkillStudio.tsx',
  '/src/app/routes/AvaChat.tsx',
  '/src/main.shell.tsx',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < 30_000) {
    if (child.exitCode != null) {
      throw new Error(`Vite exited before serving ${baseUrl}. ${lastError}`.trim());
    }
    try {
      const response = await fetch(baseUrl, { method: 'HEAD' });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Vite at ${baseUrl}. ${lastError}`.trim());
}

async function fetchWithTimeout(url, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function warmViteModules(baseUrl) {
  const failures = [];
  for (const modulePath of warmupModules) {
    let ok = false;
    let lastError = '';
    for (let attempt = 1; attempt <= 2 && !ok; attempt += 1) {
      try {
        const response = await fetchWithTimeout(`${baseUrl}${modulePath}`);
        ok = response.ok;
        if (!ok) lastError = `HTTP ${response.status}`;
        await response.arrayBuffer();
      } catch (error) {
        lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    }
    if (!ok) failures.push(`${modulePath} (${lastError || 'unknown failure'})`);
  }
  assert(failures.length === 0, `Vite module warmup failed: ${failures.join(', ')}`);
}

function startVite(port) {
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(process.execPath, [viteBin, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: root,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function collectRouteState(page, route) {
  if (route.pagerLabels.length > 0) {
    for (const label of route.pagerLabels) {
      await page.locator(`[data-list-page-size][aria-label="${label}"]`).first().waitFor({
        timeout: 45_000,
      });
    }
  } else if (route.avaSendCheck) {
    await page.locator('textarea[placeholder="Ask Ava anything..."]').waitFor({ timeout: 45_000 });
  } else if (route.waitForText) {
    await page.getByText(route.waitForText, { exact: false }).first().waitFor({ timeout: 45_000 });
  } else {
    await page.waitForFunction(() => document.body.innerText.trim().length > 200, null, {
      timeout: 45_000,
    });
  }
  await page.waitForTimeout(700);

  if (route.avaSendCheck) {
    await page.locator('textarea[placeholder="Ask Ava anything..."]').fill('Mobile send layout check');
  }

  return page.evaluate((config) => {
    const text = document.body.innerText;
    const pagers = [...document.querySelectorAll('[data-list-page-size]')].map((el) => ({
      label: el.getAttribute('aria-label') || '',
      size: el.getAttribute('data-list-page-size') || '',
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    const send = [...document.querySelectorAll('button')].find((el) =>
      (el.getAttribute('aria-label') || '').includes('Send to Ava')
    );
    const sendRect = send?.getBoundingClientRect();
    const oldCopyVisible = config.oldCopy.filter((phrase) => text.includes(phrase));
    const oldCopyContext = Object.fromEntries(
      oldCopyVisible.map((phrase) => {
        const index = text.indexOf(phrase);
        return [phrase, text.slice(Math.max(0, index - 500), index + 700)];
      })
    );
    return {
      path: location.pathname,
      title: document.title,
      bodyLength: text.trim().length,
      frameworkOverlay:
        /\[plugin:vite|vite error overlay|webpack compiled with errors|failed to compile|unhandled runtime error|react error overlay/i.test(
          text
        ),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      oldCopyVisible,
      oldCopyContext,
      pagers,
      avaSend: send
        ? {
            disabled: send.hasAttribute('disabled'),
            visible:
              Boolean(sendRect) &&
              sendRect.width > 0 &&
              sendRect.height > 0 &&
              sendRect.left >= 0 &&
              sendRect.right <= window.innerWidth,
            rect: sendRect
              ? {
                  left: Math.round(sendRect.left),
                  right: Math.round(sendRect.right),
                  width: Math.round(sendRect.width),
                }
              : null,
          }
        : null,
    };
  }, { oldCopy });
}

async function runViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width <= 430 ? 2 : 1,
    isMobile: viewport.width <= 430,
  });
  const page = await context.newPage();
  const consoleEntries = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleEntries.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    consoleEntries.push({ type: 'pageerror', text: error.message });
  });

  const results = [];
  for (const route of routeChecks) {
    await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'commit', timeout: 45_000 });
    const state = await collectRouteState(page, route);
    const screenshotName = `${viewport.name}-${route.path.replace(/^\//, '').replace(/\//g, '-')}.png`;
    await page.screenshot({ path: path.join(artifactRoot, screenshotName), fullPage: false });

    assert(state.title === route.title, `${viewport.name} ${route.path} title mismatch: ${state.title}`);
    assert(state.path === route.path, `${viewport.name} ${route.path} did not stay on route.`);
    assert(state.bodyLength > 200, `${viewport.name} ${route.path} rendered too little content.`);
    assert(!state.frameworkOverlay, `${viewport.name} ${route.path} appears to show a framework overlay.`);
    assert(state.overflowX <= 1, `${viewport.name} ${route.path} has horizontal overflow ${state.overflowX}px.`);
    if (state.oldCopyVisible.length > 0) {
      await writeFile(
        path.join(
          artifactRoot,
          `${viewport.name}-${route.path.replace(/^\//, '').replace(/\//g, '-')}-old-copy.json`
        ),
        JSON.stringify(state.oldCopyContext, null, 2)
      );
    }
    assert(
      state.oldCopyVisible.length === 0,
      `${viewport.name} ${route.path} still shows old copy: ${state.oldCopyVisible.join(', ')}`
    );
    for (const label of route.pagerLabels) {
      const pager = state.pagers.find((item) => item.label === label);
      assert(pager, `${viewport.name} ${route.path} missing pager "${label}".`);
      assert(pager.size === '10', `${viewport.name} ${route.path} pager "${label}" is not ten-item.`);
    }
    if (route.avaSendCheck) {
      assert(state.avaSend, `${viewport.name} ${route.path} missing Ava Send button.`);
      assert(state.avaSend.visible, `${viewport.name} ${route.path} Ava Send is not fully visible.`);
      assert(!state.avaSend.disabled, `${viewport.name} ${route.path} Ava Send stayed disabled after typing.`);
    }
    results.push({ route: route.path, screenshot: screenshotName, state });
  }

  await context.close();
  return { viewport: viewport.name, results, consoleEntries };
}

async function main() {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });

  const port = await getFreePort();
  const baseUrl = `http://${host}:${port}`;
  const vite = startVite(port);
  let viteOutput = '';
  vite.stdout.on('data', (chunk) => {
    viteOutput += chunk.toString();
  });
  vite.stderr.on('data', (chunk) => {
    viteOutput += chunk.toString();
  });

  try {
    await waitForServer(baseUrl, vite);
    await warmViteModules(baseUrl);
    const browser = await chromium.launch({ headless: true });
    try {
      const desktop = await runViewport(browser, baseUrl, {
        name: 'desktop',
        width: 1440,
        height: 900,
      });
      const mobile = await runViewport(browser, baseUrl, {
        name: 'mobile',
        width: 390,
        height: 844,
      });
      const consoleEntries = [...desktop.consoleEntries, ...mobile.consoleEntries];
      assert(
        consoleEntries.length === 0,
        `Playwright captured console warnings/errors: ${JSON.stringify(consoleEntries.slice(0, 5))}`
      );
      console.log(
        JSON.stringify(
          {
            ok: true,
            baseUrl,
            artifactRoot,
            viewports: [desktop, mobile].map((item) => ({
              viewport: item.viewport,
              routes: item.results.map((result) => ({
                route: result.route,
                screenshot: result.screenshot,
                pagers: result.state.pagers,
                overflowX: result.state.overflowX,
                avaSend: result.state.avaSend,
              })),
            })),
          },
          null,
          2
        )
      );
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error(viteOutput.trim());
    throw error;
  } finally {
    vite.kill('SIGTERM');
  }
}

await main();
