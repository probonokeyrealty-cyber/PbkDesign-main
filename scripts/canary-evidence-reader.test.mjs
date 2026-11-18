import { afterEach, expect, jest, test } from '@jest/globals';
import * as reader from './canary-evidence-reader.mjs';
import { CANARY_EVIDENCE_LIMITS as limits, verifyCanaryChain } from './canary-evidence-protocol.mjs';
import { canonicalJson } from './skill-governance-store.mjs';
import { makeCanaryFixture, rebuildCanaryFixture, resignCanaryRow } from './fixtures/canary-evidence-fixture.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const allRows = (f) => [f.comparison, ...f.runs, ...f.observations];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const unavailable = 'canary_evidence_unavailable';
const timeout = 'canary_evidence_timeout';
const invalid = 'canary_evidence_invalid';
const overflow = 'canary_evidence_limit_exceeded';

function fakeStore(f = makeCanaryFixture(), options = {}) {
  const calls = [], clients = [], transfers = [];
  let active = false;
  const snapshots = options.snapshots ?? [allRows(f), allRows(f)];
  const pool = { connect: jest.fn(async () => {
    const index = clients.length;
    if (active) throw new Error('max:1 client is still held');
    active = true;
    const client = {
      release: jest.fn((destroy) => { active = false; options.release?.(index, destroy); }),
      query: jest.fn(async (config) => {
        const call = { ...config, index }; calls.push(call);
        const custom = await options.query?.(call, client);
        if (custom !== undefined) { if (custom.rows) transfers.push(...clone(custom.rows)); return custom; }
        let rows = [];
        if (/FROM public\.pbk_eval_runs/.test(config.text)) {
          const source = clone(snapshots[index] ?? []);
          if (/ORDER BY created_at DESC, id DESC/.test(config.text)) {
            rows = source.filter((r) => r.tenant_id === config.values[0]
              && (r.suite_name === config.values[1] || r.source === config.values[2]))
              .sort((a, b) => b.created_at_exact.localeCompare(a.created_at_exact) || b.id.localeCompare(a.id)).slice(0, 1);
          } else {
            rows = source.filter((r) => r.tenant_id === config.values[0] && config.values[1].includes(r.id))
              .sort((a, b) => a.id.localeCompare(b.id));
          }
          const capIndex = /ORDER BY created_at DESC, id DESC/.test(config.text) ? 3 : 2;
          const cap = config.values[capIndex];
          if (/row_to_json\(selected\)/.test(config.text)) {
            // A SQL-shape model, NOT evidence of actual PostgreSQL wire behavior.
            // Explicit emitted-SQL assertions below constrain its admission semantics.
            const envelopes = rows.map((physical) => ({ physical,
              physical_bytes: Buffer.byteLength(canonicalJson(physical)) + (options.wirePadding ?? 0),
              report_bytes: Buffer.byteLength(canonicalJson(physical.report)) + (options.wirePadding ?? 0) }));
            const total = envelopes.reduce((n, r) => n + transferCost(r), 0);
            if (total > config.values[capIndex + 1] || rows.length > config.values[capIndex + 2]
              || envelopes.some((r) => r.report_bytes > cap)) {
              rows = [{ physical: null, physical_bytes: Math.min(total, limits.maxBytes + 1),
                report_bytes: Math.min(Math.max(0, ...envelopes.map((r) => r.report_bytes)), limits.maxRunReportBytes + 1) }];
            } else {
              const changed = options.rows?.(envelopes.map(({ physical, report_bytes }) => ({ ...physical, report_bytes })), call);
              rows = changed ? changed.map(({ report_bytes, ...physical }, i) => ({ physical, report_bytes,
                physical_bytes: envelopes[i]?.physical_bytes ?? Buffer.byteLength(canonicalJson(physical)) })) : envelopes;
            }
          } else {
            rows = rows.map((r) => { const report_bytes = Buffer.byteLength(JSON.stringify(r.report));
              return { ...r, report: report_bytes <= cap ? r.report : null, report_bytes }; });
            rows = options.rows?.(rows, call) ?? rows;
          }
        } else if (/set_config/.test(config.text)) rows = [{ statement_timeout: config.values[0], lock_timeout: config.values[0] }];
        transfers.push(...clone(rows));
        return { rows };
      }),
    };
    clients.push(client);
    return options.connect ? options.connect(client, index) : client;
  }) };
  const read = (extra = {}) => reader.readCanaryEvidence({ pool, secret: f.secret, revision: f.revision,
    policy: { ready: true, version: 2, hash: f.policyHash }, now: () => f.now, ...extra });
  return { pool, clients, calls, transfers, read, f };
}

