-- Explicit targeted migration only. Execute through targeted-readiness-migration.mjs
-- in one transaction, never through bridge startup or the Supabase batch runner.
-- No row rewrites, tenant constraints, policies, grants, FORCE RLS or credentials.
SET LOCAL search_path = pg_catalog;

DO $$
DECLARE
  item RECORD;
  relation OID;
  owner_id OID;
  tenant_column TEXT;
BEGIN
  IF current_setting('pbk.targeted_migration_context', true) IS DISTINCT FROM '20261116-targeted-readiness' THEN
    RAISE EXCEPTION 'Explicit targeted migration runner transaction context required';
  END IF;
  SELECT oid INTO owner_id FROM pg_roles WHERE rolname = current_user;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
               AND (rolsuper OR rolbypassrls OR pg_has_role(oid, owner_id, 'MEMBER'))) THEN
    RAISE EXCEPTION 'Unexpected browser role bypass/owner membership';
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE')
     OR NOT has_schema_privilege(current_user, 'public', 'USAGE') THEN
    RAISE EXCEPTION 'Targeted migration owner requires CREATE/USAGE on intended public schema';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('activity_log', 'workspace_id'), ('approvals', 'workspace_id'),
    ('bridge_state', NULL), ('calls', 'workspace_id'), ('contracts', 'workspace_id'),
    ('lead_imports', 'workspace_id'), ('lead_profiles', 'workspace_id'),
    ('pbk_feedback', 'tenant_id'), ('pbk_intent_events', 'tenant_id'),
    ('pbk_knowledge', 'tenant_id'), ('pbk_memories', 'tenant_id'),
    ('unified_messages', 'workspace_id')
  ) AS expected(table_name, tenant_name)
  LOOP
    relation := to_regclass(format('public.%I', item.table_name));
    IF relation IS NULL THEN
      IF item.table_name = 'unified_messages' THEN CONTINUE; END IF;
      RAISE EXCEPTION 'Missing legacy schema public.%', item.table_name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = relation
                   AND relkind = 'r' AND relowner = owner_id AND NOT relispartition) THEN
      RAISE EXCEPTION 'Unexpected table/owner for public.%; applying role must retain owner writes', item.table_name;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS required(privilege)
                WHERE NOT has_table_privilege(current_user, relation, privilege)) THEN
      RAISE EXCEPTION 'Missing required owner write/read privilege for public.%', item.table_name;
    END IF;
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', item.table_name);
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = relation AND relforcerowsecurity) THEN
      RAISE EXCEPTION 'Unexpected FORCE RLS for public.%', item.table_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = relation) THEN
      RAISE EXCEPTION 'Unexpected policies for public.%', item.table_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = relation OR inhparent = relation) THEN
      RAISE EXCEPTION 'Unexpected inheritance for public.%', item.table_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a
                WHERE c.oid = relation AND a.grantee <> owner_id)
       OR EXISTS (SELECT 1 FROM pg_attribute c, LATERAL aclexplode(c.attacl) a
                   WHERE c.attrelid = relation AND NOT c.attisdropped AND a.grantee <> owner_id) THEN
      RAISE EXCEPTION 'Unexpected nonowner grants/privileges for public.%', item.table_name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_constraint c ON c.conrelid = a.attrelid
                    AND c.contype = 'p' AND c.conkey = ARRAY[a.attnum]
                   WHERE a.attrelid = relation AND a.attname = 'id'
                     AND a.atttypid = 'text'::regtype AND a.attnotnull AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'Unexpected id primary key contract for public.%', item.table_name;
    END IF;
    tenant_column := item.tenant_name;
    IF tenant_column IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = relation AND a.attname = tenant_column
        AND a.atttypid = 'text'::regtype AND a.atttypmod = -1
        AND a.attnotnull AND NOT a.attisdropped AND a.attgenerated = ''
    ) THEN
      RAISE EXCEPTION 'Missing/incompatible public.%.% tenant column', item.table_name, tenant_column;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.bridge_state'::regclass
                  AND attname = 'data' AND atttypid = 'jsonb'::regtype AND attnotnull AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.bridge_state'::regclass
                  AND attname = 'updated_at' AND atttypid = 'timestamptz'::regtype AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Incompatible bridge_state singleton contract';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.pbk_set_updated_at()')
                  AND prorettype = 'trigger'::regtype AND NOT prosecdef
                  AND has_function_privilege(current_user, oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Missing/incompatible public.pbk_set_updated_at() helper';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.unified_messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  channel TEXT NOT NULL DEFAULT 'email',
  direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT NOT NULL DEFAULT 'received',
  provider TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  to_email TEXT NOT NULL DEFAULT '',
  from_phone TEXT NOT NULL DEFAULT '',
  to_phone TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  intent TEXT NOT NULL DEFAULT '',
  sentiment NUMERIC,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only known recording/learning additions may be absent on an existing base table.
DO $$
DECLARE
  col RECORD;
  actual RECORD;
BEGIN
  FOR col IN SELECT * FROM (VALUES
    ('id', 'text', true, true), ('lead_id', 'text', false, true),
    ('workspace_id', 'text', true, true), ('channel', 'text', true, true),
    ('direction', 'text', true, true), ('status', 'text', true, true),
    ('provider', 'text', true, true), ('from_email', 'text', true, true),
    ('to_email', 'text', true, true), ('from_phone', 'text', true, true),
    ('to_phone', 'text', true, true), ('subject', 'text', true, true),
    ('body', 'text', true, true), ('intent', 'text', true, true),
    ('sentiment', 'numeric', false, true), ('payload', 'jsonb', true, true),
    ('created_at', 'timestamptz', true, true), ('updated_at', 'timestamptz', true, true),
    ('storage_path', 'text', true, false), ('storage_bucket', 'text', true, false),
    ('audio_content_type', 'text', true, false), ('duration_seconds', 'numeric', false, false),
    ('recording_url', 'text', true, false), ('processed_for_learning', 'bool', true, false),
    ('learning_processed_at', 'timestamptz', false, false),
    ('learning_session_id', 'text', true, false), ('learning_metadata', 'jsonb', true, false)
  ) AS expected(name, type_name, required_not_null, base_column)
  LOOP
    SELECT * INTO actual FROM pg_attribute WHERE attrelid = 'public.unified_messages'::regclass
      AND attname = col.name AND NOT attisdropped;
    IF NOT FOUND THEN
      IF col.base_column THEN
        RAISE EXCEPTION 'Missing unified_messages base column %', col.name;
      END IF;
    ELSIF actual.atttypid <> to_regtype(col.type_name) OR actual.atttypmod <> -1
          OR actual.attnotnull <> col.required_not_null OR actual.attgenerated <> '' THEN
      RAISE EXCEPTION 'Incompatible unified_messages column %', col.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.unified_messages'::regclass
        AND contype = 'f' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.unified_messages'::regclass AND attname = 'lead_id' AND NOT attisdropped)]) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.unified_messages'::regclass
        AND contype = 'f' AND confrelid = 'public.lead_profiles'::regclass
        AND confdeltype = 'n' AND confupdtype = 'a' AND convalidated AND NOT condeferrable
        AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.unified_messages'::regclass AND attname = 'lead_id' AND NOT attisdropped)]
        AND confkey = ARRAY[(SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.lead_profiles'::regclass AND attname = 'id' AND NOT attisdropped)]) THEN
    RAISE EXCEPTION 'Missing/incompatible unified_messages lead foreign key contract';
  END IF;
  -- Default ACLs on the schema may otherwise grant access to a newly created table.
  IF EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a
              WHERE c.oid = 'public.unified_messages'::regclass AND a.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'Unexpected default nonowner grants/privileges for unified_messages';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS required(privilege)
              WHERE NOT has_table_privilege(current_user, 'public.unified_messages', privilege)) THEN
    RAISE EXCEPTION 'Missing required owner write/read privilege for unified_messages';
  END IF;
END $$;

ALTER TABLE public.unified_messages
  ADD COLUMN IF NOT EXISTS storage_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS audio_content_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC,
  ADD COLUMN IF NOT EXISTS recording_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS processed_for_learning BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS learning_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS learning_session_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS learning_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE
  col RECORD;
  expression TEXT;
BEGIN
  FOR col IN SELECT * FROM (VALUES
    ('id', NULL), ('lead_id', NULL), ('workspace_id', $d$'pbk'::text$d$),
    ('channel', $d$'email'::text$d$), ('direction', $d$'inbound'::text$d$),
    ('status', $d$'received'::text$d$), ('provider', $d$''::text$d$),
    ('from_email', $d$''::text$d$), ('to_email', $d$''::text$d$),
    ('from_phone', $d$''::text$d$), ('to_phone', $d$''::text$d$),
    ('subject', $d$''::text$d$), ('body', $d$''::text$d$), ('intent', $d$''::text$d$),
    ('sentiment', NULL), ('payload', $d$'{}'::jsonb$d$),
    ('created_at', 'now()'), ('updated_at', 'now()'),
    ('storage_path', $d$''::text$d$), ('storage_bucket', $d$''::text$d$),
    ('audio_content_type', $d$''::text$d$), ('duration_seconds', NULL),
    ('recording_url', $d$''::text$d$), ('processed_for_learning', 'false'),
    ('learning_processed_at', NULL), ('learning_session_id', $d$''::text$d$),
    ('learning_metadata', $d$'{}'::jsonb$d$)
  ) AS expected(name, default_expression)
  LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO expression
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.unified_messages'::regclass AND a.attname = col.name AND NOT a.attisdropped;
    IF expression IS DISTINCT FROM col.default_expression THEN
      RAISE EXCEPTION 'Incompatible unified_messages default for %', col.name;
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS unified_messages_lead_created_idx
  ON public.unified_messages (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS unified_messages_channel_status_idx
  ON public.unified_messages (workspace_id, channel, status, created_at DESC);
CREATE INDEX IF NOT EXISTS unified_messages_payload_gin_idx
  ON public.unified_messages USING gin (payload);
CREATE INDEX IF NOT EXISTS unified_messages_recordings_idx
  ON public.unified_messages (workspace_id, channel, storage_path) WHERE storage_path <> '';
CREATE INDEX IF NOT EXISTS unified_messages_learning_idx
  ON public.unified_messages (workspace_id, channel, processed_for_learning, created_at DESC)
  WHERE channel IN ('call', 'voice', 'recording');

DO $$
DECLARE
  idx RECORD;
BEGIN
  FOR idx IN SELECT * FROM (VALUES
    ('unified_messages_lead_created_idx',
      'CREATE INDEX unified_messages_lead_created_idx ON public.unified_messages USING btree (lead_id, created_at DESC)'),
    ('unified_messages_channel_status_idx',
      'CREATE INDEX unified_messages_channel_status_idx ON public.unified_messages USING btree (workspace_id, channel, status, created_at DESC)'),
    ('unified_messages_payload_gin_idx',
      'CREATE INDEX unified_messages_payload_gin_idx ON public.unified_messages USING gin (payload)'),
    ('unified_messages_recordings_idx',
      $d$CREATE INDEX unified_messages_recordings_idx ON public.unified_messages USING btree (workspace_id, channel, storage_path) WHERE (storage_path <> ''::text)$d$),
    ('unified_messages_learning_idx',
      $d$CREATE INDEX unified_messages_learning_idx ON public.unified_messages USING btree (workspace_id, channel, processed_for_learning, created_at DESC) WHERE (channel = ANY (ARRAY['call'::text, 'voice'::text, 'recording'::text]))$d$)
  ) AS expected(name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(format('public.%I', idx.name))
                    AND indrelid = 'public.unified_messages'::regclass AND indisvalid AND indisready
                    AND pg_get_indexdef(indexrelid) = idx.definition) THEN
      RAISE EXCEPTION 'Incompatible unified_messages index %', idx.name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.unified_messages'::regclass
                  AND tgname = 'unified_messages_set_updated_at') THEN
    CREATE TRIGGER unified_messages_set_updated_at BEFORE UPDATE ON public.unified_messages
      FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();
  ELSIF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.unified_messages'::regclass
                    AND tgname = 'unified_messages_set_updated_at' AND tgtype = 19
                    AND tgfoid = 'public.pbk_set_updated_at()'::regprocedure
                    AND tgenabled IN ('O', 'A') AND tgqual IS NULL) THEN
    RAISE EXCEPTION 'Incompatible unified_messages_set_updated_at trigger';
  END IF;
END $$;

-- No permissive policies: nonowners fail closed for every tenant, even with ACLs.
-- bridge_state has no tenant column; do not infer one from arbitrary JSON.
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_intent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_messages ENABLE ROW LEVEL SECURITY;
