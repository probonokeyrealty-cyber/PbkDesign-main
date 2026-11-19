import type * as React from 'react';

export function getWorklistFocusIndex(
  key: string,
  index: number,
  count: number,
  options?: { modified?: boolean; composing?: boolean },
): number | null;

export function focusWorklistRow(event: React.KeyboardEvent<HTMLButtonElement>): boolean;
