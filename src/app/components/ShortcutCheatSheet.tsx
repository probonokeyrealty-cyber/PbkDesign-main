import { X } from 'lucide-react';

const SHORTCUTS = [
  { action: 'Open command palette', keys: '⌘K / Ctrl+K' },
  { action: 'Show this sheet', keys: '?' },
  { action: 'Focus global search', keys: 'F' },
  { action: 'Toggle theme', keys: 'T' },
  { action: 'Collapse/expand rail', keys: '[' },
  { action: 'Compose new message', keys: 'C' },
  { action: 'Call first ready lead', keys: 'Alt+Shift+C' },
  { action: 'Approve first card', keys: 'A' },
  { action: 'Approve first card now', keys: 'Alt+Shift+A' },
  { action: 'Reject first card', keys: 'R' },
  { action: 'Escape (close modals)', keys: 'Esc' },
];

interface ShortcutCheatSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutCheatSheet({ open, onClose }: ShortcutCheatSheetProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop kbd-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal kbd-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="modal-kicker">Operator shortcuts</div>
            <h3>Keyboard map</h3>
            <p>Fast controls for the PBK command shell.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close shortcuts">
            <X size={18} />
          </button>
        </div>

        <div className="kbd-list">
          {SHORTCUTS.map((shortcut) => (
            <div className="kbd-row" key={shortcut.action}>
              <span>{shortcut.action}</span>
              <span className="kbd-pills">
                {shortcut.keys.split(' / ').map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
