export type SkillReviewChange = Readonly<{
  previousId: string;
  replacementId: string | null;
}>;
export type SkillReviewSelectionState = Readonly<{
  selectedId: string;
  change: SkillReviewChange | null;
}>;
export type SkillReviewSelectionAction =
  | { type: 'select'; versionId: string }
  | { type: 'repository'; versionIds: readonly string[] };
export const EMPTY_SKILL_REVIEW_SELECTION: SkillReviewSelectionState;
export function reduceSkillReviewSelection(
  state: SkillReviewSelectionState,
  action: SkillReviewSelectionAction
): SkillReviewSelectionState;
