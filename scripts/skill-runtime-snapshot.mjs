import { createHash } from 'node:crypto';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function checksumSnapshotPayload(snapshot = {}) {
  const payload = jsonClone({
    schemaVersion: Number(snapshot.schemaVersion || 1),
    generatedAt: snapshot.generatedAt || '',
    authority: snapshot.authority || 'render-postgres',
    skills: Array.isArray(snapshot.skills) ? snapshot.skills : [],
  });
  return createHash('sha256')
    .update(canonicalJson(payload))
    .digest('hex');
}

function normalizeSnapshot(snapshot, now) {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      available: false,
      source: 'none',
      reason: 'snapshot_unavailable',
      generatedAt: null,
      ageSeconds: null,
      skills: [],
    };
  }
  const checksum = checksumSnapshotPayload(snapshot);
  if (!snapshot.checksum || snapshot.checksum !== checksum) {
    return {
      available: false,
      source: 'none',
      reason: 'snapshot_checksum_invalid',
      generatedAt: null,
      ageSeconds: null,
      skills: [],
    };
  }
  const generatedAt = snapshot.generatedAt || null;
  const generatedTime = generatedAt ? new Date(generatedAt).getTime() : Number.NaN;
  return {
    ...snapshot,
    available: true,
    source: 'last-known-good-render',
    ageSeconds: Number.isFinite(generatedTime)
      ? Math.max(0, Math.floor((now().getTime() - generatedTime) / 1000))
      : null,
    skills: Array.isArray(snapshot.skills) ? snapshot.skills : [],
  };
}

export function createSkillRuntimeSnapshotCache({
  redisGet,
  redisSet,
  readText,
  writeText,
  redisKey,
  filePath,
  now = () => new Date(),
} = {}) {
  async function save(skills = []) {
    const snapshot = {
      schemaVersion: 1,
      authority: 'render-postgres',
      generatedAt: now().toISOString(),
      skills: jsonClone(Array.isArray(skills) ? skills : []),
    };
    snapshot.checksum = checksumSnapshotPayload(snapshot);
    const redisPayload = structuredClone(snapshot);
    await redisSet?.(redisKey, redisPayload);
    await writeText?.(filePath, JSON.stringify(snapshot, null, 2));
    return snapshot;
  }

  async function load() {
    let invalidReason = '';
    const redisSnapshot = await redisGet?.(redisKey);
    if (redisSnapshot) {
      const normalized = normalizeSnapshot(redisSnapshot, now);
      if (normalized.available) return normalized;
      invalidReason = normalized.reason;
    }
    try {
      const raw = await readText?.(filePath);
      if (raw) {
        const normalized = normalizeSnapshot(JSON.parse(raw), now);
        if (normalized.available) return normalized;
        invalidReason = normalized.reason;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') invalidReason = 'snapshot_read_failed';
    }
    return {
      available: false,
      source: 'none',
      reason: invalidReason || 'snapshot_unavailable',
      generatedAt: null,
      ageSeconds: null,
      skills: [],
    };
  }

  return { load, save };
}
