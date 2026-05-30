import { useState } from 'react';

interface HelpTooltipProps {
  text: string;
}

export function HelpTooltip({ text }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="help-tooltip-wrap">
      <button
        type="button"
        className="help-tooltip-trigger"
        aria-label="Show help"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      <span className={['help-tooltip-bubble', open ? 'is-open' : ''].join(' ')} role="tooltip">
        {text}
      </span>
    </span>
  );
}
