#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';

const baseUrl = process.env.PBK_MOBILE_PROOF_BASE_URL || 'http://127.0.0.1:4174';
const hostedBridgeUrl = String(process.env.PBK_HOSTED_BRIDGE_URL || '').trim();
const teamPasscode =
  process.env.PBK_MOBILE_PROOF_TEAM_PASSCODE || process.env.PBK_TEAM_PASSCODE || '';
const teamSessionStorageKey = 'pbk:team-session:v1';
const teamAuthAttempts = 3;
const routeAttempts = Math.max(
  1,
  Number.parseInt(
    process.env.PBK_MOBILE_PROOF_ROUTE_ATTEMPTS || (baseUrl.startsWith('http://127.0.0.1') ? '1' : '3'),
    10
  ) || 1
);
const routes = ['/ava-chat', '/leads', '/inbox/conversations', '/analyzer', '/campaigns', '/skills'];
const device = devices['iPhone 13'];
const routeExpectations = {
  '/ava-chat': [/Ava/i],
  '/leads': [/Leads/i, /Contacts/i],
  '/inbox/conversations': [/Inbox/i, /messages/i, /Conversation/i],
  '/analyzer': [/Deal/i, /Analyzer/i],
  '/campaigns': [/Campaign/i],
  '/skills': [/Skill/i],
};
const benignErrorPatterns = [
  /ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/i,
  /favicon\.ico/i,
];
const routeErrorPatterns = [
  /\b404\b/i,
  /\bapplication error\b/i,
  /\bfailed to load\b/i,
  /\bnot found\b/i,
  /\bpage not found\b/i,
  /\broute error\b/i,
  /\bsomething went wrong\b/i,
  /\bunexpected error\b/i,
];

function routeUrl(route) {
  return new URL(route, baseUrl).toString();
}

function uniqueUrls(urls) {
  const seen = new Set();
  return urls
    .map((url) => String(url || '').replace(/\/+$/, ''))
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function isBenignBrowserError(message) {
  return benignErrorPatterns.some((pattern) => pattern.test(message));
}

function formatRouteFailures(route, failures) {
  return `${route}: ${failures.join(`\n${route}: `)}`;
}

function findRouteErrorMarker(bodyText) {
  return routeErrorPatterns.find((pattern) => pattern.test(bodyText));
}

function shouldAuthenticateTeamSession() {
  if (!teamPasscode) return false;
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  return (
    hostname.includes('pbkcommandcenter') ||
    hostname.endsWith('.netlify.app') ||
    hostname.includes('pbk-openclaw-bridge') ||
    hostname.endsWith('.onrender.com')
  );
}

function buildStoredTeamSession(session) {
  return {
    token: session.token,
    role: session.role || 'team',
    actor: session.actor || 'PBK mobile proof',
    expiresAt: session.expiresAt,
    permissions: session.permissions,
  };
}

async function isProtectedGateVisible(page, bodyText) {
  const stableGateCount = await page
    .locator('.pbk-team-access-shell, #pbk-team-passcode')
    .count()
    .catch(() => 0);
  return stableGateCount > 0 || /protected operator workspace|team passcode|open command center/i.test(bodyText);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function authenticateTeamSession(context) {
  if (!shouldAuthenticateTeamSession()) return null;

  const authBases = uniqueUrls([baseUrl, hostedBridgeUrl]);
  let lastError = '';

  for (let attempt = 1; attempt <= teamAuthAttempts; attempt += 1) {
    for (const authBase of authBases) {
      const authHost = new URL(authBase).host;
      const authUrl = new URL('/api/auth/team', authBase).toString();
      const verifyUrl = new URL('/api/auth/team/verify', authBase).toString();
      const response = await context.request.post(authUrl, {
        data: {
          passcode: teamPasscode,
          actor: 'PBK mobile proof',
        },
        timeout: 30000,
      });

      if (!response.ok()) {
        lastError = `auth via ${authHost} returned ${response.status()} ${response.statusText()}`;
        continue;
      }

      const session = await response.json();
      if (!session?.ok || !session.token || !session.expiresAt) {
        lastError = `auth via ${authHost} did not return a usable signed session`;
        continue;
      }

      const verifyResponse = await context.request.post(verifyUrl, {
        data: {},
        headers: {
          'X-PBK-Team-Token': session.token,
        },
        timeout: 30000,
      });
      const verifyPayload = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok() || verifyPayload?.ok === false) {
        lastError = `session verify via ${authHost} returned ${verifyResponse.status()} ${verifyResponse.statusText()}`;
        continue;
      }

      const teamSession = buildStoredTeamSession({
        ...session,
        permissions: verifyPayload.permissions || session.permissions,
      });

      await context.addInitScript(
        ({ storageKey, storedSession }) => {
          window.localStorage.setItem(storageKey, JSON.stringify(storedSession));
        },
        {
          storageKey: teamSessionStorageKey,
          storedSession: teamSession,
        }
      );
      return teamSession;
    }

    await sleep(750 * attempt);
  }

  throw new Error(
    `team access authentication did not verify after ${teamAuthAttempts} attempts${
      lastError ? `: ${lastError}` : ''
    }.`
  );
}

async function installTeamSessionOnPage(page, teamSession) {
  if (!teamSession) return;
  await page.evaluate(
    ({ storageKey, storedSession }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(storedSession));
    },
    {
      storageKey: teamSessionStorageKey,
      storedSession: teamSession,
    }
  );
}

