import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fixtureResponse } from './faster-triage-fixture.mjs';

export async function createCommandCenterPreview({ root = resolve('dist') } = {}) {
  root = resolve(root);
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'");
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = req.method === 'POST' && url.pathname === '/api/state/stream/session' ? 200 : 403;
      res.end('{"ok":false}');
      return;
    }
    if (/^\/(?:api(?:\/|$)|state$|health$|status$|events$|invoke$|metrics$|\.netlify\/functions\/)/.test(url.pathname)) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(fixtureResponse(url.pathname, url.searchParams)));
      return;
    }
    try {
      let name = url.pathname;
      if (/^\/(?:settings|command-center|leads(?:\/[^/]+)?|fleet|inbox|analytics|ava-chat|analyzer)?$/.test(name)) name = '/index.shell.html';
      const path = resolve(root, '.' + decodeURIComponent(name));
      if (!path.startsWith(root + sep)) throw Error('Outside fixture');
      let body = await readFile(path);
      if (name === '/index.shell.html') body = Buffer.from(body.toString().replace('<head>', `<head><script>
        const config={endpoint:location.origin,apiKey:'sample-only'};
        window.PBK={openclaw:{getConfig:()=>config}};
        localStorage.setItem('pbk:local:openclaw-config',JSON.stringify(config));
      </script>`));
      res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('Fixture not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { origin: `http://127.0.0.1:${server.address().port}`,
    server: { close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } };
}
