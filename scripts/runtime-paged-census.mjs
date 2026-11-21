import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';
import { verifyBoundedCensusInstallation } from './bounded-census-migration.mjs';

const SCHEMA = 'pbk-runtime-source-evidence-v2';
const KINDS = ['runtime_archive', 'conversation_projection', 'qa', 'safety'];
const STATE = 'pbk:paged-v2', ZERO = '0'.repeat(64);
const ROWS = 10000, BYTES = 16777216, REPORT = 8192, PAGE = 512;
const WRITE_RESERVE = 1024 * 1024;
const budgets = new WeakMap(), admissions = new WeakMap();
const stateId = revision => `${STATE}:${revision}`;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const size = value => Buffer.byteLength(canonicalJson(value));
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const iso = value => new Date(value).toISOString();
const fail = message => { throw new Error(`Paged census: ${message}`); };
const emptyStats = () => KINDS.map(() => [0, 0, 0]);
const total = stats => stats.reduce((n, s) => n + s[0] + s[1], 0);
const denied = result => ({ verified: false, transactionPending: false, result });

function mac(secret, domain, body) {
  return createHmac('sha256', secret).update(`pbk.runtime-paged-census.v2\n${domain}\n${canonicalJson(body)}`).digest('hex');
}
function sign(secret, body) { return { ...body, signature: mac(secret, 'report', body) }; }
function authenticate(secret, report) {
  if (!report || typeof report !== 'object' || size(report) > REPORT || !hex(report.signature)) fail('unsigned report');
  const { signature, ...body } = report;
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(mac(secret, 'report', body), 'hex'))) fail('signature');
  return report;
}

// The operation owns one cumulative, poisoned budget across all four entry points.
function context(input) {
  const { client, secret, revision, fence } = input;
  if (!client?.query || typeof secret !== 'string' || !secret || !/^[a-f0-9]{40}$/.test(revision)
    || !fence || !Number.isFinite(fence.deadlineAt) || fence.deadlineAt - performance.now() > 15000
    || typeof fence.onAbort !== 'function' || typeof fence.signal?.addEventListener !== 'function') fail('inputs');
  let budget = budgets.get(fence);
  if (!budget) {
    budget = { rows: 0, bytes: 0, poisoned: false, verified: new Map(), graph: new Map(), journal: new Map(), snapshotScope: null };
    budgets.set(fence, budget);
  }
  const abort = () => {
    if (!budget.poisoned) {
      budget.poisoned = true;
      try { fence.onAbort(); } catch { /* The poisoned budget remains terminal. */ }
      try { client.release?.(true); } catch { /* The owner also destroys its connection. */ }
    }
  };
  const check = () => {
    if (budget.poisoned || fence.signal.aborted || performance.now() >= fence.deadlineAt) { abort(); fail('operation abandoned'); }
  };
  const charge = ({ rows = 0, bytes = 0 } = {}, physical = false) => {
    check();
    if (!integer(rows) || !integer(bytes)) fail('invalid budget charge');
    budget.rows += rows; budget.bytes += bytes;
    if (budget.rows > ROWS || budget.bytes > BYTES) { abort(); fail('operation budget'); }
    if (typeof fence.consume === 'function' && !physical) {
      try { fence.consume({ rows, bytes }); } catch (error) { abort(); throw error; }
    }
  };
  const consume = value => charge(value);
  const remaining = () => {
    check();
    const inherited = typeof fence.remainingBudget === 'function' ? fence.remainingBudget() : null;
    if (inherited && (!integer(inherited.rows) || !integer(inherited.bytes))) fail('remaining budget');
    return { rows: Math.min(ROWS - budget.rows, inherited?.rows ?? ROWS),
      bytes: Math.min(BYTES - budget.bytes, inherited?.bytes ?? BYTES) };
  };
  const q = async (text, values = []) => {
    check();
    const startedAt = performance.now();
    const ms = Math.max(1, Math.floor(Math.min(2000, fence.deadlineAt - startedAt)));
    const queryDeadlineAt = Math.min(fence.deadlineAt, startedAt + ms);
    const checkQuery = () => {
      check();
      if (performance.now() >= queryDeadlineAt) { abort(); fail('query abandoned'); }
    };
    let timer, listener;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => { checkQuery(); return client.query({ text, values, query_timeout: ms }); }),
        new Promise((_, reject) => {
          listener = () => { abort(); reject(new Error('Paged census: query abandoned')); };
          timer = setTimeout(listener, ms);
          fence.signal.addEventListener('abort', listener, { once: true });
        }),
      ]);
      // Synchronous adapters can settle before an overdue timer gets CPU time.
      checkQuery();
      // The coverage owner's query wrapper already charges physical result rows.
      charge({ rows: result.rows?.length || 0, bytes: size(result.rows || []) }, true);
      return result;
    } catch (error) {
      // A poisoned query is already terminal. Preserve its first cause rather than
      // replacing a missed query deadline with the later operation-abandoned check.
      if (!budget.poisoned) checkQuery();
      throw error;
    }
    finally { clearTimeout(timer); fence.signal.removeEventListener('abort', listener); }
  };
  let last = typeof input.now === 'function' ? input.now() : input.now ?? Date.now();
  const started = last, monotonic = performance.now();
  const clock = () => {
    check();
    const value = typeof input.now === 'function' ? input.now() : input.now ?? Date.now();
    if (!integer(value) || !Number.isFinite(new Date(value).getTime()) || value < last
      || value - started > performance.now() - monotonic + 1000) { abort(); fail('clock'); }
    last = value; return value;
  };
  clock();
  return { ...input, q, check, consume, remaining, abort, clock, budget, nodeCache: new Map(), rootRows: new Map() };
}

