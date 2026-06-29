import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOperatorHealthSummary } from './system-source-health.mjs';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = read('package.json');
const commandCenter = read('src/app/routes/CommandCenter.tsx');

assert(
  packageJson.includes(
    '"test:system-health-operator-view": "node ./scripts/system-health-operator-view-smoke.mjs"'
  ),
  'package.json must expose test:system-health-operator-view.'
);

const summary = buildOperatorHealthSummary({
  render: { ready: true },
  openclaw: { connected: true },
  redis: true,
  postgres: { state: 'render_postgres_ready' },
  netlify: { ready: true },
  slack: { connected: false },
  docusign: { warning: 'missing_envelope' },
  sms: { ready: true },
  email: { status: 'checking' },
  avaLearning: { trained: false },
});

assert(Array.isArray(summary), 'buildOperatorHealthSummary must return an array.');
assert(summary.length === 10, 'buildOperatorHealthSummary must return exactly 10 services.');
assert(
  new Set(summary.map((item) => item.id)).size === 10,
  'Operator health summary must contain 10 unique service ids.'
);

for (const item of summary) {
  assert(
    item.id && item.label && item.state && item.copy,
    'Each service needs id, label, state, and copy.'
  );
  assert(
    ['ready', 'needs_attention', 'checking'].includes(item.state),
    `Unexpected health state for ${item.id}: ${item.state}`
  );
}

const docusign = summary.find((item) => item.id === 'docusign');
assert(docusign, 'DocuSign must be represented.');
assert(docusign.state === 'needs_attention', 'DocuSign warning must map to needs_attention state.');
assert(
  docusign.copy.includes('Needs attention'),
  'DocuSign warning must render as Needs attention.'
);

assert(
  /SystemHealthPanel/.test(commandCenter) &&
    /System health/.test(commandCenter) &&
    /buildCommandCenterHealthInput/.test(commandCenter),
  'Command Center must render a plain-English System health panel.'
);

assert(
  /fetchBridgeConnectionRequest/.test(commandCenter) &&
    /GET \/api\/bridge\/connection/.test(commandCenter) &&
    /bridgeConnectionSource/.test(commandCenter),
  'Command Center must fetch protected live bridge connection proof for OpenClaw/bridge health.'
);

assert(
  /bridgeConnectionComponents/.test(commandCenter) &&
    /pickHealthValue\(bridgeConnectionComponents, \['bridge'\]\)/.test(commandCenter) &&
    /Sign in or refresh the team session/.test(commandCenter),
  'Command Center must distinguish missing team-session bridge proof from a disconnected OpenClaw provider.'
);

assert(
  !/openclaw:\s*error\s*\?\s*\{\s*error\s*\}\s*:\s*\{\s*connected:\s*true/.test(commandCenter),
  'Command Center must not mark OpenClaw ready when live bridge detail is missing.'
);

assert(
  !/render:\s*loading[\s\S]{0,140}\{\s*ready:\s*true/.test(commandCenter),
  'Command Center must not mark Render ready from absence of a runtime error.'
);

assert(
  !/sourceText\.includes\('postgres'\)[\s\S]{0,140}render_postgres_ready/.test(commandCenter),
  'Command Center must not mark Postgres ready from source label text alone.'
);

assert(
  /normalizedStatus === 'offline' \|\| normalizedStatus === 'needs-wiring'[\s\S]{0,80}\? 'unavailable'/.test(
    commandCenter
  ),
  'Command Center must normalize needs-wiring source labels as unavailable, not ready.'
);

assert(
  /needs\[-_\\s\]\?wiring/.test(commandCenter),
  'Command Center health source helper must treat needs-wiring as a needs-attention signal.'
);

assert(
  !/netlify:\s*loading\s*\?\s*\{\s*state:\s*'checking'\s*\}\s*:\s*\{\s*ready:\s*true/.test(
    commandCenter
  ),
  'Command Center must not mark Netlify ready from page load alone.'
);

assert(
  /Live command bridge detail is still being checked/.test(commandCenter),
  'Command Center must show OpenClaw as checking when live bridge detail is missing.'
);

console.log('system-health-operator-view-smoke: ok');
