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

[
  '/assets/*',
  '/*.css',
  '/*.js',
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
  '/index.html',
  '/analyzer.html',
  '/',
  '/dashboard',
  '/command-center',
  '/leads',
  '/deal',
  '/deal/*',
  '/inbox',
  '/fleet',
  '/memory',
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

console.log(JSON.stringify({ ok: true, result: 'netlify_cache_headers_smoke_ready' }, null, 2));
