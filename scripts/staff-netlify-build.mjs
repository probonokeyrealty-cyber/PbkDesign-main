import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProductionPrivacy } from './netlify-production-privacy.mjs';

export const staffSiteId = '87711eb9-2a9f-40b4-92c6-0f8075151ff0';

function runBuild() {
  if (!process.env.npm_execpath) throw new Error('Run npm run build:netlify-production.');
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build failed (${result.signal ?? result.status}).`);
}

export async function runStaffNetlifyBuild({
  siteId = process.env.SITE_ID,
  checkPrivacy = checkProductionPrivacy,
  build = runBuild,
} = {}) {
  if (!siteId) throw new Error('Netlify production build requires SITE_ID.');
  if (siteId !== staffSiteId) return build();

  async function requireStaffPrivacy(phase) {
    const report = await checkPrivacy();
    console.log(JSON.stringify({ phase, ...report }));
    if (!report.ok) throw new Error(`Staff privacy check failed ${phase}.`);
  }

  await requireStaffPrivacy('before build');
  await build();
  await requireStaffPrivacy('after build');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await runStaffNetlifyBuild();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
