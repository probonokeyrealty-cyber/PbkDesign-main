import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const config = readFileSync(resolve(root, 'netlify.toml'), 'utf8');

function getHeaderBlock(path) {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `\\[\\[headers\\]\\]\\s*\\n\\s*for\\s*=\\s*"${escapedPath}"[\\s\\S]*?(?=\\n\\[\\[|$)`,
  );
  return config.match(pattern)?.[0] ?? '';
}

function assertCacheControl(path, expected) {
  const block = getHeaderBlock(path);
  assert(block, `Missing Netlify header block for ${path}.`);
  assert(
    block.includes(`Cache-Control = "${expected}"`),
    `Expected ${path} to set Cache-Control: ${expected}.`,
  );
}

function getRedirectBlock(path) {
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `\\[\\[redirects\\]\\]\\s*\\n\\s*from\\s*=\\s*"${escapedPath}"[\\s\\S]*?(?=\\n\\[\\[|$)`,
  );
  return config.match(pattern)?.[0] ?? '';
}

[
  '/assets/*',
  '/*.woff2',
  '/*.ttf',
  '/*.png',
  '/*.jpg',
  '/*.jpeg',
  '/*.svg',
  '/*.webp',
].forEach((path) => {
  assertCacheControl(path, 'public, max-age=31536000, immutable');
});

[
  '/index.shell.html',
  '/index.shell.html/*',
  '/ava-chat-widget.js',
  '/404.html',
  '/pbk-build-manifest.json',
  '/index.html',
  '/analyzer.html',
  '/',
  '/dashboard',
  '/command-center',
  '/leads',
  '/deal',
  '/deal/*',
  '/inbox',
  '/inbox/*',
  '/fleet',
  '/memory',
  '/skills',
  '/skills/*',
  '/skill-studio',
  '/skill-studio/*',
  '/analytics',
  '/settings',
  '/campaigns',
  '/ava-chat',
].forEach((path) => {
  assertCacheControl(path, 'no-cache, must-revalidate');
});

const apiHeaderBlock = getHeaderBlock('/api/*');
assert(
  !/immutable/.test(apiHeaderBlock),
  'API proxy routes must not be marked immutable; they need live bridge responses.',
);

const assetMissRedirect = /from\s*=\s*"\/assets\/\*"[\s\S]*?to\s*=\s*"\/404\.html"[\s\S]*?status\s*=\s*404/.exec(
  config,
);
const shellFallbackRedirect = /from\s*=\s*"\/\*"[\s\S]*?to\s*=\s*"\/index\.shell\.html"[\s\S]*?status\s*=\s*200/.exec(
  config,
);
assert(
  assetMissRedirect,
  'Missing Netlify 404 redirect for absent /assets/* chunks.',
);
assert(
  shellFallbackRedirect,
  'Missing Netlify catch-all shell fallback redirect.',
);
assert(
  assetMissRedirect.index < shellFallbackRedirect.index,
  'Absent asset chunks must be caught before the SPA shell fallback.',
);
assert(
  !/force\s*=\s*true/.test(getRedirectBlock('/assets/*')),
  'The /assets/* 404 redirect must not force existing built assets away from Netlify static hosting.',
);

const globalHeaderBlock = getHeaderBlock('/*');
assert(
  globalHeaderBlock.includes('microphone=(self)'),
  'The production shell must allow same-origin microphone access for Ava voice controls.',
);
assert(
  globalHeaderBlock.includes('wss://pbk-openclaw-bridge.onrender.com'),
  'The production CSP must allow the hosted browser-voice WebSocket.',
);

console.log(JSON.stringify({ ok: true, result: 'netlify_cache_headers_smoke_ready' }, null, 2));
