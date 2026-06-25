import { describe, expect, test } from '@jest/globals';

import { createSkillRuntimeSnapshotCache } from './skill-runtime-snapshot.mjs';

function createMemoryAdapters() {
  const values = new Map();
  return {
    values,
    async redisGet(key) {
      return values.get(`redis:${key}`) || null;
    },
    async redisSet(key, value) {
      values.set(`redis:${key}`, value);
    },
    async readText(filePath) {
      const value = values.get(`file:${filePath}`);
      if (value == null) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return value;
    },
    async writeText(filePath, value) {
      values.set(`file:${filePath}`, value);
    },
  };
}

describe('skill runtime snapshot cache', () => {
  test('saves and loads an approved snapshot with checksum validation', async () => {
    const adapters = createMemoryAdapters();
    const cache = createSkillRuntimeSnapshotCache({
      ...adapters,
      redisKey: 'pbk:skill-runtime-snapshot',
      filePath: 'approved-skills.json',
      now: () => new Date('2026-06-09T12:00:00.000Z'),
    });
    const skills = [
      {
        versionId: 'version-1',
        contentHash: 'hash-1',
        name: 'Price gap discovery',
        lifecycleState: 'active',
        status: 'active',
      },
    ];

    const saved = await cache.save(skills);
    const loaded = await cache.load();

    expect(saved.checksum).toHaveLength(64);
    expect(loaded.available).toBe(true);
    expect(loaded.source).toBe('last-known-good-render');
    expect(loaded.generatedAt).toBe('2026-06-09T12:00:00.000Z');
    expect(loaded.skills).toEqual(skills);
  });

  test('rejects a snapshot whose approved payload was changed', async () => {
    const adapters = createMemoryAdapters();
    const cache = createSkillRuntimeSnapshotCache({
      ...adapters,
      redisKey: 'pbk:skill-runtime-snapshot',
      filePath: 'approved-skills.json',
    });
    await cache.save([{ versionId: 'version-1', contentHash: 'hash-1' }]);

    const stored = adapters.values.get('redis:pbk:skill-runtime-snapshot');
    stored.skills[0].contentHash = 'tampered';
    adapters.values.set('redis:pbk:skill-runtime-snapshot', stored);
    adapters.values.set('file:approved-skills.json', JSON.stringify(stored));

    const loaded = await cache.load();

    expect(loaded.available).toBe(false);
    expect(loaded.reason).toBe('snapshot_checksum_invalid');
    expect(loaded.skills).toEqual([]);
  });

  test('preserves checksum validity after JSON drops undefined skill fields', async () => {
    const adapters = createMemoryAdapters();
    const cache = createSkillRuntimeSnapshotCache({
      ...adapters,
      redisKey: 'pbk:skill-runtime-snapshot',
      filePath: 'approved-skills.json',
      now: () => new Date('2026-06-09T12:00:00.000Z'),
    });

    await cache.save([
      {
        versionId: 'version-1',
        contentHash: 'hash-1',
        name: 'Price gap discovery',
        optionalAssignmentId: undefined,
      },
    ]);

    const stored = adapters.values.get('redis:pbk:skill-runtime-snapshot');
    adapters.values.set(
      'redis:pbk:skill-runtime-snapshot',
      JSON.parse(JSON.stringify(stored))
    );

    const loaded = await cache.load();

    expect(loaded.available).toBe(true);
    expect(loaded.skills[0]).not.toHaveProperty('optionalAssignmentId');
  });

  test('still writes the last-known-good file when Redis save fails', async () => {
    const adapters = createMemoryAdapters();
    const cache = createSkillRuntimeSnapshotCache({
      ...adapters,
      async redisSet() {
        throw new Error('redis unavailable');
      },
      redisKey: 'pbk:skill-runtime-snapshot',
      filePath: 'approved-skills.json',
      now: () => new Date('2026-06-09T12:00:00.000Z'),
    });

    const saved = await cache.save([{ versionId: 'version-2', contentHash: 'hash-2' }]);
    const loaded = await cache.load();

    expect(saved.persistence.redis).toBe(false);
    expect(saved.persistence.file).toBe(true);
    expect(saved.persistence.warnings[0]).toContain('redis:');
    expect(loaded.available).toBe(true);
    expect(loaded.skills[0].versionId).toBe('version-2');
  });
});
