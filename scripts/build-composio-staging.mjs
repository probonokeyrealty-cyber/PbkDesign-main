import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Render's native Node runtime serves the existing shell from the repository root.
// Run only in a disposable build checkout: these are derived deployment assets.
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [resolve(root, 'scripts/sync-master-template.mjs')], {cwd:root,stdio:'inherit'});
execFileSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build'], {cwd:root,env:{...process.env,PBK_PORTAL_ENV:'staging'},stdio:'inherit'});
for (const file of ['index.shell.html','index.html','analyzer.html','pbk-build-manifest.json'])copyFileSync(resolve(root,'dist',file),resolve(root,file));
cpSync(resolve(root,'dist/assets'),resolve(root,'assets'),{recursive:true});
console.log('Existing PBK shell staged for the isolated Node service.');
