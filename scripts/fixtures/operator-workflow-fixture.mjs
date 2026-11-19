import { createServer } from 'vite';
import { createServer as createSocketServer } from 'node:net';
import { selectedCompPatch } from '../../src/app/utils/leadComps.mjs';

function savedEvidence(index) {
  if (index !== 20 && index !== 22) return {};
  const address = { street: `${index} Synthetic Avenue`, city: 'Example City', state: 'CA', zip: '90210' };
  const captured = `2026-11-17T12:${index}:00Z`;
  const sales = [
    { id: `SYN-COMP-${index}-A`, address: `${100 + index} Synthetic Comp Lane, Example City, CA 90210`, soldDate: '2026-11-12', price: index === 22 ? 312345 : 260000, sqft: 1655, beds: 3, baths: 2, distanceMiles: 0.5 },
    { id: `SYN-COMP-${index}-B`, address: `${200 + index} Synthetic Comp Lane, Example City, CA 90210`, soldDate: '2026-11-11', price: 398765, sqft: 1800, beds: 4, baths: 2, distanceMiles: 0.7 },
  ];
  const reviewed = selectedCompPatch({ source: 'ATTOM', status: 'matched', retrievedAt: captured, windowStart: '2026-10-18', windowEnd: '2026-11-17', radiusMiles: 1, sales }, [sales[0].id], address);
  return { analyzer: reviewed.analyzer, deal: { ...reviewed.deal,
    propertyRecordSnapshot: { source: 'attom', address: `${address.street}, Example City, CA 90210`, retrievedAt: captured,
      facts: { address: `${address.street}, Example City, CA 90210`, apn: `SYN-PARCEL-0${index}`, livingSqft: index === 22 ? 1722 : 1700, lotSqft: index === 22 ? 6222 : 6000, propertyType: 'Single family' } },
  } };
}

export const operatorLeadFixtures = Array.from({ length: 64 }, (_, i) => ({
  id: i === 63 ? `SYN-${'long-id-'.repeat(24)}` : `SYN-WORK-${String(i).padStart(3, '0')}`,
  leadId: i === 63 ? `SYN-${'long-id-'.repeat(24)}` : `SYN-WORK-${String(i).padStart(3, '0')}`,
  seller: { name: `Synthetic Seller ${String(i).padStart(2, '0')}`,
    phone: i % 2 === 0 ? '+12025550101' : '123',
    email: i % 3 === 0 ? `seller${i}@example.invalid` : '' },
  property: { address: `${i} Synthetic Avenue`, city: 'Example City', state: 'CA', zip: '90210',
    arv: 245000, mao: 140000, sqft: 1600,
    ...(i === 22 ? { arv: 287123, mao: 151234, estimatedRepairs: 17345, sqft: 1644 } : {}) },
  ...savedEvidence(i),
  bant: { nextStep: i === 63 ? 'UnbrokenLongValue'.repeat(35) : 'Confirm synthetic availability.' },
  selectedPath: 'cash', score: i < 40 ? 90 : 70,
  updatedAt: '2026-11-15T10:34:00Z',
}));

export const operatorSkillFixtures = Array.from({ length: 64 }, (_, i) => ({
  versionId: i === 63 ? `SYN-version /?#%"-[]-${'long-id-'.repeat(24)}` : i === 26 ? '0' : `SYN-SKILL-${String(i).padStart(3, '0')}`,
  skillKey: i === 20 || i === 21 ? 'synthetic-shared-key' : `synthetic-key-${i}`,
  name: i >= 60 && i <= 62 ? `Synthetic Trend ${i}` : `Synthetic Skill ${String(i).padStart(2, '0')}`,
  versionNumber: i === 21 ? 2 : 1,
  lifecycleState: i < 3 ? 'candidate' : i === 3 ? 'approved_inactive' : i === 4 ? 'failed' : i === 5 ? 'rolled_back' :
    i === 6 ? 'needs_review' : i === 7 ? 'ready_for_approval' : i === 20 ? 'unrecognized_state' :
      i === 23 ? 'constructor' : i === 24 ? null : i === 25 ? undefined : i === 26 ? 0 : 'active',
  agentId: i % 2 ? 'rex' : 'ava', riskClass: i % 3 ? 'medium' : 'high',
  instructions: `Response: Synthetic response ${i}.\n\nNext question: Synthetic question ${i}?\n\nDo not use when: Synthetic boundary ${i}.`,
  sourceProvenance: { note: `Synthetic provenance ${i}` },
  triggerPolicy: { liveCallPattern: `Synthetic scenario ${i}.`, nextQuestion: `Synthetic question ${i}?` },
  contentHash: `synthetic-hash-${i}`,
  ...(i === 20 ? {} : i === 21 ? { usageCount: 0, successRate: 0, confidence: 0, confidenceDelta: 0 } :
    i === 22 ? { usageCount: -4, successRate: -3, confidence: 101, confidenceDelta: 'bad', lastTriggeredAt: 'invalid' } :
      { usageCount: i + 1, successRate: i >= 60 ? 90 : 60 + i % 30, confidence: 90, confidenceDelta: i >= 60 ? -0.1 : 0.05,
        lastTriggeredAt: `2026-11-17T12:${String(i % 60).padStart(2, '0')}:00Z` }),
}));

// Explicit method/path allowlist. No invoke fallback, provider routes or business writes.
const reads = new Map([
  ['/api/auth/team/status', { ok: true, configured: false, authRequired: false }],
  ['/api/quotas', { ok: true, quotas: {} }],
  ['/api/tooling/status', { ok: true, tools: [] }],
  ['/api/conversations', { ok: true, items: [] }],
  ['/health', { ok: true, status: 'synthetic' }],
  ['/status', { ok: true, status: 'synthetic' }],
  ['/api/skills/governance/status', { ok: true }],
]);
export function operatorFixtureResponse(method, path, query = new URLSearchParams()) {
  if (method === 'POST' && path === '/api/state/stream/session') return { ok: false };
  if (method !== 'GET') return null;
  if (path === '/state') return { leadImports: operatorLeadFixtures, activity: [], calls: [], messages: [], contracts: [], approvals: [] };
  if (path === '/api/leads') return { ok: true, leads: operatorLeadFixtures };
  if (path === '/api/skills/governance/repository') {
    const search = (query.get('search') || '').toLowerCase();
    const state = query.get('lifecycleState');
    return { ok: true, items: operatorSkillFixtures.filter(item =>
      (!state || item.lifecycleState === state) &&
      (!search || `${item.name} ${item.instructions}`.toLowerCase().includes(search))) };
  }
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
          const response = operatorFixtureResponse(req.method, url.pathname, url.searchParams);
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
