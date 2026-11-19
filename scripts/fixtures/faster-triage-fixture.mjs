import { createServer } from 'vite';
import { join } from 'node:path';

export const sampleLeads = [
  { id: 'SYN-L-2291', seller: { name: 'Fictional Seller' }, property: { address: '88 Sample Oak Dr', city: 'Example City', state: 'CA', zip: '90210', arv: 245000 }, bant: { nextStep: 'Confirm seller availability for a walkthrough.' }, soldComps: [{ id: 'SYN-COMP', soldPrice: 245000 }], score: 90 },
  { id: 'SYN-L-22910', seller: { name: 'Fictional Seller' }, property: { address: '88 Sample Oak Dr' }, bant: { nextStep: 'Other exact ID only.' }, score: 80 },
  { id: 'SYN-EMPTY', seller: { name: 'Empty Step' }, bant: { nextStep: '' }, score: 80 },
  { id: 'SYN-PARTIAL', seller: { name: 'Partial Record' }, score: 80 },
  { id: `SYN-${'long-id-'.repeat(24)}`, seller: { name: 'Long Record' }, bant: { nextStep: `Keep the complete operator wording. ${'UnbrokenLongValue'.repeat(35)}` }, score: 79 },
];
export const sampleApproval = { id: 'SYN-APR-084', status: 'pending', type: 'SMS', leadId: sampleLeads[0].id,
  leadName: 'Fictional Seller', address: '88 Sample Oak Dr', message: 'Sample approval; no provider connected.', createdAt: '2026-11-15T10:42:00Z' };

export function fixtureResponse(path, params) {
  if (path === '/api/auth/team/status') return { ok: true, configured: false, authRequired: false };
  if (path === '/state') return { approvals: [sampleApproval], leadImports: sampleLeads, activity: [], calls: [], messages: [], contracts: [] };
  if (path === '/api/leads') return { ok: true, leads: sampleLeads };
  const match = path.match(/^\/api\/leads\/([^/]+)(?:\/full)?$/);
  if (match) return { ok: true, lead: sampleLeads.find(l => l.id === decodeURIComponent(match[1])) };
  if (path === '/api/founder/work-queue') return { ok: true, items: sampleLeads.map((l, i) => ({
    id: `sample-queue-${i}`, recordKind: 'lead', recordId: l.id, tag: 'Lead', body: `${l.seller.name} / ${l.property?.address || 'No address'}`,
    targetPath: '/leads', score: 90 - i, reason: 'Existing queue reason', source: 'fixture',
  })) };
  if (path === '/api/conversations') return { ok: true, items: [
    { id: 'wrong-thread', leadId: 'SYN-L-22910', sellerName: 'Fictional Seller' },
    { id: 'sample-thread', leadId: 'SYN-L-2291', sellerName: 'Fictional Seller' },
  ].filter(t => !params.get('leadId') || t.leadId === params.get('leadId') || t.id === 'wrong-thread') };
  if (path.endsWith('/timeline')) return { ok: true, items: [{ id: 'sample-event', eventType: 'sms.received', channel: 'sms', direction: 'inbound', threadId: path.includes('wrong-thread') ? 'wrong-thread' : 'sample-thread',
    body: path.includes('wrong-thread') ? 'FOREIGN SELLER HISTORY MUST NOT APPEAR' : 'Exact seller sample history', occurredAt: '2026-11-15T10:34:00Z' }], nextCursor: null };
  return { ok: true, items: [] };
}

export async function createTriagePreview(port = 0) {
  process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
  const server = await createServer({
    cacheDir: join(process.env.PBK_OPERATOR_EVIDENCE_DIR || 'output/faster-triage', `vite-cache-${port ? 'preview' : 'test'}`),
    server: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{
      name: 'pbk-faster-triage-read-only-fixture',
      transformIndexHtml: { order: 'pre', handler: () => [{ tag: 'script', injectTo: 'head-prepend', children:
        "const config={endpoint:location.origin,apiKey:'sample-only'};window.PBK={openclaw:{getConfig:()=>config}};if(!localStorage.getItem('pbk:prefs:v1'))localStorage.setItem('pbk:prefs:v1',JSON.stringify({theme:'dark',railCollapsed:false,lastPage:'/',tourCompleted:true}));" }] },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'");
          const url = new URL(req.url, 'http://127.0.0.1');
          if (!/^\/(?:api(?:\/|$)|\.netlify\/functions\/|state$|health$|status$|events$|invoke$|metrics$)/.test(url.pathname)) return next();
          res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
          if (url.pathname === '/api/state/stream/session') { res.end('{"ok":false}'); return; }
          if (req.method !== 'GET') { res.statusCode = 403; res.end('{"error":"Read-only sample preview; no writes or providers"}'); return; }
          res.end(JSON.stringify(fixtureResponse(url.pathname, url.searchParams)));
        });
      },
    }],
  });
  await server.listen();
  return { server, origin: `http://127.0.0.1:${server.httpServer.address().port}` };
}
