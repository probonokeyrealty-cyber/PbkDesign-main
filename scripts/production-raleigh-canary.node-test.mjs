import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPublicMarketClaims } from './lib/public-market-claims.mjs';
import { createRaleighClaim, isFreshRaleighApproval, isRaleighCanaryArmed } from './lib/production-raleigh-canary.mjs';

test('production fails closed for missing, excessive or expired windows and old approvals', () => {
  const now = Date.now();
  const env = {
    PBK_PRODUCTION_RALEIGH_CANARY_ENABLED: 'true',
    PBK_PRODUCTION_RALEIGH_CANARY_EXPIRES_AT: new Date(now + 600_000).toISOString(),
  };
  assert.equal(isRaleighCanaryArmed({}, now), false);
  assert.equal(isRaleighCanaryArmed(env, now - 600_001), false);
  assert.equal(isRaleighCanaryArmed(env, now + 600_000), false);
  assert.equal(isRaleighCanaryArmed(env, now), true);
  const task = { payload: { market: 'Raleigh, NC' }, createdAt: new Date(now - 250).toISOString() };
  assert.equal(isFreshRaleighApproval(task, env, now), true);
  assert.equal(isFreshRaleighApproval(task, env, now + 300_000), false);
});

test('a new approval and process cannot reclaim the Raleigh attempt after the lease expires', async () => {
  const testDirectory = await mkdtemp(path.join(tmpdir(), 'pbk-raleigh-claim-'));
  try {
    let now = 1000;
    const newProcessClaim = () => createRaleighClaim(
      createPublicMarketClaims({ testDirectory, now: () => now }).claim, () => true);
    assert.equal(await newProcessClaim()('first-approval'), true);
    now += 300_001;
    assert.equal(await newProcessClaim()('another-approval'), false);
  } finally {
    await rm(testDirectory, { recursive: true });
  }
});
