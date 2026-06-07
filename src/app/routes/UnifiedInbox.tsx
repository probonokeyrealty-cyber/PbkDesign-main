import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import { ConversationThreadRail, type ConversationFilter } from '../components/inbox/ConversationThreadRail';
import { ConversationTimeline } from '../components/inbox/ConversationTimeline';
import { ConversationComposer } from '../components/inbox/ConversationComposer';
import { LiveCallPip } from '../components/inbox/LiveCallPip';
import { LeadContextInspector } from '../components/inbox/LeadContextInspector';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  fetchConversationRequest,
  fetchConversationsRequest,
  fetchConversationTimelineRequest,
  fetchLeadFullRequest,
  mergeConversationThreadsRequest,
  patchConversationRequest,
  searchLeadsRequest,
  type ConversationEvent,
  type ConversationThread,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';
import {
  getConversationMobileState,
  normalizeConversationThreads,
} from './conversationRuntimeLogic.js';

const THREAD_PAGE_SIZE = 40;
const TIMELINE_PAGE_SIZE = 80;
const SELECTED_POLL_MS = 18_000;

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function buildThreadFilters(
  search: string,
  filter: ConversationFilter,
  cursor = ''
) {
  return {
    cursor,
    search,
    unread: filter === 'unread' ? true : undefined,
    pinned: filter === 'pinned' ? true : undefined,
    channel: ['sms', 'email', 'call'].includes(filter) ? filter : '',
    activity: ['live', 'approvals'].includes(filter) ? filter : '',
    limit: THREAD_PAGE_SIZE,
  };
}

type LeadSearchResult = Record<string, unknown>;

function getLeadResultId(result: LeadSearchResult) {
  return text(result.leadId || result.lead_id || result.id);
}

function getLeadResultName(result: LeadSearchResult) {
  const seller = record(result.seller);
  return text(result.leadName || result.lead_name || result.name || seller.name, 'Unknown seller');
}

function getLeadResultAddress(result: LeadSearchResult) {
  const property = record(result.property);
  return text(
    result.address || result.propertyAddress || result.property_address || property.address,
    'Address not captured'
  );
}

