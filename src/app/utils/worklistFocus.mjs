const rootSelector = '[data-pbk-worklist]';
const rowSelector = 'button[data-pbk-worklist-row]';

export function getWorklistFocusIndex(key, index, count, options = {}) {
  if (options.modified || options.composing || !Number.isInteger(count) || count <= 0
    || !Number.isInteger(index) || index < 0 || index >= count) return null;

  switch (key) {
    case 'ArrowDown': return Math.min(index + 1, count - 1);
    case 'ArrowUp': return Math.max(index - 1, 0);
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

export function focusWorklistRow(event) {
  const button = event.currentTarget;
  if (event.defaultPrevented || event.target !== button || !button.matches(rowSelector)) return false;

  const root = button.closest(rootSelector);
  if (!root || !['leads', 'skills'].includes(root.getAttribute('data-pbk-worklist'))) return false;

  const rows = Array.from(root.querySelectorAll(rowSelector)).filter(row => {
    if (row.closest(rootSelector) !== root || !row.isConnected
      || row.matches(':disabled, [aria-disabled="true"]') || row.closest('[hidden], [inert]')
      || row.getClientRects().length === 0) return false;
    const { visibility } = row.ownerDocument.defaultView.getComputedStyle(row);
    return visibility !== 'hidden' && visibility !== 'collapse';
  });
  const index = getWorklistFocusIndex(event.key, rows.indexOf(button), rows.length, {
    modified: event.ctrlKey || event.metaKey || event.altKey || event.shiftKey,
    composing: event.nativeEvent?.isComposing,
  });
  if (index === null) return false;

  event.preventDefault();
  rows[index].focus();
  return true;
}
