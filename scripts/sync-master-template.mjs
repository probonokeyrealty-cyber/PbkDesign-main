import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.resolve(__dirname, '..');
const publicDir = path.join(appRoot, 'public');
const legacyDir = path.join(publicDir, 'legacy');

const copies = [
  {
    from: path.join(workspaceRoot, 'PBK_Master_Deal_Package.html'),
    to: path.join(publicDir, 'PBK_Master_Deal_Package.html'),
  },
  {
    from: path.join(workspaceRoot, 'PBK_Command_Center v5.html'),
    to: path.join(legacyDir, 'PBK_Command_Center v5.html'),
  },
];

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(legacyDir, { recursive: true });

copies.forEach(({ from, to }) => {
  if (!fs.existsSync(from)) {
    throw new Error(`Missing required PBK asset: ${from}`);
  }

  fs.copyFileSync(from, to);
  console.log(`Synced ${path.basename(from)} -> ${to}`);
});
