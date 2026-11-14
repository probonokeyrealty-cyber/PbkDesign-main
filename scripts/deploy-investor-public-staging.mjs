// Only the dedicated investor staging project. Never deploy to the existing production project.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const siteId = '7d2d0593-795c-4cd6-a5ab-51abcf7b0d1f';
const protectedSiteId = '87711eb9-2a9f-40b4-92c6-0f8075151ff0';
const root = '.pbk-local/investor-public-stage';
const config = JSON.parse(
  await fs.readFile(path.join(process.env.APPDATA, 'netlify/Config/config.json'), 'utf8')
);
const token = config.users[config.userId]?.auth?.token;
if (!token) throw Error('Existing Netlify CLI authentication unavailable.');
async function api(route, options = {}) {
  const response = await fetch(`https://api.netlify.com/api/v1${route}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!response.ok) throw Error(`Staging deploy request failed (${response.status}).`);
  return response.json();
}
const before = await api(`/sites/${protectedSiteId}`);
const stage = await api(`/sites/${siteId}`);
if (stage.name !== 'pbk-investors-staging' || siteId === protectedSiteId)
  throw Error('Dedicated staging target mismatch.');
await fs.writeFile(`${root}/_redirects`, '/ /investor-portal.html 200!\n/* /404.html 404\n');
await fs.writeFile(
  `${root}/404.html`,
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not available | PBK</title><body><h1>Page not available</h1><p>This address is for the private investor staging portal.</p><a href="/">Return to investor sign-in</a></body></html>'
);
await fs.writeFile(`${root}/robots.txt`, 'User-agent: *\nDisallow: /\n');
await fs.writeFile(
  `${root}/_headers`,
  `/*
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://asumndiooctluuecydhj.supabase.co; form-action 'self'; base-uri 'none'; frame-ancestors 'none'
`
);
const files = {},
  byHash = new Map();
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      const name = '/' + path.relative(root, file).replaceAll('\\', '/');
      if (
        !/^\/(investor-portal\.html|404\.html|robots\.txt|_headers|_redirects|assets\/[\w-]+\.(js|css))$/.test(
          name
        )
      )
        throw Error(`Unexpected file in investor staging build: ${name}`);
      const bytes = await fs.readFile(file);
      const hash = crypto.createHash('sha1').update(bytes).digest('hex');
      files[name] = hash;
      byHash.set(hash, { name, bytes });
    }
  }
}
await walk(root);
if (!files['/investor-portal.html'] || !Object.keys(files).some((x) => x.endsWith('.js')))
  throw Error('Build the investor staging entry first.');
let deploy = await api(`/sites/${siteId}/deploys`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    draft: false,
    title: 'Investor staging only — approved login required',
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
  if (!file) throw Error('Missing staging file.');
  await api(
    `/deploys/${deploy.id}/files${file.name.split('/').map(encodeURIComponent).join('/')}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file.bytes,
    }
  );
}
for (let n = 0; n < 60 && deploy.state !== 'ready'; n++) {
  await new Promise((r) => setTimeout(r, 1000));
  deploy = await api(`/deploys/${deploy.id}`);
  if (deploy.state === 'error') throw Error('Investor staging deploy failed.');
}
if (deploy.state !== 'ready') throw Error('Investor staging deploy is not ready.');
const after = await api(`/sites/${protectedSiteId}`);
if (after.published_deploy?.id !== before.published_deploy?.id)
  throw Error('Existing production deployment changed; investigate.');
const report = {
  siteId,
  deployId: deploy.id,
  url: 'https://pbk-investors-staging.netlify.app',
  state: deploy.state,
  files: Object.keys(files),
  existingProductionDeployUnchanged: after.published_deploy?.id,
};
await fs.writeFile('.pbk-local/investor-public-deploy.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
