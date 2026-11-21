import { validRecordingObjectVersion } from '../recording-retention-authorization.mjs';

export const retentionStorageOrigin = 'https://retention-storage.invalid';
export const retentionStorageBucket = 'retention-fixture';
export const retentionStorageFixtureFlag = '--recording-retention-storage-fixture';
const prefix = `/storage/v1/object`;
export const retentionWriterFixtureKey = 'fixture/retention-writer.txt';
const fixtureKeys = new Set([
  'fixture/retention-approved.txt', 'fixture/retention-race.txt',
  'fixture/retention-interrupted.txt', 'fixture/retention-later.txt',
  'fixture/retention-pointer-rollback.txt',
  retentionWriterFixtureKey,
]);

export function isRetentionStorageRequest({ url, method, body } = {}) {
  if (typeof url !== 'string' || !url.startsWith(`${retentionStorageOrigin}/`)) return false;
  if (method === 'GET') {
    const info = `${retentionStorageOrigin}${prefix}/info/authenticated/${retentionStorageBucket}/`;
    return !body && url.startsWith(info) && fixtureKeys.has(url.slice(info.length));
  }
  const writer = `${retentionStorageOrigin}${prefix}/${retentionStorageBucket}/${retentionWriterFixtureKey}`;
  if (url === writer && method === 'PUT') return body === 'synthetic writer first' || body === 'synthetic writer second';
  if (url === writer && method === 'DELETE') return body === undefined;
  if (method !== 'DELETE' || url !== `${retentionStorageOrigin}${prefix}/${retentionStorageBucket}` ||
      typeof body !== 'string' || body.length > 512) return false;
  try {
    const request = JSON.parse(body);
    if (Object.keys(request).length !== 1 || !Array.isArray(request.prefixes) || request.prefixes.length !== 1) return false;
    const [entry] = request.prefixes;
    return Object.keys(entry).length === 2 && fixtureKeys.has(entry.path) && validRecordingObjectVersion(entry.versionId);
  } catch {
    return false;
  }
}
