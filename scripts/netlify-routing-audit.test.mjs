import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { checkNetlifyCommandCenterRouting } from './netlify-routing-audit.mjs';

const rule = (from, to, force = true, status = 200) =>
  `[[redirects]]\nfrom = "${from}"\nto = "${to}"\nstatus = ${status}\nforce = ${force}`;
const shell = '/index.shell.html';
const bridge = '/.netlify/functions/pbk-bridge-proxy?path=';
const brain = rule('/brain', shell);
const brainApi = rule('/brain/*', `${bridge}/brain/:splat`);
const api = rule('/api/*', `${bridge}/api/:splat`);
const fallback = rule('/*', shell, false);
const config = (...rules) => rules.join('\n\n');

test('accepts the modern Brain page and proxy rewrites in either line-ending format', () => {
  const source = config(brain, brainApi, api, fallback);
  const expected = { brain: true, brainApi: true, api: true, fallback: true };
  assert.deepEqual(checkNetlifyCommandCenterRouting(source), expected);
  assert.deepEqual(checkNetlifyCommandCenterRouting(source.replace(/\n/g, '\r\n')), expected);
});

test.each([
  ['legacy Brain target', 'brain', config(rule('/brain', '/index.html'), brainApi, api, fallback)],
  ['Brain wildcard serves the shell', 'brainApi', config(brain, rule('/brain/*', shell), api, fallback)],
  ['missing Brain proxy', 'brainApi', config(brain, api, fallback)],
  ['API target drops the forwarded path', 'api', config(brain, brainApi, rule('/api/*', bridge), fallback)],
  ['API status is a redirect', 'api', config(brain, brainApi, rule('/api/*', `${bridge}/api/:splat`, true, 301), fallback)],
  ['API rewrite is not forced', 'api', config(brain, brainApi, rule('/api/*', `${bridge}/api/:splat`, false), fallback)],
  ['fallback shadows the Brain API', 'brainApi', config(brain, fallback, brainApi, api)],
  ['fallback shadows the general API', 'api', config(brain, brainApi, fallback, api)],
  ['first duplicate API rule takes priority', 'api', config(brain, brainApi, rule('/api/*', shell), api, fallback)],
])('rejects %s', (_label, failedCheck, source) => {
  assert.equal(checkNetlifyCommandCenterRouting(source)[failedCheck], false);
});
