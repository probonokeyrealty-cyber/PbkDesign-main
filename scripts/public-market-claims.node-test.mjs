import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createPublicMarketClaims } from './lib/public-market-claims.mjs';

test('separate journal survives restart, stale snapshots and the active worker quarantine', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pbk-market-claims-'));
  let now = 1000;
  try {
    const make = () => createPublicMarketClaims({ testDirectory: dir, now: () => now });
    assert.equal(await make().claim('job-a'), true);
    assert.equal(await make().claim('job-b'), false);
    now += 300001;
    assert.equal(await make().claim('job-a'), false);
    assert.equal(await make().claim('job-b'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Postgres claims use a separate permanent unique record and transactional global lease', async () => {
  const db = new PGlite();
  let locks = 0;
  const pool = {
    connect: async () => ({
      query: (sql, args) =>
        sql.includes('pg_advisory_xact_lock')
          ? (locks++, Promise.resolve({ rows: [] }))
          : db.query(sql, args),
      release() {},
    }),
  };
  try {
    assert.equal(await createPublicMarketClaims({ getPool: () => pool }).claim('job-a'), true);
    assert.equal(await createPublicMarketClaims({ getPool: () => pool }).claim('job-b'), false);
    await db.query("UPDATE pbk_public_market_claims SET expires_at=NOW()-INTERVAL '1 second'");
    assert.equal(await createPublicMarketClaims({ getPool: () => pool }).claim('job-a'), false);
    assert.equal(await createPublicMarketClaims({ getPool: () => pool }).claim('job-b'), true);
    assert.equal(locks, 4);
  } finally {
    await db.close();
  }
});

test('hosted claims fail closed without Postgres', async () => {
  await assert.rejects(
    () => createPublicMarketClaims().claim('job-a'),
    /durable_claims_unavailable/
  );
});
