import type { ReactElement } from 'react';
import type { SkillReviewChange } from '../../utils/skillReviewSelection.mjs';

export function SkillReviewNotice({ change }: { change: SkillReviewChange | null }): ReactElement {
  return (
    <p
      className="pbk-skill-review-notice"
      data-pbk-skill-review-notice=""
      role="status"
      aria-live="polite"
      aria-atomic="true"
      hidden={change === null}
    >
      {change && (
        <>
          Version <code>{change.previousId}</code> is not in the current results.
          {change.replacementId !== null && (
            <>
              {' '}
              Showing <code>{change.replacementId}</code>.
            </>
          )}
        </>
      )}
    </p>
  );
}
