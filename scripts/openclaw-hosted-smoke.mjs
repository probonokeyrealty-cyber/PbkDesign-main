import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIsolatedBridgeSmoke } from './openclaw-smoke.mjs';

// Compatibility entry for Hosted Founder Smoke. No hosted targets or credentials are consumed.
export async function runHostedFounderSmoke() {
  await runIsolatedBridgeSmoke();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Hosted Founder Smoke accepts no target overrides; it runs isolated sample state only.');
    process.exitCode = 1;
  } else {
    await runHostedFounderSmoke().catch(error => {
      console.error(error instanceof Error ? error.message : 'Isolated hosted smoke failed');
      process.exitCode = 1;
    });
  }
}
