import assert from 'node:assert/strict';
import { buildApprovalResolutionProof } from './approval-live-unison-proof.mjs';

const allClearedProof = buildApprovalResolutionProof({
  approvalId: 'approval-live-unison-001',
  surfaces: [
    { name: 'slack', cleared: true },
    { name: 'command-center', cleared: true },
    { name: 'inbox', cleared: true },
    { name: 'ava-chat', cleared: true },
  ],
});

assert.deepEqual(allClearedProof, {
  approvalId: 'approval-live-unison-001',
  surfaceCount: 4,
  clearedCount: 4,
  allCleared: true,
  uncleared: [],
});

const failedProof = buildApprovalResolutionProof({
  approvalId: 'approval-live-unison-002',
  surfaces: [
    { name: 'slack', cleared: true },
    { name: 'command-center', cleared: true },
    { name: 'inbox', cleared: false },
    { name: 'ava-chat', cleared: true },
  ],
});

assert.equal(failedProof.approvalId, 'approval-live-unison-002');
assert.equal(failedProof.surfaceCount, 4);
assert.equal(failedProof.clearedCount, 3);
assert.equal(failedProof.allCleared, false);
assert.deepEqual(failedProof.uncleared, ['inbox']);

const emptyProof = buildApprovalResolutionProof({
  approvalId: 'approval-live-unison-empty',
  surfaces: [],
});

assert.equal(emptyProof.allCleared, false);

console.log('approval-live-unison-proof-smoke: ok');
