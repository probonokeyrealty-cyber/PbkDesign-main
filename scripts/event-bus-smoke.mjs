import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EventTypes,
  consumeOnce,
  createEventBus,
  getEventBusStatus,
  publishEvent,
} from './event-bus/streams.mjs';

async function main() {
  const bus = createEventBus({
    mode: 'memory',
    streamName: 'pbk:test-events',
    consumerGroup: 'pbk-test-consumers',
    consumerName: 'pbk-smoke',
  });

  const published = await publishEvent(EventTypes.TOOL_INVOKED, {
    toolName: 'analyzeDeal',
    ok: true,
  }, 'event-bus-smoke', { bus });

  assert.equal(published.ok, true, 'memory event publish should succeed.');
  assert.equal(published.eventType, EventTypes.TOOL_INVOKED);
  assert.match(published.id, /^mem-/);

  const handled = [];
  const consumed = await consumeOnce(async (event) => {
    handled.push(event);
  }, { bus, batchSize: 5, blockMs: 10 });

  assert.equal(consumed.ok, true, 'consumeOnce should return ok.');
  assert.equal(consumed.processed, 1, 'consumeOnce should process exactly one event.');
  assert.equal(handled.length, 1, 'handler should receive the event.');
  assert.equal(handled[0].type, EventTypes.TOOL_INVOKED);
  assert.equal(handled[0].payload.toolName, 'analyzeDeal');

  const deadLetters = [];
  await publishEvent(EventTypes.QA_VALIDATION_FAILED, { toolName: 'sendDocuSign' }, 'event-bus-smoke', { bus });
  const failed = await consumeOnce(async () => {
    throw new Error('expected handler failure');
  }, {
    bus,
    deadLetterSink: async (record) => deadLetters.push(record),
    batchSize: 5,
    blockMs: 10,
  });

  assert.equal(failed.ok, true, 'failed handler should still be acknowledged after dead-letter.');
  assert.equal(failed.failed, 1, 'consumeOnce should report failed event count.');
  assert.equal(deadLetters.length, 1, 'dead-letter sink should receive failed event.');
  assert.equal(deadLetters[0].eventType, EventTypes.QA_VALIDATION_FAILED);
  assert.match(deadLetters[0].error, /expected handler failure/);

  const status = await getEventBusStatus({ bus });
  assert.equal(status.configured, true);
  assert.equal(status.mode, 'memory');
  assert.equal(status.streamName, 'pbk:test-events');

  const redisState = {
    reads: [],
    acknowledgements: [],
    adds: [],
    claimStarts: [],
    deliveryCounts: new Map(),
  };
  const redisClient = {
    isOpen: true,
    async xGroupCreate() {
      return 'OK';
    },
    async xAdd(...args) {
      redisState.adds.push(args);
      return '1710000000000-0';
    },
    async xAutoClaim(_stream, _group, _consumer, _idleMs, startId) {
      redisState.claimStarts.push(startId);
      return {
        nextId: startId === '0-0' ? '1-0' : '0-0',
        messages: [],
        deletedMessages: [],
      };
    },
    async xReadGroup() {
      const message = redisState.reads.shift();
      return message
        ? [{ name: 'pbk:test-redis-events', messages: [message] }]
        : null;
    },
    async xAck(_stream, _group, id) {
      redisState.acknowledgements.push(id);
      return 1;
    },
    async xLen() {
      return redisState.reads.length;
    },
    async xPending() {
      return { pending: 0 };
    },
    async xPendingRange(_stream, _group, startId) {
      return [{
        id: startId,
        deliveriesCounter: redisState.deliveryCounts.get(startId) || 3,
      }];
    },
  };
  const redisBus = createEventBus({
    mode: 'redis',
    redisUrl: 'redis://test',
    redisClient,
    streamName: 'pbk:test-redis-events',
    consumerGroup: 'pbk-test-consumers',
    consumerName: 'pbk-test-consumer',
    reclaimIdleMs: 120_000,
  });

  await publishEvent(
    EventTypes.TOOL_INVOKED,
    { toolName: 'analyzeDeal' },
    'event-bus-smoke',
    { bus: redisBus },
  );
  assert.equal(redisState.adds[0].length, 3);
  assert.equal(
    redisState.adds[0][2].type,
    EventTypes.TOOL_INVOKED,
    'Redis stream publishing should append without destructive MAXLEN trimming.',
  );

  redisState.reads.push({
    id: '1710000000001-0',
    message: {
      type: EventTypes.QA_VALIDATION_FAILED,
      payload: JSON.stringify({ toolName: 'sendDocuSign' }),
      source: 'event-bus-smoke',
      timestamp: String(Date.now()),
    },
  });
  const deferred = await consumeOnce(
    async () => {
      throw new Error('retry this event');
    },
    {
      bus: redisBus,
      deadLetterSink: async () => ({ ok: false, reason: 'postgres_unavailable' }),
      blockMs: 1,
    },
  );
  assert.equal(deferred.deferred, 1, 'Failed dead-letter writes should defer acknowledgement.');
  assert.equal(
    redisState.acknowledgements.includes('1710000000001-0'),
    false,
    'An event must remain pending when dead-letter persistence fails.',
  );
  assert.equal(redisState.claimStarts[0], '0-0');

  redisState.deliveryCounts.set('1710000000001-retry', 1);
  redisState.reads.push({
    id: '1710000000001-retry',
    message: {
      type: EventTypes.QA_VALIDATION_FAILED,
      payload: JSON.stringify({ toolName: 'sendDocuSign' }),
      source: 'event-bus-smoke',
      timestamp: String(Date.now()),
    },
  });
  let transientDeadLetters = 0;
  const transientFailure = await consumeOnce(
    async () => {
      throw new Error('temporary provider outage');
    },
    {
      bus: redisBus,
      deadLetterSink: async () => {
        transientDeadLetters += 1;
        return { ok: true };
      },
      blockMs: 1,
    },
  );
  assert.equal(transientFailure.deferred, 1);
  assert.equal(transientDeadLetters, 0);
  assert.equal(
    redisState.acknowledgements.includes('1710000000001-retry'),
    false,
    'Transient failures must remain pending until the delivery threshold is reached.',
  );

  redisState.reads.push({
    id: '1710000000002-0',
    message: {
      type: EventTypes.QA_VALIDATION_FAILED,
      payload: JSON.stringify({ toolName: 'sendDocuSign' }),
      source: 'event-bus-smoke',
      timestamp: String(Date.now()),
    },
  });
  const persistedFailure = await consumeOnce(
    async () => {
      throw new Error('dead-letter this event');
    },
    {
      bus: redisBus,
      deadLetterSink: async () => ({ ok: true }),
      blockMs: 1,
    },
  );
  assert.equal(persistedFailure.failed, 1);
  assert.equal(
    redisState.acknowledgements.includes('1710000000002-0'),
    true,
    'An event may be acknowledged after durable dead-letter persistence.',
  );
  assert.equal(
    redisState.claimStarts[1],
    '1-0',
    'Pending reclaim scans should continue from the cursor returned by XAUTOCLAIM.',
  );

  const workerSource = await readFile(new URL('./event-worker.mjs', import.meta.url), 'utf8');
  assert(
    /PBK_EVENT_WORKER_BRIDGE_TIMEOUT_MS/.test(workerSource) &&
      /body\.ok === false/.test(workerSource) &&
      /body\.skipped === true/.test(workerSource) &&
      /nestedResult\?\.ok === false/.test(workerSource),
    'The event worker must bound bridge latency and reject application-level tool failures.',
  );
  assert(
    /allowFailureResults:\s*\['insufficient_call_memory'\]/.test(workerSource),
    'Known non-fatal embedding skips should remain explicitly allowlisted.',
  );
  assert(
    /batchSize:\s*1/.test(workerSource) &&
      /Idempotency-Key/.test(workerSource) &&
      /event_dead_letters_tenant_event_idx/.test(workerSource),
    'The worker must consume one event at a time and make retried side effects and dead letters idempotent.',
  );

  console.log('Event bus smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
