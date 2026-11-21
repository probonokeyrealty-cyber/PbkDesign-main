import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const lead = { id: 'SYN-ANALYTICS-104', name: 'Sample seller', stage: 'closed',
  address: '104 Sample Avenue', revenue: 12500, revenueBasis: 'recorded' };
const coverage = count => ({ version: 1, totalRecords: count, recordedRecords: count, missingRecords: 0 });

export function analyticsPreviewResponse(path, params) {
  const generatedAt = new Date().toISOString();
  const days = params.get('days') || '30';
  const range = params.get('range');
  const reportingPeriod = range === 'ytd' ? `ytd:${new Date().getUTCFullYear()}` : `rolling:${days}`;
  const base = { ok: true, result: 'live', source: 'local-sample', generatedAt, reportingPeriod,
    ...(range === 'ytd' ? { range } : {}) };
  if (path === '/api/auth/team/status') return { ok: true, configured: false, authRequired: false };
  if (path === '/state') return { leadImports: [lead], approvals: [], calls: [], messages: [], contracts: [], activity: [] };
  if (path === '/api/leads') return { ok: true, leads: [lead] };
  if (path === `/api/leads/${lead.id}/full`) return { ok: true, lead: { ...lead,
    seller: { name: lead.name }, property: { address: lead.address },
    notes: 'Fictional local sample only.', soldComps: [{ id: 'SYN-COMP', soldPrice: 250000 }] } };
  if (path === '/api/leads/stages') return { ...base, stages: [
    { stage: 'contacted', label: 'Contacted', total: 6, leads: [] },
    { stage: 'assigned', label: 'Assigned', total: 2, leads: [] },
    { stage: 'closed', label: 'Closed', total: 1, revenue: lead.revenue,
      revenueBasis: 'recorded', revenueCoverage: coverage(1), leads: [lead] },
  ] };
  if (path === '/api/deals/timeline') return { ...base, dateBasis: 'record_created',
    financialEvidence: { version: 1, revenueCoverage: coverage(1) }, days: [
      { day: generatedAt.slice(0, 10), count: 1, revenue: lead.revenue,
        revenueBasis: 'recorded', revenueCoverage: coverage(1), leads: [lead] },
    ] };
  if (path === '/api/observability/ai-metrics') return { ...base, metrics: {
    p95LatencyMs: 1400, qaRetryRate: 0.04, safetyBlocks: 2, aiSpendUsd: 35, estimatedAiSpendUsd: null,
    costEvidence: { version: 1, totalRecords: 2, recordedRecords: 2, estimatedRecords: 0, missingRecords: 0 },
  } };
  if (path === '/api/analytics/campaign-drilldown') return { ...base,
    summary: { leads: 2, replied: 1, replyRate: 50, connectRate: 0 }, rows: [
      { id: 'SYN-CAM-1', source: 'Sample referral', channel: 'sms', sent: true, replied: true },
      { id: 'SYN-CAM-2', source: 'Sample website', channel: 'email', sent: true },
    ] };
  return { ok: true, items: [] };
}

export async function createAnalyticsPreview(port = 5199) {
  process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
  const server = await createServer({
    cacheDir: 'output/proof-first-analytics/preview-cache',
    optimizeDeps: { entries: ['./index.shell.html'] },
    server: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{ name: 'pbk-read-only-analytics-preview',
      transformIndexHtml: { order: 'pre', handler: () => [{ tag: 'script', injectTo: 'head-prepend', children:
        "const config={endpoint:location.origin,apiKey:'sample-only'};window.PBK={openclaw:{getConfig:()=>config}};localStorage.setItem('pbk:local:openclaw-config',JSON.stringify(config));if(!localStorage.getItem('pbk:prefs:v1'))localStorage.setItem('pbk:prefs:v1',JSON.stringify({theme:'dark',railCollapsed:false,lastPage:'/',tourCompleted:true}));" }] },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'");
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end('{"error":"Read-only sample preview; writes and providers are disabled"}');
          }
          const url = new URL(req.url, 'http://127.0.0.1');
          if (!/^\/(?:api(?:\/|$)|\.netlify\/functions\/|state$|health$|status$|events$|invoke$|metrics$)/.test(url.pathname)) return next();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(analyticsPreviewResponse(url.pathname, url.searchParams)));
        });
      },
    }],
  });
  await server.listen();
  return { server, origin: `http://127.0.0.1:${server.httpServer.address().port}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { origin } = await createAnalyticsPreview(Number(process.argv[2] || 5199));
  console.log(`Read-only fictional PBK analytics preview: ${origin}/analytics`);
}
