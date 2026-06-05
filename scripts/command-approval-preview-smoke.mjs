import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const commandCenter = read('src/app/routes/CommandCenter.tsx');
const pbkCss = read('src/styles/pbk-components.css');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const packageJson = read('package.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:command-approval-preview"'),
  'package.json must expose test:command-approval-preview.'
);

assert(
  /getApprovalPreview/.test(commandCenter),
  'CommandCenter must reuse the shared runtime approval preview helper.'
);

assert(
  /pbk-command-approval-card/.test(commandCenter),
  'CommandCenter approval cards must use the PBK command approval card class.'
);

assert(
  /approval-preview/.test(commandCenter) && /getApprovalPreview\(approval\)/.test(commandCenter),
  'CommandCenter approval cards must render the actual approval preview payload.'
);

assert(
  /pbk-command-approval-card \.approval-preview/.test(pbkCss),
  'PBK CSS must style Command Center approval previews.'
);

assert(
  /Rich approval payload preview in Command Center[\s\S]*Ships/.test(dataMap),
  'Data map must mark Command Center rich approval payload previews as shipped.'
);

assert(
  !/Rich approval payload preview in Command Center[\s\S]*Needs UI port/.test(dataMap),
  'Data map must not leave Command Center approval previews marked as needing a UI port.'
);

console.log('command-approval-preview-smoke: ok');
