import { createServer } from 'node:http';

// A collision must fail startup, never probe the listener already on this port.
if (process.argv[2]) process.env.PBK_OPENCLAW_PORT = process.argv[2];
createServer((req, res) => { if (req.url !== '/hang') res.end('sample'); })
  .listen(Number(process.env.PBK_OPENCLAW_PORT), '127.0.0.1');
