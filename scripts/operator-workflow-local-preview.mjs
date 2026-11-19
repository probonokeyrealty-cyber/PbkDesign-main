import { createOperatorWorkflowPreview } from './fixtures/operator-workflow-fixture.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1]) || Number(args[1]) > 65535)) {
  console.error('Usage: node scripts/operator-workflow-local-preview.mjs [--port 0..65535]');
  process.exitCode = 1;
} else {
  const requested = args.length ? Number(args[1]) : 4173;
  let preview;
  try { preview = await createOperatorWorkflowPreview(requested); }
  catch (error) {
    if (!requested || !/EADDRINUSE|already in use/.test(error.message)) throw error;
    preview = await createOperatorWorkflowPreview();
  }
  const { server, origin } = preview;
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    server.httpServer?.closeAllConnections();
    await server.close();
    if (process.connected) process.disconnect();
  }
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  // IPC is only available to a parent process (used by the bounded CLI tests).
  if (process.send) process.on('message', message => { if (message === 'shutdown') void close(); });
  console.log(JSON.stringify({ origin, leads: `${origin}/leads`, skills: `${origin}/skills`, mode: 'synthetic_read_only' }));
}
