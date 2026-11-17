import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sqlUrl = new URL('./migrations/20261117-bounded-census.sql', import.meta.url);
export const BOUNDED_CENSUS_SQL = readFileSync(sqlUrl, 'utf8');
export const BOUNDED_CENSUS_SHA256 = createHash('sha256').update(BOUNDED_CENSUS_SQL).digest('hex');

// Only this checked-in fixed DDL is parsed, never caller SQL or database input.
const functions = [...BOUNDED_CENSUS_SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(pbk_census_\w+)\(([^]*?)\)\s*\n(RETURNS[^]*?)AS \$census\$([^]*?)\$census\$;/g)]
  .map(([, name, args, attributes, body]) => Object.freeze({ name, body,
    argCount: args.trim() ? args.split(',').length : 0,
    arguments: args.replace(/\btimestamptz\b/g,'timestamp with time zone'),
    result: attributes.match(/^RETURNS\s+([^]*?)\s+LANGUAGE\b/)[1],
    argTypes: args.trim() ? args.split(',').map(arg => arg.trim().split(/\s+/)[1]
      .replace('timestamptz','timestamp with time zone')).join(', ') : '',
    language: /LANGUAGE sql/.test(attributes) ? 'sql' : 'plpgsql',
    securityDefiner: /SECURITY DEFINER/.test(attributes),
    strict: /\bSTRICT\b/.test(attributes),
    volatility: /\bIMMUTABLE\b/.test(attributes) ? 'i' : /\bSTABLE\b/.test(attributes) ? 's' : 'v',
    parallel: /PARALLEL SAFE/.test(attributes) ? 's' : 'u',
  }));

const normalizeDefinition = value => String(value ?? '').replace(/\bpublic\./g,'')
  .replace(/::text\b/g,'').replace(/\bLIKE\b/g,'~~').replace(/[()\s]/g,'');
const genericColumns = [['id','text',true],['report','jsonb',true],
  ['body_digest','text',false,'s','pbk_census_digest(report)'],
  ['report_bytes','bigint',false,'s','pbk_census_bytes(report)']];
const columns = {
  head: [['id','boolean',true,'','true'],['epoch','text',true,'','gen_random_uuid()::text'],
    ['sequence','bigint',true,'','0'],['chain_hash','text',true,'',"repeat('0',64)"],['installation','jsonb',false]],
  journal: [['sequence','bigint',true],['epoch','text',true],['source_kind','text',true],
    ['operation','text',true],['old_ref','text',false],['new_ref','text',false],['source_ref','text',true],
    ['digest','text',true],['projection_bytes','bigint',true],['presence','text',true],['outcome','text',true],
    ['clock_valid','boolean',true],['observed_at','text',true],['previous_hash','text',true],['chain_hash','text',true]],
  state: genericColumns, entries: genericColumns, proofs: genericColumns,
};
const check = expression => normalizeDefinition(`CHECK (${expression})`);
const oneOf = (field, values) => check(`${field} = ANY (ARRAY[${values.map(v => `'${v}'`).join(',')}])`);
const hexCheck = field => check(`${field} ~ '^[a-f0-9]{64}$'`);
const genericConstraints = [normalizeDefinition('PRIMARY KEY (id)'),
  check('octet_length(id)>=1 AND octet_length(id)<=512'),
  check("jsonb_typeof(report)='object' AND pbk_census_bytes(report)<=8192")];
const constraints = {
  head: [normalizeDefinition('PRIMARY KEY (id)'),check('id'),check('sequence>=0'),hexCheck('chain_hash')],
  journal: [normalizeDefinition('PRIMARY KEY (sequence)'),check('sequence>0'),
    oneOf('source_kind',['runtime_archive','conversation_projection','qa','safety']),
    oneOf('operation',['INSERT','UPDATE','DELETE']),...['old_ref','new_ref','source_ref','digest','previous_hash','chain_hash'].map(hexCheck),
    check('projection_bytes>=0'),oneOf('presence',['present','deleted']),
    oneOf('outcome',['success','warning','failed','cancelled','skipped','blocked','allowed','pending','unknown','deleted']),
    check('old_ref IS NOT NULL OR new_ref IS NOT NULL')],
  state: genericConstraints, entries: genericConstraints, proofs: genericConstraints,
};
const sourceTables = ['activity_log','conversation_events','pbk_qa_audit','pbk_safety_audit'];
const triggers = [
  ...sourceTables.flatMap(table => [
    { table, name: 'pbk_census_capture', type: 29, fn: 'pbk_census_source_trigger' },
    { table, name: 'pbk_census_no_truncate', type: 34, fn: 'pbk_census_reject_mutation' },
  ]),
  ...['journal','proofs'].map(suffix => ({ table: `pbk_runtime_census_${suffix}`,
    name: 'pbk_census_immutable', type: 58, fn: 'pbk_census_reject_mutation' })),
];
const indexes = [...BOUNDED_CENSUS_SQL.matchAll(/CREATE INDEX IF NOT EXISTS (\w+) ON public\.(\w+)\s*\n\s*\(([^]*?)\)\s*WHERE ([^;]+);/g)]
  .map(([,name,table,expression,predicate]) => ({ name,table,
    expression: normalizeDefinition(expression), predicate: normalizeDefinition(predicate) }));

