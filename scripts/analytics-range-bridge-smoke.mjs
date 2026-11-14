import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'pbk-analytics-qa-'));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const guard = `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const execFileSync = childProcess.execFileSync;
childProcess.execFileSync = (file, ...args) => file === 'powershell.exe'
  ? '{}' : execFileSync(file, ...args);
syncBuiltinESMExports();
globalThis.fetch = () => { throw new Error('Outbound HTTP disabled in analytics QA'); };
const NativeDate = Date;
const now = NativeDate.parse('2026-01-04T12:00:00Z');
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
`;
const contracts = [
  { id: 'older-fixture', status: 'signed', amount: 4000, createdAt: '2025-12-31T23:59:59Z' },
  { id: 'boundary-fixture', status: 'signed', amount: 6000, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'recent-fixture', status: 'signed', amount: 7000, createdAt: '2026-01-02T15:00:00Z' },
];

let child;
let closed;
try {
  await writeFile(
    join(directory, 'openclaw-state.json'),
    JSON.stringify({ contracts, analyzerRuns: [] })
  );
  child = spawn(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(guard)}`,
      './scripts/openclaw-local-server.mjs',
    ],
    {
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        TEMP: process.env.TEMP,
        PBK_OPENCLAW_STATE_DIR: directory,
        PBK_OPENCLAW_PORT: String(port),
        PBK_BRIDGE_API_KEY: 'fixture-analytics-bridge',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  closed = once(child, 'close');
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2500);
  });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    if (
      await fetch(origin + '/health')
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    assert(attempt < 120, `Isolated bridge did not start: ${stderr}`);
    await delay(100);
  }
  const read = async (path) => {
    const response = await fetch(origin + path, {
      headers: { Authorization: 'Bearer fixture-analytics-bridge' },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const defaultTimeline = await read('/api/deals/timeline');
  assert.deepEqual(
    defaultTimeline.days.map(({ day, revenue }) => [day, revenue]),
    [
      ['2025-12-31', 4000],
      ['2026-01-01', 6000],
      ['2026-01-02', 7000],
    ]
  );
  const yearToDate = await read('/api/deals/timeline?range=ytd');
  assert.equal(yearToDate.range, 'ytd');
  assert.deepEqual(
    yearToDate.days.map(({ day, revenue }) => [day, revenue]),
    [
      ['2026-01-01', 6000],
      ['2026-01-02', 7000],
    ]
  );
  assert.equal((await read('/api/observability/ai-metrics?range=ytd')).range, 'ytd');
  assert.equal((await read('/api/observability/ai-metrics?days=7')).days, 7);
  console.log('Analytics bridge preserves rolling windows and includes Jan 1 UTC in YTD.');
} finally {
  if (child) {
    child.kill();
    await closed;
  }
  await rm(directory, { recursive: true, force: true });
}
