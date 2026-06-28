import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const operatorCopy = read('src/app/utils/operatorCopy.ts');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const packageJson = read('package.json');

const expectedMappings = {
  bridge_healthy: 'Connected',
  render_postgres_ready: 'Saved and ready',
  retry_gated: 'Waiting to retry',
  primary_path_gated: 'Needs setup',
  provider_policy: 'Sending rules',
  blocking: 'Needs attention',
  approval_required: 'Needs your review',
  dispatching: 'Working on it',
  reconciliation_required: 'Needs confirmation',
  delivered: 'Delivered',
  failed: 'Could not complete',
};

const exportedMap = operatorCopy.match(
  /export const operatorStatusCopy: Record<string, string> = \{([\s\S]*?)\};/
);
assert(exportedMap, 'operatorCopy.ts must export operatorStatusCopy as the canonical map.');

assert(
  /export function toOperatorCopy\(value: string\): string/.test(operatorCopy),
  'operatorCopy.ts must export toOperatorCopy(value: string): string.'
);

for (const [raw, label] of Object.entries(expectedMappings)) {
  assert(
    new RegExp(`${raw}:\\s*['"]${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(
      exportedMap[1]
    ),
    `operatorStatusCopy must map ${raw} to "${label}".`
  );
}

assert(
  /normalizeOperatorCopyKey/.test(operatorCopy) &&
    /toLowerCase\(\)/.test(operatorCopy) &&
    /replace\([^)]*[_\\s-]/.test(operatorCopy),
  'operatorCopy.ts must normalize hyphen, underscore, space, and case variants.'
);

assert(
  packageJson.includes('"test:operator-copy": "node ./scripts/operator-copy-smoke.mjs"'),
  'package.json must expose test:operator-copy.'
);

assert(
  /import \{ toOperatorCopy \} from '\.\.\/utils\/operatorCopy'/.test(commandCenter),
  'CommandCenter must import toOperatorCopy.'
);

assert(
  /friendlyRuntimeLabel\(item\.dataState \|\| 'unknown', 'Checking'\)/.test(commandCenter),
  'SourceConfidenceRail must translate visible data-state labels through operator copy.'
);

assert(
  !/<span className="truncate">\{item\.dataState \|\| 'unknown'\}<\/span>/.test(commandCenter),
  'SourceConfidenceRail must not render raw data-state labels.'
);

for (const integration of [
  'SourceConfidenceRail',
  'ProductionGapsRail',
  'FounderBattlefield',
  'SystemHealthPanel',
  'friendlyRuntimeLabel',
  'friendlyRuntimeText',
]) {
  const section = commandCenter.slice(Math.max(0, commandCenter.indexOf(integration) - 500));
  assert(
    section.includes('toOperatorCopy'),
    `CommandCenter ${integration} path must use toOperatorCopy.`
  );
}

for (const rawLabel of ['retry-gated', 'retry_gated', 'primary-path-gated', 'provider-policy']) {
  assert(
    !new RegExp(`>\\s*\\{?['"\`]?${rawLabel}['"\`]?\\}?\\s*<`).test(commandCenter),
    `CommandCenter must not render raw agent-facing label ${rawLabel} in operator copy paths.`
  );
}

console.log('operator-copy-smoke: ok');
