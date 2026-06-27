#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';

const baseUrl = process.env.PBK_MOBILE_PROOF_BASE_URL || 'http://127.0.0.1:4174';
const teamPasscode =
  process.env.PBK_MOBILE_PROOF_TEAM_PASSCODE || process.env.PBK_TEAM_PASSCODE || '';
const teamSessionStorageKey = 'pbk:team-session:v1';
const routes = ['/ava-chat', '/leads', '/inbox', '/deal', '/campaigns', '/skill-studio'];
const device = devices['iPhone 13'];
const routeExpectations = {
  '/ava-chat': [/Ava/i],
  '/leads': [/Leads/i, /Contacts/i],
  '/inbox': [/Inbox/i, /messages/i],
  '/deal': [/Deal/i, /Analyzer/i],
  '/campaigns': [/Campaign/i],
  '/skill-studio': [/Skill/i],
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

async function authenticateTeamSession(context) {
  if (!shouldAuthenticateTeamSession()) return;

  const authUrl = new URL('/api/auth/team', baseUrl).toString();
  const response = await context.request.post(authUrl, {
    data: {
      passcode: teamPasscode,
      actor: 'PBK mobile proof',
    },
    timeout: 30000,
  });

  if (!response.ok()) {
    throw new Error(
      `team access authentication failed with ${response.status()} ${response.statusText()}`
    );
  }

  const session = await response.json();
  if (!session?.ok || !session.token || !session.expiresAt) {
    throw new Error('team access authentication did not return a usable session.');
  }

  await context.addInitScript(
    ({ storageKey, teamSession }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(teamSession));
    },
    {
      storageKey: teamSessionStorageKey,
      teamSession: {
        token: session.token,
        role: session.role || 'team',
        actor: session.actor || 'PBK mobile proof',
        expiresAt: session.expiresAt,
        permissions: session.permissions,
      },
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

    const bodyText = (await page.locator('body').innerText({ timeout: 10000 })).trim();
    if (!bodyText) {
      failures.push(`expected non-empty body text after navigating to ${url}.`);
    }

    if (/protected operator workspace|team passcode|open command center/i.test(bodyText)) {
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
      await checkRoute(context, route);
      console.log(`[mobile-browser-proof] ${route} ok`);
    }
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(`[mobile-browser-proof] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
