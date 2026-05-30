import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const index = readFileSync(resolve('index.html'), 'utf8');
const bridge = readFileSync(resolve('scripts/openclaw-local-server.mjs'), 'utf8');
const eventWorker = readFileSync(resolve('scripts/event-worker.mjs'), 'utf8');
const netlifyConfig = readFileSync(resolve('netlify.toml'), 'utf8');

assert.match(
  eventWorker,
  /EventTypes\.CALL_COMPLETED[\s\S]*upsertCallEmbeddingFromTranscript/,
  'event worker should route call.completed to the call transcript embedding upsert tool.'
);
assert.match(
  bridge,
  /POST' && pathname === '\/api\/feedback'/,
  'bridge should expose POST /api/feedback for post-call thumbs feedback.'
);

assert.match(index, /loading-spinner-small/, 'dashboard should include a reusable small loading spinner.');
assert.match(index, /function setElementBusy/, 'dashboard should include a shared busy-state helper.');
assert.match(index, /function withButtonLoading/, 'dashboard should include a shared button loading helper.');
assert.match(index, /aria-busy/, 'busy controls should expose aria-busy for assistive tech.');
assert.match(index, /pbk-boot-overlay/, 'dashboard should hide static fallback markup behind a PBK boot overlay.');
assert.match(index, /body:not\(\.pbk-boot-ready\) \.app/, 'dashboard should keep the app hidden until boot routing is ready.');
assert.match(index, /function markPbkBootReady/, 'dashboard should explicitly release the boot overlay after initial routing.');
assert.match(index, /markPbkBootReady\(initialPage \|\| 'dashboard'\)/, 'dashboard should mark boot ready after choosing the initial page.');
assert.match(
  netlifyConfig,
  /from\s*=\s*"\/index\.shell\.html\/\*"[\s\S]*?to\s*=\s*"\/index\.shell\.html"[\s\S]*?force\s*=\s*true/,
  'Netlify should route modern shell deep links to the React shell instead of the legacy dashboard.'
);

assert.match(index, /function addBrainThinkingMessage/, 'Rex chat should add an inline thinking message.');
assert.match(index, /data-brain-thinking-id/, 'Rex thinking messages should be removable by id.');
assert.match(index, /Rex is thinking/, 'Rex chat should show visible thinking copy while waiting.');

assert.match(index, /function recordCallFeedback/, 'recordings UI should wire thumbs feedback to the bridge.');
assert.match(index, /\/api\/feedback/, 'recordings feedback should call /api/feedback.');
assert.match(index, /data-feedback-rating="good"/, 'recordings UI should render a thumbs-up feedback action.');
assert.match(index, /data-feedback-rating="bad"/, 'recordings UI should render a thumbs-down feedback action.');

assert.match(
  index,
  /async function handleApprovalAction[\s\S]*withButtonLoading/,
  'approval board decisions should display a button-level loading state.'
);
assert.match(
  index,
  /function wireAgentConsoleRuntime[\s\S]*withButtonLoading/,
  'Agent Console command bar should display a loading state while commands run.'
);

console.log('[ui-loading-feedback-smoke] ok');
