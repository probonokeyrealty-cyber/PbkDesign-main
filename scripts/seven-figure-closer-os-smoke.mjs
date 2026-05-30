import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/20260529017000_pbk_7figure_closer_os.sql');
const sql = readFileSync(migrationPath, 'utf8');

const objectionIds = [...sql.matchAll(/00000000-0000-7000-8000-0000000000\d{2}/g)].map((match) => match[0]);
const uniqueObjectionIds = new Set(objectionIds);
assert.equal(uniqueObjectionIds.size, 10, '7-Figure Closer OS migration should seed 10 objection tracks.');

const probeIds = [...sql.matchAll(/7figure-pain-probe-layer-\d/g)].map((match) => match[0]);
const uniqueProbeIds = new Set(probeIds);
assert.equal(uniqueProbeIds.size, 4, '7-Figure Closer OS migration should seed the 4-layer pain probe.');

assert.match(sql, /ON CONFLICT \(id\) DO UPDATE/g, '7-Figure Closer OS migration should be idempotent by deterministic ids.');
const sourceLabels = sql.match(/'7figure_closer_os'/g) || [];
assert.equal(sourceLabels.length, 14, '7-Figure Closer OS migration should label all 10 memories and 4 probes with the source.');

console.log('[seven-figure-closer-os-smoke] ok');