async function checkRoute(context, route) {
  const url = routeUrl(route);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!isBenignBrowserError(text)) consoleErrors.push(text);
  });
  page.on('pageerror', (error) => {
    const text = error?.stack || error?.message || String(error);
    if (!isBenignBrowserError(text)) pageErrors.push(text);
  });

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const failures = [];

    if (response && !response.ok()) {
      failures.push(`expected HTTP 2xx/3xx from ${url}, received ${response.status()} ${response.statusText()}.`);
    }

    const finalUrl = page.url();
    if (!finalUrl.includes(route)) {
      failures.push(`expected final URL to include "${route}", received "${finalUrl}".`);
    }

    let bodyText = (await page.locator('body').innerText({ timeout: 10000 })).trim();
    if ((await isProtectedGateVisible(page, bodyText)) && teamPasscode) {
      const refreshedSession = await authenticateTeamSession(context);
      await installTeamSessionOnPage(page, refreshedSession);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      bodyText = (await page.locator('body').innerText({ timeout: 10000 })).trim();
    }

    if (!bodyText) {
      failures.push(`expected non-empty body text after navigating to ${url}.`);
    }

    if (await isProtectedGateVisible(page, bodyText)) {
      const envHint = teamPasscode
        ? 'the team session was not accepted by the hosted app.'
        : 'set PBK_MOBILE_PROOF_TEAM_PASSCODE or PBK_TEAM_PASSCODE to prove protected pages.';
      failures.push(`protected workspace gate is still visible; ${envHint}`);
    }

    const routeErrorMarker = findRouteErrorMarker(bodyText);
    if (routeErrorMarker) {
      failures.push(`visible route error UI matched ${routeErrorMarker.toString()}.`);
    }

    const expectedMarkers = routeExpectations[route] || [];
    if (bodyText && !expectedMarkers.some((pattern) => pattern.test(bodyText))) {
      failures.push(
        `expected visible content matching ${expectedMarkers.map((pattern) => pattern.toString()).join(' or ')}.`
      );
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    if (overflow.scrollWidth > overflow.innerWidth + 2) {
      failures.push(
        `horizontal overflow detected; document width ${overflow.scrollWidth}px exceeds viewport ${overflow.innerWidth}px.`
      );
    }

    if (consoleErrors.length) {
      failures.push(`browser console errors:\n${consoleErrors.map((message) => `  - ${message}`).join('\n')}`);
    }
    if (pageErrors.length) {
      failures.push(`page errors:\n${pageErrors.map((message) => `  - ${message}`).join('\n')}`);
    }

    if (failures.length) {
      throw new Error(formatRouteFailures(route, failures));
    }
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      ...device,
    });
    await authenticateTeamSession(context);

    for (const route of routes) {
      let lastError = null;
      for (let attempt = 1; attempt <= routeAttempts; attempt += 1) {
        try {
          await checkRoute(context, route);
          if (attempt > 1) {
            console.log(`[mobile-browser-proof] ${route} ok after ${attempt} attempts`);
          } else {
            console.log(`[mobile-browser-proof] ${route} ok`);
          }
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < routeAttempts) {
            await sleep(1000 * attempt);
          }
        }
      }
      if (lastError) throw lastError;
    }
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(`[mobile-browser-proof] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
