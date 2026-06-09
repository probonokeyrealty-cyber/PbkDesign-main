import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const publicDir = path.join(appRoot, 'public');
const legacyDir = path.join(publicDir, 'legacy');

const requiredAssets = [
  path.join(publicDir, 'PBK_Master_Deal_Package.html'),
  path.join(legacyDir, 'PBK_Command_Center v5.html'),
];

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(legacyDir, { recursive: true });

requiredAssets.forEach((assetPath) => {
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing required checked-in PBK asset: ${assetPath}`);
  }
  console.log(`Using checked-in PBK asset: ${assetPath}`);
});
