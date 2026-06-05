import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const settings = read('src/app/routes/Settings.tsx');
const pbkCss = read('src/styles/pbk-components.css');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:settings-prototype-modern"'),
  'package.json must expose test:settings-prototype-modern.'
);

[
  'SettingsHero',
  'SettingsSourceRail',
  'SettingsStatRibbon',
  'SettingsProviderCard',
  'SettingsToolCard',
  'SettingsSafetyRail',
].forEach((component) => {
  assert(settings.includes(component), `Settings should include ${component}.`);
});

[
  'pbk-settings-surface',
  'pbk-settings-hero',
  'pbk-settings-source-rail',
  'pbk-settings-grid',
  'pbk-settings-stat',
  'pbk-settings-layout',
  'pbk-settings-card',
  'pbk-settings-provider-card',
  'pbk-settings-tool-card',
  'pbk-settings-safety-rail',
].forEach((className) => {
  assert(
    settings.includes(className) || pbkCss.includes(`.${className}`),
    `${className} must be implemented.`
  );
});

[
  'GET /state',
  'GET /api/quotas',
  'GET /api/tooling/status',
  'PUT /api/admin/tasks/:id',
  'GET /api/observability/status',
  'GET/POST /api/settings',
].forEach((endpoint) => {
  assert(settings.includes(endpoint), `Settings should surface data source ${endpoint}.`);
});

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/state"[\s\S]*status="ships"/.test(settings),
  'Settings must mark GET /state as a shipped runtime/settings source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/quotas"[\s\S]*status="ships"/.test(settings),
  'Settings must mark GET /api/quotas as a shipped provider quota source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/tooling\/status"[\s\S]*status="ships"/.test(settings),
  'Settings must mark GET /api/tooling/status as a shipped tooling source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/observability\/status"[\s\S]*status="ships"/.test(
    settings
  ),
  'Settings must mark canonical observability status as a shipped data source.'
);

assert(
  !/John Smith|Diane Kowalski|123 Main St|Approve Offer|UI-only|SAMPLE_SETTINGS|MOCK_SETTINGS/.test(
    settings
  ),
  'Settings must not port prototype sample people, addresses, or mock labels.'
);

assert(
  runtimeBridge.includes('/api/quotas') &&
    runtimeBridge.includes('/api/tooling/status') &&
    runtimeBridge.includes('/api/admin/tasks/'),
  'runtimeBridge must contain the Settings endpoint helpers.'
);
assert(
  dataMap.includes('Settings') &&
    dataMap.includes('GET /api/quotas') &&
    dataMap.includes('GET /api/tooling/status') &&
    dataMap.includes('GET /api/observability/status'),
  'Bridge data map must document Settings runtime sources and observability wiring gap.'
);

[
  '.pbk-settings-hero',
  '.pbk-settings-stat',
  '.pbk-settings-provider-card',
  '.pbk-settings-tool-card',
  '.pbk-settings-safety-rail',
].forEach((selector) => {
  assert(pbkCss.includes(selector), `PBK CSS should include ${selector}.`);
});

console.log('settings-prototype-modern-smoke: ok');
