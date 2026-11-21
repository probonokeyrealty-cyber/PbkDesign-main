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
  let outlookSends = 0;
  globalThis.fetch = (url, request) => {
    if (process.env.PBK_AGENT_SMOKE_OUTLOOK_FIXTURE === '1' && request?.method === 'POST') {
      if (url === 'https://backend.composio.dev/api/v3.1/tools/execute/OUTLOOK_GET_PROFILE') {
        return Promise.resolve(Response.json({ successful: true, data: { mail: 'acquisition@example.com' } }));
      }
      if (url === 'https://backend.composio.dev/api/v3.1/tools/execute/OUTLOOK_SEND_EMAIL') {
        const { arguments: args } = JSON.parse(request.body);
        if (args.to === 'test@example.net' && args.body === 'Fixture only.') {
          return Promise.resolve(Response.json({ successful: true, log_id: `fixture-outlook-${++outlookSends}` }));
        }
      }
    }
    return deny();
  };
  net.Socket.prototype.connect = deny;
  dgram.createSocket = deny;
  for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
    childProcess[name] = deny;
  }
  syncBuiltinESMExports();
}
