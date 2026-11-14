import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

export function buildAgentRuntimeSmokeEnv(source = process.env) {
  const allowed = new Set(['systemroot', 'windir', 'comspec', 'path', 'pathext', 'temp', 'tmp']);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase()))
  );
}

if (process.env.PBK_AGENT_SMOKE_ISOLATED === '1') {
  const deny = () => {
    throw new Error('Agent smoke isolation blocked outbound network or subprocess access.');
  };
  // Accepted HTTP sockets still work; this child cannot initiate any connections.
  globalThis.fetch = deny;
  net.Socket.prototype.connect = deny;
  dgram.createSocket = deny;
  for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
    childProcess[name] = deny;
  }
  syncBuiltinESMExports();
}
