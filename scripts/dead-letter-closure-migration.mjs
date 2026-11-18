import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sqlUrl = new URL('./migrations/20261117-dead-letter-closure.sql', import.meta.url);
export const DEAD_LETTER_CLOSURE_SQL = readFileSync(sqlUrl, 'utf8');
export const DEAD_LETTER_CLOSURE_SHA256 = createHash('sha256').update(DEAD_LETTER_CLOSURE_SQL).digest('hex');
const TABLE = 'pbk_dead_letter_closure_ledger';
const SEQUENCE = `${TABLE}_ordinal_seq`;
const FUNCTION = 'pbk_closure_reject_mutation';
const browserRole = role => ['anon', 'authenticated', 'public'].includes(String(role).toLowerCase());
const INVALID = Object.freeze({ ok: false, verified: false, result: 'closure_installation_invalid' });
const columns = [
  ['id', 'text', true], ['tenant_id', 'text', true], ['ordinal', 'bigint', true, 'a'],
  ['admitted_at', 'timestamp with time zone', true], ['insert_xid', 'xid8', true],
  ['record_ref', 'text', true], ['approval_ref', 'text', true], ['intent_binding', 'text', true],
  ['action', 'text', true], ['previous_id', 'text', false], ['report', 'jsonb', true],
];
// Exact server-deparsed definitions, not a baseline stored in the mutable database.
// Preserve string literals, casts, ordering and parentheses: no lossy SQL normalizer.
const constraints = {
  pbk_closure_pkey: 'PRIMARY KEY (id)',
  pbk_closure_ordinal_key: 'UNIQUE (ordinal)',
  pbk_closure_intent_key: 'UNIQUE (intent_binding)',
  pbk_closure_previous_fk: `FOREIGN KEY (previous_id) REFERENCES public.${TABLE}(id) ON UPDATE RESTRICT ON DELETE RESTRICT`,
  pbk_closure_id_check: "CHECK ((id ~ '^[a-zA-Z0-9_:-]{1,120}$'::text))",
  pbk_closure_tenant_check: "CHECK ((tenant_id = 'pbk'::text))",
  pbk_closure_ordinal_check: 'CHECK ((ordinal > 0))',
  pbk_closure_admission_check: 'CHECK (isfinite(admitted_at))',
  pbk_closure_xid_check: "CHECK (((insert_xid > '0'::xid8) AND (insert_xid = pg_current_xact_id())))",
  pbk_closure_record_check: "CHECK ((record_ref ~ '^[a-f0-9]{64}$'::text))",
  pbk_closure_approval_check: "CHECK ((approval_ref ~ '^[a-f0-9]{64}$'::text))",
  pbk_closure_intent_check: "CHECK ((intent_binding ~ '^[a-f0-9]{64}$'::text))",
  pbk_closure_action_check: "CHECK ((action = ANY (ARRAY['close_internal'::text, 'revoke_internal'::text])))",
  pbk_closure_report_check: `CHECK ((((jsonb_typeof(report) = 'object'::text) AND (octet_length((report)::text) <= 65536) AND (report @> jsonb_build_object('schemaVersion', 'pbk-dead-letter-closure-v1', 'receiptId', id, 'tenantId', tenant_id, 'ordinal', (ordinal)::text, 'admittedAt', to_char((admitted_at AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'::text), 'insertXid', (insert_xid)::text, 'recordRef', record_ref, 'approvalRef', approval_ref, 'intentBinding', intent_binding, 'action', action)) AND (jsonb_typeof((report -> 'attestation'::text)) = 'object'::text) AND ((report #>> '{attestation,version}'::text[]) = 'pbk-dead-letter-closure-v1'::text) AND ((report #>> '{attestation,signature}'::text[]) ~ '^[a-f0-9]{64}$'::text) AND
CASE
    WHEN (previous_id IS NULL) THEN ((report -> 'predecessor'::text) = 'null'::jsonb)
    ELSE ((jsonb_typeof((report -> 'predecessor'::text)) = 'object'::text) AND ((report #>> '{predecessor,id}'::text[]) = previous_id))
END AND ((action <> 'revoke_internal'::text) OR (previous_id IS NOT NULL))) IS TRUE))`,
};
const indexes = {
  pbk_closure_pkey: `CREATE UNIQUE INDEX pbk_closure_pkey ON public.${TABLE} USING btree (id)`,
  pbk_closure_ordinal_key: `CREATE UNIQUE INDEX pbk_closure_ordinal_key ON public.${TABLE} USING btree (ordinal)`,
  pbk_closure_intent_key: `CREATE UNIQUE INDEX pbk_closure_intent_key ON public.${TABLE} USING btree (intent_binding)`,
  pbk_closure_record_ordinal_idx: `CREATE INDEX pbk_closure_record_ordinal_idx ON public.${TABLE} USING btree (tenant_id, record_ref, ordinal DESC)`,
};
const functionBody = DEAD_LETTER_CLOSURE_SQL.match(/AS \$closure\$([^]*?)\$closure\$;/)?.[1];
if (!functionBody) throw new Error('Invalid fixed closure migration');