function transferCost(row) {
  return Buffer.byteLength(canonicalJson(row)) + (row.physical
    ? row.physical_bytes - Buffer.byteLength(canonicalJson(row.physical)) : 0);
}

function denied(result, code) {
  expect(result).toEqual({ ok: false, verified: false, readbackVerified: false,
    source: 'postgres:pbk_eval_runs', result: code, runId: null, evidence: {}, diagnostics: { codes: [code] } });
  expect(Buffer.byteLength(JSON.stringify(result.diagnostics))).toBeLessThanOrEqual(limits.maxDiagnosticsBytes);
}
function released(store, destroy) {
  for (const client of store.clients) {
    expect(client.release).toHaveBeenCalledTimes(1);
    if (destroy !== undefined) expect(client.release).toHaveBeenCalledWith(destroy);
  }
}
function monotonic() {
  let ms = 0;
  jest.spyOn(process.hrtime, 'bigint').mockImplementation(() => BigInt(Math.round(ms * 1_000_000)));
  return { advance: (amount) => { ms += amount; } };
}
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('exports only the read-only reader', () => { expect(Object.keys(reader)).toEqual(['readCanaryEvidence']); });

test('authentic chain reads every dependency twice on independent max:1 snapshots', async () => {
  const store = fakeStore(); const result = await store.read();
  const verified = verifyCanaryChain({ ...store.f, now: store.f.now });
  expect(result).toEqual({ ...verified, ok: true, readbackVerified: true,
    source: 'postgres:pbk_eval_runs', runId: store.f.comparison.id });
  expect(store.pool.connect).toHaveBeenCalledTimes(2); released(store, false);
  for (const index of [0, 1]) {
    const calls = store.calls.filter((c) => c.index === index);
    expect(calls[0].text).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/);
    expect(calls.at(-1).text).toBe('ROLLBACK');
    const selects = calls.filter((c) => /FROM public\.pbk_eval_runs/.test(c.text));
    expect(selects).toHaveLength(3);
    expect(selects[0].text).toMatch(/tenant_id = \$1 AND \(suite_name = \$2 OR source = \$3\)/);
    expect(selects[0].text).toMatch(/ORDER BY created_at DESC, id DESC\s+LIMIT 1/);
    expect(selects[1].values[1].sort()).toEqual(store.f.runs.map((r) => r.id).sort());
    expect(selects[2].values[1].sort()).toEqual(store.f.observations.map((r) => r.id).sort());
    for (const select of selects) {
      expect(select.text).toMatch(/bool_and\(report_bytes <= \$/);
      expect(select.text).toMatch(/UNION ALL\s+SELECT NULL::json AS physical/);
      expect(select.text).toMatch(/to_char\(created_at AT TIME ZONE 'UTC'/);
      expect(select.text).not.toMatch(/SELECT \*/);
    }
  }
  expect(store.calls.every((c) => c.query_timeout > 0 && c.query_timeout <= 2000)).toBe(true);
  expect(store.calls.some((c) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COMMIT)\b/i.test(c.text))).toBe(false);
});

test('valid regressing observations remain verified, not a forged passing aggregate', async () => {
  const f = makeCanaryFixture(); f.observations.at(-1).report.outcome = 'error';
  f.observations.at(-1).report.behaviorPassed = false; f.observations.at(-1).report.fallback = true;
  rebuildCanaryFixture(f); const result = await fakeStore(f).read();
  expect(result.verified).toBe(true); expect(result.evidence.canary.candidate.errorRate).toBe(1 / 20);
});

test('missing newest admission is unverified and has no proof', async () => {
  const store = fakeStore(undefined, { snapshots: [[], []] }); denied(await store.read(), 'canary_evidence_missing'); released(store, false);
});

test.each(['unsigned', 'wrong revision', 'bad suite', 'bad source', 'pending'])('newer %s admission masks an older pass without dependency reads', async (mode) => {
  const f = makeCanaryFixture(), newer = clone(f.comparison);
  newer.id = `canary_comparison_${'f'.repeat(64)}`; newer.report.id = newer.id;
  if (mode === 'wrong revision') newer.report.revision = 'c'.repeat(40);
  if (mode === 'bad suite') newer.suite_name = 'damaged';
  if (mode === 'bad source') newer.source = 'damaged';
  if (mode === 'pending') Object.assign(newer.report, { status: 'pending', executed: false, completedAt: null, baseline: null, candidate: null });
  resignCanaryRow(newer, f.secret);
  if (mode === 'unsigned') newer.report.attestation.signature = '0'.repeat(64);
  const store = fakeStore(f, { snapshots: [[...allRows(f), newer]] });
  denied(await store.read(), mode === 'pending' ? 'canary_evidence_pending' : invalid);
  expect(store.calls.filter((c) => /FROM public/.test(c.text))).toHaveLength(1); released(store, false);
});

