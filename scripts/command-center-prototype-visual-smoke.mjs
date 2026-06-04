import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const commandCenter = read('src/app/routes/CommandCenter.tsx');
const pbkComponents = read('src/styles/pbk-components.css');
const packageJson = read('package.json');

function expectContains(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(message);
  }
}

function expectMatch(haystack, pattern, message) {
  if (!pattern.test(haystack)) {
    throw new Error(message);
  }
}

expectContains(
  packageJson,
  '"test:command-center-prototype-visual"',
  'package.json should expose the Command Center prototype visual smoke test.'
);

expectContains(
  commandCenter,
  'buildBattlefieldItems',
  'Command Center should derive the battlefield strip from runtime snapshot data.'
);
expectContains(
  commandCenter,
  'pbk-command-hero',
  'Command Center should render the prototype hero section.'
);
expectContains(
  commandCenter,
  'pbk-battlefield',
  'Command Center should render the founder battlefield strip.'
);
expectContains(
  commandCenter,
  'GET /api/founder/work-queue',
  'Battlefield should honestly disclose the canonical endpoint that still needs Mastra wiring.'
);
expectMatch(
  commandCenter,
  /pbk-priority-(high|money|live)/,
  'Command Center cards should use weighted priority visual styles.'
);
expectContains(
  commandCenter,
  'DataSourceCaption',
  'Command Center should use reusable data-source captions instead of ad hoc text.'
);
expectMatch(
  commandCenter,
  /snapshot\.approvals|snapshot\.calls|snapshot\.activity|snapshot\.leadImports/,
  'Command Center data-source captions should identify real runtime snapshot feeds.'
);

expectContains(
  pbkComponents,
  '.pbk-command-hero',
  'PBK component CSS should include the prototype hero styling.'
);
expectContains(
  pbkComponents,
  '.pbk-battlefield',
  'PBK component CSS should include the battlefield strip styling.'
);
expectContains(
  pbkComponents,
  '.pbk-bf-chip',
  'PBK component CSS should include ranked work queue chips.'
);
expectContains(
  pbkComponents,
  '.pbk-data-source .ds-tag',
  'PBK data-source captions should style endpoint/source tags.'
);

console.log('command-center-prototype-visual-smoke: ok');