export function validateClosureMigrationConfig(env = {}) {
  const required = suffix => {
    const value = String(env[`PBK_CLOSURE_MIGRATION_${suffix}`] || '').trim();
    if (!value) throw new Error(`Missing PBK_CLOSURE_MIGRATION_${suffix}; ambient database settings ignored`);
    return value;
  };
  const databaseUrl = required('DATABASE_URL'), target = required('TARGET'), host = required('EXPECT_HOST');
  const expectedDatabase = required('EXPECT_DATABASE'), expectedRole = required('EXPECT_ROLE');
  if (browserRole(expectedRole)) throw new Error('Closure migration owner must be an existing trusted server role');
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('Invalid closure migration PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('Closure migration URL must be PostgreSQL without overrides or fragments');
  }
  if (target !== 'local' || !['localhost', '127.0.0.1', '[::1]'].includes(host) || url.hostname !== host) {
    throw new Error('Closure migration requires explicit local target and matching loopback host');
  }
  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid closure migration port');
  try {
    if (!/^[a-zA-Z0-9_-]+$/.test(expectedDatabase) || decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase
      || !/^[a-zA-Z0-9_-]+$/.test(expectedRole) || decodeURIComponent(url.username) !== expectedRole
      || !decodeURIComponent(url.password)) throw new Error('mismatch');
  } catch { throw new Error('Closure migration database/role identity mismatch or invalid encoding'); }
  return { databaseUrl, target, host, port, expectedDatabase, expectedRole };
}

async function capabilities(query) {
  const { rows } = await query(`SELECT (
    pg_catalog.to_regprocedure('pg_catalog.pg_current_xact_id()') IS NOT NULL AND
    pg_catalog.to_regprocedure('pg_catalog.pg_current_snapshot()') IS NOT NULL AND
    pg_catalog.to_regprocedure('pg_catalog.pg_visible_in_snapshot(pg_catalog.xid8,pg_catalog.pg_snapshot)') IS NOT NULL AND
    pg_catalog.has_function_privilege(current_user,'pg_catalog.pg_current_xact_id()','EXECUTE') AND
    pg_catalog.has_function_privilege(current_user,'pg_catalog.pg_current_snapshot()','EXECUTE') AND
    pg_catalog.has_function_privilege(current_user,'pg_catalog.pg_visible_in_snapshot(pg_catalog.xid8,pg_catalog.pg_snapshot)','EXECUTE')
  ) AS closure_capabilities`);
  return rows.length === 1 && rows[0].closure_capabilities === true;
}

async function inventory(query) {
  return (await query(`SELECT 'relation' AS kind,c.relname AS name FROM pg_catalog.pg_class c
    WHERE c.relnamespace='public'::pg_catalog.regnamespace AND
      (c.relname LIKE 'pbk_dead_letter_closure_%' OR c.relname LIKE 'pbk_closure_%')
    UNION ALL SELECT 'function',p.proname FROM pg_catalog.pg_proc p
    WHERE p.pronamespace='public'::pg_catalog.regnamespace AND p.proname LIKE 'pbk_closure_%'`)).rows;
}