test.each(['missing run', 'missing observation', 'signature', 'extra key', 'wrong tenant', 'wrong source', 'counters', 'timestamp'])('rejects %s using native protocol checks', async (mode) => {
  const f = makeCanaryFixture();
  if (mode === 'missing run') f.runs.pop();
  else if (mode === 'missing observation') f.observations.pop();
  else if (mode === 'signature') f.observations[0].report.attestation.signature = '0'.repeat(64);
  else if (mode === 'extra key') f.observations[0].report.untrusted = true;
  else if (mode === 'wrong tenant') f.observations[0].tenant_id = 'elsewhere';
  else if (mode === 'wrong source') f.observations[0].source = 'elsewhere';
  else if (mode === 'counters') f.observations[0].passed = 0;
  else f.observations[0].created_at_exact = f.observations[0].created_at_exact.replace('000Z', '001Z');
  const store = fakeStore(f); denied(await store.read(), invalid); released(store, false);
});

test.each(['deleted admission', 'deleted run', 'deleted observation', 'edited admission', 'edited run', 'edited observation', 'superseded'])('fresh snapshot fails closed on %s', async (mode) => {
  const f = makeCanaryFixture(), next = clone(allRows(f));
  if (mode.startsWith('deleted')) next.splice(mode.endsWith('admission') ? 0 : mode.endsWith('run') ? 1 : 3, 1);
  else if (mode === 'superseded') { const row = clone(f.comparison); row.id = `canary_comparison_${'f'.repeat(64)}`; next.push(row); }
  else next[mode.endsWith('admission') ? 0 : mode.endsWith('run') ? 1 : 3].ok = false;
  const store = fakeStore(f, { snapshots: [allRows(f), next] });
  const result = await store.read(); expect(result.verified).toBe(false); expect(result.evidence).toEqual({});
  expect(result.result).toBe('canary_evidence_superseded'); released(store, false);
});

test('canonical readback ignores physical array/key ordering but not content', async () => {
  const f = makeCanaryFixture(); const next = allRows(f).map((row) => Object.fromEntries(Object.entries(row).reverse())).reverse();
  expect((await fakeStore(f, { snapshots: [allRows(f), next] }).read()).verified).toBe(true);
});

test.each([null, {}, { ready: false, version: 2 }, { ready: true, version: 1 }, { ready: true, version: 2, hash: 'bad' }])('invalid approved policy %j never acquires', async (policy) => {
  const store = fakeStore(); denied(await store.read({ policy }), invalid); expect(store.pool.connect).not.toHaveBeenCalled();
});
test.each(['', null, 12, 'x'.repeat(4097)])('invalid secret never acquires (%j)', async (secret) => {
  const store = fakeStore(); denied(await store.read({ secret }), invalid); expect(store.pool.connect).not.toHaveBeenCalled();
});
test.each([NaN, Infinity, 1.5, 'now', undefined])('invalid wall clock %j fails closed', async (clock) => {
  const store = fakeStore(); denied(await store.read({ now: () => clock }), invalid); released(store);
});
test('backward wall clock fails closed', async () => {
  const store = fakeStore(); let n = 0; denied(await store.read({ now: () => store.f.now - n++ }), invalid); released(store);
});
test('final fresh wall clock is sampled after both rollbacks/releases', async () => {
  const store = fakeStore(undefined, { release: (index) => { if (index === 1) expired = true; } });
  let expired = false;
  denied(await store.read({ now: () => store.f.now + (expired ? limits.maxAgeMs : 0) }), 'canary_evidence_stale'); released(store, false);
});

test.each(['comparison', 'run', 'observation'])('SQL withholds oversized %s report before transfer', async (kind) => {
  const f = makeCanaryFixture(); const row = kind === 'comparison' ? f.comparison : kind === 'run' ? f.runs[0] : f.observations[0];
  row.report.payload = 'x'.repeat(kind === 'run' ? 65536 : kind === 'comparison' ? 8192 : 2048);
  const store = fakeStore(f); denied(await store.read(), overflow);
  expect(store.transfers.at(-1).physical).toBeNull();
  expect(store.transfers.some((r) => r.physical?.id === row.id)).toBe(false);
  expect(JSON.stringify(store.transfers)).not.toContain('payload'); released(store, false);
});
test('unwraps SQL admission metadata before exact physical-row verification', async () => {
  const store = fakeStore(); expect((await store.read()).verified).toBe(true);
  const envelopes = store.transfers.filter((r) => r.physical);
  expect(envelopes).toHaveLength(86);
  expect(envelopes.every((r) => Number.isInteger(r.report_bytes) && Number.isInteger(r.physical_bytes))).toBe(true);
  expect(envelopes.every((r) => Object.keys(r.physical).length === 10)).toBe(true);
});
test('unexpected physical SQL fields are not silently stripped', async () => {
  const store = fakeStore(undefined, { rows: (rows) => rows.map((r) => ({ ...r, injected: true })) });
  denied(await store.read(), invalid); released(store, false);
});

