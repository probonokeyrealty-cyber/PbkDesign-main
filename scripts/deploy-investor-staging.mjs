// Draft-only Netlify API deployment. No branch push, production deploy or functions.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const siteId = '87711eb9-2a9f-40b4-92c6-0f8075151ff0';
const manifest = JSON.parse(await fs.readFile('dist/pbk-build-manifest.json', 'utf8'));
if (manifest.portalEnvironment !== 'staging')
  throw Error('Build the staff staging profile with npm run build:staff-staging first.');
const config = JSON.parse(
  await fs.readFile(path.join(process.env.APPDATA, 'netlify/Config/config.json'), 'utf8')
);
const token = config.users[config.userId]?.auth?.token;
if (!token) throw Error('Existing Netlify CLI authentication unavailable.');
async function api(route, options = {}) {
  const r = await fetch(`https://api.netlify.com/api/v1${route}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!r.ok) throw Error(`Netlify API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
await fs.mkdir('.pbk-local', { recursive: true });
const before = await api(`/sites/${siteId}`);
await fs.writeFile(
  '.pbk-local/netlify-production-before.json',
  JSON.stringify(
    {
      id: before.id,
      publishedDeployId: before.published_deploy?.id,
      publishedAt: before.published_deploy?.published_at,
    },
    null,
    2
  )
);
// A ZIP-less file manifest lets the draft flag remain explicit JSON.
await fs.writeFile('dist/_redirects','/property-log /index.shell.html 200\n/ /index.shell.html 200\n/* /index.shell.html 200\n');
await fs.writeFile('dist/_headers',`/*
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://asumndiooctluuecydhj.supabase.co; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://asumndiooctluuecydhj.supabase.co; frame-ancestors 'none'
`);
const files = {},
  byHash = new Map();
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      const bytes = await fs.readFile(file);
      const hash = crypto.createHash('sha1').update(bytes).digest('hex');
      const name = '/' + path.relative('dist', file).replaceAll('\\', '/');
      files[name] = hash;
      byHash.set(hash, { name, bytes });
    }
  }
}
await walk('dist');
let deploy = await api(`/sites/${siteId}/deploys`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    draft: true,
    branch: 'pbk-investor-staging',
    title: 'PBK private investor staging only',
    async: true,
    files,
    functions: {},
  }),
});
for (let n = 0; n < 60 && deploy.state === 'preparing'; n++) {
  await new Promise((r) => setTimeout(r, 1000));
  deploy = await api(`/deploys/${deploy.id}`);
}
for (const hash of deploy.required || []) {
  const file = byHash.get(hash);
  if (!file) throw Error('Required file missing from manifest');
  await api(
    `/deploys/${deploy.id}/files${file.name.split('/').map(encodeURIComponent).join('/')}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file.bytes }
  );
}
for (let n = 0; n < 60 && deploy.state !== 'ready'; n++) {
  await new Promise((r) => setTimeout(r, 1000));
  deploy = await api(`/deploys/${deploy.id}`);
  if (deploy.state === 'error') throw Error(`Draft deploy failed: ${deploy.error_message}`);
}
if (deploy.state !== 'ready') throw Error('Draft deploy is still processing.');
const after = await api(`/sites/${siteId}`);
if (after.published_deploy?.id !== before.published_deploy?.id)
  throw Error('Production deploy changed unexpectedly; investigate before continuing.');
const report = {
  deployId: deploy.id,
  state: deploy.state,
  url: deploy.deploy_ssl_url || deploy.deploy_url,
  productionUrl: deploy.ssl_url,
  productionDeployUnchanged: true,
  productionDeployId: after.published_deploy?.id,
};
await fs.writeFile('.pbk-local/portal-draft-deploy.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
