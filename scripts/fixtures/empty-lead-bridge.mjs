import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const stateDir = process.env.PBK_OPENCLAW_STATE_DIR;
const stateFile = join(stateDir || '', 'openclaw-state.json');
if (!stateDir || !process.env.PBK_SMOKE_ISOLATION_NONCE || process.cwd() !== stateDir ||
    !process.permission?.has('fs.write', stateFile)) {
  throw new Error('This fixture requires the isolated bridge runner');
}

await writeFile(stateFile, JSON.stringify({
  leads: [],
  leadImports: [],
  approvals: [],
  calls: [],
  messages: [],
  adminTasks: [],
  activity: [],
  analyzerRuns: [],
  appointments: [],
  attachments: [],
  contracts: [],
  dncEntries: [],
  localCommands: [],
}), { flag: 'wx' });
await import('../openclaw-local-server.mjs');
