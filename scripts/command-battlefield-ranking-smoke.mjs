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
  /snapshot\.approvals \+ snapshot\.calls \+ snapshot\.messages \+ snapshot\.adminTasks \+ snapshot\.leadImports/.test(
    commandCenter
  ),
  'Battlefield data source caption must include all ranked snapshot arrays.'
);

assert(
  /Battlefield ranked queue[\s\S]*client ranking/.test(dataMap),
  'Data map must document the Battlefield ranked queue as shipped client ranking.'
);

console.log('command-battlefield-ranking-smoke: ok');