async function transaction(c, action) {
  await c.q('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await c.q(`SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true),
      set_config('idle_in_transaction_session_timeout',$1,true)`, ['2000ms']);
    const lock = (await c.q('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [STATE])).rows[0];
    if (lock?.acquired !== true) fail('owner busy');
    const result = await action();
    c.clock(); await c.q('COMMIT');
    c.budget.verified.clear(); c.budget.graph.clear(); c.budget.journal.clear();
    c.scopeInitialized = false;
    return result;
  } catch (error) {
    if (!c.budget.poisoned) await c.q('ROLLBACK').catch(() => c.abort());
    throw error;
  }
}

async function snapshotScope(c) {
  if (c.scopeInitialized) return;
  const scope = (await c.q(`SELECT pg_current_xact_id()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation`)).rows[0];
  c.scopeInitialized = true;
  c.cacheable = ['repeatable read', 'serializable'].includes(scope?.isolation);
  if (!c.cacheable || c.budget.snapshotScope !== scope.transaction_id) {
    c.budget.verified.clear(); c.budget.graph.clear(); c.budget.journal.clear();
  }
  c.budget.snapshotScope = c.cacheable ? scope.transaction_id : null;
  c.graph = c.cacheable ? c.budget.graph : new Map();
  c.journal = c.cacheable ? c.budget.journal : new Map();
}

async function installation(c) {
  const result = await verifyBoundedCensusInstallation({ query: c.q });
  if (result !== true && result?.verified !== true) fail('installation');
  const row = (await c.q(`SELECT public.pbk_census_digest(public.pbk_census_installation()) AS digest`)).rows[0];
  if (!hex(row?.digest)) fail('installation fingerprint');
  return row.digest;
}
async function head(c, locked = false) {
  const rows = (await c.q(`SELECT epoch,sequence,chain_hash FROM public.pbk_runtime_census_head
    WHERE id=true${locked ? ' FOR UPDATE' : ''}`)).rows;
  const h = rows?.[0];
  if (rows.length !== 1 || typeof h.epoch !== 'string' || !h.epoch || !integer(Number(h.sequence)) || !hex(h.chain_hash)) fail('head');
  return { epoch: h.epoch, sequence: Number(h.sequence), hash: h.chain_hash };
}
async function journalIntegrity(c, h, base) {
  // Pre-baseline journal history is not prospective coverage. Authenticate its
  // exact captured boundary, then retain/verify every forward witness separately.
  const expected = new Map();
  journalExpectation(expected, h.sequence, h.hash);
  if (base) journalExpectation(expected, base.sequence, base.hash);
  const staged = await journalRows(c, expected, h.epoch);
  for (const [sequence, actual] of staged) c.journal.set(sequence, actual);
}

async function loadReport(c, table, id) {
  const rows = (await c.q(`SELECT id,report,body_digest,report_bytes FROM public.${table} WHERE id=$1`, [id])).rows;
  if (rows.length !== 1 || Number(rows[0].report_bytes) > REPORT || !hex(rows[0].body_digest)) fail('missing report');
  return rows[0];
}
function bound(c, report, generation) {
  authenticate(c.secret, report);
  if (report.schemaVersion !== SCHEMA || report.tenantId !== 'pbk' || report.revision !== c.revision
    || generation && report.generation !== generation) fail('report binding');
}
async function saveState(c, state) {
  const report = sign(c.secret, state);
  if (size(report) > REPORT) fail('state oversized');
  await c.q(`INSERT INTO public.pbk_runtime_census_state(id,report) VALUES ($1,$2::jsonb)
    ON CONFLICT(id) DO UPDATE SET report=EXCLUDED.report`, [stateId(c.revision), JSON.stringify(report)]);
  return report;
}
async function state(c) {
  const rows = (await c.q(`SELECT report FROM public.pbk_runtime_census_state WHERE id=$1`, [stateId(c.revision)])).rows;
  if (!rows.length) return null;
  if (rows.length !== 1) fail('duplicate state');
  const s = rows[0].report; bound(c, s);
  if (!hex(s.generation) || !integer(s.kind) || s.kind > 4 || typeof s.cursor !== 'string'
    || s.cursor !== '' && !hex(s.cursor) || !integer(s.journalSequence) || !hex(s.journalHash)
    || !hex(s.instrumentation) || !integer(s.lastNow) || c.clock() < s.lastNow) fail('state');
  const { signature: _signature, ...body } = s;
  return body;
}

// References: [immutable id, generated database body digest, first key, last key, four source counters].
async function storeNode(c, s, body) {
  const height = body.children?.length ? 1 + Math.max(...body.children.map(ref => ref[6])) : 0;
  if (!integer(height) || height > 32) fail('proof height');
  const report = sign(c.secret, { schemaVersion: SCHEMA, tenantId: 'pbk', revision: c.revision,
    generation: s.generation, ...body, height });
  if (size(report) > REPORT) fail('proof oversized');
  const id = mac(c.secret, 'node-id', report);
  const rows = (await c.q(`INSERT INTO public.pbk_runtime_census_proofs(id,report) VALUES ($1,$2::jsonb)
    ON CONFLICT(id) DO NOTHING RETURNING body_digest,report_bytes`, [id, JSON.stringify(report)])).rows;
  const persisted = rows[0] || await loadReport(c, 'pbk_runtime_census_proofs', id);
  if (persisted.report && !equal(persisted.report, report)) fail('proof collision');
  const ref = [id, persisted.body_digest, body.first ?? '', body.last ?? '', body.stats ?? emptyStats(), body.times || null, height];
  if (!hex(ref[1]) || Number(persisted.report_bytes) > REPORT) fail('stored proof');
  c.nodeCache.set(id, report);
  return ref;
}
async function node(c, s, ref) {
  if (!Array.isArray(ref) || ref.length !== 7 || !hex(ref[0]) || !hex(ref[1])) fail('node reference');
  let report = c.nodeCache.get(ref[0]);
  if (!report) {
    const row = await loadReport(c, 'pbk_runtime_census_proofs', ref[0]);
    if (row.body_digest !== ref[1]) fail('node digest');
    report = row.report; c.nodeCache.set(ref[0], report);
  }
  bound(c, report, s.generation);
  if (mac(c.secret, 'node-id', report) !== ref[0] || (report.first ?? '') !== ref[2]
    || (report.last ?? '') !== ref[3] || !equal(report.stats ?? emptyStats(), ref[4])
    || !equal(ref[5], report.times || null) || ref[6] !== report.height) fail('node summary');
  return report;
}
function statsOf(entries, witness) {
  const stats = emptyStats();
  if (witness) stats[0][0] = entries.length;
  if (!witness) for (const e of entries) {
    const k = Number(e[0][0]);
    if (!KINDS[k] || !hex(e[0].slice(1)) || !hex(e[1]) || !integer(e[2])
      || ![0, 1].includes(e[3]) || !integer(e[4]) || typeof e[5] !== 'boolean' || !integer(e[6])) fail('entry');
    stats[k][e[3] ? 0 : 1]++; stats[k][2] += e[4];
  }
  return stats;
}
function addStats(refs) {
  const stats = emptyStats();
  for (const ref of refs) for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) stats[i][j] += ref[4][i][j];
  return stats;
}
async function leaf(c, s, entries, witness) {
  const body = { type: witness ? 'witness-leaf' : 'leaf', entries, children: [],
    first: entries[0]?.[0] ?? '', last: entries.at(-1)?.[0] ?? '', stats: statsOf(entries, witness) };
  if (witness) body.times = [entries[0][8], entries.at(-1)[8], entries.at(-1)[10]];
  const ref = await storeNode(c, s, body);
  if (!witness) await c.q(`INSERT INTO public.pbk_runtime_census_entries(id,report) VALUES ($1,$2::jsonb)
    ON CONFLICT(id) DO UPDATE SET report=EXCLUDED.report`, [`${s.generation}:${ref[0]}`, JSON.stringify(c.nodeCache.get(ref[0]))]);
  return ref;
}
async function branch(c, s, children, witness) {
  if (!children.length || children.length > 16) fail('branch fanout');
  for (let i = 1; i < children.length; i++) if (children[i - 1][3] >= children[i][2]) fail('overlap');
  return storeNode(c, s, { type: witness ? 'witness-branch' : 'branch', children,
    first: children[0][2], last: children.at(-1)[3], stats: addStats(children),
    ...(witness ? { times: [children[0][5][0], children.at(-1)[5][1], children.at(-1)[5][2]] } : {}) });
}
async function updateTree(c, s, root, updates, witness = false, depth = 0) {
  if (depth > 32) fail('tree depth');
  const limit = witness ? 12 : 40;
  const old = root ? await node(c, s, root) : null;
  if (!old || old.type === (witness ? 'witness-leaf' : 'leaf')) {
    if (old && !witness) {
      const id = `${s.generation}:${root[0]}`;
      let cached = (await c.q(`SELECT report,body_digest FROM public.pbk_runtime_census_entries WHERE id=$1`, [id])).rows[0];
      if (!cached) {
        cached = (await c.q(`INSERT INTO public.pbk_runtime_census_entries(id,report) VALUES ($1,$2::jsonb)
          RETURNING report,body_digest`, [id, JSON.stringify(old)])).rows[0];
      }
      if (cached.body_digest !== root[1] || !equal(cached.report, old)) fail('mutable cache mismatch');
    }
    const entries = new Map((old?.entries || []).map(e => [e[0], e]));
    for (const e of updates) {
      const prior = entries.get(e[0]);
      if (!prior || witness || e[2] > prior[2]) entries.set(e[0], e);
      // Clock validity is observation-time metadata, not equal-version content.
      // Retain the prior assessment rather than upgrading it as wall time passes.
      else if (e[2] === prior[2] && !equal(e.slice(0, 5), prior.slice(0, 5))) fail('same-version contradiction');
    }
    const ordered = [...entries.values()].sort((a, b) => a[0].localeCompare(b[0]));
    const refs = [];
    for (let i = 0; i < ordered.length || i === 0; i += limit) refs.push(await leaf(c, s, ordered.slice(i, i + limit), witness));
    return refs;
  }
  if (old.type !== (witness ? 'witness-branch' : 'branch') || !Array.isArray(old.children)
    || old.children.length > 16 || !equal(old.stats, addStats(old.children))) fail('branch shape');
  const grouped = old.children.map(() => []);
  for (const e of updates) {
    let i = old.children.findIndex(child => e[0] <= child[3]);
    if (i < 0) i = grouped.length - 1;
    grouped[i].push(e);
  }
  const children = [];
  for (let i = 0; i < grouped.length; i++) children.push(...(grouped[i].length
    ? await updateTree(c, s, old.children[i], grouped[i], witness, depth + 1) : [old.children[i]]));
  const refs = [];
  for (let i = 0; i < children.length; i += 16) refs.push(await branch(c, s, children.slice(i, i + 16), witness));
  return refs;
}
async function apply(c, s, entries, witness = false) {
  if (!entries.length) return;
  const field = witness ? 'witness' : 'tree';
  let refs = await updateTree(c, s, s[field], entries, witness);
  while (refs.length > 1) {
    const next = [];
    for (let i = 0; i < refs.length; i += 16) next.push(await branch(c, s, refs.slice(i, i + 16), witness));
    refs = next;
  }
  s[field] = refs[0];
}

async function pruneWitness(c, s) {
  if (!s.closed || !s.witness) return;
  const cutoff = c.clock() - 2 * 86400000;
  const prune = async (ref, depth = 0) => {
    if (depth > 32 || !Array.isArray(ref[5])) fail('witness retention binding');
    if (Date.parse(ref[5][1]) < cutoff) {
      s.baseSequence = Number(ref[3]); s.baseHash = ref[5][2];
      return null;
    }
    if (Date.parse(ref[5][0]) >= cutoff) return ref;
    const n = await node(c, s, ref);
    if (n.type === 'witness-leaf') {
      const removed = n.entries.filter(e => Date.parse(e[8]) < cutoff);
      const retained = n.entries.filter(e => Date.parse(e[8]) >= cutoff);
      if (removed.length) {
        s.baseSequence = Number(removed.at(-1)[0]); s.baseHash = removed.at(-1)[10];
      }
      return retained.length ? leaf(c, s, retained, true) : null;
    }
    if (n.type !== 'witness-branch') fail('witness retention type');
    const children = [];
    for (const child of n.children) { const next = await prune(child, depth + 1); if (next) children.push(next); }
    return children.length ? branch(c, s, children, true) : null;
  };
  const previous = s.baseSequence;
  s.witness = await prune(s.witness);
  if (s.baseSequence !== previous) s.gapFloor = iso(Math.max(Date.parse(s.gapFloor), cutoff));
}

async function pageBranch(c, s, children) {
  return storeNode(c, s, { type: 'page-branch', children, stats: addStats(children),
    first: children[0][2], last: children.at(-1)[3] });
}
async function appendPage(c, s, root, ref, depth = 0) {
  if (!root) return [ref];
  if (depth > 32) fail('page tree depth');
  const n = await node(c, s, root);
  if (n.type === 'page') return [root, ref];
  if (n.type !== 'page-branch' || !n.children.length || n.children.length > 16) fail('page tree');
  const children = [...n.children.slice(0, -1), ...await appendPage(c, s, n.children.at(-1), ref, depth + 1)];
  const refs = [];
  for (let i = 0; i < children.length; i += 16) refs.push(await pageBranch(c, s, children.slice(i, i + 16)));
  return refs;
}
async function recordPage(c, s, h, entries, bytes, cursor, endOfKind) {
  const page = s.pageCount + 1, ordinal = String(page).padStart(20, '0');
  const stats = emptyStats(); stats[0] = [1, entries.length, endOfKind ? 1 : 0];
  const ref = await storeNode(c, s, { type: 'page', children: [], stats,
    first: ordinal, last: ordinal, page, sourceKind: KINDS[s.kind], after: s.cursor, cursor,
    count: entries.length, projectionBytes: bytes, observedHead: h, endOfKind,
    contentBinding: mac(c.secret, 'page-content', entries), predecessor: s.lastPage });
  let refs = await appendPage(c, s, s.pages, ref);
  while (refs.length > 1) refs = [await pageBranch(c, s, refs)];
  s.pages = refs[0]; s.pageCount = page; s.scannedCount += entries.length;
  s.lastPage = { id: ref[0], digest: ref[1] };
}

async function scan(c, s, h) {
  if (s.kind === 4) return;
  const requested = s.pageSizeHint || PAGE;
  const rows = (await c.q('SELECT * FROM public.pbk_census_page($1,$2,$3)', [KINDS[s.kind], s.cursor, requested])).rows;
  if (!Array.isArray(rows) || rows.length > requested) fail('page');
  let previous = s.cursor, bytes = 0;
  const entries = [];
  const capacity = c.remaining().bytes, available = Math.max(0, capacity - WRITE_RESERVE);
  for (const row of rows) {
    const b = Number(row.projection_bytes);
    if (row.source_kind !== KINDS[s.kind] || !hex(row.source_ref) || row.source_ref <= previous
      || !hex(row.digest) || !integer(b) || typeof row.clock_valid !== 'boolean') fail('page range');
    if (b > BYTES) fail('individual projection exceeds admissible operation');
    if (bytes + b > available && (entries.length || b > capacity)) break;
    previous = row.source_ref; bytes += b;
    entries.push([`${s.kind}${row.source_ref}`, row.digest, h.sequence, 1, b, row.clock_valid, c.clock()]);
  }
  if (rows.length && !entries.length) {
    if (requested > 1) { s.pageSizeHint = 1; return; }
    c.abort(); fail('no projection fits remaining operation');
  }
  c.consume({ bytes });
  await apply(c, s, entries);
  const endOfKind = entries.length === rows.length && rows.length < requested;
  await recordPage(c, s, h, entries, bytes, previous, endOfKind);
  s.cursor = previous;
  s.pageSizeHint = PAGE;
  if (endOfKind) { s.kind++; s.cursor = ''; }
}
async function catchUp(c, s, h, mustComplete = false) {
  if (h.epoch !== s.epoch || h.sequence < s.journalSequence) fail('journal reset');
  if (h.sequence === s.journalSequence) {
    if (h.hash !== s.journalHash) fail('journal rewritten');
    return;
  }
  const requested = s.journalPageSizeHint || PAGE;
  const rows = (await c.q(`SELECT j.*,public.pbk_census_digest(to_jsonb(j)-'chain_hash') AS computed_hash
    FROM public.pbk_census_journal_page($1,$2,$3) j`, [s.journalSequence, h.sequence, requested])).rows;
  if (!rows.length || rows.length > PAGE || mustComplete && h.sequence - s.journalSequence > rows.length) fail('journal backlog');
  const entries = [], witnesses = [], journalCache = [];
  let sequence = s.journalSequence, hash = s.journalHash, bytes = 0;
  const capacity = c.remaining().bytes, available = Math.max(0, capacity - WRITE_RESERVE);
  for (const j of rows) {
    const n = Number(j.sequence), k = KINDS.indexOf(j.source_kind), b = Number(j.projection_bytes);
    if (n !== sequence + 1 || j.epoch !== s.epoch || k < 0 || !hex(j.source_ref) || !hex(j.digest)
      || !hex(j.chain_hash) || j.chain_hash !== j.computed_hash || j.previous_hash !== hash
      || !integer(b) || !['present', 'deleted'].includes(j.presence) || typeof j.clock_valid !== 'boolean') fail('journal chain');
    if (b > BYTES) fail('individual journal projection exceeds admissible operation');
    if (bytes + b > available && (entries.length || b > capacity)) {
      if (mustComplete) fail('journal byte backlog');
      if (!entries.length && requested > 1) s.journalPageSizeHint = 1;
      break;
    }
    bytes += b;
    const observed = iso(c.clock());
    entries.push([`${k}${j.source_ref}`, j.digest, n, j.presence === 'present' ? 1 : 0, b, j.clock_valid, c.clock()]);
    if (s.closed) witnesses.push([String(n).padStart(20, '0'), k, j.source_ref, j.digest, b,
      j.presence, j.outcome, j.clock_valid, observed, j.previous_hash, j.chain_hash, size(j)]);
    journalCache.push([n, { epoch: j.epoch, hash: j.chain_hash, previous: j.previous_hash }]);
    sequence = n; hash = j.chain_hash;
  }
  c.consume({ bytes });
  await apply(c, s, entries); await apply(c, s, witnesses, true);
  if (entries.length) s.journalPageSizeHint = PAGE;
  s.journalSequence = sequence; s.journalHash = hash;
  if (sequence === h.sequence && hash !== h.hash) fail('journal boundary');
  for (const [sequence, actual] of journalCache) c.journal.set(sequence, actual);
}

async function seal(c, s) {
  const children = [s.tree, s.witness, s.pages].filter(Boolean);
  const ref = await storeNode(c, s, { type: 'root', children, stats: s.tree?.[4] || emptyStats(),
    epoch: s.epoch, instrumentation: s.instrumentation, tree: s.tree, witness: s.witness,
    pages: s.pages, pageCount: s.pageCount, scannedCount: s.scannedCount,
    journalSequence: s.journalSequence, journalHash: s.journalHash,
    baseSequence: s.baseSequence, baseHash: s.baseHash, forwardOnlyFrom: s.forwardOnlyFrom,
    gaps: s.gaps, gapFloor: s.gapFloor,
    segmentRef: s.segmentRef });
  s.reference = { id: ref[0], digest: ref[1] };
}
function inventoryOf(c, s) {
  const fingerprint = mac(c.secret, 'inventory', { generation: s.generation, reference: s.reference });
  return { protocol: 'paged-v2', revision: c.revision, generation: s.generation, reference: s.reference,
    fingerprint, receiptCount: total(s.tree?.[4] || emptyStats()), journalSequence: s.journalSequence,
    journalHash: s.journalHash, instrumentation: s.instrumentation };
}

// Parent references authenticate metadata; only witness leaves expose journal tuples.
function metadataOf(report, digest, reportBytes) {
  return { digest, reportBytes, type: report.type, children: report.children,
    first: report.first ?? '', last: report.last ?? '', stats: report.stats,
    times: report.times || null, height: report.height, generation: report.generation,
    revision: report.revision, tenant: report.tenantId, schema: report.schemaVersion,
    page: report.type === 'page' ? [report.page, report.sourceKind, report.after, report.cursor,
      report.count, report.endOfKind, report.predecessor, report.contentBinding, report.observedHead] : null,
    entries: report.type === 'witness-leaf' ? report.entries : [] };
}
const validStats = stats => Array.isArray(stats) && stats.length === 4
  && stats.every(s => Array.isArray(s) && s.length === 3 && s.every(integer));
function checkReference(metadata, ref) {
  if (!Array.isArray(ref) || ref.length !== 7 || !hex(ref[0]) || !hex(ref[1])
    || metadata.digest !== ref[1] || metadata.first !== ref[2] || metadata.last !== ref[3]
    || !equal(metadata.stats, ref[4]) || !equal(metadata.times, ref[5]) || metadata.height !== ref[6]) fail('child reference');
}
function checkMetadata(c, m, generation) {
  if (!hex(m.digest) || !integer(m.reportBytes) || m.reportBytes > REPORT
    || m.schema !== SCHEMA || m.tenant !== 'pbk' || m.revision !== c.revision || m.generation !== generation
    || !validStats(m.stats) || !integer(m.height) || m.height > 32
    || !Array.isArray(m.children) || m.children.length > 16) fail('node metadata');
  const leaves = ['leaf', 'page', 'witness-leaf'];
  if (leaves.includes(m.type)) {
    if (m.children.length || m.height !== 0) fail('leaf metadata');
  } else {
    if (!['root', 'branch', 'page-branch', 'witness-branch'].includes(m.type) || !m.children.length) fail('branch metadata');
    for (const ref of m.children) if (!Array.isArray(ref) || ref.length !== 7 || !hex(ref[0]) || !hex(ref[1])
      || !integer(ref[6]) || ref[6] >= m.height || !validStats(ref[4])) fail('height or child metadata');
    if (m.height !== 1 + Math.max(...m.children.map(ref => ref[6]))) fail('node height');
    if (m.type !== 'root') {
      if (m.first !== m.children[0][2] || m.last !== m.children.at(-1)[3] || !equal(m.stats, addStats(m.children))) fail('branch summary');
      for (let i = 1; i < m.children.length; i++) {
        if (m.children[i - 1][3] >= m.children[i][2]) fail('branch overlap');
        if (m.type !== 'branch' && Number(m.children[i - 1][3]) + 1 !== Number(m.children[i][2])) fail('branch hole');
      }
    }
  }
  if (m.type.startsWith('witness-')) {
    if (!Array.isArray(m.times) || m.times.length !== 3 || !hex(m.times[2])
      || !Number.isFinite(Date.parse(m.times[0])) || Date.parse(m.times[0]) > Date.parse(m.times[1])
      || !integer(Number(m.first)) || !integer(Number(m.last))
      || m.stats[0][0] !== Number(m.last) - Number(m.first) + 1) fail('witness summary');
    if (m.type === 'witness-leaf') {
      if (!Array.isArray(m.entries) || !m.entries.length || m.entries.length > 12
        || m.entries.length !== m.stats[0][0] || m.entries[0][0] !== m.first || m.entries.at(-1)[0] !== m.last
        || !equal(m.times, [m.entries[0][8], m.entries.at(-1)[8], m.entries.at(-1)[10]])) fail('witness leaf');
      for (let i = 0; i < m.entries.length; i++) {
        const e = m.entries[i];
        if (Number(e[0]) !== Number(m.first) + i || !hex(e[9]) || !hex(e[10])
          || i && (e[9] !== m.entries[i - 1][10] || Date.parse(e[8]) < Date.parse(m.entries[i - 1][8]))) fail('witness continuity');
      }
    } else if (!equal(m.times, [m.children[0][5]?.[0], m.children.at(-1)[5]?.[1], m.children.at(-1)[5]?.[2]])) fail('witness branch bounds');
  }
  if (m.type === 'page') {
    const p = m.page;
    if (!Array.isArray(p) || !integer(p[0]) || p[0] < 1 || m.first !== String(p[0]).padStart(20, '0') || m.last !== m.first
      || !KINDS.includes(p[1]) || !(p[2] === '' || hex(p[2])) || !(p[3] === '' || hex(p[3]))
      || !integer(p[4]) || p[4] > PAGE || typeof p[5] !== 'boolean' || !hex(p[7])
      || !p[8] || !integer(p[8].sequence) || !hex(p[8].hash)
      || !equal(m.stats, [[1, p[4], p[5] ? 1 : 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]])) fail('page metadata');
  }
}
function journalExpectation(expected, sequence, hash, previous) {
  if (!integer(sequence) || !hex(hash) || previous !== undefined && !hex(previous)) fail('journal expectation');
  if (sequence === 0) { if (hash !== ZERO) fail('journal origin'); return; }
  const prior = expected.get(sequence);
  if (prior && (prior.hash !== hash || prior.previous !== undefined && previous !== undefined && prior.previous !== previous)) fail('journal conflict');
  expected.set(sequence, { hash, previous: previous ?? prior?.previous });
}
async function journalRows(c, expected, epoch) {
  await snapshotScope(c);
  const pending = [];
  const check = (actual, e) => {
    if (!actual || actual.epoch !== epoch || actual.hash !== e.hash
      || e.previous !== undefined && actual.previous !== e.previous) fail('journal dependency');
  };
  for (const [sequence, e] of expected) {
    const cached = c.journal.get(sequence);
    if (cached) check(cached, e); else pending.push(sequence);
  }
  const staged = new Map();
  for (let offset = 0; offset < pending.length;) {
    const available = c.remaining();
    const count = Math.min(PAGE, pending.length - offset, available.rows - 16,
      Math.floor((available.bytes - 4096) / (REPORT + 512)));
    if (count <= 0) fail('journal batch preflight');
    const ids = pending.slice(offset, offset + count);
    const rows = (await c.q(`SELECT j.sequence,j.epoch,j.chain_hash,j.previous_hash,
      public.pbk_census_digest(to_jsonb(j)-'chain_hash') AS computed_hash
      FROM public.pbk_runtime_census_journal j WHERE sequence=ANY($1::bigint[])
      /* paged-census:journal-metadata */`, [ids])).rows;
    if (rows.length !== ids.length) fail('journal missing');
    for (const j of rows) {
      const sequence = Number(j.sequence);
      if (!expected.has(sequence) || staged.has(sequence) || j.chain_hash !== j.computed_hash) fail('journal tamper');
      const actual = { epoch: j.epoch, hash: j.chain_hash, previous: j.previous_hash };
      check(actual, expected.get(sequence)); staged.set(sequence, actual);
    }
    offset += count;
  }
  return staged;
}

// BFS loads each new immutable metadata row once; authority is published only after full closure.
async function dependencies(c, targets) {
  await snapshotScope(c);
  for (const { root } of targets) {
    const pageStats = root.pages?.[4]?.[0], count = root.witness?.[4]?.[0]?.[0] || 0;
    if (!pageStats || pageStats[0] !== root.pageCount || pageStats[1] !== root.scannedCount || pageStats[2] !== 4
      || count !== root.journalSequence - root.baseSequence || count && (Number(root.witness[2]) !== root.baseSequence + 1
        || Number(root.witness[3]) !== root.journalSequence)) fail('manifest completeness counters');
  }
  const pending = targets.filter(({ reference }) => !c.cacheable || c.budget.verified.get(reference.id) !== reference.digest);
  if (!pending.length) return;
  const { epoch, generation } = pending[0].root;
  if (pending.some(t => t.root.epoch !== epoch || t.root.generation !== generation)) fail('cross-generation manifests');
  const graph = new Map(c.graph), staged = new Set(), queue = [], expected = new Map(), enqueued = new Set();
  const journal = new Map();
  const enqueue = ref => {
    if (!Array.isArray(ref) || ref.length !== 7 || !hex(ref[0]) || !hex(ref[1])) fail('child descriptor');
    const prior = expected.get(ref[0]);
    if (prior && !equal(prior, ref)) fail('conflicting child descriptors');
    expected.set(ref[0], ref);
    if (graph.has(ref[0])) checkReference(graph.get(ref[0]), ref);
    else if (!enqueued.has(ref[0])) { enqueued.add(ref[0]); queue.push(ref[0]); }
  };
  for (const { root, reference } of pending) {
    const row = c.rootRows.get(reference.id);
    const m = metadataOf(root, reference.digest, Number(row.report_bytes));
    checkMetadata(c, m, generation); graph.set(reference.id, m); staged.add(reference.id);
    for (const ref of m.children) enqueue(ref);
    journalExpectation(journal, root.baseSequence, root.baseHash);
    journalExpectation(journal, root.journalSequence, root.journalHash);
  }
  for (let offset = 0; offset < queue.length;) {
    const available = c.remaining();
    const count = Math.min(PAGE, queue.length - offset, available.rows - 16,
      Math.floor((available.bytes - 4096) / (REPORT + 512)));
    if (count <= 0) fail('metadata batch preflight');
    const ids = queue.slice(offset, offset + count), requested = new Set(ids);
    const rows = (await c.q(`SELECT id,body_digest,report_bytes,
      jsonb_build_array(report->>'type',report->'children',report->>'first',report->>'last',
        report->'stats',report->'times',report->'height',report->>'generation',report->>'revision',
        report->>'tenantId',report->>'schemaVersion',
        CASE WHEN report->>'type'='page' THEN jsonb_build_array(report->'page',report->>'sourceKind',
          report->>'after',report->>'cursor',report->'count',report->'endOfKind',report->'predecessor',
          report->>'contentBinding',report->'observedHead') ELSE NULL END,
        CASE WHEN report->>'type'='witness-leaf' THEN report->'entries' ELSE '[]'::jsonb END) AS census_metadata
      FROM public.pbk_runtime_census_proofs WHERE id=ANY($1::text[])`, [ids])).rows;
    if (rows.length !== ids.length) fail('missing metadata dependency');
    for (const row of rows) {
      if (!requested.delete(row.id) || !Array.isArray(row.census_metadata)) fail('duplicate metadata');
      const [type, children, first, last, stats, times, height, gen, revision, tenant, schema, page, entries] = row.census_metadata;
      const m = { digest: row.body_digest, reportBytes: Number(row.report_bytes), type, children,
        first: first ?? '', last: last ?? '', stats, times, height, generation: gen, revision, tenant, schema, page, entries };
      checkReference(m, expected.get(row.id)); checkMetadata(c, m, generation);
      graph.set(row.id, m); staged.add(row.id);
      for (const ref of children) enqueue(ref);
    }
    offset += count;
  }
  for (const id of staged) {
    const m = graph.get(id);
    for (const ref of m.children) {
      const child = graph.get(ref[0]);
      if (!child) fail('missing child closure');
      checkReference(child, ref);
      const family = m.type === 'branch' ? ['leaf', 'branch'] : m.type === 'page-branch'
        ? ['page', 'page-branch'] : m.type === 'witness-branch' ? ['witness-leaf', 'witness-branch'] : null;
      if (family && !family.includes(child.type)) fail('child type');
    }
    if (m.type === 'page') {
      const [ordinal, kind, after, cursor, count, endOfKind, predecessor, , observedHead] = m.page;
      if (observedHead.epoch !== epoch || count && cursor <= after || !count && cursor !== after) fail('page range');
      if (ordinal === 1) {
        if (predecessor !== null || kind !== KINDS[0] || after !== '') fail('page origin');
      } else {
        const prev = graph.get(predecessor?.id);
        if (!prev || prev.digest !== predecessor.digest || prev.type !== 'page' || prev.page[0] !== ordinal - 1) fail('page predecessor');
        if (prev.page[5] ? KINDS.indexOf(kind) !== KINDS.indexOf(prev.page[1]) + 1 || after !== ''
          : kind !== prev.page[1] || after !== prev.page[3]) fail('page continuity');
      }
      if (endOfKind && kind === KINDS[3] && ordinal !== pending[0].root.pageCount) fail('page completion');
    }
    if (m.type === 'witness-leaf') for (const e of m.entries) journalExpectation(journal, Number(e[0]), e[10], e[9]);
  }
  for (const { root } of pending) {
    for (const [ref, family] of [[root.tree, ['leaf', 'branch']], [root.witness, ['witness-leaf', 'witness-branch']],
      [root.pages, ['page', 'page-branch']]]) if (ref && !family.includes(graph.get(ref[0])?.type)) fail('root child type');
  }
  const actualJournal = await journalRows(c, journal, epoch);
  for (const { root } of pending) {
    let previous = root.baseHash;
    for (let sequence = root.baseSequence + 1; sequence <= root.journalSequence; sequence++) {
      c.check();
      const actual = actualJournal.get(sequence) || c.journal.get(sequence);
      if (!actual || actual.previous !== previous) fail('journal closure continuity');
      previous = actual.hash;
    }
    if (previous !== root.journalHash) fail('journal closure hash');
  }
  // No staged node/root becomes reusable if any dependency or journal check failed.
  for (const id of staged) {
    c.graph.set(id, graph.get(id));
    if (c.cacheable) c.budget.verified.set(id, graph.get(id).digest);
  }
  for (const [sequence, actual] of actualJournal) c.journal.set(sequence, actual);
}
function parseManifest(c, inventory, row) {
  if (inventory?.protocol !== 'paged-v2' || inventory.revision !== c.revision || !hex(inventory.generation)
    || !hex(inventory.reference?.id) || !hex(inventory.reference?.digest)) fail('inventory reference');
  if (row.body_digest !== inventory.reference.digest) fail('manifest digest');
  const root = row.report; bound(c, root, inventory.generation);
  if (root.type !== 'root' || mac(c.secret, 'node-id', root) !== inventory.reference.id
    || root.instrumentation !== inventory.instrumentation || !equal(root.children, [root.tree, root.witness, root.pages].filter(Boolean))) fail('manifest');
  const reconstructed = inventoryOf(c, { ...root, generation: inventory.generation, reference: inventory.reference });
  if (!equal(reconstructed, inventory)) fail('inventory substitution');
  c.rootRows.set(inventory.reference.id, row);
  return root;
}
async function manifest(c, inventory) {
  const row = await loadReport(c, 'pbk_runtime_census_proofs', inventory?.reference?.id);
  const root = parseManifest(c, inventory, row);
  await dependencies(c, [{ reference: inventory.reference, root }]);
  return root;
}

async function proofBatch(c, references) {
  const refs = new Map();
  for (const { id, digest } of references) {
    if (!hex(id) || !hex(digest) || refs.has(id) && refs.get(id) !== digest) fail('batch reference');
    refs.set(id, digest);
  }
  if (!refs.size) return new Map();
  if (refs.size > c.remaining().rows - 256) fail('batch rows preflight');
  let metadata;
  if ([...refs].every(([id, digest]) => c.graph?.get(id)?.digest === digest)) {
    metadata = [...refs].map(([id, digest]) => ({ id, body_digest: digest, report_bytes: c.graph.get(id).reportBytes }));
  } else metadata = (await c.q(`SELECT id,body_digest,report_bytes FROM public.pbk_runtime_census_proofs
    WHERE id=ANY($1::text[])`, [[...refs.keys()]])).rows;
  if (metadata.length !== refs.size) fail('missing batch proof');
  let bytes = 0;
  for (const m of metadata) {
    if (refs.get(m.id) !== m.body_digest || !integer(Number(m.report_bytes)) || Number(m.report_bytes) > REPORT) fail('batch metadata');
    bytes += Number(m.report_bytes) + 256;
  }
  if (bytes > c.remaining().bytes - 4096 || refs.size > c.remaining().rows - 256) fail('batch bytes preflight');
  const rows = (await c.q(`SELECT id,report,body_digest,report_bytes FROM public.pbk_runtime_census_proofs
    WHERE id=ANY($1::text[])`, [[...refs.keys()]])).rows;
  if (rows.length !== refs.size) fail('batch disappeared');
  const result = new Map();
  for (const row of rows) {
    if (refs.get(row.id) !== row.body_digest || Number(row.report_bytes) > REPORT) fail('batch digest');
    result.set(row.id, row); c.nodeCache.set(row.id, row.report);
  }
  return result;
}
async function journalBoundaries(c, roots) {
  const expected = new Map();
  for (const root of roots) for (const [sequence, hash] of [[root.baseSequence, root.baseHash], [root.journalSequence, root.journalHash]]) {
    journalExpectation(expected, sequence, hash);
  }
  const staged = await journalRows(c, expected, roots[0].epoch);
  for (const [sequence, actual] of staged) c.journal.set(sequence, actual);
}

function witnessLeaves(c, root, start, end) {
  const leaves = [];
  const visit = (ref, depth = 0) => {
    c.check();
    if (depth > 32) fail('witness depth');
    if (!ref[5] || Date.parse(ref[5][1]) < start || Date.parse(ref[5][0]) > end) return;
    const metadata = c.graph?.get(ref[0]);
    if (!metadata || metadata.digest !== ref[1]) fail('witness metadata dependency');
    if (metadata.type === 'witness-leaf') leaves.push(ref);
    else if (metadata.type === 'witness-branch') for (const child of metadata.children) visit(child, depth + 1);
    else fail('witness metadata type');
  };
  if (root.witness) visit(root.witness);
  return leaves;
}
async function witnessEvents(c, inventory, root, leaves, start, end) {
  const events = [];
  for (const ref of leaves) {
    const n = await node(c, { generation: inventory.generation }, ref);
    if (n.type !== 'witness-leaf') fail('witness payload type');
    for (const e of n.entries) {
      const sequence = Number(e[0]), at = Date.parse(e[8]);
      if (!integer(sequence) || sequence <= root.baseSequence || sequence > root.journalSequence
        || !Number.isFinite(at)) fail('witness range');
      if (at >= start && at <= end) events.push(e);
    }
  }
  return events;
}

export async function preparePagedCensusObservation(input = {}) {
  let c;
  try {
    c = context(input);
    const instrumentation = await installation(c);
    const prepared = await transaction(c, async () => {
      const h = await head(c);
      let s = await state(c);
      if (!s) {
        await journalIntegrity(c, h);
        s = { schemaVersion: SCHEMA, tenantId: 'pbk', revision: c.revision,
          generation: mac(c.secret, 'generation', randomUUID()), instrumentation, epoch: h.epoch,
          kind: 0, cursor: '', journalSequence: h.sequence, journalHash: h.hash,
          tree: null, witness: null, reference: null, closed: false, lastNow: c.clock(), admission: null,
          gaps: [], gapFloor: null, pages: null, pageCount: 0, scannedCount: 0, lastPage: null };
      }
      if (s.instrumentation !== instrumentation || s.epoch !== h.epoch) fail('installation changed');
      if (s.admission && c.clock() < s.admission.expiresAt) fail('admission busy');
      if (s.admission) {
        s.gaps.push({ gapRef: mac(c.secret, 'abandoned', s.admission.token), classification: 'unknown',
          reason: 'observation_abandoned', startedAt: iso(s.admission.startedAt), endedAt: iso(c.clock()) });
        if (s.gaps.length > 16) s.gapFloor = s.gaps.shift().endedAt;
      }
      const previouslyClosed = s.closed;
      await journalIntegrity(c, { sequence: s.journalSequence, hash: s.journalHash, epoch: s.epoch },
        s.closed ? { sequence: s.baseSequence, hash: s.baseHash } : undefined);
      await scan(c, s, h);
      const closing = await head(c, true);
      await catchUp(c, s, closing);
      await pruneWitness(c, s);
      if (s.kind === 4 && s.journalSequence === closing.sequence) {
        if (!s.closed) {
          s.closed = true; s.baseSequence = closing.sequence; s.baseHash = closing.hash;
          s.forwardOnlyFrom = iso(c.clock()); s.gapFloor = s.forwardOnlyFrom;
          s.segmentRef = mac(c.secret, 'segment', s.generation);
        }
        await seal(c, s);
      }
      s.lastNow = c.clock();
      if (previouslyClosed && s.journalSequence === closing.sequence) {
        s.admission = { token: mac(c.secret, 'admission', randomUUID()), startedAt: c.clock(), expiresAt: c.clock() + 15000,
          reference: s.reference, revision: c.revision };
      } else s.admission = null;
      await saveState(c, s);
      return { s, newlyClosed: !previouslyClosed && s.closed };
    });
    // A new baseline uses a separate operation for closure readback, never a third
    // full-tree read in the first coverage checkpoint's shared budget.
    if (prepared.newlyClosed) await manifest(c, inventoryOf(c, prepared.s));
    const stored = await state(c);
    if (!equal(stored, prepared.s)) fail('state readback');
    if (!stored.admission) return { ...denied('paged_census_incomplete'), progressRecorded: true,
      progress: { generation: stored.generation, kind: stored.kind, closed: stored.closed,
        journalSequence: stored.journalSequence } };
    const admission = Object.freeze({});
    admissions.set(admission, { client: c.client, fence: c.fence, revision: c.revision,
      namespace: mac(c.secret, 'namespace', 'pbk'), admission: stored.admission });
    return { verified: true, transactionPending: false, result: 'paged_census_admitted', admission };
  } catch { return denied('paged_census_unverified'); }
}

function summarize(c, root, start, end, events) {
  return KINDS.map((sourceKind, k) => {
    const [present, deleted] = root.stats[k], n = present + deleted;
    // UNKNOWN is a conservative inventory classification, never an organic event.
    // Interval activity counts come from authenticated witnesses, not baseline rows.
    const activity = events.filter(e => e[1] === k), count = activity.length;
    const counts = { census: n, history: count, observations: n + count, present, deleted, inWindow: count,
      inventoryUnknown: n, unknown: count, operational: 0, controlled: 0, diagnostic: 0, lateUnknown: 0, success: 0,
      warning: 0, failed: 0, cancelled: 0, skipped: 0, blocked: 0, allowed: 0, pending: 0,
      unknownOutcome: 0, invalidClock: activity.filter(e => !e[7]).length, eligible: 0 };
    for (const event of activity) {
      const outcome = event[6] === 'unknown' ? 'unknownOutcome' : event[6];
      if (['success', 'warning', 'failed', 'cancelled', 'skipped', 'blocked', 'allowed', 'pending', 'unknownOutcome'].includes(outcome)) counts[outcome]++;
    }
    const times = activity.map(e => e[8]).sort();
    return { sourceKind, counts, fingerprint: mac(c.secret, 'source', { sourceKind,
      reference: root.tree, start, end, events: activity }), observationBounds: {
        firstObservedAt: times[0] || null, lastObservedAt: times.at(-1) || null }, eligible: false };
  });
}
export async function collectPagedCensusSnapshotInTransaction(input = {}) {
  let c;
  try {
    c = context(input);
    const handle = admissions.get(input.admission);
    admissions.delete(input.admission);
    if (!handle || handle.client !== c.client || handle.fence !== c.fence || handle.revision !== c.revision
      || handle.namespace !== mac(c.secret, 'namespace', 'pbk')) fail('one-use admission');
    await snapshotScope(c);
    if (!c.cacheable) fail('repeatable-read transaction required');
    const { windowStart: start, windowEnd: end } = input;
    if (!integer(start) || !integer(end) || start > end || end > c.clock() || end - start > 86400000) fail('window');
    const s = await state(c);
    if (!s?.closed || !equal(s.admission, handle.admission) || c.clock() >= s.admission.expiresAt) fail('stale admission');
    if (await installation(c) !== s.instrumentation) fail('installation');
    const h = await head(c, true);
    await catchUp(c, s, h, true);
    await pruneWitness(c, s);
    if (s.journalSequence !== h.sequence) fail('pending journal');
    await seal(c, s);
    const inventory = inventoryOf(c, s), root = await manifest(c, inventory);
    const events = await witnesses(c, inventory, root, start, end);
    s.admission = null; s.lastNow = c.clock(); await saveState(c, s);
    const forward = Date.parse(root.forwardOnlyFrom);
    const intersectingGaps = root.gaps.filter(g => Date.parse(g.startedAt) <= end && Date.parse(g.endedAt) >= start).length;
    const continuous = start >= forward && start >= Date.parse(root.gapFloor) && intersectingGaps === 0;
    return { verified: true, transactionPending: true, invalidReceipts: 0, protocol: 'paged-v2',
      schemaVersion: SCHEMA, inventory, fingerprint: mac(c.secret, 'snapshot', { inventory, start, end }),
      coverage: { segmentRef: root.segmentRef, forwardOnlyFrom: root.forwardOnlyFrom, gaps: root.gaps,
        gapFloor: root.gapFloor, gapFingerprint: mac(c.secret, 'gaps', root.gaps), intersectingGaps, continuous },
      sources: summarize(c, root, start, end, events), historyCompleteFrom: root.gapFloor };
  } catch { return { ...denied('paged_census_unverified'), transactionPending: true, invalidReceipts: 1 }; }
}

export async function readPagedCensusInventory(input = {}) {
  const c = context(input);
  if (input.independent !== false) { c.budget.verified.clear(); c.budget.graph.clear(); c.budget.journal.clear(); }
  if (await installation(c) !== input.inventory?.instrumentation) fail('installation');
  await manifest(c, input.inventory);
  return { verified: true, ...input.inventory };
}

async function witnesses(c, inventory, root, start, end) {
  const leaves = witnessLeaves(c, root, start, end);
  await proofBatch(c, leaves.map(ref => ({ id: ref[0], digest: ref[1] })));
  return witnessEvents(c, inventory, root, leaves, start, end);
}
export async function readPagedCensusIntervalRoots(input = {}) {
  const c = context(input), { reports, snapshot } = input;
  if (!Array.isArray(reports) || reports.length > 2000 || !snapshot?.inventory) fail('interval inputs');
  await snapshotScope(c);
  const inventories = new Map([[canonicalJson(snapshot.inventory), snapshot.inventory]]), roots = [];
  const instrumentation = reports.length ? await installation(c) : null;
  let previous = -Infinity;
  const intervals = [];
  for (const report of reports) {
    const start = Date.parse(report.intervalStart), end = Date.parse(report.cutoff);
    if (!integer(start) || !integer(end) || start > end || start < previous || end > c.clock()) fail('interval clocks');
    previous = start;
    const inv = report.source?.inventory || snapshot.inventory;
    if (instrumentation !== inv.instrumentation || inv.generation !== snapshot.inventory.generation) fail('interval installation or generation');
    const key = canonicalJson(inv); inventories.set(key, inv);
    intervals.push({ report, inv, key, start, end });
  }
  if (!reports.length) return roots;
  const bodies = await proofBatch(c, [...inventories.values()].map(inv => inv.reference));
  const manifests = new Map(), targets = [];
  for (const [key, inv] of inventories) {
    const root = parseManifest(c, inv, bodies.get(inv.reference.id));
    manifests.set(key, root); targets.push({ reference: inv.reference, root });
  }
  await dependencies(c, targets);
  await journalBoundaries(c, [...manifests.values()]);
  const leaves = new Map();
  for (const interval of intervals) {
    const root = manifests.get(interval.key);
    if (interval.start < Date.parse(root.forwardOnlyFrom) || interval.start < Date.parse(root.gapFloor)) fail('pre-anchor interval');
    interval.leaves = witnessLeaves(c, root, interval.start, interval.end);
    for (const ref of interval.leaves) leaves.set(ref[0], { id: ref[0], digest: ref[1] });
  }
  await proofBatch(c, [...leaves.values()]);
  for (const { report, inv, key, start, end, leaves } of intervals) {
    c.check();
    const root = manifests.get(key);
    if (start < Date.parse(root.forwardOnlyFrom)) fail('pre-anchor interval');
    const events = await witnessEvents(c, inv, root, leaves, start, end);
    const value = mac(c.secret, 'interval', { segmentRef: root.segmentRef,
      start: report.intervalStart, end: report.cutoff, events });
    if (report.source?.intervalRoot && report.source.intervalRoot !== value) fail('historical interval mismatch');
    roots.push(value);
  }
  return roots;
}