// Read-only: no transaction control, settings, helper installation or connection.
// Caller supplies a bounded query and owns a stable transaction/snapshot if needed.
export async function verifyDeadLetterClosureInstallation(query) {
  try {
    if (typeof query !== 'function' || !await capabilities(query)) return { ...INVALID };
    const objects = await inventory(query);
    const expectedObjects = [TABLE, SEQUENCE, ...Object.keys(indexes)].map(name => `relation:${name}`)
      .concat(`function:${FUNCTION}`).sort();
    if (JSON.stringify(objects.map(o => `${o.kind}:${o.name}`).sort()) !== JSON.stringify(expectedObjects)) return { ...INVALID };
    const { rows } = await query(`SELECT 'table' AS kind,c.relname AS name,
      pg_catalog.jsonb_build_object('kind',c.relkind,'persistence',c.relpersistence,'owned',c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user),
      'trusted_role',current_user NOT IN ('anon','authenticated'),
      'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'options',c.reloptions,'partition',c.relispartition,
      'replica',c.relreplident,'typed',c.reloftype::text,'rules',c.relhasrules,
      'acl_safe',NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner),
      'can_select',pg_catalog.has_table_privilege(current_user,c.oid,'SELECT'),
      'can_insert',pg_catalog.has_table_privilege(current_user,c.oid,'INSERT'),
      'role_access_safe',NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid<>c.relowner
        AND (NOT r.rolsuper OR r.rolname IN ('anon','authenticated')) AND r.rolname !~ '^pg_'
        AND (pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
          OR pg_catalog.has_sequence_privilege(r.oid,pg_catalog.to_regclass($2),'USAGE,SELECT,UPDATE')
          OR pg_catalog.has_function_privilege(r.oid,pg_catalog.to_regprocedure('public.pbk_closure_reject_mutation()'),'EXECUTE')
          OR pg_catalog.pg_has_role(r.oid,c.relowner,'MEMBER'))),
      'policies',(SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid),
      'inherits',(SELECT count(*) FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid)) AS detail
    FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass($1)
    UNION ALL SELECT 'column',a.attname,pg_catalog.jsonb_build_object('position',a.attnum,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
      'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),
      'local',a.attislocal,'inherited',a.attinhcount,'collation',a.attcollation=(SELECT typcollation FROM pg_catalog.pg_type WHERE oid=a.atttypid),
      'acl_safe',NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(a.attacl) acl WHERE acl.grantee<>(SELECT relowner FROM pg_catalog.pg_class WHERE oid=a.attrelid)))
    FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=pg_catalog.to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped
    UNION ALL SELECT 'constraint',k.conname,pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_constraintdef(k.oid),
      'validated',k.convalidated,'deferred',k.condeferred,'deferrable',k.condeferrable,'local',k.conislocal,'inherited',k.coninhcount,
      'parent',k.conparentid::text,'self_reference',k.contype<>'f' OR k.confrelid=k.conrelid,
      'builtin_dependencies',NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend dep
        LEFT JOIN pg_catalog.pg_proc proc ON dep.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass AND proc.oid=dep.refobjid
        LEFT JOIN pg_catalog.pg_operator op ON dep.refclassid='pg_catalog.pg_operator'::pg_catalog.regclass AND op.oid=dep.refobjid
        LEFT JOIN pg_catalog.pg_type typ ON dep.refclassid='pg_catalog.pg_type'::pg_catalog.regclass AND typ.oid=dep.refobjid
        LEFT JOIN pg_catalog.pg_collation coll ON dep.refclassid='pg_catalog.pg_collation'::pg_catalog.regclass AND coll.oid=dep.refobjid
        WHERE dep.classid='pg_catalog.pg_constraint'::pg_catalog.regclass AND dep.objid=k.oid AND
          (proc.pronamespace<>'pg_catalog'::pg_catalog.regnamespace OR op.oprnamespace<>'pg_catalog'::pg_catalog.regnamespace
            OR typ.typnamespace<>'pg_catalog'::pg_catalog.regnamespace OR coll.collnamespace<>'pg_catalog'::pg_catalog.regnamespace)))
    FROM pg_catalog.pg_constraint k WHERE k.conrelid=pg_catalog.to_regclass($1) AND k.contype<>'n'
    UNION ALL SELECT 'index',c.relname,pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_indexdef(i.indexrelid),
      'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'immediate',i.indimmediate,
      'clustered',i.indisclustered,'replident',i.indisreplident,'options',c.reloptions,
      'owned',c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user))
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=pg_catalog.to_regclass($1)
    UNION ALL SELECT 'trigger',t.tgname,pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_triggerdef(t.oid),'type',t.tgtype,
      'enabled',t.tgenabled,'function',t.tgfoid=pg_catalog.to_regprocedure('public.pbk_closure_reject_mutation()'),
      'args',t.tgnargs,'attributes',t.tgattr::text,'qual',t.tgqual::text,'old',t.tgoldtable,'new',t.tgnewtable,
      'constraint',t.tgconstraint::text,'parent',t.tgparentid::text)
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid=pg_catalog.to_regclass($1) AND NOT t.tgisinternal
    UNION ALL SELECT 'sequence',c.relname,pg_catalog.jsonb_build_object('owned',c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user),
      'kind',c.relkind,'persistence',c.relpersistence,'options',c.reloptions,'type',pg_catalog.format_type(s.seqtypid,NULL),
      'start',s.seqstart::text,'increment',s.seqincrement::text,'min',s.seqmin::text,'max',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle,
      'acl_safe',NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('S',c.relowner))) a WHERE a.grantee<>c.relowner),
      'can_use',pg_catalog.has_sequence_privilege(current_user,c.oid,'USAGE'),
      'identity',pg_catalog.pg_get_serial_sequence($1,'ordinal')=$2,
      'dependencies',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type',d.deptype,'table',d.refobjid=pg_catalog.to_regclass($1),'column',d.refobjsubid))
        FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::pg_catalog.regclass AND d.objid=c.oid AND d.refclassid='pg_catalog.pg_class'::pg_catalog.regclass))
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_sequence s ON s.seqrelid=c.oid WHERE c.oid=pg_catalog.to_regclass($2)
    UNION ALL SELECT 'function',p.proname,pg_catalog.jsonb_build_object('body',p.prosrc,'language',l.lanname,'args',pg_catalog.oidvectortypes(p.proargtypes),
      'result',pg_catalog.pg_get_function_result(p.oid),'kind',p.prokind,'definer',p.prosecdef,'strict',p.proisstrict,'volatility',p.provolatile,
      'parallel',p.proparallel,'leakproof',p.proleakproof,'returns_set',p.proretset,'config',p.proconfig,'binary',p.probin,
      'cost',p.procost,'rows',p.prorows,'support',p.prosupport::text,'argnames',p.proargnames,'allargs',p.proallargtypes,
      'defaults',p.pronargdefaults,'owned',p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user),
      'can_execute',pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE'),
      'acl_safe',NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner))
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.pronamespace='public'::pg_catalog.regnamespace AND p.proname=$3`,
    [`public.${TABLE}`, `public.${SEQUENCE}`, FUNCTION]);
    const group = kind => rows.filter(r => r.kind === kind);
    const one = kind => group(kind).length === 1 ? group(kind)[0].detail : null;
    const t = one('table');
    if (!t || t.kind !== 'r' || t.persistence !== 'p' || !t.owned || !t.trusted_role || !t.rls || t.forced || t.options !== null
      || t.partition || t.replica !== 'd' || t.typed !== '0' || t.rules || !t.acl_safe || !t.can_select || !t.can_insert || !t.role_access_safe
      || t.policies !== 0 || t.inherits !== 0) return { ...INVALID };
    const actualColumns = group('column');
    if (actualColumns.length !== columns.length) return { ...INVALID };
    for (const [i, [name, type, notnull, identity = '']] of columns.entries()) {
      const d = actualColumns.find(r => r.name === name)?.detail;
      if (!d || d.position !== i + 1 || d.type !== type || d.notnull !== notnull || d.identity !== identity
        || d.generated !== '' || d.default !== null || !d.local || d.inherited !== 0 || !d.collation || !d.acl_safe) return { ...INVALID };
    }
    const actualConstraints = group('constraint');
    if (actualConstraints.length !== Object.keys(constraints).length) return { ...INVALID };
    for (const [name, definition] of Object.entries(constraints)) {
      const d = actualConstraints.find(r => r.name === name)?.detail;
      const accepted = name === 'pbk_closure_previous_fk' ? [definition, definition.replace('REFERENCES public.', 'REFERENCES ')] : [definition];
      if (!d || !accepted.includes(d.definition) || !d.builtin_dependencies || !d.self_reference || !d.validated || d.deferred || d.deferrable
        || !d.local || d.inherited !== 0 || d.parent !== '0') return { ...INVALID };
    }
    if (group('index').length !== Object.keys(indexes).length) return { ...INVALID };
    for (const [name, definition] of Object.entries(indexes)) {
      const d = group('index').find(r => r.name === name)?.detail;
      if (!d || d.definition !== definition || !d.valid || !d.ready || !d.live || !d.immediate
        || d.clustered || d.replident || d.options !== null || !d.owned) return { ...INVALID };
    }
    const trigger = one('trigger');
    if (!trigger || group('trigger')[0].name !== 'pbk_closure_immutable' || trigger.type !== 58 || trigger.enabled !== 'A'
      || !trigger.function || trigger.args !== 0 || trigger.attributes !== '' || trigger.qual !== null
      || trigger.old !== null || trigger.new !== null || trigger.constraint !== '0' || trigger.parent !== '0'
      || !['public.', ''].some(prefix => trigger.definition === `CREATE TRIGGER pbk_closure_immutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.${TABLE} FOR EACH STATEMENT EXECUTE FUNCTION ${prefix}${FUNCTION}()`)) return { ...INVALID };
    const s = one('sequence');
    if (!s || !s.owned || !s.acl_safe || !s.can_use || !s.identity || s.kind !== 'S' || s.persistence !== 'p' || s.options !== null
      || s.type !== 'bigint' || s.start !== '1' || s.increment !== '1' || s.min !== '1' || s.max !== '9223372036854775807'
      || s.cache !== '1' || s.cycle || s.dependencies?.length !== 1 || s.dependencies[0].type !== 'i'
      || s.dependencies[0].table !== true || s.dependencies[0].column !== 3) return { ...INVALID };
    const f = one('function');
    if (!f || f.body !== functionBody || f.language !== 'plpgsql' || f.args !== '' || f.result !== 'trigger' || f.kind !== 'f'
      || f.definer || f.strict || f.volatility !== 'v' || f.parallel !== 'u' || f.leakproof || f.returns_set
      || JSON.stringify(f.config) !== JSON.stringify(['search_path=pg_catalog, pg_temp']) || f.binary !== null
      || f.cost !== 100 || f.rows !== 0 || f.support !== '-' || f.argnames !== null || f.allargs !== null
      || f.defaults !== 0 || !f.owned || !f.acl_safe || !f.can_execute) return { ...INVALID };
    return { ok: true, verified: true, result: 'closure_installation_verified',
      identitySequence: `public.${SEQUENCE}`, ownerDdlTrusted: true };
  } catch { return { ...INVALID }; }
}

