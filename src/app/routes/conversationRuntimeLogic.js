function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function timestamp(value) {
  const parsed = Date.parse(cleanText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function threadActivityTime(thread = {}) {
  return timestamp(
    thread.lastEventAt ||
      thread.lastInboundAt ||
      thread.lastOutboundAt ||
      thread.updatedAt ||
      thread.createdAt
  );
}

export function sortConversationThreads(threads = []) {
  return [...asArray(threads)].sort(
    (left, right) =>
      threadActivityTime(right) - threadActivityTime(left) ||
      cleanText(left?.id).localeCompare(cleanText(right?.id))
  );
}

export function normalizeConversationThreads(threads = []) {
  const byThreadId = new Map();
  for (const rawThread of asArray(threads)) {
    const thread = { ...asObject(rawThread) };
    const id = cleanText(thread.id);
    if (!id) continue;
    const current = byThreadId.get(id);
    if (!current || threadActivityTime(thread) >= threadActivityTime(current)) {
      byThreadId.set(id, thread);
    }
  }
  return sortConversationThreads([...byThreadId.values()]);
}

function resolvedTimeZone(timeZone) {
  const candidate = cleanText(timeZone, 'UTC');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return 'UTC';
  }
}

export function filterVisibleConversationEvents(events = [], { includeHidden = false } = {}) {
  return asArray(events)
    .filter((event) => includeHidden || !event?.hiddenAt)
    .map((event) => ({ ...asObject(event) }));
}

function calendarDayKey(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dayLabel(key, timeZone) {
  if (key === 'unknown') return 'Unknown date';
  const date = new Date(`${key}T12:00:00.000Z`);
  return date.toLocaleDateString([], {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function groupConversationEventsByDay(events = [], options = {}) {
  const timeZone = resolvedTimeZone(options.timeZone);
  const visible = filterVisibleConversationEvents(events, options).sort(
    (left, right) =>
      timestamp(left.occurredAt || left.createdAt) -
        timestamp(right.occurredAt || right.createdAt) ||
      cleanText(left.id).localeCompare(cleanText(right.id))
  );
  const groups = new Map();
  for (const event of visible) {
    const key = calendarDayKey(event.occurredAt || event.createdAt, timeZone);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: dayLabel(key, timeZone),
        events: [],
      });
    }
    groups.get(key).events.push(event);
  }
  return [...groups.values()];
}

export function filterSenderIdentitiesForChannel(identities = [], channel = '') {
  const selectedChannel = cleanText(channel).toLowerCase();
  return asArray(identities)
    .filter(
      (identity) =>
        !selectedChannel || cleanText(identity?.channel).toLowerCase() === selectedChannel
    )
    .map((identity) => ({ ...asObject(identity) }));
}

export function getSenderRestrictionReason(identity = {}) {
  const lifecycleStatus = cleanText(identity.lifecycleStatus || 'quarantined').toLowerCase();
  if (lifecycleStatus !== 'active') {
    return `Sender is ${lifecycleStatus.replace(/_/g, ' ')}.`;
  }

  const healthStatus = cleanText(identity.healthStatus).toLowerCase().replace(/[\s-]+/g, '_');
  if (
    /(?:^|_)(?:blocked|quarantined|error|failed|failure|banned|suspended|disabled|disconnected|retired|released|release_pending|sending_error|connection_error|soft_bounce|permanent_suspension)(?:_|$)/.test(
      healthStatus
    )
  ) {
    return `Provider health is ${healthStatus.replace(/_/g, ' ')}.`;
  }
  return '';
}

export function getConversationMobileState({
  threadId = '',
  selectedThreadId = '',
  profileOpen = false,
} = {}) {
  if (profileOpen && (threadId || selectedThreadId)) return 'profile';
  if (threadId || selectedThreadId) return 'conversation';
  return 'threads';
}

export function getConversationPreview(thread = {}, maxLength = 96) {
  const latestEvent = asObject(thread.latestEvent);
  const payload = asObject(latestEvent.payload);
  const transcript = payload.transcript;
  const transcriptText = Array.isArray(transcript)
    ? transcript
        .map((entry) => {
          const item = asObject(entry);
          return cleanText(item.text || item.word || item.transcript || entry);
        })
        .filter(Boolean)
        .join(' ')
    : typeof transcript === 'object'
      ? cleanText(
          asObject(transcript).text ||
            asObject(transcript).summary ||
            asObject(transcript).transcript
        )
      : cleanText(transcript);
  const candidate =
    cleanText(latestEvent.body) ||
    cleanText(latestEvent.subject) ||
    cleanText(payload.summary) ||
    transcriptText ||
    cleanText(thread.preview) ||
    cleanText(thread.title) ||
    cleanText(latestEvent.eventType).replace(/_/g, ' ');
  if (candidate.length <= maxLength) return candidate;
  return `${candidate.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}