async function verifyFixedObjects(client) {
  const { rows } = await client.query(`
    SELECT 'column' AS kind,c.relname AS table_name,a.attname AS name,
      jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,
      'generated',a.attgenerated,'expression',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl,
      'acl_safe',NOT EXISTS (SELECT 1 FROM aclexplode(a.attacl) acl WHERE acl.grantee<>c.relowner)) AS detail
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'table',c.relname,c.relname,jsonb_build_object('rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',c.relowner,
      'owned',c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user),
      'acl_safe',NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner),
      'policies',(SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid))
    FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) AND c.relkind='r'
    UNION ALL
    SELECT 'constraint',c.relname,k.conname,jsonb_build_object('definition',pg_get_constraintdef(k.oid),
      'validated',k.convalidated,'deferrable',k.condeferrable)
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
    WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) AND k.contype<>'n'
    UNION ALL
    SELECT 'trigger',c.relname,t.tgname,jsonb_build_object('type',t.tgtype,'fn',p.proname,
      'namespace',n.nspname,'enabled',t.tgenabled,'args',t.tgnargs,'attrs',t.tgattr::text,'qual',t.tgqual::text)
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE c.relnamespace='public'::regnamespace AND t.tgname=ANY($2::text[])
    UNION ALL
    SELECT 'index',c.relname,idx.relname,jsonb_build_object('expression',pg_get_expr(i.indexprs,i.indrelid),
      'predicate',pg_get_expr(i.indpred,i.indrelid),'valid',i.indisvalid,'ready',i.indisready,
      'unique',i.indisunique,'method',m.amname,'columns',i.indnatts)
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_catalog.pg_class c ON c.oid=i.indrelid JOIN pg_catalog.pg_am m ON m.oid=idx.relam
    WHERE idx.relnamespace='public'::regnamespace AND idx.relname=ANY($3::text[])
  `, [Object.keys(columns).map(s => `pbk_runtime_census_${s}`),
    ['pbk_census_capture','pbk_census_no_truncate','pbk_census_immutable'],indexes.map(i => i.name)]);
  for (const [suffix, expected] of Object.entries(columns)) {
    const table = `pbk_runtime_census_${suffix}`;
    const tableRows = rows.filter(r => r.kind === 'table' && r.table_name === table);
    if (tableRows.length !== 1 || !tableRows[0].detail.rls || tableRows[0].detail.force_rls || !tableRows[0].detail.owned
      || !tableRows[0].detail.acl_safe || Number(tableRows[0].detail.policies) !== 0) return false;
    const actual = rows.filter(r => r.kind === 'column' && r.table_name === table);
    if (actual.length !== expected.length) return false;
    for (const [name,type,notnull,generated = '',expression = ''] of expected) {
      const row = actual.find(r => r.name === name)?.detail;
      if (!row || !row.acl_safe || row.type !== type || row.notnull !== notnull || row.generated !== generated
        || normalizeDefinition(row.expression) !== normalizeDefinition(expression)) return false;
    }
    const actualChecks = rows.filter(r => r.kind === 'constraint' && r.table_name === table);
    if (actualChecks.some(r => !r.detail.validated || r.detail.deferrable)
      || JSON.stringify(actualChecks.map(r => normalizeDefinition(r.detail.definition)).sort())
      !== JSON.stringify([...constraints[suffix]].sort())) return false;
  }
  const actualTriggers = rows.filter(r => r.kind === 'trigger');
  if (actualTriggers.length !== triggers.length) return false;
  for (const trigger of triggers) {
    const d = actualTriggers.find(r => r.table_name === trigger.table && r.name === trigger.name)?.detail;
    if (!d || d.type !== trigger.type || d.fn !== trigger.fn || d.namespace !== 'public'
      || d.enabled !== 'A' || d.args !== 0 || d.attrs !== '' || d.qual !== null) return false;
  }
  const actualIndexes = rows.filter(r => r.kind === 'index');
  if (actualIndexes.length !== indexes.length || indexes.length !== 4) return false;
  for (const index of indexes) {
    const d = actualIndexes.find(r => r.table_name === index.table && r.name === index.name)?.detail;
    if (!d || !d.valid || !d.ready || d.unique || d.method !== 'btree' || d.columns !== 1
      || normalizeDefinition(d.expression) !== index.expression || normalizeDefinition(d.predicate) !== index.predicate) return false;
  }
  return true;
}

