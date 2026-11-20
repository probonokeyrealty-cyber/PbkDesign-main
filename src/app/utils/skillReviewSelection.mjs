export const EMPTY_SKILL_REVIEW_SELECTION = Object.freeze({ selectedId: '', change: null });

export function reduceSkillReviewSelection(state, action) {
  if (action.type === 'select') {
    return { selectedId: action.versionId, change: null };
  }

  if (state.selectedId !== '' && action.versionIds.includes(state.selectedId)) {
    return { selectedId: state.selectedId, change: null };
  }

  const replacementId = action.versionIds[0] ?? null;
  return {
    selectedId: replacementId ?? '',
    change: state.selectedId !== '' ? { previousId: state.selectedId, replacementId } : null,
  };
}