test.each([1100, 1101])('cumulative transferred metadata rows enforce exact limit %i', async (count) => {
  const f = makeCanaryFixture({ sampleCount: 1 }); let emitted = false;
  // Two snapshots transfer ten receipt rows; pad one control result only.
  const store = fakeStore(f, { query: (c) => {
    if (!emitted && /set_config/.test(c.text)) { emitted = true; return { rows: Array.from({ length: count - 10 }, () => ({})) }; }
    if (/set_config/.test(c.text)) return { rows: [] };
  } });
  const result = await store.read();
  if (count === 1100) expect(result.verified).toBe(true); else denied(result, overflow);
  released(store);
});

test.each([2097152, 2097153])('cumulative serialized bytes including size metadata enforce exact limit %i', async (cap) => {
  const f = makeCanaryFixture({ sampleCount: 1 }); const plain = fakeStore(f, { query: (c) => /set_config/.test(c.text) ? { rows: [] } : undefined });
  expect((await plain.read()).verified).toBe(true);
  const receiptBytes = plain.transfers.reduce((n, r) => n + Buffer.byteLength(canonicalJson(r)), 0);
  let emitted = false;
  const store = fakeStore(f, { query: (c) => {
    if (/set_config/.test(c.text)) {
      if (emitted) return { rows: [] }; emitted = true;
      const empty = { metadata: '' }; const overhead = Buffer.byteLength(canonicalJson(empty));
      return { rows: [{ metadata: 'x'.repeat(cap - receiptBytes - overhead) }] };
    }
  } });
  const result = await store.read(); if (cap === limits.maxBytes) expect(result.verified).toBe(true); else denied(result, overflow);
  released(store);
});
test('max membership fits the cumulative row budget, never a per-snapshot reset', async () => {
  const store = fakeStore(makeCanaryFixture({ sampleCount: 256 }));
  const result = await store.read();
  expect(result.verified).toBe(true); expect(store.transfers.length).toBe(1036);
  expect(store.pool.connect).toHaveBeenCalledTimes(2); released(store, false);
});

