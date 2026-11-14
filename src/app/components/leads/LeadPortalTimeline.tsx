import { MessageSquareText } from 'lucide-react';
import { ConversationTimeline } from '../inbox/ConversationTimeline';
import type { ConversationEvent, ConversationThread } from '../../utils/runtimeBridge';

type LeadPortalTimelineProps = {
  thread: ConversationThread | null;
  events: ConversationEvent[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onEventChanged: () => void;
};

export function LeadPortalTimeline({
  thread,
  events,
  loading,
  loadingMore,
  error,
  hasMore,
  onRetry,
  onLoadMore,
  onEventChanged,
}: LeadPortalTimelineProps) {
  return (
    <section
      className="pbk-lead-portal-timeline"
      id="lead-timeline"
      aria-labelledby="lead-timeline-heading"
    >
      <header>
        <div>
          <h2 id="lead-timeline-heading">Seller timeline</h2>
        </div>
        <MessageSquareText size={20} />
      </header>
      {thread ? (
        <ConversationTimeline
          thread={thread}
          events={events}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          hasMore={hasMore}
          onRetry={onRetry}
          onLoadMore={onLoadMore}
          onOpenProfile={() => undefined}
          onLatestSeen={() => undefined}
          onEventChanged={onEventChanged}
        />
      ) : (
        <div className="pbk-lead-portal-empty">
          <MessageSquareText size={22} />
          <strong>No events in this timeline yet</strong>
        </div>
      )}
    </section>
  );
}
