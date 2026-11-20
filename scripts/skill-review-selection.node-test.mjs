import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SKILL_REVIEW_SELECTION,
  reduceSkillReviewSelection,
} from '../src/app/utils/skillReviewSelection.mjs';

function expectTransition(state, action, expected) {
  const beforeState = structuredClone(state);
  const beforeAction = structuredClone(action);
  if (state.change) Object.freeze(state.change);
  if (action.type === 'repository') Object.freeze(action.versionIds);
  Object.freeze(state);
  Object.freeze(action);

  const result = reduceSkillReviewSelection(state, action);
  assert.deepEqual(result, expected);
  assert.deepEqual(reduceSkillReviewSelection(state, action), expected);
  assert.deepEqual(state, beforeState);
  assert.deepEqual(action, beforeAction);
  return result;
}

for (const [name, state, action, expected] of [
  [
    'initial repository selects SYN-A without a notice',
    { selectedId: '', change: null },
    { type: 'repository', versionIds: ['SYN-A', 'SYN-B'] },
    { selectedId: 'SYN-A', change: null },
  ],
  [
    'initial selection follows repository order rather than sorting IDs',
    { selectedId: '', change: null },
    { type: 'repository', versionIds: ['SYN-C', 'SYN-B', 'SYN-A'] },
    { selectedId: 'SYN-C', change: null },
  ],
  [
    'initially empty results have no notice',
    { selectedId: '', change: null },
    { type: 'repository', versionIds: [] },
    { selectedId: '', change: null },
  ],
  [
    'missing SYN-A selects SYN-B with the paired change',
    { selectedId: 'SYN-A', change: null },
    { type: 'repository', versionIds: ['SYN-B'] },
    { selectedId: 'SYN-B', change: { previousId: 'SYN-A', replacementId: 'SYN-B' } },
  ],
  [
    'replacement follows repository order rather than sorting IDs',
    { selectedId: 'SYN-A', change: null },
    { type: 'repository', versionIds: ['SYN-C', 'SYN-B'] },
    { selectedId: 'SYN-C', change: { previousId: 'SYN-A', replacementId: 'SYN-C' } },
  ],
  [
    'empty results clear SYN-A with no invented replacement',
    { selectedId: 'SYN-A', change: null },
    { type: 'repository', versionIds: [] },
    { selectedId: '', change: { previousId: 'SYN-A', replacementId: null } },
  ],
  [
    'retained selection does not jump to the first ID',
    { selectedId: 'SYN-B', change: null },
    { type: 'repository', versionIds: ['SYN-A', 'SYN-B'] },
    { selectedId: 'SYN-B', change: null },
  ],
  [
    'retained selection clears an older notice',
    { selectedId: 'SYN-B', change: { previousId: 'SYN-A', replacementId: 'SYN-B' } },
    { type: 'repository', versionIds: ['SYN-A', 'SYN-B'] },
    { selectedId: 'SYN-B', change: null },
  ],
  [
    'manual selection of SYN-C clears an older notice',
    { selectedId: 'SYN-B', change: { previousId: 'SYN-A', replacementId: 'SYN-B' } },
    { type: 'select', versionId: 'SYN-C' },
    { selectedId: 'SYN-C', change: null },
  ],
  [
    'manual empty selection clears an older notice',
    { selectedId: 'SYN-B', change: { previousId: 'SYN-A', replacementId: 'SYN-B' } },
    { type: 'select', versionId: '' },
    { selectedId: '', change: null },
  ],
  [
    'ID 0 is a valid initial selection',
    { selectedId: '', change: null },
    { type: 'repository', versionIds: ['0', 'SYN-A'] },
    { selectedId: '0', change: null },
  ],
  [
    'ID 0 is retained and clears an older notice',
    { selectedId: '0', change: { previousId: 'SYN-A', replacementId: '0' } },
    { type: 'repository', versionIds: ['SYN-A', '0'] },
    { selectedId: '0', change: null },
  ],
  [
    'missing ID 0 creates a change',
    { selectedId: '0', change: null },
    { type: 'repository', versionIds: ['SYN-B'] },
    { selectedId: 'SYN-B', change: { previousId: '0', replacementId: 'SYN-B' } },
  ],
  [
    'ID 0 is a valid replacement',
    { selectedId: 'SYN-A', change: null },
    { type: 'repository', versionIds: ['0'] },
    { selectedId: '0', change: { previousId: 'SYN-A', replacementId: '0' } },
  ],
  [
    'repopulating an empty selection does not reuse the prior notice',
    { selectedId: '', change: { previousId: 'SYN-A', replacementId: null } },
    { type: 'repository', versionIds: ['SYN-B'] },
    { selectedId: 'SYN-B', change: null },
  ],
]) {
  test(name, () => {
    expectTransition(state, action, expected);
  });
}

test('the exported empty state starts review without a notice', () => {
  assert.deepEqual(EMPTY_SKILL_REVIEW_SELECTION, { selectedId: '', change: null });
  expectTransition(
    EMPTY_SKILL_REVIEW_SELECTION,
    { type: 'repository', versionIds: ['SYN-A', 'SYN-B'] },
    { selectedId: 'SYN-A', change: null }
  );
});

test('repository commits use the latest manual selection, never the earlier SYN-A', () => {
  const selected = expectTransition(
    { selectedId: 'SYN-A', change: null },
    { type: 'select', versionId: 'SYN-B' },
    { selectedId: 'SYN-B', change: null }
  );
  const retained = expectTransition(
    selected,
    { type: 'repository', versionIds: ['SYN-B', 'SYN-C'] },
    { selectedId: 'SYN-B', change: null }
  );
  expectTransition(
    retained,
    { type: 'repository', versionIds: ['SYN-C'] },
    { selectedId: 'SYN-C', change: { previousId: 'SYN-B', replacementId: 'SYN-C' } }
  );
});

test('long and markup-shaped IDs remain exact through selection, retention and replacement', () => {
  const longId = `SYN-${'long-id-'.repeat(100)}`;
  const markupId = ' <script>"SYN-A" & /?#%[]</script> ';
  const selected = expectTransition(
    { selectedId: 'SYN-A', change: null },
    { type: 'select', versionId: markupId },
    { selectedId: markupId, change: null }
  );
  const retained = expectTransition(
    selected,
    { type: 'repository', versionIds: [longId, markupId] },
    { selectedId: markupId, change: null }
  );
  const replaced = expectTransition(
    retained,
    { type: 'repository', versionIds: [longId] },
    { selectedId: longId, change: { previousId: markupId, replacementId: longId } }
  );
  expectTransition(
    replaced,
    { type: 'repository', versionIds: [markupId] },
    { selectedId: markupId, change: { previousId: longId, replacementId: markupId } }
  );
});

test('ID membership is case-sensitive and does not trim whitespace', () => {
  expectTransition(
    { selectedId: 'SYN-A', change: null },
    { type: 'repository', versionIds: ['syn-a', ' SYN-A '] },
    { selectedId: 'syn-a', change: { previousId: 'SYN-A', replacementId: 'syn-a' } }
  );
});
