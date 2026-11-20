import { useId, useRef, useState } from 'react';
import { portalRequest } from './portalApi';

const topics = [
  ['due-diligence', 'What should I verify first?'],
  ['rental', 'What would I need to evaluate a rental?'],
  ['renovation', 'What should I check before renovating and reselling?'],
  ['wholesale', 'What should I check for a wholesale deal?'],
];

export function PropertyConsultation({ id, version }: { id: string; version: number }) {
  const titleId = useId();
  const [topic, setTopic] = useState(topics[0][0]);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function consult() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setAnswer('');
    setError('');
    try {
      const result = await portalRequest('consultProperty', { id, version, topic });
      if (result.version !== version || typeof result.answer !== 'string')
        throw new Error('Reopen the packet and try again.');
      setAnswer(result.answer);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Consultation is unavailable.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="portal-consultation" aria-labelledby={titleId}>
      <h3 id={titleId}>Consult DeepSeek</h3>
      <p>
        Use the released packet’s property dimensions and available price and estimate figures to
        plan your due diligence.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void consult();
        }}
      >
        <label>
          Review question
          <select
            value={topic}
            disabled={busy}
            onChange={(event) => {
              setTopic(event.target.value);
              setAnswer('');
              setError('');
            }}
          >
            {topics.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="portal-primary" type="submit" disabled={busy}>
          Ask DeepSeek
        </button>
      </form>
      <div aria-live="polite" aria-busy={busy}>
        {busy && <p>Reviewing the released property facts…</p>}
        {error && <p role="alert">{error}</p>}
        {answer && (
          <div className="portal-fact">
            <strong>Due diligence · Packet version {version}</strong>
            <p className="portal-consultation-answer">{answer}</p>
          </div>
        )}
      </div>
    </section>
  );
}
