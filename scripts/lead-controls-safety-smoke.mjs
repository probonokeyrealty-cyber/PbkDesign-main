import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const bridge = read('scripts/openclaw-local-server.mjs');

assert(
  packageJson.includes('"test:lead-controls-safety"'),
  'package.json must expose test:lead-controls-safety.'
);

assert(
  /function getExactLeadDeleteIds\(lead = \{\}, fallbackId = ''\)/.test(bridge),
  'Lead delete must derive exact ids before removing anything.'
);

const deleteRouteMatch = bridge.match(
  /if \(leadPatchMatch && request\.method === 'DELETE'\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    if \(leadPatchMatch && request\.method === 'PATCH'\)/
);
assert(deleteRouteMatch, 'DELETE /api/leads/:id route must be present.');
const deleteRoute = deleteRouteMatch[0];

assert(
  /const exactDeleteIds = getExactLeadDeleteIds\(existing, leadPatchMatch\.groups\.id\);/.test(
    deleteRoute
  ),
  'DELETE /api/leads/:id must compute exact delete ids from the selected lead.'
);

assert(
  /state\.leadImports = \(state\.leadImports \|\| \[\]\)\.filter\(\(lead\) => !leadHasExactId\(lead, exactDeleteIds\)\);/.test(
    deleteRoute
  ),
  'Lead roster delete must remove only records whose id/import/external id exactly matches the selected lead.'
);

[
  'state.messages',
  'state.calls',
  'state.appointments',
  'state.contracts',
  'state.analyzerRuns',
  'campaign.leads',
].forEach((surface) => {
  const routeSnippet = deleteRoute.slice(
    Math.max(0, deleteRoute.indexOf(surface) - 240),
    deleteRoute.indexOf(surface) + 520
  );
  assert(
    !/seller:\s*\{[^}]*email|seller:\s*\{[^}]*phone|property:\s*\{[^}]*address|leadName/.test(
      routeSnippet
    ),
    `${surface} cleanup must not delete by broad seller/contact/address identity.`
  );
});

const deleteDbMatch = bridge.match(
  /async function deleteLeadProfileRowFromDb\(lead = \{\}, fallbackId = ''\) \{[\s\S]*?\r?\n\}/
);
assert(deleteDbMatch, 'deleteLeadProfileRowFromDb must be present.');
const deleteDb = deleteDbMatch[0];

assert(
  /const ids = getExactLeadDeleteIds\(lead, fallbackId\);/.test(deleteDb),
  'Postgres lead profile delete must use exact lead ids.'
);
assert(
  !/LOWER\(email\)|REGEXP_REPLACE|LOWER\(address\)|phone = ANY/.test(deleteDb),
  'Postgres lead profile delete must not delete by email, phone, phone digits, or address.'
);

assert(
  /function collectApprovalDecisionIds\(approvalId: string, result: Record<string, unknown>\)/.test(
    runtimeBridge
  ),
  'Runtime bridge must collect canonical approval decision ids for every page.'
);
assert(
  /const approvalIds = collectApprovalDecisionIds\(approvalId, result\);[\s\S]*detail:\s*\{ approvalId, approvalIds, status, response: result \}/.test(
    runtimeBridge
  ),
  'Approval decision events must publish collected approvalIds so all approval boards clear together.'
);

console.log('lead-controls-safety-smoke: ok');
