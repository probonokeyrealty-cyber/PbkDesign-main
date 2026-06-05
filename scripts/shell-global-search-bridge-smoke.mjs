import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const topbar = read('src/app/shell/ShellTopbar.tsx');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const bridge = read('scripts/openclaw-local-server.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:shell-global-search-bridge"'),
  'package.json must expose test:shell-global-search-bridge.'
);

assert(
  /fetchGlobalSearchRequest/.test(runtimeBridge) && /\/api\/search/.test(runtimeBridge),
  'runtimeBridge must expose GET /api/search.'
);

assert(
  /type GlobalSearchResult/.test(runtimeBridge) && /GlobalSearchResponse/.test(runtimeBridge),
  'runtimeBridge must type global search results.'
);

assert(/fetchGlobalSearchRequest/.test(topbar), 'ShellTopbar must call fetchGlobalSearchRequest.');

assert(
  /const \[searchSource, setSearchSource\]/.test(topbar),
  'ShellTopbar must expose whether search came from bridge or fallback.'
);

assert(
  /data-source="GET \/api\/search"/.test(topbar),
  'ShellTopbar search source annotation must point to GET /api/search.'
);

assert(
  /Bridge search|Local fallback|Searching bridge/.test(topbar),
  'ShellTopbar must render honest bridge/fallback search status text.'
);

assert(
  /ShellTopbar` global search[\s\S]*fetchGlobalSearchRequest\(\)[\s\S]*Ships/.test(dataMap),
  'Data map must mark ShellTopbar global search as shipped through fetchGlobalSearchRequest().'
);

assert(
  /collectGlobalSearchRecords[\s\S]*getCurrentAgentRegistry\(\)[\s\S]*kind:\s*'agent'/.test(
    bridge
  ),
  'Bridge global search must index canonical agent registry records.'
);

console.log('shell-global-search-bridge-smoke: ok');
