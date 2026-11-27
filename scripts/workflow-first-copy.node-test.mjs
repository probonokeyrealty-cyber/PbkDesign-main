import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/app/utils/operatorCopy.ts');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
new Function('exports', 'module', compiled)(module.exports, module);
const copy = module.exports;

test('workflow states distinguish waiting, approval and actual delivery', () => {
  assert.equal(copy.toOperatorCopy('queued'), 'Waiting to run');
  assert.equal(copy.toOperatorCopy('queued-for-approval'), 'Waiting for approval');
  assert.equal(copy.toOperatorCopy('approved'), 'Approved');
  assert.equal(copy.toOperatorCopy('needs-revision'), 'Changes requested');
  assert.equal(copy.toOperatorCopy('delivered'), 'Delivered');
  assert.equal(copy.toOperatorCopy('reconciliation_required'), 'Needs confirmation');
});

test('final approval commands name the decision, never delivery', () => {
  assert.equal(typeof copy.getApprovalDecisionCopy, 'function');
  assert.equal(copy.getApprovalDecisionCopy('approved'), 'Approve request');
  assert.equal(copy.getApprovalDecisionCopy('rejected'), 'Decline request');
  assert.equal(copy.getApprovalDecisionCopy('needs-revision'), 'Request changes');
  assert.equal(copy.getApprovalDecisionCopy('unknown'), 'Review request');
});

test('Analyzer and lead actions use explicit wording on existing handlers', () => {
  const analyzer = read('src/app/components/DealAnalyzerChrome.tsx');
  assert.ok(analyzer.includes('Deal summary'));
  assert.ok(analyzer.includes('Open deal summary'));
  assert.ok(analyzer.includes('aria-label="Open call prep"'));
  assert.ok(analyzer.includes('Save deal'));
  assert.ok(analyzer.includes('onClick={onSaveDeal}'));
  assert.ok(analyzer.includes('onClick={onOpenSnapshot}'));
  assert.ok(read('src/app/components/AnalyzerTab.tsx').includes('Lead details'));
  const lead = read('src/app/components/leads/LeadPortalHeader.tsx');
  assert.ok(lead.includes('Edit lead'));
  assert.ok(lead.includes('Open conversation'));
  assert.ok(lead.includes('onClick={onEdit}'));
  assert.ok(lead.includes('target="_blank" rel="noopener noreferrer"'));
});

test('both confirmation surfaces use the shared action copy without bypassing checks', () => {
  const today = read('src/app/routes/CommandCenter.tsx');
  const inbox = read('src/app/routes/Inbox.tsx');
  assert.ok(today.includes('getApprovalDecisionCopy(approvalDecisionDraft.status)'));
  assert.ok(today.includes('!approvalsAvailable'));
  assert.ok(today.includes('onClick={executeApprovalDecision}'));
  assert.ok(inbox.includes('getApprovalDecisionCopy(draft.status)'));
  assert.ok(inbox.includes('Submitting decision...'));
  assert.ok(inbox.includes('disabled={pending} onClick={onConfirm}'));
});

test('existing polish CI runs workflow contracts and sample-only desktop/mobile proof', () => {
  const workflow = read('.github/workflows/command-center-polish-verify.yml');
  assert.ok(workflow.includes("'scripts/workflow-first*'"));
  assert.ok(workflow.includes('node --test scripts/workflow-first-copy.node-test.mjs'));
  assert.ok(workflow.includes('node scripts/workflow-first-browser-smoke.mjs'));
  assert.ok(workflow.includes('contents: read'));
  assert.doesNotMatch(workflow, /secrets\.|npm run deploy|netlify deploy|render deploy/);
});
