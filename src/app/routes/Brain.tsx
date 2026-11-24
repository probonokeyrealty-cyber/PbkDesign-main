import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Database, Send } from 'lucide-react';
import { bridgeRequest } from '../utils/runtimeBridge';

type Turn = { role: 'user' | 'assistant'; content: string; citations?: string[] };

export function Brain() {
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = draft.trim();
    if (!query || sending.current) return;

    sending.current = true;
    setPending(true);
    setFailed(false);
    const question: Turn = { role: 'user', content: query };
    const messages = [...turns.slice(-16), question].map(({ role, content }) => ({
      role,
      content,
    }));
    try {
      const result = await bridgeRequest<{ ok?: boolean; answer?: string; citations?: string[] }>({
        method: 'POST',
        path: '/api/brain/query',
        body: { query, messages, requestedBy: 'Command Center', readOnly: true },
      });
      const answer = typeof result?.answer === 'string' ? result.answer.trim() : '';
      if (result?.ok === false || !answer) throw new Error('No Rex answer');
      const citations = Array.isArray(result.citations)
        ? [
            ...new Set(
              result.citations.filter((citation) => typeof citation === 'string' && citation.trim())
            ),
          ]
        : [];
      setTurns((current) => [
        ...current,
        question,
        { role: 'assistant', content: answer, citations },
      ]);
      setDraft('');
    } catch {
      setFailed(true);
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-4 py-5">
      <header className="pbk-memory-hero-top flex-wrap">
        <h1 className="pbk-display">Brain</h1>
        <Link className="pbk-btn pbk-btn-ghost" to="/memory">
          <Database size={15} aria-hidden="true" />
          Memory
        </Link>
      </header>
      <section className="pbk-memory-card min-w-0" aria-labelledby="rex-heading">
        <div className="mem-card-head">
          <h2 id="rex-heading">Ask Rex</h2>
        </div>
        <div className="mem-card-body flex min-w-0 flex-col gap-4">
          {!!turns.length && (
            <div role="log" aria-label="Rex conversation" className="flex min-w-0 flex-col gap-4">
              {turns.map((turn, index) => (
                <div key={index} className="min-w-0">
                  <strong>{turn.role === 'user' ? 'You' : 'Rex'}</strong>
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{turn.content}</p>
                  {!!turn.citations?.length && (
                    <ul
                      aria-label="Sources"
                      className="mt-2 list-disc pl-5 text-sm [overflow-wrap:anywhere]"
                    >
                      {turn.citations.map((citation) => (
                        <li key={citation}>{citation}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
          <form className="flex min-w-0 flex-col items-start gap-2" onSubmit={submit}>
            <textarea
              aria-label="Ask Rex"
              className="pbk-input w-full resize-y"
              rows={3}
              value={draft}
              readOnly={pending}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              className="pbk-btn pbk-btn-primary"
              type="submit"
              aria-label="Send to Rex"
              disabled={pending || !draft.trim()}
            >
              <Send size={15} aria-hidden="true" />
              Send
            </button>
            {pending && <p role="status">Rex is researching...</p>}
            {failed && (
              <p role="alert">Rex could not answer. Check the Brain connection and try again.</p>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
