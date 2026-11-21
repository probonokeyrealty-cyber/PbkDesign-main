import { useId, useState } from 'react';
import { Delete } from 'lucide-react';

const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function ParcelPhoneKeypad({ lastFour }: { lastFour: string }) {
  const [entered, setEntered] = useState('');
  const inputId = useId();
  const match = entered.length === 4 ? entered === lastFour : null;
  const append = (digit: string) => setEntered((current) => (current + digit).slice(0, 4));

  return (
    <details className="pbk-virtual-phone-keypad">
      <summary>Verify phone ending</summary>
      <div className="pbk-virtual-phone-keys">
        <label htmlFor={inputId}>Last four digits</label>
        <input id={inputId} className="pbk-input" inputMode="numeric" autoComplete="off" value={entered}
          maxLength={4} onChange={(event) => setEntered(event.target.value.replace(/\D/g, '').slice(0, 4))} />
        <div className="pbk-keypad-grid" aria-label="Phone verification keypad" role="group">
          {digits.map((digit) => (
            <button key={digit} type="button" className="pbk-btn pbk-btn-ghost" onClick={() => append(digit)}>{digit}</button>
          ))}
          <button type="button" className="pbk-btn pbk-btn-ghost" onClick={() => setEntered('')}>Clear</button>
          <button type="button" className="pbk-btn pbk-btn-ghost" onClick={() => append('0')}>0</button>
          <button type="button" className="pbk-btn pbk-btn-ghost" aria-label="Delete last digit" onClick={() => setEntered((current) => current.slice(0, -1))}><Delete size={16} aria-hidden="true" /></button>
        </div>
        <div role="status" className={match === true ? 'pbk-phone-ok' : match === false ? 'pbk-phone-error' : 'pbk-phone-note'}>
          {match === true ? 'Matches the CRM contact.' : match === false ? 'Does not match the CRM contact.' : 'Checks the selected CRM number locally.'}
        </div>
      </div>
    </details>
  );
}
