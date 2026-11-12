import { createServer } from 'vite';

// This fixture never connects to a real bridge or provider.
process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const approvals = [
  { id: 'rail-demo-001', type: 'SMS', status: 'pending', leadName: 'Demo Seller / Local fixture',
    address: '14 Demo Oak Way', message: 'Could you confirm the property living area?', createdAt: new Date().toISOString() },
  { id: 'rail-demo-002', type: 'SMS', status: 'pending', leadName: 'Unconfirmed Response / Local fixture',
    address: '86 Demo Cedar Lane', message: 'Please confirm the property ZIP code.', createdAt: new Date().toISOString() },
];
const server = await createServer({
  server: { host: '127.0.0.1', port: 5197 },
  plugins: [{
    name: 'pbk-decision-rail-isolated-fixtures',
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        response.setHeader('Content-Security-Policy', "connect-src 'self'; form-action 'none'");
        const path = new URL(request.url, 'http://localhost').pathname;
        if (!/^\/(?:api(?:\/|$)|\.netlify\/functions\/|state$|status$|health$|events$|invoke$|metrics$)/.test(path)) return next();
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        const send = (json, status = 200) => { response.statusCode = status; response.end(JSON.stringify(json)); };
        const target = path.match(/^\/api\/approvals\/(rail-demo-00[12])$/)?.[1];
        if (request.method === 'PUT' && target) {
          if (target === 'rail-demo-002') return send({ error: 'Local fixture: response unconfirmed. No provider was contacted.' }, 502);
          let body = '', bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > 4096) return send({ ok: false }, 413);
            body += chunk;
          }
          let input;
          try { input = JSON.parse(body); } catch { return send({ ok: false }, 400); }
          const approval = approvals.find(item => item.id === target);
          if (approval.status !== 'pending') return send({ error: 'Demo decision already recorded.' }, 409);
          if (!['approved', 'rejected', 'needs-revision'].includes(input.status)) return send({ ok: false }, 400);
          approval.status = input.status;
          return send({ ok: true, approval: { ...approval } });
        }
        if (request.method === 'POST' && path === '/api/state/stream/session') return send({ ok: false });
        if (request.method !== 'GET') return send({ error: 'Local fixture blocks this write. No real provider is connected.' }, 403);
        if (path === '/api/auth/team/status') return send({ ok: true, configured: false, authRequired: false });
        if (path === '/state') return send({ approvals, leadImports: [], activity: [], calls: [], messages: [] });
        return send({ ok: true, items: [] });
      });
    },
  }],
});
await server.listen();
server.printUrls();
