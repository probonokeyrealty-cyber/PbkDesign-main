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
  packageJson.includes('"test:command-battlefield-ranking"'),
  'package.json must expose test:command-battlefield-ranking.'
);

['score: number', 'source: string', 'reason: string', 'cta: string'].forEach((field) => {
  assert(commandCenter.includes(field), `BattlefieldItem must include ${field}.`);
});

assert(
  /rankBattlefieldItems/.test(commandCenter) && /right\.score - left\.score/.test(commandCenter),
  'Battlefield items must be ranked by descending score.'
);

['pbk-bf-rank', 'pbk-bf-score', 'pbk-bf-source', 'pbk-bf-reason'].forEach((className) => {
  assert(commandCenter.includes(className), `FounderBattlefield must render ${className}.`);
  assert(pbkCss.includes(`.${className}`), `PBK CSS must style .${className}.`);
});

assert(
  /endpoint="GET \/api\/founder\/work-queue"/.test(commandCenter) &&
    /fallbackBattlefieldItems/.test(commandCenter),
  'Battlefield data source caption must use the bridge work queue while retaining snapshot fallback.'
);

assert(
  /Battlefield ranked queue[\s\S]*GET \/api\/founder\/work-queue[\s\S]*fallback `GET \/state`[\s\S]*Ships/.test(
    dataMap
  ),
  'Data map must document the Battlefield ranked queue as bridge-backed with a snapshot fallback.'
);

console.log('command-battlefield-ranking-smoke: ok');
