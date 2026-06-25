import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const runtimeSnapshotHook = read('src/app/hooks/useRuntimeSnapshot.ts');
const avaChat = read('src/app/routes/AvaChat.tsx');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const inbox = read('src/app/routes/Inbox.tsx');
const inboxRuntimeLogic = read('src/app/routes/inboxRuntimeLogic.js');

assert(
  packageJson.includes('"test:approval-unison"'),
  'package.json must expose test:approval-unison.'
);

assert(
  /export async function updateApprovalDecision[\s\S]*window\.dispatchEvent\(\s*new CustomEvent\('pbk:approval-decision'/.test(
    runtimeBridge
  ),
  'updateApprovalDecision must broadcast pbk:approval-decision after a successful bridge decision.'
);

assert(
  /detail:\s*{[\s\S]*approvalId[\s\S]*approvalIds:\s*\[approvalId\][\s\S]*status[\s\S]*response/.test(runtimeBridge),
  'The approval decision event must include approvalId, approvalIds, status, and bridge response detail.'
);

assert(
  /window\.addEventListener\('pbk:approval-decision',\s*reconnectNow\)/.test(
    runtimeSnapshotHook
  ) &&
    /window\.removeEventListener\('pbk:approval-decision',\s*reconnectNow\)/.test(
      runtimeSnapshotHook
    ),
  'useRuntimeSnapshot must refresh immediately when any surface decides an approval.'
);

assert(
  /window\.addEventListener\('pbk:approval-decision'[\s\S]*load\(\{\s*silent:\s*true\s*}\)/.test(
    avaChat
  ),
  'Ava Chat must reload local command bubbles when an approval is decided elsewhere.'
);

assert(
  /getPendingApprovals\(approvals = \[\]\)[\s\S]*status[\s\S]*pending/.test(inboxRuntimeLogic),
  'Shared pending approval helper must hide approved, rejected, cancelled, and needs-revision decisions.'
);

assert(
  /export function getApprovalResolutionKeys\(approval = {}\)/.test(inboxRuntimeLogic) &&
    /preview:/.test(inboxRuntimeLogic) &&
    /target:/.test(inboxRuntimeLogic),
  'Shared approval logic must expose duplicate-aware resolution keys for related approval cards.'
);

assert(
  commandCenter.includes('getApprovalResolutionKeys') &&
    commandCenter.includes('approvalKeys') &&
    commandCenter.includes('resolutionKeys.forEach'),
  'Command Center must clear related approval keys after any approval decision.'
);

assert(
  inbox.includes('getApprovalResolutionKeys') &&
    inbox.includes('pendingAction.startsWith(`approval:${approvalId}:`)') &&
    inbox.includes('resolutionKeys.forEach'),
  'Inbox must clear related approval keys and lock the whole approval while a decision is in flight.'
);

assert(
  avaChat.includes('getApprovalResolutionKeys') &&
    avaChat.includes('approvalKeys') &&
    avaChat.includes('nextKeys.forEach'),
  'Ava Chat must listen for related approval keys when approvals are resolved elsewhere.'
);

[
  'updateApprovalDecision',
  'confirmApprovalDecision',
  'executeApprovalDecision',
  'data-approval-primary="true"',
].forEach((token) => {
  assert(commandCenter.includes(token), `Command Center must keep approval control token ${token}.`);
});

[
  'updateApprovalDecision',
  'openApprovalDecisionConfirm',
  'executeApprovalDecision',
  'data-approval-primary={index === 0 ?',
].forEach((token) => {
  assert(inbox.includes(token), `Inbox must keep approval control token ${token}.`);
});

console.log('approval-unison-smoke: ok');
