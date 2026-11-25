import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const publicDir = path.join(appRoot, 'public');

const requiredAssets = [
  path.join(publicDir, 'PBK_Master_Deal_Package.html'),
  path.join(appRoot, 'docs', 'reference', 'legacy-command-center-v5.html'),
];

fs.mkdirSync(publicDir, { recursive: true });

requiredAssets.forEach((assetPath) => {
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing required checked-in PBK asset: ${assetPath}`);
  }
  console.log(`Using checked-in PBK asset: ${assetPath}`);
});
