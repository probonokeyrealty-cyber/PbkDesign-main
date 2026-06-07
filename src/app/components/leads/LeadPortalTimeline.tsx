import { MessageSquareText } from 'lucide-react';
import { PbkDataSource } from '../../../components/pbk/index';
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
    <section className="pbk-lead-portal-timeline">
      <header>
        <div>
          <span className="pbk-kicker">SMS, email, calls, contracts &amp; approvals</span>
          <h2>Unified seller timeline</h2>
          <p>One chronological record across every confirmed provider event.</p>
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
          <strong>No canonical conversation thread yet</strong>
          <span>
            The seller record is live, but no normalized SMS, email, call, or document event has
            been attached to this lead.
          </span>
        </div>
      )}
      <PbkDataSource
        endpoint="GET /api/conversations/:threadId/timeline"
        status="ships"
        note="canonical seller event history"
      />
    </section>
  );
}
