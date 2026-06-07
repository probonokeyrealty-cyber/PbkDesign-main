import { createClient as createRedisClient } from 'redis';
import { EventTypes } from './event-types.mjs';

const DEFAULT_STREAM = 'pbk:events';
const DEFAULT_GROUP = 'pbk-consumers';
const DEFAULT_CONSUMER = `pbk-${process.env.RENDER_SERVICE_ID || process.env.HOSTNAME || process.env.COMPUTERNAME || process.pid}`;
const DEFAULT_NAMESPACE = String(process.env.PBK_REDIS_NAMESPACE || 'pbk-openclaw').trim().replace(/[^a-z0-9:_-]/gi, '-') || 'pbk-openclaw';
const DEFAULT_RECLAIM_IDLE_MS = 10 * 60_000;
const DEFAULT_MAX_DELIVERY_ATTEMPTS = 3;

function normalizeStreamName(value = '') {
  const raw = String(value || DEFAULT_STREAM).trim();
  return raw.includes(':') ? raw : `${DEFAULT_NAMESPACE}:${raw}`;
}

function safeJsonParse(value, fallback = null) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function makeMemoryId() {
  return `mem-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createEventBus(options = {}) {
  const redisUrl = String(options.redisUrl || process.env.PBK_REDIS_URL || process.env.REDIS_URL || process.env.RENDER_REDIS_URL || '').trim();
  const mode = String(options.mode || (redisUrl ? 'redis' : 'disabled')).toLowerCase();
  const memoryQueue = [];
  return {
    mode,
    redisUrl,
    streamName: normalizeStreamName(options.streamName || process.env.PBK_EVENT_STREAM_NAME || DEFAULT_STREAM),
    consumerGroup: String(options.consumerGroup || process.env.PBK_EVENT_CONSUMER_GROUP || DEFAULT_GROUP).trim() || DEFAULT_GROUP,
    consumerName: String(options.consumerName || process.env.PBK_EVENT_CONSUMER_NAME || DEFAULT_CONSUMER).trim() || DEFAULT_CONSUMER,
    reclaimIdleMs: Math.max(
      60_000,
      Number(options.reclaimIdleMs || process.env.PBK_EVENT_RECLAIM_IDLE_MS || DEFAULT_RECLAIM_IDLE_MS),
    ),
    maxDeliveryAttempts: Math.max(
      1,
      Number(options.maxDeliveryAttempts || process.env.PBK_EVENT_MAX_DELIVERY_ATTEMPTS || DEFAULT_MAX_DELIVERY_ATTEMPTS),
    ),
    reclaimCursor: '0-0',
    redisClient: options.redisClient || null,
    redisClientFactory: options.redisClientFactory || createRedisClient,
    connected: false,
    groupReady: false,
    memoryQueue,
  };
}

let defaultBus = null;

export function getDefaultEventBus() {
  if (!defaultBus) defaultBus = createEventBus();
  return defaultBus;
}

async function getRedisClient(bus) {
  if (!bus || bus.mode !== 'redis' || !bus.redisUrl) return null;
  if (bus.redisClient?.isOpen) return bus.redisClient;
  if (!bus.redisClient) {
    bus.redisClient = bus.redisClientFactory({
      url: bus.redisUrl,
      socket: {
        reconnectStrategy: (retries) => Math.min(1000 * retries, 10_000),
      },
    });
    bus.redisClient.on?.('error', (error) => {
      console.warn('[pbk-event-bus] Redis error:', error?.message || error);
    });
  }
  if (!bus.redisClient.isOpen) await bus.redisClient.connect();
  bus.connected = true;
  return bus.redisClient;
}

async function ensureConsumerGroup(bus) {
  if (bus.groupReady || bus.mode !== 'redis') return;
  const client = await getRedisClient(bus);
  if (!client) return;
  try {
    await client.xGroupCreate(bus.streamName, bus.consumerGroup, '0', { MKSTREAM: true });
  } catch (error) {
    if (!/BUSYGROUP/i.test(String(error?.message || error))) throw error;
  }
  bus.groupReady = true;
}

function normalizeRedisMessage(streamName, raw = {}) {
  const fields = raw.message || raw.fields || {};
  const parsedPayload = safeJsonParse(fields.payload || '{}', null);
  return {
    id: raw.id,
    type: fields.type || '',
    payload: parsedPayload && typeof parsedPayload === 'object' ? parsedPayload : {},
    payloadParseError: parsedPayload == null,
    source: fields.source || '',
    timestamp: Number(fields.timestamp || Date.now()),
    streamName,
    raw: fields,
  };
}

async function getMessageDeliveryCount(client, bus, eventId) {
  if (typeof client.xPendingRange !== 'function') return bus.maxDeliveryAttempts;
  try {
    const pending = await client.xPendingRange(
      bus.streamName,
      bus.consumerGroup,
      eventId,
      eventId,
      1,
    );
    const record = Array.isArray(pending) ? pending[0] : null;
    return Math.max(
      1,
      Number(record?.deliveriesCounter ?? record?.deliveryCount ?? record?.deliveries ?? 1) || 1,
    );
  } catch (error) {
    console.warn('[pbk-event-bus] Pending delivery count lookup skipped:', error?.message || error);
    return bus.maxDeliveryAttempts;
  }
}

export async function publishEvent(type, payload = {}, source = 'bridge', options = {}) {
  const bus = options.bus || getDefaultEventBus();
  const eventType = String(type || '').trim();
  if (!eventType) return { ok: false, result: 'event_type_required' };

  if (bus.mode === 'memory') {
    const id = makeMemoryId();
    bus.memoryQueue.push({
      id,
      type: eventType,
      payload: payload && typeof payload === 'object' ? payload : { value: payload },
      source,
      timestamp: Date.now(),
      streamName: bus.streamName,
    });
    return { ok: true, result: 'event_published', mode: 'memory', id, eventId: id, eventType };
  }

  if (bus.mode !== 'redis' || !bus.redisUrl) {
    return {
      ok: false,
      skipped: true,
      result: 'event_bus_disabled',
      reason: 'PBK_REDIS_URL is not configured.',
      eventType,
    };
  }

  const client = await getRedisClient(bus);
  const id = await client.xAdd(bus.streamName, '*', {
    type: eventType,
    payload: JSON.stringify(payload && typeof payload === 'object' ? payload : { value: payload }),
    source: String(source || 'bridge'),
    timestamp: String(Date.now()),
  });
  return { ok: true, result: 'event_published', mode: 'redis', id, eventId: id, eventType, streamName: bus.streamName };
}

async function deadLetter(event, error, options = {}) {
  const record = {
    eventId: event.id,
    event_id: event.id,
    eventType: event.type,
    event_type: event.type,
    payload: event.payload || {},
    source: event.source || '',
    error: error?.message || String(error),
    stack: error?.stack || '',
    createdAt: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  const sinkResult =
    typeof options.deadLetterSink === 'function'
      ? await options.deadLetterSink(record)
      : null;
  return {
    ok: typeof options.deadLetterSink === 'function' && sinkResult?.ok !== false,
    record,
    sinkResult,
  };
}

async function consumeMemoryOnce(handler, options = {}) {
  const bus = options.bus;
  const batch = bus.memoryQueue.splice(0, Math.max(1, Number(options.batchSize || 10)));
  let processed = 0;
  let failed = 0;
  for (const event of batch) {
    try {
      await handler(event);
      processed += 1;
    } catch (error) {
      failed += 1;
      await deadLetter(event, error, options);
    }
  }
  return { ok: true, result: 'events_consumed', mode: 'memory', processed, failed };
}

async function readClaimedMessages(client, bus, batchSize) {
  if (typeof client.xAutoClaim !== 'function') return [];
  try {
    const startId = String(bus.reclaimCursor || '0-0');
    const claimed = await client.xAutoClaim(
      bus.streamName,
      bus.consumerGroup,
      bus.consumerName,
      bus.reclaimIdleMs,
      startId,
      { COUNT: batchSize },
    );
    bus.reclaimCursor = String(claimed?.nextId || '0-0');
    return (claimed?.messages || []).filter(Boolean);
  } catch (error) {
    console.warn('[pbk-event-bus] Pending event reclaim skipped:', error?.message || error);
    return [];
  }
}

async function processRedisMessages(client, bus, rawMessages, handler, options = {}) {
  let processed = 0;
  let failed = 0;
  let deferred = 0;
  for (const rawMessage of rawMessages) {
    const event = normalizeRedisMessage(bus.streamName, rawMessage);
    let shouldAcknowledge = false;
    try {
      if (!event.type) throw new Error('Event type is missing.');
      if (event.payloadParseError) throw new Error(`Event ${event.id} contains malformed JSON payload.`);
      await handler(event);
      processed += 1;
      shouldAcknowledge = true;
    } catch (error) {
      failed += 1;
      const deliveryCount = await getMessageDeliveryCount(client, bus, event.id);
      if (deliveryCount < bus.maxDeliveryAttempts) {
        deferred += 1;
        continue;
      }
      try {
        const result = await deadLetter(event, error, options);
        shouldAcknowledge = typeof options.deadLetterSink === 'function' && result?.ok !== false;
      } catch (deadLetterError) {
        console.warn(
          '[pbk-event-bus] Dead-letter persistence failed; event remains pending:',
          deadLetterError?.message || deadLetterError,
        );
      }
      if (!shouldAcknowledge) deferred += 1;
    }
    if (shouldAcknowledge) {
      await client.xAck(bus.streamName, bus.consumerGroup, event.id);
    }
  }
  return { processed, failed, deferred };
}

export async function consumeOnce(handler, options = {}) {
  if (typeof handler !== 'function') throw new Error('Event handler is required.');
  const bus = options.bus || getDefaultEventBus();
  const batchSize = Math.max(1, Math.min(100, Number(options.batchSize || 10)));
  const blockMs = Math.max(0, Math.min(60_000, Number(options.blockMs || 5000)));

  if (bus.mode === 'memory') return consumeMemoryOnce(handler, { ...options, bus, batchSize, blockMs });
  if (bus.mode !== 'redis' || !bus.redisUrl) {
    return { ok: false, skipped: true, result: 'event_bus_disabled', processed: 0, failed: 0 };
  }

  await ensureConsumerGroup(bus);
  const client = await getRedisClient(bus);
  const claimedMessages = await readClaimedMessages(client, bus, batchSize);
  if (claimedMessages.length) {
    const claimedResult = await processRedisMessages(
      client,
      bus,
      claimedMessages,
      handler,
      options,
    );
    return {
      ok: true,
      result: 'events_consumed',
      mode: 'redis',
      reclaimed: claimedMessages.length,
      ...claimedResult,
    };
  }
  const streams = await client.xReadGroup(
    bus.consumerGroup,
    bus.consumerName,
    [{ key: bus.streamName, id: '>' }],
    { COUNT: batchSize, BLOCK: blockMs },
  );
  if (!streams) return { ok: true, result: 'no_events', mode: 'redis', processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;
  let deferred = 0;
  for (const stream of streams) {
    const messages = stream.messages || [];
    const result = await processRedisMessages(
      client,
      { ...bus, streamName: stream.name || bus.streamName },
      messages,
      handler,
      options,
    );
    processed += result.processed;
    failed += result.failed;
    deferred += result.deferred;
  }
  return {
    ok: true,
    result: 'events_consumed',
    mode: 'redis',
    processed,
    failed,
    deferred,
  };
}

export async function consumeEvents(handler, options = {}) {
  const bus = options.bus || getDefaultEventBus();
  const signal = options.signal;
  while (!signal?.aborted) {
    const result = await consumeOnce(handler, { ...options, bus });
    if (result?.skipped) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Number(options.blockMs || 5000))));
    }
  }
  return { ok: true, result: 'event_consumer_stopped' };
}

export async function getEventBusStatus(options = {}) {
  const bus = options.bus || getDefaultEventBus();
  let streamLength = 0;
  let pending = 0;
  let backlog = bus.memoryQueue?.length || 0;
  let backlogError = '';
  if (bus.mode === 'redis' && bus.redisUrl) {
    try {
      await ensureConsumerGroup(bus);
      const client = await getRedisClient(bus);
      streamLength = Number(await client.xLen(bus.streamName)) || 0;
      try {
        const pendingInfo = await client.xPending(bus.streamName, bus.consumerGroup);
        pending = Number(pendingInfo?.pending ?? pendingInfo?.count ?? pendingInfo?.total ?? 0) || 0;
      } catch {
        pending = 0;
      }
      backlog = streamLength + pending;
    } catch (error) {
      backlogError = error?.message || String(error);
    }
  }
  return {
    ok: bus.mode === 'memory' || (bus.mode === 'redis' && Boolean(bus.redisUrl)),
    configured: bus.mode === 'memory' || Boolean(bus.redisUrl),
    enabled: bus.mode !== 'disabled',
    mode: bus.mode,
    streamName: bus.streamName,
    consumerGroup: bus.consumerGroup,
    consumerName: bus.consumerName,
    connected: Boolean(bus.connected || bus.redisClient?.isOpen),
    pendingMemoryEvents: bus.memoryQueue?.length || 0,
    streamLength,
    pending,
    backlog,
    backlogError,
    reclaimIdleMs: bus.reclaimIdleMs,
    reclaimCursor: bus.reclaimCursor,
    maxDeliveryAttempts: bus.maxDeliveryAttempts,
  };
}

export { EventTypes };