test.each(['resolve', 'reject'])('late %s query continuation before timer callback poisons and destroys without rollback', async (mode) => {
  const mono = monotonic(); const store = fakeStore(undefined, { query: (call) => {
    if (/FROM public/.test(call.text)) { mono.advance(2001); if (mode === 'reject') throw new Error('private db detail'); return { rows: [] }; }
  } });
  denied(await store.read(), timeout); released(store, true);
  expect(store.calls.at(-1).text).not.toBe('ROLLBACK'); expect(store.pool.connect).toHaveBeenCalledTimes(1);
});
test('late acquired client after synchronous event-loop stall is destroyed once', async () => {
  const mono = monotonic(); const store = fakeStore(undefined, { connect: (client) => { mono.advance(15001); return client; } });
  denied(await store.read(), timeout); released(store, true); expect(store.calls).toHaveLength(0);
});
test.each(['resolve', 'reject'])('hanging query is abandoned and later %s cannot revive it', async (mode) => {
  jest.useFakeTimers({ doNotFake: ['hrtime'] }); const waiting = deferred();
  const store = fakeStore(undefined, { query: (c) => /FROM public/.test(c.text) ? waiting.promise : undefined });
  const pending = store.read(); await jest.advanceTimersByTimeAsync(2001);
  denied(await pending, timeout); released(store, true);
  if (mode === 'resolve') waiting.resolve({ rows: [store.f.comparison] }); else waiting.reject(new Error('late private error'));
  await jest.advanceTimersByTimeAsync(1); released(store, true); expect(store.calls.at(-1).text).not.toBe('ROLLBACK');
});
test('timed-out acquisition destroys a late client without querying it', async () => {
  jest.useFakeTimers({ doNotFake: ['hrtime'] }); const waiting = deferred();
  const store = fakeStore(undefined, { connect: () => waiting.promise });
  const pending = store.read(); await jest.advanceTimersByTimeAsync(15001); denied(await pending, timeout);
  waiting.resolve(store.clients[0]); await jest.advanceTimersByTimeAsync(1); released(store, true); expect(store.calls).toHaveLength(0);
});
test('one cumulative deadline includes acquisition, verification and fresh snapshot', async () => {
  const mono = monotonic(); const store = fakeStore(undefined, { connect: (client) => { mono.advance(7000); return client; },
    query: (c) => { if (c.index === 1 && /FROM public/.test(c.text)) mono.advance(1001); } });
  denied(await store.read(), timeout);
  expect(store.clients[0].release).toHaveBeenCalledWith(false); expect(store.clients[1].release).toHaveBeenCalledWith(true);
  const last = store.calls.at(-1); expect(last.query_timeout).toBeLessThanOrEqual(1000);
});
test('backward monotonic clock fails closed', async () => {
  const mono = monotonic(); mono.advance(10);
  const store = fakeStore(undefined, { connect: (client) => { mono.advance(-1); return client; } });
  denied(await store.read(), timeout); released(store, true);
});
test.each(['acquire', 'begin', 'configure', 'select', 'rollback', 'release'])('redacts %s failures and releases/destroys once', async (step) => {
  const store = fakeStore(undefined, { connect: (client) => { if (step === 'acquire') throw new Error('secret db URL'); return client; },
    query: (c) => { if ((step === 'begin' && /^BEGIN/.test(c.text)) || (step === 'configure' && /set_config/.test(c.text))
      || (step === 'select' && /FROM public/.test(c.text)) || (step === 'rollback' && c.text === 'ROLLBACK')) throw new Error('secret SQL provider'); },
    release: () => { if (step === 'release') throw new Error('secret release'); } });
  denied(await store.read(), unavailable);
  if (step !== 'acquire') released(store);
  expect(store.pool.connect).toHaveBeenCalledTimes(1);
});
test('a failed read does not poison a different later operation or cache a prior proof', async () => {
  const first = fakeStore(undefined, { snapshots: [[], []] }); denied(await first.read(), 'canary_evidence_missing');
  expect((await fakeStore().read()).verified).toBe(true);
});

