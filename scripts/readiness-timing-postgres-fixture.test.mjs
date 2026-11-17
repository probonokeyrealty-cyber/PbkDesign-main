import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createTimingPostgresFixture } from './readiness-timing-postgres-fixture.mjs';

test.each(['snapshot', 'create', 'init', 'init_drop', 'init_drop_end'])
('fixture %s failure preserves the original error and ends its pool exactly once', async stage => {
  const original = new Error(`isolated ${stage} failure`);
  let ends = 0, drops = 0, creates = 0;
  const pool = {
    async query(config) {
      const text = typeof config === 'string' ? config : config.text;
      if (text.startsWith('SELECT to_regclass')) {
        if (stage === 'snapshot') throw original;
        return { rows: [{ table: null }] };
      }
      if (text.startsWith('CREATE SCHEMA')) {
        creates++;
        if (stage === 'create') throw original;
        return { rows: [] };
      }
      if (text.startsWith('DROP SCHEMA')) {
        drops++;
        if (stage.includes('drop')) throw new Error('isolated drop failure');
        return { rows: [] };
      }
      throw original;
    },
    async end() { ends++; if (stage.endsWith('_end')) throw new Error('isolated end failure'); },
  };
  await assert.rejects(createTimingPostgresFixture({}, { createPool: () => pool }), error => error === original);
  assert.equal(ends, 1);
  assert.equal(creates, stage === 'snapshot' ? 0 : 1);
  assert.equal(drops, stage.startsWith('init') ? 1 : 0, 'drop only a schema successfully owned by this fixture');
});
