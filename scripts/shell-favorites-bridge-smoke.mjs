import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const favorites = read('src/app/shell/FavoritesBar.tsx');
const layout = read('src/app/shell/ParadiseLayout.tsx');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:shell-favorites-bridge"'),
  'package.json must expose test:shell-favorites-bridge.'
);

assert(
  /updateRuntimeSettingsRequest/.test(favorites),
  'FavoritesBar must persist favorite changes through updateRuntimeSettingsRequest.'
);

assert(
  /settings\.ui\.favorites|ui:\s*\{[\s\S]*favorites/.test(favorites),
  'FavoritesBar must write favorites under settings.ui.favorites.'
);

assert(
  /data-source="PATCH \/api\/settings ui\.favorites"/.test(favorites),
  'FavoritesBar must annotate bridge favorites writes as PATCH /api/settings ui.favorites.'
);

assert(
  /localStorage:pbk:favorites:v1/.test(favorites) &&
    /Device prefs|bridge unavailable/i.test(favorites),
  'FavoritesBar must retain and honestly label device/localStorage preferences.'
);

assert(
  /'\/skill-studio': 'Skill Studio'/.test(favorites) &&
    /'\/ava-chat': 'Ava Chat'/.test(favorites) &&
    /'\/agent-console': 'Agent Console'/.test(favorites),
  'FavoritesBar must recognize production shell routes instead of normalizing them away.'
);

assert(
  /return PAGE_LABELS\[pathname\] \? pathname : '';/.test(favorites),
  'FavoritesBar must not normalize unknown routes to Command Center.'
);

assert(
  /<FavoritesBar[\s\S]*snapshot=\{snapshot/.test(layout) && /refresh=\{refresh\}/.test(layout),
  'ParadiseLayout must pass runtime snapshot and refresh into FavoritesBar.'
);

assert(
  /`FavoritesBar` pinned pages[\s\S]*PATCH \/api\/settings[\s\S]*Ships/.test(dataMap),
  'Data map must mark FavoritesBar pinned pages as shipped through PATCH /api/settings.'
);

console.log('shell-favorites-bridge-smoke: ok');
