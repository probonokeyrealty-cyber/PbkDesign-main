const pending = new Set<string>();
const held = new Set<string>();

export function isInboxSubmissionHeld(key: string) {
  return pending.has(key) || held.has(key);
}

// Keep uncertain and queued drafts protected when the composer is remounted in this tab.
export function beginInboxSubmission(key: string) {
  if (isInboxSubmissionHeld(key)) return null;
  pending.add(key);
  return (hold: boolean) => {
    pending.delete(key);
    if (hold) held.add(key);
  };
}
