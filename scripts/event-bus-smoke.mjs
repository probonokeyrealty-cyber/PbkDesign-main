import assert from 'node:assert/strict';
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

  console.log('Event bus smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
