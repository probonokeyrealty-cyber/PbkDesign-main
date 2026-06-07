import {
  AlertCircle,
  Bell,
  Clock3,
  FileCheck2,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Pin,
  Plus,
  Search,
  UserRoundSearch,
} from 'lucide-react';
import { PbkDataSource } from '../../../components/pbk/index';
import type { ConversationThread } from '../../utils/runtimeBridge';
import { getConversationPreview } from '../../routes/conversationRuntimeLogic.js';

export type ConversationFilter =
  | 'all'
  | 'unread'
  | 'pinned'
  | 'live'
  | 'approvals'
  | 'sms'
  | 'email'
  | 'call';

type ConversationThreadRailProps = {
  threads: ConversationThread[];
  selectedThreadId: string;
  search: string;
  activeFilter: ConversationFilter;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  onSearchChange: (value: string) => void;
  onFilterChange: (filter: ConversationFilter) => void;
  onSelect: (thread: ConversationThread) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onMatchUnknown: (thread: ConversationThread) => void;
  onNewConversation: () => void;
};

const filters: Array<{
  key: ConversationFilter;
  label: string;
  Icon: typeof MessageSquare;
}> = [
  { key: 'all', label: 'All', Icon: MessageSquare },
  { key: 'unread', label: 'Unread', Icon: Bell },
  { key: 'pinned', label: 'Pinned', Icon: Pin },
  { key: 'live', label: 'Live', Icon: Phone },
  { key: 'approvals', label: 'Approvals', Icon: FileCheck2 },
  { key: 'sms', label: 'SMS', Icon: MessageSquare },
  { key: 'email', label: 'Email', Icon: Mail },
  { key: 'call', label: 'Calls', Icon: Phone },
];

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function relativeTime(value: unknown) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) return 'No activity yet';
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function getThreadAddress(thread: ConversationThread) {
  const property = record(thread.property);
  const seller = record(thread.seller);
  return text(
    property.address ||
      property.propertyAddress ||
      seller.address ||
      thread.identities?.find((identity) => identity.identityType === 'email')?.displayValue,
    'Address not captured'
  );
}

function getThreadChannel(thread: ConversationThread) {
  return text(thread.latestEvent?.channel || thread.latestEvent?.eventType, 'activity')
    .replace(/_/g, ' ')
    .toUpperCase();
}

export function ConversationThreadRail({
  threads,
  selectedThreadId,
  search,
  activeFilter,
  loading,
  loadingMore,
  error,
  hasMore,
  onSearchChange,
  onFilterChange,
  onSelect,
  onLoadMore,
  onRetry,
  onMatchUnknown,
  onNewConversation,
}: ConversationThreadRailProps) {
  return (
    <aside className="pbk-conversation-thread-rail" aria-label="Seller conversations">
      <div className="pbk-conversation-thread-tools">
        <div className="pbk-conversation-thread-heading">
          <div>
            <div className="pbk-eyebrow">Seller conversations</div>
            <h1>Unified Inbox</h1>
          </div>
          <button
            type="button"
            className="pbk-conversation-new-message"
            onClick={onNewConversation}
          >
            <Plus size={15} aria-hidden="true" />
            New message
          </button>
        </div>
        <label className="pbk-conversation-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search conversations</span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Name, address, phone..."
          />
        </label>
        <div className="pbk-conversation-filters" aria-label="Conversation filters">
          {filters.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={activeFilter === key ? 'active' : ''}
              aria-pressed={activeFilter === key}
              onClick={() => onFilterChange(key)}
            >
              <Icon size={13} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="pbk-conversation-thread-list">
        {loading &&
          Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="pbk-conversation-thread-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ))}

        {!loading && error && (
          <div className="pbk-conversation-inline-state error" role="alert">
            <AlertCircle size={18} />
            <strong>Could not load conversations</strong>
            <span>{error}</span>
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}

        {!loading &&
          !error &&
          threads.map((thread) => {
            const selected = thread.id === selectedThreadId;
            const unknown = !thread.leadId;
            return (
              <article
                key={thread.id}
                className={`pbk-conversation-thread-row ${selected ? 'selected' : ''}`.trim()}
              >
                <button
                  type="button"
                  className="pbk-conversation-thread-main"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => onSelect(thread)}
                >
                  <span className="pbk-conversation-thread-avatar" aria-hidden="true">
                    {text(thread.title, '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="pbk-conversation-thread-copy">
                    <span className="pbk-conversation-thread-title">
                      <strong>{text(thread.title, 'Unknown seller')}</strong>
                      <span>{relativeTime(thread.lastEventAt)}</span>
                    </span>
                    <span className="pbk-conversation-thread-address">
                      {getThreadAddress(thread)}
                    </span>
                    <span className="pbk-conversation-thread-preview">
                      {getConversationPreview(thread, 86) || 'No timeline activity yet.'}
                    </span>
                    <span className="pbk-conversation-thread-meta">
                      <span>{getThreadChannel(thread)}</span>
                      {thread.pinned && <span>PINNED</span>}
                      {Number(thread.unreadCount || 0) > 0 && (
                        <span className="unread">{thread.unreadCount} NEW</span>
                      )}
                      <span className="sla">
                        <Clock3 size={11} aria-hidden="true" />
                        {thread.lastInboundAt
                          ? `Inbound ${relativeTime(thread.lastInboundAt)}`
                          : 'No SLA'}
                      </span>
                    </span>
                  </span>
                </button>
                {unknown && (
                  <button
                    type="button"
                    className="pbk-conversation-match-lead"
                    onClick={() => onMatchUnknown(thread)}
                    aria-label={`Match ${text(thread.title, 'unknown contact')} to a lead`}
                  >
                    <UserRoundSearch size={13} />
                    Match lead
                  </button>
                )}
              </article>
            );
          })}

        {!loading && !error && !threads.length && (
          <div className="pbk-conversation-inline-state">
            <MessageSquare size={18} />
            <strong>No matching conversations</strong>
            <span>Start from an existing lead or wait for new provider activity.</span>
            <button type="button" onClick={onNewConversation}>
              <Plus size={14} aria-hidden="true" />
              New message
            </button>
          </div>
        )}

        {hasMore && !loading && !error && (
          <button
            type="button"
            className="pbk-conversation-load-more"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore && <Loader2 size={14} className="animate-spin" />}
            {loadingMore ? 'Loading' : 'Load more'}
          </button>
        )}
      </div>
      <PbkDataSource
        endpoint="GET /api/conversations"
        status="ships"
        note="cursor-paged seller threads"
      />
    </aside>
  );
}