test.each([undefined, null, {}, { pool: {} }])('missing reader context %j is a redacted denial, never a thrown error', async (input) => {
  denied(await reader.readCanaryEvidence(input), invalid);
});
test.each(['A'.repeat(40), 'a'.repeat(39), null, 1])('invalid revision %j never acquires', async (revision) => {
  const store = fakeStore(); denied(await store.read({ revision }), invalid); expect(store.pool.connect).not.toHaveBeenCalled();
});
test.each([1999, 2000, 2001])('query wall boundary %i ms is inclusive only below deadline', async (elapsed) => {
  const mono = monotonic(); let once = false;
  const store = fakeStore(undefined, { query: (c) => { if (!once && /FROM public/.test(c.text)) { once = true; mono.advance(elapsed); } } });
  const result = await store.read();
  if (elapsed < 2000) { expect(result.verified).toBe(true); released(store, false); }
  else { denied(result, timeout); released(store, true); }
});
test.each(['resolve', 'reject'])('second-snapshot late %s destroys only the current client', async (mode) => {
  const mono = monotonic(); const store = fakeStore(undefined, { query: (c) => {
    if (c.index === 1 && /FROM public/.test(c.text)) { mono.advance(2001); if (mode === 'reject') throw new Error('late'); }
  } });
  denied(await store.read(), timeout); released(store);
  expect(store.clients[0].release).toHaveBeenCalledWith(false); expect(store.clients[1].release).toHaveBeenCalledWith(true);
  expect(store.calls.at(-1).text).not.toBe('ROLLBACK');
});
test('remaining query budget shrinks after slow pool acquisition', async () => {
  const mono = monotonic();
  const store = fakeStore(undefined, { connect: (client, index) => { if (index === 1) mono.advance(14900); return client; } });
  expect((await store.read()).verified).toBe(true);
  expect(store.calls.filter((c) => c.index === 1).every((c) => c.query_timeout <= 100)).toBe(true);
  for (const c of store.calls.filter((c) => c.index === 1 && /set_config/.test(c.text))) expect(parseInt(c.values[0], 10)).toBeLessThanOrEqual(100);
  released(store, false);
});
test.each([NaN, 1, null])('invalid internal monotonic sample %j poisons before querying', async (value) => {
  const store = fakeStore(); jest.spyOn(process.hrtime, 'bigint').mockReturnValue(value);
  denied(await store.read(), timeout); expect(store.calls).toHaveLength(0);
});
test('elapsed release time is included in the operation deadline', async () => {
  const mono = monotonic(); const store = fakeStore(undefined, { release: (index) => { if (index === 1) mono.advance(15000); } });
  denied(await store.read(), timeout); released(store, false);
});
test.each(['resolve', 'reject'])('late rollback %s poisons without a second rollback or release', async (mode) => {
  const mono = monotonic(); const store = fakeStore(undefined, { query: (c) => {
    if (c.text === 'ROLLBACK') { mono.advance(2001); if (mode === 'reject') throw new Error('shutdown detail'); }
  } });
  denied(await store.read(), timeout); released(store, true);
  expect(store.calls.filter((c) => c.text === 'ROLLBACK')).toHaveLength(1); expect(store.pool.connect).toHaveBeenCalledTimes(1);
});
test('hanging rollback is destroyed within the query deadline', async () => {
  jest.useFakeTimers({ doNotFake: ['hrtime'] }); const wait = deferred();
  const store = fakeStore(undefined, { query: (c) => c.text === 'ROLLBACK' ? wait.promise : undefined });
  const pending = store.read(); await jest.advanceTimersByTimeAsync(2001); denied(await pending, timeout); released(store, true);
  wait.resolve({ rows: [] }); await jest.advanceTimersByTimeAsync(1); released(store, true);
});
test('late second acquisition is cleaned up while the first was normally released', async () => {
  jest.useFakeTimers({ doNotFake: ['hrtime'] }); const wait = deferred();
  const store = fakeStore(undefined, { connect: (client, index) => index === 1 ? wait.promise : client });
  const pending = store.read(); await jest.advanceTimersByTimeAsync(15001); denied(await pending, timeout);
  wait.resolve(store.clients[1]); await jest.advanceTimersByTimeAsync(1); released(store);
  expect(store.clients[0].release).toHaveBeenCalledWith(false); expect(store.clients[1].release).toHaveBeenCalledWith(true);
  expect(store.calls.filter((c) => c.index === 1)).toHaveLength(0);
});
test('rejected late pool acquisition cannot leak or revive evidence', async () => {
  jest.useFakeTimers({ doNotFake: ['hrtime'] }); const wait = deferred();
  const pool = { connect: () => wait.promise }; const f = makeCanaryFixture();
  const pending = reader.readCanaryEvidence({ pool, secret: f.secret, revision: f.revision,
    policy: { ready: true, version: 2, hash: f.policyHash }, now: () => f.now });
  await jest.advanceTimersByTimeAsync(15001); denied(await pending, timeout);
  wait.reject(new Error('late database URL')); await jest.advanceTimersByTimeAsync(1);
});
test.each([-1, '1200', NaN, undefined])('invalid SQL report_bytes %j is rejected', async (size) => {
  const store = fakeStore(undefined, { rows: (rows) => rows.map((r) => ({ ...r, report_bytes: size })) });
  denied(await store.read(), invalid); released(store, false);
});
test('SQL size metadata cannot understate the parsed report transfer', async () => {
  const store = fakeStore(undefined, { rows: (rows) => rows.map((r) => ({ ...r, report_bytes: 1 })) });
  denied(await store.read(), invalid); released(store, false);
});
test('SQL size-only admission cannot silently remove a report within its cap', async () => {
  const store = fakeStore(undefined, { rows: (rows) => rows.map((r) => ({ ...r, report: null })) });
  denied(await store.read(), invalid); released(store, false);
});
test('JSONB wire whitespace is charged cumulatively, not discarded by the parser', async () => {
  const f = makeCanaryFixture({ sampleCount: 1 }); const plain = fakeStore(f, { query: (c) => /set_config/.test(c.text) ? { rows: [] } : undefined });
  expect((await plain.read()).verified).toBe(true);
  const receiptBytes = plain.transfers.reduce((n, r) => n + Buffer.byteLength(canonicalJson(r)), 0);
  let emitted = false;
  const store = fakeStore(f, {
    wirePadding: 200,
    query: (c) => {
      if (/set_config/.test(c.text)) {
        if (emitted) return { rows: [] }; emitted = true;
        return { rows: [{ metadata: 'x'.repeat(limits.maxBytes - receiptBytes - Buffer.byteLength(canonicalJson({ metadata: '' })) - 100) }] };
      }
    },
  });
  denied(await store.read(), overflow); released(store);
});
test('duplicate or unrequested dependency rows are never partial proof', async () => {
  const store = fakeStore(undefined, { rows: (rows, c) => /ANY\(/.test(c.text) ? [rows[0], rows[0]] : rows });
  denied(await store.read(), invalid); released(store, false);
});
test('a fully valid newer comparison on readback supersedes the prior chain', async () => {
  const f = makeCanaryFixture(), next = makeCanaryFixture();
  next.comparison.id = `canary_comparison_${'f'.repeat(64)}`; next.comparison.report.id = next.comparison.id;
  for (const row of [...next.runs, ...next.observations]) row.report.comparisonId = next.comparison.id;
  rebuildCanaryFixture(next);
  expect(verifyCanaryChain(next).verified).toBe(true);
  const store = fakeStore(f, { snapshots: [allRows(f), [...allRows(f), ...allRows(next)]] });
  denied(await store.read(), 'canary_evidence_superseded'); released(store, false);
});
test('pending run is authenticated before denying, without loading observations', async () => {
  const f = makeCanaryFixture(); Object.assign(f.runs[0].report, { status: 'pending', executed: false, completedAt: null }); rebuildCanaryFixture(f);
  const store = fakeStore(f); denied(await store.read(), 'canary_evidence_pending');
  expect(store.calls.filter((c) => /FROM public/.test(c.text))).toHaveLength(2); released(store, false);
});

test('freshness is sampled again after final verification, not only before its CPU work', async () => {
  let wallValue, finalSample = false;
  const store = fakeStore(); wallValue = store.f.now;
  jest.spyOn(process.hrtime, 'bigint').mockImplementation(() => {
    if (finalSample) wallValue = store.f.now + limits.maxAgeMs;
    return 1_000_000n;
  });
  denied(await store.read({ now: () => {
    if (store.clients.length === 2 && store.clients[1].release.mock.calls.length === 1) finalSample = true;
    return wallValue;
  } }), 'canary_evidence_stale');
  released(store, false);
});
test('fractional remaining millisecond never issues a query_timeout exceeding the operation budget', async () => {
  const mono = monotonic(); const store = fakeStore(undefined, { connect: (client) => { mono.advance(14999.5); return client; } });
  denied(await store.read(), timeout); released(store, true); expect(store.calls).toHaveLength(0);
});

test.each(['source', 'suite_name', 'id'])('I1 newest poisoned %s is withheld before transfer and still masks an older pass', async (field) => {
  const f = makeCanaryFixture(), poison = clone(f.comparison);
  poison[field] = 'x'.repeat(3 * 1024 * 1024);
  poison.created_at_exact = poison.created_at_exact.replace('.000000Z', '.001000Z');
  const store = fakeStore(f, { snapshots: [[...allRows(f), poison]] });
  denied(await store.read(), overflow);
  const evidenceRows = store.transfers.filter((r) => 'physical' in r || 'report_bytes' in r);
  expect(evidenceRows).toHaveLength(1); expect(evidenceRows[0].physical).toBeNull();
  expect(evidenceRows[0].physical_bytes).toBeGreaterThan(limits.maxBytes);
  expect(store.transfers.reduce((n, r) => n + transferCost(r), 0)).toBeLessThanOrEqual(limits.maxBytes);
  expect(store.calls.filter((c) => /FROM public/.test(c.text))).toHaveLength(1);
  released(store, false);
});

test.each(['run', 'observation'])('I1 oversized %s label withholds the entire dependency batch', async (kind) => {
  const f = makeCanaryFixture(); (kind === 'run' ? f.runs[0] : f.observations[0]).source = 'x'.repeat(3 * 1024 * 1024);
  const store = fakeStore(f); denied(await store.read(), overflow);
  const last = store.transfers.at(-1); expect(last.physical).toBeNull();
  expect(last.physical_bytes).toBeGreaterThan(limits.maxBytes);
  expect(JSON.stringify(store.transfers)).not.toContain('x'.repeat(1024));
  released(store, false);
});

test.each([[0, 'runs'], [0, 'observations'], [1, 'runs'], [1, 'observations']])('I1 snapshot %i entire %s batch must fit the remaining allowance before transfer', async (snapshot, group) => {
  const f = makeCanaryFixture({ sampleCount: 2 });
  const expected = f[group].map((physical) => ({ physical,
    physical_bytes: Buffer.byteLength(canonicalJson(physical)), report_bytes: Buffer.byteLength(canonicalJson(physical.report)) }));
  const allowance = Math.max(...expected.map(transferCost)) + 50;
  expect(expected.every((r) => transferCost(r) < allowance)).toBe(true);
  expect(expected.reduce((n, r) => n + transferCost(r), 0)).toBeGreaterThan(allowance);
  let configCount = 0, usedBeforeBatch, store;
  store = fakeStore(f, { query: (c) => {
    if (c.index === snapshot && /set_config/.test(c.text) && ++configCount === (group === 'runs' ? 2 : 3)) {
      const used = store.transfers.reduce((n, r) => n + transferCost(r), 0);
      const padding = { metadata: 'x'.repeat(limits.maxBytes - used - allowance - Buffer.byteLength(canonicalJson({ metadata: '' }))) };
      usedBeforeBatch = used + transferCost(padding); return { rows: [padding] };
    }
  } });
  denied(await store.read(), overflow);
  expect(store.transfers.at(-1).physical).toBeNull();
  expect(store.transfers.reduce((n, r) => n + transferCost(r), 0)).toBeLessThanOrEqual(limits.maxBytes);
  const batch = store.calls.filter((c) => c.index === snapshot && /FROM public/.test(c.text)).at(-1);
  expect(batch.values.at(-2)).toBe(limits.maxBytes - usedBeforeBatch);
  expect(store.pool.connect).toHaveBeenCalledTimes(snapshot + 1); released(store, false);
});

test('I1 emitted SQL admits all selected physical fields and the complete batch server-side', async () => {
  const store = fakeStore(); expect((await store.read()).verified).toBe(true);
  const selects = store.calls.filter((c) => /FROM public/.test(c.text));
  for (const c of selects) {
    expect(c.text).toMatch(/^WITH selected AS MATERIALIZED/);
    expect(c.text).toMatch(/row_to_json\(selected\) AS physical/);
    expect(c.text).toMatch(/octet_length\(physical::text\) AS physical_bytes/);
    expect(c.text).toMatch(/sum\(physical_bytes::bigint/);
    expect(c.text).toMatch(/bool_and\(report_bytes <= \$/);
    expect(c.text).toMatch(/batch_bytes <= \$\d+::bigint AND batch_rows <= \$\d+::int AND reports_fit/);
    expect(c.text).toMatch(/UNION ALL\s+SELECT NULL::json AS physical/);
    expect(c.text).toMatch(/FROM batch WHERE NOT \(batch_bytes <= \$\d+::bigint AND batch_rows <= \$\d+::int AND reports_fit\)/);
    const selected = c.text.split('), projected AS MATERIALIZED')[0];
    expect(selected).not.toMatch(/octet_length|batch_bytes|report_bytes/);
    expect(c.values.at(-2)).toBeGreaterThan(0); expect(c.values.at(-2)).toBeLessThan(limits.maxBytes);
  }
});

test('I1 JSON escaping, not only raw text length, controls physical admission', async () => {
  const f = makeCanaryFixture(); f.comparison.source = '"\n\\'.repeat(400_000);
  expect(Buffer.byteLength(f.comparison.source)).toBeLessThan(limits.maxBytes);
  const store = fakeStore(f); denied(await store.read(), overflow);
  expect(store.transfers.at(-1).physical).toBeNull();
  expect(store.transfers.at(-1).physical_bytes).toBeGreaterThan(limits.maxBytes); released(store, false);
});

test('I1 individually bounded poisoned labels cannot overflow the fixed cap as a batch', async () => {
  const f = makeCanaryFixture();
  for (const row of f.observations) row.source = 'x'.repeat(60_000);
  expect(f.observations.every((r) => Buffer.byteLength(canonicalJson(r)) < limits.maxBytes)).toBe(true);
  const store = fakeStore(f); denied(await store.read(), overflow);
  expect(store.transfers.at(-1).physical).toBeNull();
  expect(store.transfers.filter((r) => r.physical?.report.kind === 'observation')).toHaveLength(0);
  expect(store.transfers.reduce((n, r) => n + transferCost(r), 0)).toBeLessThanOrEqual(limits.maxBytes); released(store, false);
});

test('I1 admitted wire whitespace remains charged without changing exact physical digests', async () => {
  const store = fakeStore(undefined, { wirePadding: 200 });
  const result = await store.read(); expect(result.verified).toBe(true);
  expect(result.evidence).toEqual(verifyCanaryChain(store.f).evidence);
  const envelopes = store.transfers.filter((r) => r.physical);
  expect(envelopes.every((r) => r.physical_bytes - Buffer.byteLength(canonicalJson(r.physical)) === 200)).toBe(true);
  released(store, false);
});

test('I1 insufficient room for bounded denial metadata stops before any physical query', async () => {
  let store;
  store = fakeStore(undefined, { query: (c) => /set_config/.test(c.text)
    ? { rows: [{ metadata: 'x'.repeat(limits.maxBytes - 10 - Buffer.byteLength(canonicalJson({ metadata: '' }))) }] } : undefined });
  denied(await store.read(), overflow);
  expect(store.calls.filter((c) => /FROM public/.test(c.text))).toHaveLength(0); released(store, false);
});
