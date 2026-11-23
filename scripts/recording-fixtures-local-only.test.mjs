import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { expect, test } from '@jest/globals';

function section(path, start, end) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Section not found in ${path}`);
  return source.slice(from, to);
}

const wireControls = section('../index.html', 'function wireRecordingsControls()', 'function wireSettingsPersistenceControls()');
const fixtureRoute = section('../scripts/openclaw-local-server.mjs',
  "if (request.method === 'POST' && pathname === '/api/recordings/fixture')", '\n    if (request.method');

async function clickRecordingControl(label, lookupResult) {
  const requests = [], feedback = [], transcripts = [], downloads = [], playback = [];
  const active = { dataset: { messageId: 'recording-1' }, querySelector: () => null };
  const listeners = {};
  const page = {
    dataset: {},
    querySelector: selector => selector === '.rec-item.active' ? active : null,
    querySelectorAll: selector => selector === '.rec-line' ? [{ textContent: 'A saved transcript.' }] : [],
    addEventListener: (event, fn) => { listeners[event] = fn; },
  };
  const button = {
    classList: { contains: name => name === 'play' && label === 'play', add() {}, remove() {} },
    closest: selector => selector === 'button' ? button : null,
    textContent: label,
  };
  runInNewContext(`${wireControls}\nwireRecordingsControls();`, {
    getPageNode: () => page,
    normalizeControlText: text => text.toLowerCase(),
    Audio: class {
      addEventListener() {}
      play() { playback.push(this.src); }
    },
    async requestOpenClawApi(path, options) {
      requests.push({ path, method: options?.method || 'GET' });
      if (path === '/api/recordings/fixture') throw new Error('Unexpected fixture creation');
      return lookupResult();
    },
    downloadTextFile: (_name, text) => { transcripts.push(text); },
    showLocalViewToast() {},
    toastOutcome: notice => { feedback.push(notice); },
    toast: notice => { feedback.push(notice); },
    document: {
      createElement: () => ({ click() { downloads.push(this.href); }, remove() {} }),
      body: { appendChild() {} },
    },
  });
  listeners.click({ target: button });
  await setImmediate();
  return { requests, feedback, transcripts, downloads, playback };
}

test.each(['download', 'play'])('%s does not create a fixture when recording lookup fails', async (label) => {
  const result = await clickRecordingControl(label, () => { throw new Error('Lookup failed'); });
  expect(result.requests).toEqual([{ path: '/api/recordings/recording-1?expiresIn=3600', method: 'GET' }]);
  expect(result.downloads).toEqual([]);
  expect(result.playback).toEqual([]);
  expect(result.feedback.some(item => item.title === 'Recording unavailable')).toBe(true);
  if (label === 'download') expect(result.transcripts).toEqual(['A saved transcript.']);
});

test.each(['download', 'play'])('%s still uses the signed URL from a successful lookup', async (label) => {
  const url = 'https://example.invalid/recordings/fixture-test.wav';
  const result = await clickRecordingControl(label, () => ({ signedUrl: url }));
  expect(result.requests).toHaveLength(1);
  expect(result.transcripts).toEqual([]);
  expect(label === 'play' ? result.playback : result.downloads).toEqual([url]);
});

const localFixtureMode = {
  IS_HOSTED: false,
  IS_LAN: false,
  HOST: '127.0.0.1',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  DATABASE_URL: 'postgres://127.0.0.1:54322/test',
  process: { env: { PBK_ENABLE_LOCAL_RECORDING_FIXTURES: '1' } },
};

async function resolveFixtureRequest(overrides) {
  const responses = [];
  let bodyReads = 0, uploads = 0;
  await runInNewContext(`(async () => { ${fixtureRoute} })()`, {
    ...localFixtureMode,
    ...overrides,
    URL,
    request: { method: 'POST' },
    pathname: '/api/recordings/fixture',
    response: {},
    json: (_response, status, result) => { responses.push({ status, result }); },
    readBody: () => { bodyReads++; return {}; },
    buildRecordingStoragePath: () => 'sandbox/fixture.wav',
    toNumber: value => Number(value),
    createSilentWavBuffer: () => Buffer.alloc(1),
    uploadSupabaseRecording: () => { uploads++; return { ok: false, statusCode: 422 }; },
  });
  return { bodyReads, uploads, responses };
}

test.each([
  ['hosted bridge', { IS_HOSTED: true }],
  ['LAN bridge', { IS_LAN: true }],
  ['non-loopback bridge binding', { HOST: '0.0.0.0' }],
  ['no opt-in', { process: { env: {} } }],
  ['nonlocal Storage', { SUPABASE_URL: 'https://example.invalid' }],
  ['nonlocal Postgres', { DATABASE_URL: 'postgres://example.invalid/test' }],
  ['Postgres host override', { DATABASE_URL: 'postgres://localhost/test?host=example.invalid' }],
])('fixture creation rejects %s before parsing the request', async (_label, settings) => {
  const { bodyReads, uploads, responses } = await resolveFixtureRequest(settings);
  expect(bodyReads).toBe(0);
  expect(uploads).toBe(0);
  expect(responses).toEqual([{ status: 404, result: expect.objectContaining({ result: 'recording_fixture_disabled' }) }]);
});

test('explicit loopback fixture mode reaches the existing upload path', async () => {
  const { bodyReads, uploads, responses } = await resolveFixtureRequest({});
  expect(bodyReads).toBe(1);
  expect(uploads).toBe(1);
  expect(responses[0].status).toBe(422);
});
