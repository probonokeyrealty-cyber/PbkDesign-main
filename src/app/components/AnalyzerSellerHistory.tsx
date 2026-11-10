import { useEffect, useState } from 'react';
import { ExternalLink, MessageSquareText, RotateCw } from 'lucide-react';
import {
  fetchConversationsRequest,
  fetchConversationTimelineRequest,
  type ConversationEvent,
} from '../utils/runtimeBridge';

type HistoryState =
  | { status: 'loading' | 'missing' | 'error' }
  | { status: 'ready'; events: ConversationEvent[] };

const eventDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export function AnalyzerSellerHistory({ leadId }: { leadId: string }) {
  const [history, setHistory] = useState<HistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!leadId) return;
    let active = true;
    async function loadHistory() {
      try {
        const response = await fetchConversationsRequest({ leadId, limit: 10 });
        if (!active) return;
        if (!response.ok || !Array.isArray(response.items)) throw new Error();
        const thread = response.items.find((item) =>
          item.leadId === leadId && item.id?.trim() && !item.mergedIntoThreadId
        );
        if (!thread) {
          setHistory({ status: 'missing' });
          return;
        }

        const timeline = await fetchConversationTimelineRequest(thread.id, { limit: 12 });
        if (!active) return;
        if (!timeline.ok || !Array.isArray(timeline.items)) throw new Error();
        const events = timeline.items
          .filter((event) => event.threadId === thread.id &&
            (event.leadId == null || event.leadId === leadId) &&
            !event.hiddenAt && !event.spamReportedAt)
          .sort((a, b) => (Date.parse(b.occurredAt) || 0) - (Date.parse(a.occurredAt) || 0))
          .slice(0, 4);
        setHistory({ status: 'ready', events });
      } catch {
        if (active) setHistory({ status: 'error' });
      }
    }

    void loadHistory();
    return () => { active = false; };
  }, [leadId, attempt]);

  return (
    <section className="pbk-analyzer-context-section" aria-labelledby="analyzer-history-heading">
      <header>
        <MessageSquareText size={16} aria-hidden="true" />
        <h3 id="analyzer-history-heading">Seller history</h3>
      </header>
      {!leadId ? (
        <p className="pbk-analyzer-context-meta">No lead linked to this deal.</p>
      ) : history.status === 'ready' ? (
        <>
          {history.events.length ? (
            <ol className="pbk-analyzer-history-list" aria-label="Recent seller activity">
              {history.events.map((event) => {
                const timestamp = Date.parse(event.occurredAt);
                const summary = (event.body || event.subject || event.status || '').trim();
                return (
                  <li key={event.id}>
                    <div className="pbk-analyzer-history-meta">
                      <span>{[event.direction, event.channel || event.eventType].filter(Boolean).join(' / ')}</span>
                      {Number.isFinite(timestamp) && (
                        <time dateTime={event.occurredAt}>{eventDate.format(timestamp)}</time>
                      )}
                    </div>
                    {summary && <p>{summary.length > 180 ? summary.slice(0, 177) + '...' : summary}</p>}
                  </li>
                );
              })}
            </ol>
          ) : <p className="pbk-analyzer-context-meta">No recent activity.</p>}
          <a
            className="pbk-analyzer-context-link"
            href={`/inbox/conversations?lead=${encodeURIComponent(leadId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open conversation <ExternalLink size={13} aria-hidden="true" />
          </a>
        </>
      ) : (
        <>
          <p role="status" className="pbk-analyzer-context-meta">
            {history.status === 'loading' ? 'Loading seller history...'
              : history.status === 'missing' ? 'No conversation is linked to this lead.'
              : 'Seller history is unavailable.'}
          </p>
          {history.status === 'error' && (
            <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => {
              setHistory({ status: 'loading' });
              setAttempt((count) => count + 1);
            }}>
              <RotateCw size={14} aria-hidden="true" /> Retry
            </button>
          )}
        </>
      )}
    </section>
  );
}
