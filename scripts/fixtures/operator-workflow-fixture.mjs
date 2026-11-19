import { createServer } from 'vite';
import { createServer as createSocketServer } from 'node:net';

export const operatorLeadFixtures = Array.from({ length: 64 }, (_, i) => ({
  id: i === 63 ? `SYN-${'long-id-'.repeat(24)}` : `SYN-WORK-${String(i).padStart(3, '0')}`,
  leadId: i === 63 ? `SYN-${'long-id-'.repeat(24)}` : `SYN-WORK-${String(i).padStart(3, '0')}`,
  seller: { name: `Synthetic Seller ${String(i).padStart(2, '0')}`,
    phone: i % 2 === 0 ? '+12025550101' : '123',
    email: i % 3 === 0 ? `seller${i}@example.invalid` : '' },
  property: { address: `${i} Synthetic Avenue`, city: 'Example City', state: 'CA', zip: '90210',
    arv: 245000, mao: 140000, sqft: 1600, manualValue: 'operator-kept',
    attomSnapshot: { apn: 'SYN-APN', source: 'synthetic', livingSqft: 1600 } },
  soldComps: [{ id: 'SYN-REVIEWED-COMP', soldPrice: 245000, reviewed: true }],
  bant: { nextStep: i === 63 ? 'UnbrokenLongValue'.repeat(35) : 'Confirm synthetic availability.' },
  selectedPath: 'cash', score: i < 40 ? 90 : 70,
  updatedAt: '2026-11-15T10:34:00Z',
}));

// Explicit method/path allowlist. No invoke fallback, provider routes or business writes.
const reads = new Map([
  ['/api/auth/team/status', { ok: true, configured: false, authRequired: false }],
  ['/api/quotas', { ok: true, quotas: {} }],
  ['/api/tooling/status', { ok: true, tools: [] }],
  ['/api/conversations', { ok: true, items: [] }],
  ['/health', { ok: true, status: 'synthetic' }],
  ['/status', { ok: true, status: 'synthetic' }],
]);
export function operatorFixtureResponse(method, path) {
  if (method === 'POST' && path === '/api/state/stream/session') return { ok: false };
  if (method !== 'GET') return null;
  if (path === '/state') return { leadImports: operatorLeadFixtures, activity: [], calls: [], messages: [], contracts: [], approvals: [] };
  if (path === '/api/leads') return { ok: true, leads: operatorLeadFixtures };
  const match = path.match(/^\/api\/leads\/([^/]+)\/(full|last-call)$/);
  if (match) {
    const lead = operatorLeadFixtures.find(l => l.id === decodeURIComponent(match[1]));
    if (!lead) return null;
    return match[2] === 'full' ? { ok: true, lead } : { ok: true, leadId: lead.id, call: null };
  }
  return reads.get(path) ?? null;
}

export async function createOperatorWorkflowPreview(port = 0) {
  if (!port) {
    const socket = createSocketServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    port = socket.address().port;
    await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  }
  const origin = `http://127.0.0.1:${port}`;
  process.env.PBK_DEV_BRIDGE_URL = origin;
  const server = await createServer({
    cacheDir: '.pbk-local/operator-workflow/vite-cache',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    plugins: [{
      name: 'pbk-operator-workflow-read-only', enforce: 'pre',
      configResolved(config) { config.server.proxy = undefined; },
      transformIndexHtml: { order: 'pre', handler: () => [{ tag: 'script', injectTo: 'head-prepend', children:
        "window.PBK={openclaw:{getConfig:()=>({endpoint:location.origin})}};localStorage.setItem('pbk:prefs:v1',JSON.stringify({theme:'dark',railCollapsed:false,tourCompleted:true}));" }] },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'");
          const url = new URL(req.url, 'http://127.0.0.1');
          if (!/^\/(?:api(?:\/|$)|\.netlify\/functions\/|state$|health$|status$|events$|invoke$|metrics$)/.test(url.pathname)) return next();
          if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) {
            res.statusCode = 403;
            res.end('{"ok":false,"error":"Synthetic fixtures are loopback-origin only"}');
            return;
          }
          const response = operatorFixtureResponse(req.method, url.pathname);
          res.statusCode = response ? 200 : req.method === 'GET' ? 404 : 403;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(response ?? { ok: false, error: `Fixture denies ${req.method} ${url.pathname}` }));
        });
      },
    }],
  });
  try {
    await server.listen();
    return { server, origin };
  } catch (error) { await server.close(); throw error; }
}
