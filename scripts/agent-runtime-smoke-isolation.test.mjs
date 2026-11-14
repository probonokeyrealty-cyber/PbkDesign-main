import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from '@jest/globals';
import { buildAgentRuntimeSmokeEnv } from './agent-runtime-smoke-isolation.mjs';

test('agent smoke environment drops credentials and inherited Node options', () => {
  assert.deepEqual(buildAgentRuntimeSmokeEnv({
    Path: 'system-bin',
    SystemRoot: 'windows',
    PBK_TELNYX_API_KEY: 'not-a-real-key',
    PBK_EXTERNAL_AGENT_MAX: 'https://example.test',
    NODE_OPTIONS: '--require unwanted.cjs',
  }), { Path: 'system-bin', SystemRoot: 'windows' });
});

test('bridge child cannot fetch, open outbound sockets, or run credential hydration', () => {
  const result = spawnSync(process.execPath, [
    '--import', new URL('./agent-runtime-smoke-isolation.mjs', import.meta.url).href,
    '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import net from 'node:net';
      import { execFileSync } from 'node:child_process';
      const denied = /Agent smoke isolation blocked/;
      assert.throws(() => fetch('https://example.test'), denied);
      assert.throws(() => new net.Socket().connect(443, 'example.test'), denied);
      assert.throws(() => execFileSync('powershell.exe', ['-NoProfile']), denied);
      console.log('isolation verified');
    `,
  ], {
    env: { ...buildAgentRuntimeSmokeEnv(), PBK_AGENT_SMOKE_ISOLATED: '1' },
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /isolation verified/);
});