export function UnifiedInbox() {
  const { snapshot, refresh: refreshRuntime } = useRuntimeSnapshot(2500);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedThreadId = searchParams.get('thread') || '';
  const requestedLeadId = searchParams.get('lead') || '';
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [threadCursor, setThreadCursor] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(true);
  const [threadLoadingMore, setThreadLoadingMore] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ConversationFilter>('all');
  const [compactViewport, setCompactViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 760
  );
  const [inspectorOverlay, setInspectorOverlay] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 1180
  );

  const [selectedThread, setSelectedThread] = useState<ConversationThread | null>(null);
  const [recipientSummary, setRecipientSummary] = useState<{
    phone?: string;
    email?: string;
  } | null>(null);
  const [timeline, setTimeline] = useState<ConversationEvent[]>([]);
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [timelineError, setTimelineError] = useState('');
  const [leadDetail, setLeadDetail] = useState<Record<string, unknown> | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadError, setLeadError] = useState('');
  const [profileOpen, setProfileOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1180
  );
  const [degradedReason, setDegradedReason] = useState('');

  const [matchThread, setMatchThread] = useState<ConversationThread | null>(null);
  const [leadQuery, setLeadQuery] = useState('');
  const [leadMatches, setLeadMatches] = useState<LeadSearchResult[]>([]);
  const [leadSearchPending, setLeadSearchPending] = useState(false);
  const [mergePendingId, setMergePendingId] = useState('');
  const [mergeError, setMergeError] = useState('');
  const [selectedLeadMatch, setSelectedLeadMatch] = useState<LeadSearchResult | null>(null);
  const threadRequestSequence = useRef(0);
  const selectedRequestSequence = useRef(0);
  const selectedThreadIdRef = useRef(selectedThreadId);
  const selectedPollInFlight = useRef(false);
  const readInFlightThreadId = useRef('');
  const matchDialogRef = useRef<HTMLElement>(null);
  const matchReturnFocusRef = useRef<HTMLElement | null>(null);
  const leadSearchSequence = useRef(0);
  const leadThreadResolveSequence = useRef(0);

  const visibleThreads = useMemo(
    () => normalizeConversationThreads(threads) as ConversationThread[],
    [threads]
  );

  selectedThreadIdRef.current = selectedThreadId;

  useEffect(() => {
    const mobileMedia = window.matchMedia('(max-width: 760px)');
    const inspectorMedia = window.matchMedia('(max-width: 1180px)');
    const update = () => {
      setCompactViewport(mobileMedia.matches);
      setInspectorOverlay(inspectorMedia.matches);
    };
    update();
    mobileMedia.addEventListener('change', update);
    inspectorMedia.addEventListener('change', update);
    return () => {
      mobileMedia.removeEventListener('change', update);
      inspectorMedia.removeEventListener('change', update);
    };
  }, []);

  const setSelectedThreadInUrl = useCallback(
    (threadId: string) => {
      const next = new URLSearchParams(searchParams);
      if (threadId) {
        next.set('thread', threadId);
        next.delete('lead');
      } else {
        next.delete('thread');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    if (!requestedLeadId || selectedThreadId) return undefined;
    const requestId = ++leadThreadResolveSequence.current;
    void fetchConversationsRequest({ leadId: requestedLeadId, limit: 2 })
      .then((response) => {
        if (requestId !== leadThreadResolveSequence.current) return;
        const canonical =
          (response.items || []).find((candidate) => candidate.leadId === requestedLeadId) ||
          response.items?.[0];
        if (canonical?.id) {
          setSelectedThreadInUrl(canonical.id);
          return;
        }
        setThreadError('This seller has no canonical conversation thread yet.');
      })
      .catch((error) => {
        if (requestId !== leadThreadResolveSequence.current) return;
        setThreadError(
          error instanceof Error ? error.message : 'Unable to resolve the seller conversation.'
        );
      });
    return () => {
      leadThreadResolveSequence.current += 1;
    };
  }, [requestedLeadId, selectedThreadId, setSelectedThreadInUrl]);

  const loadThreadPage = useCallback(
    async ({ append = false, cursor = '' }: { append?: boolean; cursor?: string } = {}) => {
      const requestId = ++threadRequestSequence.current;
      append ? setThreadLoadingMore(true) : setThreadLoading(true);
      if (!append) setThreadError('');
      try {
        const response = await fetchConversationsRequest(
          buildThreadFilters(search, activeFilter, cursor)
        );
        if (requestId !== threadRequestSequence.current) return;
        const nextItems = response.items || [];
        setThreads((current) => (append ? [...current, ...nextItems] : nextItems));
        setThreadCursor(response.nextCursor || null);
        setDegradedReason(response.result && response.result !== 'postgres' ? response.result : '');
      } catch (error) {
        if (requestId !== threadRequestSequence.current) return;
        const message = error instanceof Error ? error.message : 'Unable to load conversations.';
        if (append) {
          showUiToast({
            tone: 'error',
            title: 'More conversations not loaded',
            desc: message,
          });
        } else {
          setThreadError(message);
        }
        if (/postgres|database|unavailable/i.test(message)) setDegradedReason(message);
      } finally {
        if (requestId === threadRequestSequence.current) {
          setThreadLoading(false);
          setThreadLoadingMore(false);
        }
      }
    },
    [activeFilter, search]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadThreadPage();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [loadThreadPage]);

  useEffect(() => {
    if (
      !compactViewport &&
      !threadLoading &&
      !selectedThreadId &&
      !requestedLeadId &&
      visibleThreads[0]?.id
    ) {
      setSelectedThreadInUrl(visibleThreads[0].id);
    }
  }, [
    compactViewport,
    requestedLeadId,
    selectedThreadId,
    setSelectedThreadInUrl,
    threadLoading,
    visibleThreads,
  ]);

  const loadSelectedThread = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (quiet && selectedPollInFlight.current) return;
      const requestThreadId = selectedThreadId;
      const requestId = ++selectedRequestSequence.current;
      if (!selectedThreadId) {
        setSelectedThread(null);
        setTimeline([]);
        setTimelineCursor(null);
        setTimelineLoading(false);
        setTimelineError('');
        setRecipientSummary(null);
        setLeadDetail(null);
        return;
      }
      selectedPollInFlight.current = true;
      if (!quiet) setTimelineLoading(true);
      if (!quiet) setTimelineError('');
      try {
        const [threadResponse, timelineResponse] = await Promise.all([
          fetchConversationRequest(requestThreadId),
          fetchConversationTimelineRequest(requestThreadId, {
            limit: TIMELINE_PAGE_SIZE,
          }),
        ]);
        if (
          requestId !== selectedRequestSequence.current ||
          requestThreadId !== selectedThreadIdRef.current
        ) {
          return;
        }
        const thread = threadResponse.thread || null;
        setSelectedThread(thread);
        setRecipientSummary(threadResponse.recipientSummary || null);
        setTimeline((current) => {
          if (!quiet) return timelineResponse.items || [];
          const merged = new Map(current.map((event) => [event.id, event]));
          for (const event of timelineResponse.items || []) merged.set(event.id, event);
          return [...merged.values()];
        });
        if (!quiet) setTimelineCursor(timelineResponse.nextCursor || null);
        const result = timelineResponse.result || threadResponse.result || '';
        setDegradedReason(result && result !== 'postgres' ? result : '');
      } catch (error) {
        if (
          requestId !== selectedRequestSequence.current ||
          requestThreadId !== selectedThreadIdRef.current
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unable to load the timeline.';
        if (!quiet) setTimelineError(message);
        if (/postgres|database|unavailable/i.test(message)) setDegradedReason(message);
      } finally {
        if (requestId === selectedRequestSequence.current) {
          selectedPollInFlight.current = false;
        }
        if (!quiet && requestId === selectedRequestSequence.current) setTimelineLoading(false);
      }
    },
    [selectedThreadId]
  );

  useEffect(() => {
    void loadSelectedThread();
    if (!selectedThreadId) return undefined;
    const timer = window.setInterval(() => {
      void loadSelectedThread({ quiet: true });
    }, SELECTED_POLL_MS);
    return () => {
      window.clearInterval(timer);
      selectedRequestSequence.current += 1;
      selectedPollInFlight.current = false;
    };
  }, [loadSelectedThread, selectedThreadId]);

  const markSelectedThreadRead = useCallback(async () => {
    const thread = selectedThread;
    if (
      !thread ||
      Number(thread.unreadCount || 0) <= 0 ||
      (inspectorOverlay && profileOpen) ||
      document.visibilityState !== 'visible' ||
      thread.id !== selectedThreadIdRef.current ||
      readInFlightThreadId.current === thread.id
    ) {
      return;
    }
    readInFlightThreadId.current = thread.id;
    try {
      await patchConversationRequest(thread.id, { read: true });
      if (thread.id !== selectedThreadIdRef.current) return;
      setThreads((current) =>
        current.map((candidate) =>
          candidate.id === thread.id ? { ...candidate, unreadCount: 0 } : candidate
        )
      );
      setSelectedThread((current) =>
        current?.id === thread.id ? { ...current, unreadCount: 0 } : current
      );
    } catch (readError) {
      showUiToast({
        tone: 'error',
        title: 'Read status not saved',
        desc:
          readError instanceof Error
            ? readError.message
            : 'The timeline loaded, but its read state could not be saved.',
      });
    } finally {
      if (readInFlightThreadId.current === thread.id) readInFlightThreadId.current = '';
    }
  }, [inspectorOverlay, profileOpen, selectedThread]);

  useEffect(() => {
    const leadId = selectedThread?.leadId;
    if (!leadId) {
      setLeadDetail(null);
      setLeadError('');
      return;
    }
    let cancelled = false;
    setLeadLoading(true);
    setLeadError('');
    void fetchLeadFullRequest(leadId)
      .then((result) => {
        if (!cancelled) setLeadDetail(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setLeadError(error instanceof Error ? error.message : 'Unable to load seller context.');
        }
      })
      .finally(() => {
        if (!cancelled) setLeadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedThread?.leadId]);

  const loadEarlierTimeline = async () => {
    if (!selectedThreadId || !timelineCursor) return;
    const requestThreadId = selectedThreadId;
    setTimelineLoadingMore(true);
    try {
      const response = await fetchConversationTimelineRequest(requestThreadId, {
        cursor: timelineCursor,
        limit: TIMELINE_PAGE_SIZE,
      });
      if (requestThreadId !== selectedThreadIdRef.current) return;
      setTimeline((current) => {
        const merged = new Map(current.map((event) => [event.id, event]));
        for (const event of response.items || []) merged.set(event.id, event);
        return [...merged.values()];
      });
      setTimelineCursor(response.nextCursor || null);
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Earlier activity not loaded',
        desc: error instanceof Error ? error.message : 'Unable to load earlier activity.',
      });
    } finally {
      if (requestThreadId === selectedThreadIdRef.current) setTimelineLoadingMore(false);
    }
  };

  const openMatchLead = (thread: ConversationThread) => {
    matchReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMatchThread(thread);
    setLeadQuery(thread.title || '');
    setLeadMatches([]);
    setSelectedLeadMatch(null);
    setMergeError('');
  };

  const closeMatchLead = useCallback(() => {
    leadSearchSequence.current += 1;
    setMatchThread(null);
    setSelectedLeadMatch(null);
    window.setTimeout(() => matchReturnFocusRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!matchThread) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMatchLead();
        return;
      }
      if (event.key !== 'Tab' || !matchDialogRef.current) return;
      const focusable = Array.from(
        matchDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeMatchLead, matchThread]);

  const searchLeads = async () => {
    if (!leadQuery.trim()) return;
    const requestId = ++leadSearchSequence.current;
    const requestQuery = leadQuery.trim();
    setLeadSearchPending(true);
    setMergeError('');
    try {
      const result = await searchLeadsRequest({ query: requestQuery, limit: 8 });
      if (requestId !== leadSearchSequence.current || requestQuery !== leadQuery.trim()) return;
      setLeadMatches((result.leads || []) as LeadSearchResult[]);
      setSelectedLeadMatch(null);
    } catch (error) {
      if (requestId !== leadSearchSequence.current) return;
      setMergeError(error instanceof Error ? error.message : 'Lead search failed.');
    } finally {
      if (requestId === leadSearchSequence.current) setLeadSearchPending(false);
    }
  };

  const mergeWithLeadThread = async (lead: LeadSearchResult) => {
    if (!matchThread) return;
    const leadId = getLeadResultId(lead);
    if (!leadId) return;
    setMergePendingId(leadId);
    setMergeError('');
    try {
      const candidates = await fetchConversationsRequest({
        leadId,
        limit: 20,
      });
      const canonical = (candidates.items || []).find(
        (thread) => thread.leadId === leadId && thread.id !== matchThread.id
      );
      if (!canonical) {
        throw new Error(
          'This lead has no canonical conversation thread yet. Open the lead portal and start the first message before merging.'
        );
      }
      await mergeConversationThreadsRequest(canonical.id, matchThread.id);
      closeMatchLead();
      setSelectedThreadInUrl(canonical.id);
      await loadThreadPage();
      showUiToast({
        tone: 'success',
        title: 'Conversation matched',
        desc: `${getLeadResultName(lead)} now owns this seller timeline.`,
      });
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : 'Unable to merge the conversation.');
    } finally {
      setMergePendingId('');
    }
  };

  const mobileState = getConversationMobileState({
    threadId: selectedThreadId,
    profileOpen,
  });

  return (
    <div
      className={`pbk-unified-inbox ${profileOpen ? 'profile-open' : ''}`}
      data-mobile-state={mobileState}
    >
      {degradedReason && (
        <div className="pbk-conversation-degraded" role="status">
          <AlertTriangle size={15} />
          <span>
            Conversation Postgres is unavailable or degraded. PBK is showing only confirmed bridge
            results: {degradedReason}
          </span>
        </div>
      )}

      <div className="pbk-unified-inbox-grid">
        <ConversationThreadRail
          threads={visibleThreads}
          selectedThreadId={selectedThreadId}
          search={search}
          activeFilter={activeFilter}
          loading={threadLoading}
          loadingMore={threadLoadingMore}
          error={threadError}
          hasMore={Boolean(threadCursor)}
          onSearchChange={(value) => {
            threadRequestSequence.current += 1;
            setThreadLoading(true);
            setSearch(value);
            setSelectedThreadInUrl('');
          }}
          onFilterChange={(filter) => {
            threadRequestSequence.current += 1;
            setThreadLoading(true);
            setActiveFilter(filter);
            setSelectedThreadInUrl('');
          }}
          onSelect={(thread) => {
            setSelectedThreadInUrl(thread.id);
            if (typeof window !== 'undefined' && window.innerWidth < 1180) setProfileOpen(false);
          }}
          onLoadMore={() =>
            void loadThreadPage({ append: true, cursor: threadCursor || '' })
          }
          onRetry={() => void loadThreadPage()}
          onMatchUnknown={openMatchLead}
        />

        <div className="pbk-conversation-main">
          <div className="pbk-conversation-main-actions">
            <button
              type="button"
              className="mobile-back"
              onClick={() => setSelectedThreadInUrl('')}
              aria-label="Back to conversations"
            >
              <ArrowLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => void loadSelectedThread()}
              disabled={!selectedThreadId || timelineLoading}
              aria-label="Refresh selected conversation"
            >
              <RefreshCw size={15} className={timelineLoading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => setProfileOpen((value) => !value)}
              disabled={!selectedThread}
              aria-label={profileOpen ? 'Close seller profile' : 'Open seller profile'}
            >
              {profileOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            </button>
          </div>
          <ConversationTimeline
            thread={selectedThread}
            events={timeline}
            loading={timelineLoading}
            loadingMore={timelineLoadingMore}
            error={timelineError}
            hasMore={Boolean(timelineCursor)}
            onRetry={() => void loadSelectedThread()}
            onLoadMore={() => void loadEarlierTimeline()}
            onOpenProfile={() => setProfileOpen(true)}
            onLatestSeen={() => void markSelectedThreadRead()}
            onEventChanged={() => void loadSelectedThread()}
          />
          {selectedThread && (
            <ConversationComposer
              key={selectedThread.id}
              thread={selectedThread}
              lead={leadDetail}
              recipientSummary={recipientSummary}
              events={timeline}
              onSent={() => void loadSelectedThread({ quiet: true })}
            />
          )}
          <LiveCallPip
            calls={snapshot?.calls || []}
            leadId={selectedThread?.leadId}
            leadName={selectedThread?.title}
            phone={recipientSummary?.phone}
            address={text(
              record(leadDetail).address ||
                record(record(leadDetail).property).address ||
                record(selectedThread?.property).address
            )}
            onChanged={() => {
              void refreshRuntime();
              void loadSelectedThread({ quiet: true });
            }}
          />
        </div>

        <LeadContextInspector
          open={profileOpen}
          thread={selectedThread}
          lead={leadDetail}
          loading={leadLoading}
          error={leadError}
          onClose={() => setProfileOpen(false)}
        />
      </div>

      {matchThread && (
        <div className="pbk-conversation-match-backdrop" role="presentation">
          <section
            ref={matchDialogRef}
            className="pbk-conversation-match-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="match-lead-title"
          >
            <header>
              <div>
                <div className="pbk-eyebrow">Unknown contact</div>
                <h2 id="match-lead-title">Match this conversation to a lead</h2>
                <p>
                  PBK will merge only after you confirm an existing lead thread. Provider history
                  remains intact.
                </p>
              </div>
              <button type="button" onClick={closeMatchLead} aria-label="Close matching">
                <X size={17} />
              </button>
            </header>
            <div className="pbk-conversation-match-search">
              <Search size={15} aria-hidden="true" />
              <label className="sr-only" htmlFor="conversation-lead-search">
                Search for an existing lead
              </label>
              <input
                id="conversation-lead-search"
                value={leadQuery}
                onChange={(event) => {
                  leadSearchSequence.current += 1;
                  setLeadQuery(event.target.value);
                  setLeadMatches([]);
                  setSelectedLeadMatch(null);
                  setLeadSearchPending(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void searchLeads();
                }}
                placeholder="Seller, address, phone, email..."
                autoFocus
              />
              <button type="button" onClick={() => void searchLeads()} disabled={leadSearchPending}>
                {leadSearchPending && <Loader2 size={14} className="animate-spin" />}
                Search
              </button>
            </div>
            {mergeError && (
              <div className="pbk-conversation-match-error" role="alert">
                {mergeError}
              </div>
            )}
            <div className="pbk-conversation-match-results">
              {leadMatches.map((lead) => {
                const leadId = getLeadResultId(lead);
                return (
                  <button
                    key={leadId || getLeadResultName(lead)}
                    type="button"
                    onClick={() => setSelectedLeadMatch(lead)}
                    disabled={!leadId || Boolean(mergePendingId)}
                    aria-pressed={getLeadResultId(selectedLeadMatch || {}) === leadId}
                  >
                    <span>
                      <UserRoundCheck size={16} />
                    </span>
                    <span>
                      <strong>{getLeadResultName(lead)}</strong>
                      <small>{getLeadResultAddress(lead)}</small>
                    </span>
                    <CheckCircle2 size={15} />
                  </button>
                );
              })}
              {!leadSearchPending && leadQuery && !leadMatches.length && !mergeError && (
                <p>No ranked lead matches yet.</p>
              )}
            </div>
            {selectedLeadMatch && (
              <div className="pbk-conversation-merge-confirm" role="group" aria-label="Confirm match">
                <div>
                  <strong>Merge into {getLeadResultName(selectedLeadMatch)}?</strong>
                  <span>
                    This preserves provider history and moves this provisional thread into the
                    lead's canonical timeline.
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelectedLeadMatch(null)}
                  disabled={Boolean(mergePendingId)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void mergeWithLeadThread(selectedLeadMatch)}
                  disabled={Boolean(mergePendingId)}
                >
                  {mergePendingId && <Loader2 size={14} className="animate-spin" />}
                  Confirm merge
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