// Dedicated connected client, never a pool or a caller's active transaction.
// Import/runtime startup never calls this function. No provider/source writes.
export async function applyDeadLetterClosureMigration(client, { expectedDatabase, expectedRole } = {}) {
  if (browserRole(expectedRole)) throw new Error('Closure migration owner must be an existing trusted server role');
  if (!/^[a-zA-Z0-9_-]+$/.test(expectedDatabase || '') || !/^[a-zA-Z0-9_-]+$/.test(expectedRole || '')) {
    throw new Error('Explicit closure database/role identity required');
  }
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL search_path=pg_catalog,pg_temp");
    await client.query("SET LOCAL statement_timeout='2s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const { rows } = await client.query('SELECT current_database() AS database,current_user AS role');
    if (rows.length !== 1 || rows[0].database !== expectedDatabase || rows[0].role !== expectedRole) {
      throw new Error('Connected closure database/role identity mismatch');
    }
    if (!await capabilities(client.query.bind(client))) throw new Error('Closure xid/snapshot capabilities unavailable');
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock(72624, 20261117)');
    const existing = await inventory(client.query.bind(client));
    if (existing.length) {
      if (!(await verifyDeadLetterClosureInstallation(client.query.bind(client))).ok) throw new Error('Closure installation drift; refusing repair');
    } else {
      await client.query(DEAD_LETTER_CLOSURE_SQL);
    }
    const installation = await verifyDeadLetterClosureInstallation(client.query.bind(client));
    if (!installation.ok) throw new Error('Closure installation readback failed');
    await client.query('COMMIT');
    return { ...installation, migration: path.basename(fileURLToPath(sqlUrl)), sha256: DEAD_LETTER_CLOSURE_SHA256 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !/^--confirm-sha256=[a-f0-9]{64}$/.test(arg))
    || args.filter(a => a === '--apply').length > 1 || args.filter(a => a.startsWith('--confirm-sha256=')).length > 1) {
    throw new Error('Invalid closure migration arguments');
  }
  const apply = args.includes('--apply');
  if (apply && !args.includes(`--confirm-sha256=${DEAD_LETTER_CLOSURE_SHA256}`)) throw new Error('Reviewed closure SQL checksum required');
  const config = validateClosureMigrationConfig(process.env);
  const plan = { mode: apply ? 'apply' : 'dry-run', target: config.target,
    migration: path.basename(fileURLToPath(sqlUrl)), sha256: DEAD_LETTER_CLOSURE_SHA256 };
  if (!apply) { process.stdout.write(`${JSON.stringify(plan)}\n`); return; }
  const { default: pg } = await import('pg');
  const url = new URL(config.databaseUrl);
  const client = new pg.Client({ host: config.host.replace(/^\[|\]$/g, ''), port: config.port,
    database: config.expectedDatabase, user: config.expectedRole, password: decodeURIComponent(url.password), ssl: false,
    options: '-c search_path=pg_catalog,pg_temp', connectionTimeoutMillis: 10000, query_timeout: 2000,
    application_name: 'pbk-dead-letter-closure-migration' });
  try {
    await client.connect();
    process.stdout.write(`${JSON.stringify({ ...plan, ...await applyDeadLetterClosureMigration(client, config) })}\n`);
  } finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Closure migration refused/failed; check explicit local target, identity and reviewed checksum.');
    process.exitCode = 1;
  });
}