export function validateBoundedCensusMigrationConfig(env = {}) {
  const required = suffix => {
    const value = String(env[`PBK_CENSUS_MIGRATION_${suffix}`] || '').trim();
    if (!value) throw new Error(`Missing PBK_CENSUS_MIGRATION_${suffix}; ambient database settings ignored`);
    return value;
  };
  const databaseUrl = required('DATABASE_URL'), target = required('TARGET');
  const host = required('EXPECT_HOST'), expectedDatabase = required('EXPECT_DATABASE'), expectedRole = required('EXPECT_ROLE');
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('Invalid census migration PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('Census migration URL must be PostgreSQL without query overrides or fragments');
  }
  if (target !== 'local' || !['localhost','127.0.0.1','[::1]'].includes(host) || url.hostname !== host) {
    throw new Error('Census migration requires an explicit local target and matching host');
  }
  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid census migration port');
  try {
    if (!/^[a-zA-Z0-9_-]+$/.test(expectedDatabase) || decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase
      || !/^[a-zA-Z0-9_-]+$/.test(expectedRole) || decodeURIComponent(url.username) !== expectedRole) {
      throw new Error('mismatch');
    }
    if (!decodeURIComponent(url.password)) throw new Error('Explicit password required');
  } catch { throw new Error('Census migration database/role identity mismatch or invalid encoding'); }
  return { databaseUrl, target, host, port, expectedDatabase, expectedRole };
}

// Compare original shipped function bodies, not only the mutable catalog baseline.
export async function verifyBoundedCensusInstallation(client) {
  const { rows } = await client.query(`SELECT p.proname,p.prosrc,p.pronargs,p.prosecdef,p.proisstrict,
    p.provolatile,p.proparallel,p.proconfig,l.lanname,p.proacl,
    NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) AS acl_safe,
    p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) AS owned,
    oidvectortypes(p.proargtypes) AS argument_types,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS result
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'pbk_census_%'`);
  if (rows.length !== functions.length) return false;
  for (const fn of functions) {
    const candidates = rows.filter(row => row.proname === fn.name);
    if (candidates.length !== 1) return false;
    const row = candidates[0];
    if (row.prosrc !== fn.body || Number(row.pronargs) !== fn.argCount
      || row.prosecdef !== fn.securityDefiner || row.proisstrict !== fn.strict
      || row.provolatile !== fn.volatility || row.proparallel !== fn.parallel
      || row.argument_types !== fn.argTypes || row.lanname !== fn.language
      || normalizeDefinition(row.arguments) !== normalizeDefinition(fn.arguments)
      || normalizeDefinition(row.result) !== normalizeDefinition(fn.result)
      || JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, pg_temp'])
      || !row.acl_safe || !row.owned) return false;
  }
  if (!await verifyFixedObjects(client)) return false;
  const verification = await client.query('SELECT public.pbk_census_verify_installation() AS ok');
  return verification.rows[0]?.ok === true;
}

// Dedicated connected client only; callers must not pass a pool or an active transaction.
export async function applyBoundedCensusMigration(client, { expectedDatabase, expectedRole, expectedSha256 } = {}) {
  if (expectedSha256 !== BOUNDED_CENSUS_SHA256) throw new Error('Explicit reviewed census migration checksum required');
  if (!expectedDatabase || !expectedRole) throw new Error('Explicit census database/role identity required');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='5min'");
    const { rows } = await client.query('SELECT current_database() AS database,current_user AS role');
    if (rows[0]?.database !== expectedDatabase || rows[0]?.role !== expectedRole) throw new Error('Connected census database/role identity mismatch');
    await client.query(BOUNDED_CENSUS_SQL);
    if (!await verifyBoundedCensusInstallation(client)) throw new Error('Census original installation verification failed');
    await client.query('COMMIT');
    return { ok: true, migration: path.basename(fileURLToPath(sqlUrl)), sha256: BOUNDED_CENSUS_SHA256 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !/^--confirm-sha256=[a-f0-9]{64}$/.test(arg))
    || new Set(args).size !== args.length) throw new Error('Invalid census migration arguments');
  const apply = args.includes('--apply');
  if (apply && !args.includes(`--confirm-sha256=${BOUNDED_CENSUS_SHA256}`)) throw new Error('Explicit reviewed census migration checksum required');
  const config = validateBoundedCensusMigrationConfig(process.env);
  const plan = { mode: apply ? 'apply' : 'dry-run', target: config.target,
    migration: path.basename(fileURLToPath(sqlUrl)), sha256: BOUNDED_CENSUS_SHA256 };
  if (!apply) { process.stdout.write(`${JSON.stringify(plan)}\n`); return; }
  const { default: pg } = await import('pg');
  const url = new URL(config.databaseUrl);
  const client = new pg.Client({ host: config.host.replace(/^\[|\]$/g,''), port: config.port,
    database: config.expectedDatabase, user: config.expectedRole, password: decodeURIComponent(url.password),
    ssl: false, options: '-c search_path=pg_catalog,pg_temp',
    connectionTimeoutMillis: 10000, application_name: 'pbk-bounded-census-migration' });
  try {
    await client.connect();
    const result = await applyBoundedCensusMigration(client, { ...config, expectedSha256: BOUNDED_CENSUS_SHA256 });
    process.stdout.write(`${JSON.stringify({ ...plan, ...result })}\n`);
  } finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Driver errors can include submitted values; never print them or connection details.
    console.error('Census migration refused/failed; verify explicit local target, identity and reviewed checksum.');
    process.exitCode = 1;
  });
}
