-- Targeted census instrumentation only. Caller owns the migration transaction.
CREATE OR REPLACE FUNCTION public.pbk_census_digest(body jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $census$SELECT encode(sha256(convert_to(body::text, 'UTF8')), 'hex')$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_bytes(body jsonb)
RETURNS bigint LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $census$SELECT octet_length(convert_to(body::text, 'UTF8'))::bigint$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_identity(source_kind text, source_id text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $census$
BEGIN
  IF source_kind NOT IN ('runtime_archive','conversation_projection','qa','safety') THEN
    RAISE EXCEPTION 'Invalid census source kind';
  END IF;
  RETURN encode(sha256(decode(replace('pbk.census.identity.v2:' || source_kind || ':' || source_id,chr(92),chr(92)||chr(92)), 'escape')), 'hex');
END
$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_projection(source_kind text, source_row jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $census$
DECLARE
  fields text[];
  field text;
  result jsonb := '{}';
  value jsonb;
  stamp timestamptz;
BEGIN
  CASE source_kind
    WHEN 'runtime_archive' THEN fields := ARRAY['id','workspace_id','source','status','category','text','metadata','created_at','updated_at'];
    WHEN 'conversation_projection' THEN fields := ARRAY['id','workspace_id','source_table','source_id','event_type','channel','direction','status','body','payload','created_at','updated_at','occurred_at'];
    WHEN 'qa' THEN fields := ARRAY['id','tenant_id','tool_name','passed','skipped','reason','validator','retry_count','params','result','qa','source','created_at'];
    WHEN 'safety' THEN fields := ARRAY['id','tenant_id','tool_name','blocked','approval_required','params','validation','source','created_at'];
    ELSE RAISE EXCEPTION 'Invalid census source kind';
  END CASE;
  FOREACH field IN ARRAY fields LOOP
    value := coalesce(source_row->field,'null'::jsonb);
    IF field IN ('created_at','updated_at','occurred_at') AND value <> 'null'::jsonb THEN
      stamp := (source_row->>field)::timestamptz;
      IF isfinite(stamp) THEN
        value := to_jsonb(to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
      END IF;
    END IF;
    result := result || jsonb_build_object(field,value);
  END LOOP;
  RETURN result;
END
$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_in_scope(source_kind text, source_row jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $census$
BEGIN
  CASE source_kind
    WHEN 'runtime_archive' THEN RETURN coalesce(source_row->>'workspace_id'='pbk' AND source_row->>'source' LIKE 'runtime-event:%',false);
    WHEN 'conversation_projection' THEN RETURN coalesce(source_row->>'workspace_id'='pbk',false);
    WHEN 'qa','safety' THEN RETURN coalesce(source_row->>'tenant_id'='pbk',false);
    ELSE RAISE EXCEPTION 'Invalid census source kind';
  END CASE;
END
$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_outcome(source_kind text, source_row jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $census$
BEGIN
  CASE source_kind
    WHEN 'runtime_archive' THEN RETURN CASE source_row->>'status'
      WHEN 'success' THEN 'success' WHEN 'warning' THEN 'warning' WHEN 'error' THEN 'failed'
      WHEN 'failed' THEN 'failed' WHEN 'cancelled' THEN 'cancelled' ELSE 'unknown' END;
    WHEN 'conversation_projection' THEN RETURN CASE source_row->>'status'
      WHEN 'completed' THEN 'success' WHEN 'delivered' THEN 'success' WHEN 'sent' THEN 'success'
      WHEN 'received' THEN 'success' WHEN 'failed' THEN 'failed' WHEN 'error' THEN 'failed'
      WHEN 'cancelled' THEN 'cancelled' WHEN 'pending' THEN 'pending' WHEN 'queued' THEN 'pending'
      WHEN 'approved' THEN 'pending' WHEN 'rejected' THEN 'blocked' ELSE 'unknown' END;
    WHEN 'qa' THEN
      IF jsonb_typeof(source_row->'passed') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(source_row->'skipped') IS DISTINCT FROM 'boolean' THEN RETURN 'unknown'; END IF;
      RETURN CASE WHEN (source_row->>'skipped')::boolean THEN 'skipped'
        WHEN (source_row->>'passed')::boolean THEN 'success' ELSE 'failed' END;
    WHEN 'safety' THEN
      IF jsonb_typeof(source_row->'blocked') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(source_row->'approval_required') IS DISTINCT FROM 'boolean' THEN RETURN 'unknown'; END IF;
      RETURN CASE WHEN (source_row->>'blocked')::boolean THEN 'blocked' ELSE 'allowed' END;
    ELSE RAISE EXCEPTION 'Invalid census source kind';
  END CASE;
END
$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_clock_valid(source_kind text, source_row jsonb, observed_at timestamptz)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $census$
DECLARE
  fields text[];
  field text;
  stamp timestamptz;
BEGIN
  CASE source_kind
    WHEN 'runtime_archive' THEN fields := ARRAY['created_at','updated_at'];
    WHEN 'conversation_projection' THEN fields := ARRAY['created_at','updated_at','occurred_at'];
    WHEN 'qa','safety' THEN fields := ARRAY['created_at'];
    ELSE RAISE EXCEPTION 'Invalid census source kind';
  END CASE;
  IF NOT isfinite(observed_at) THEN RETURN false; END IF;
  FOREACH field IN ARRAY fields LOOP
    stamp := (source_row->>field)::timestamptz;
    IF stamp IS NULL OR NOT isfinite(stamp) OR stamp > observed_at THEN RETURN false; END IF;
  END LOOP;
  RETURN coalesce((source_row->>'created_at')::timestamptz <= (source_row->>'updated_at')::timestamptz,true);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END
$census$;

CREATE TABLE IF NOT EXISTS public.pbk_runtime_census_head (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  epoch text NOT NULL DEFAULT gen_random_uuid()::text,
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  chain_hash text NOT NULL DEFAULT repeat('0',64) CHECK (chain_hash ~ '^[a-f0-9]{64}$'),
  installation jsonb
);
CREATE TABLE IF NOT EXISTS public.pbk_runtime_census_journal (
  sequence bigint PRIMARY KEY CHECK (sequence > 0),
  epoch text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('runtime_archive','conversation_projection','qa','safety')),
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  old_ref text CHECK (old_ref ~ '^[a-f0-9]{64}$'),
  new_ref text CHECK (new_ref ~ '^[a-f0-9]{64}$'),
  source_ref text NOT NULL CHECK (source_ref ~ '^[a-f0-9]{64}$'),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  projection_bytes bigint NOT NULL CHECK (projection_bytes >= 0),
  presence text NOT NULL CHECK (presence IN ('present','deleted')),
  outcome text NOT NULL CHECK (outcome IN ('success','warning','failed','cancelled','skipped','blocked','allowed','pending','unknown','deleted')),
  clock_valid boolean NOT NULL,
  observed_at text NOT NULL,
  previous_hash text NOT NULL CHECK (previous_hash ~ '^[a-f0-9]{64}$'),
  chain_hash text NOT NULL CHECK (chain_hash ~ '^[a-f0-9]{64}$'),
  CHECK (old_ref IS NOT NULL OR new_ref IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.pbk_runtime_census_state (
  id text PRIMARY KEY CHECK (octet_length(id) BETWEEN 1 AND 512),
  report jsonb NOT NULL CHECK (jsonb_typeof(report)='object' AND public.pbk_census_bytes(report) <= 8192),
  body_digest text GENERATED ALWAYS AS (public.pbk_census_digest(report)) STORED,
  report_bytes bigint GENERATED ALWAYS AS (public.pbk_census_bytes(report)) STORED
);
CREATE TABLE IF NOT EXISTS public.pbk_runtime_census_entries (
  id text PRIMARY KEY CHECK (octet_length(id) BETWEEN 1 AND 512),
  report jsonb NOT NULL CHECK (jsonb_typeof(report)='object' AND public.pbk_census_bytes(report) <= 8192),
  body_digest text GENERATED ALWAYS AS (public.pbk_census_digest(report)) STORED,
  report_bytes bigint GENERATED ALWAYS AS (public.pbk_census_bytes(report)) STORED
);
CREATE TABLE IF NOT EXISTS public.pbk_runtime_census_proofs (
  id text PRIMARY KEY CHECK (octet_length(id) BETWEEN 1 AND 512),
  report jsonb NOT NULL CHECK (jsonb_typeof(report)='object' AND public.pbk_census_bytes(report) <= 8192),
  body_digest text GENERATED ALWAYS AS (public.pbk_census_digest(report)) STORED,
  report_bytes bigint GENERATED ALWAYS AS (public.pbk_census_bytes(report)) STORED
);

-- Check before table REVOKE: PostgreSQL can also remove PUBLIC column grants.
-- Existing permissions must be refused, not silently repaired.
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid,
      LATERAL aclexplode(a.attacl) acl
    WHERE c.relnamespace='public'::regnamespace
      AND c.relname IN ('pbk_runtime_census_head','pbk_runtime_census_journal','pbk_runtime_census_state','pbk_runtime_census_entries','pbk_runtime_census_proofs')
      AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner
  ) THEN RAISE EXCEPTION 'Census unexpected column grants'; END IF;
END
$guard$;

ALTER TABLE public.pbk_runtime_census_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_runtime_census_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_runtime_census_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_runtime_census_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_runtime_census_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pbk_runtime_census_head, public.pbk_runtime_census_journal,
  public.pbk_runtime_census_state, public.pbk_runtime_census_entries, public.pbk_runtime_census_proofs FROM PUBLIC;

INSERT INTO public.pbk_runtime_census_head(id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.pbk_census_reject_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $census$
BEGIN
  RAISE EXCEPTION 'Census immutable history or untracked source TRUNCATE refused';
END
$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_source_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $census$
DECLARE
  kind text;
  old_row jsonb;
  new_row jsonb;
  old_identity text;
  new_identity text;
  old_scoped boolean;
  new_scoped boolean;
  projection jsonb;
  h public.pbk_runtime_census_head%ROWTYPE;
  entry public.pbk_runtime_census_journal%ROWTYPE;
  item integer;
  stamp timestamptz;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'AFTER' THEN
    RAISE EXCEPTION 'Invalid census trigger installation';
  END IF;
  CASE TG_TABLE_NAME
    WHEN 'activity_log' THEN kind := 'runtime_archive';
    WHEN 'conversation_events' THEN kind := 'conversation_projection';
    WHEN 'pbk_qa_audit' THEN kind := 'qa';
    WHEN 'pbk_safety_audit' THEN kind := 'safety';
    ELSE RAISE EXCEPTION 'Invalid census trigger source';
  END CASE;
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  old_scoped := public.pbk_census_in_scope(kind,old_row);
  new_scoped := public.pbk_census_in_scope(kind,new_row);
  IF NOT old_scoped AND NOT new_scoped THEN RETURN NULL; END IF;
  IF old_scoped THEN old_identity := public.pbk_census_identity(kind,old_row->>'id'); END IF;
  IF new_scoped THEN new_identity := public.pbk_census_identity(kind,new_row->>'id'); END IF;

  -- The singleton row is the commit serialization point, not an allocated sequence.
  SELECT * INTO STRICT h FROM public.pbk_runtime_census_head WHERE id=true FOR UPDATE;
  stamp := clock_timestamp();
  FOR item IN 1..2 LOOP
    IF item=1 AND old_scoped AND (NOT new_scoped OR old_identity <> new_identity) THEN
      projection := public.pbk_census_projection(kind,old_row);
      entry.presence := 'deleted'; entry.source_ref := old_identity;
      entry.outcome := 'deleted'; entry.clock_valid := true;
    ELSIF item=2 AND new_scoped THEN
      projection := public.pbk_census_projection(kind,new_row);
      entry.presence := 'present'; entry.source_ref := new_identity;
      entry.outcome := public.pbk_census_outcome(kind,projection);
      entry.clock_valid := public.pbk_census_clock_valid(kind,projection,stamp);
    ELSE CONTINUE;
    END IF;
    entry.sequence := h.sequence + 1;
    entry.epoch := h.epoch; entry.source_kind := kind; entry.operation := TG_OP;
    entry.old_ref := old_identity; entry.new_ref := new_identity;
    entry.digest := public.pbk_census_digest(projection);
    entry.projection_bytes := public.pbk_census_bytes(projection);
    entry.observed_at := to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    entry.previous_hash := h.chain_hash;
    entry.chain_hash := public.pbk_census_digest(to_jsonb(entry)-'chain_hash');
    INSERT INTO public.pbk_runtime_census_journal SELECT (entry).*;
    h.sequence := entry.sequence; h.chain_hash := entry.chain_hash;
  END LOOP;
  UPDATE public.pbk_runtime_census_head SET sequence=h.sequence,chain_hash=h.chain_hash WHERE id=true;
  RETURN NULL;
END
$census$;

DROP TRIGGER IF EXISTS pbk_census_capture ON public.activity_log;
CREATE TRIGGER pbk_census_capture AFTER INSERT OR UPDATE OR DELETE ON public.activity_log
FOR EACH ROW EXECUTE FUNCTION public.pbk_census_source_trigger();
DROP TRIGGER IF EXISTS pbk_census_capture ON public.conversation_events;
CREATE TRIGGER pbk_census_capture AFTER INSERT OR UPDATE OR DELETE ON public.conversation_events
FOR EACH ROW EXECUTE FUNCTION public.pbk_census_source_trigger();
DROP TRIGGER IF EXISTS pbk_census_capture ON public.pbk_qa_audit;
CREATE TRIGGER pbk_census_capture AFTER INSERT OR UPDATE OR DELETE ON public.pbk_qa_audit
FOR EACH ROW EXECUTE FUNCTION public.pbk_census_source_trigger();
DROP TRIGGER IF EXISTS pbk_census_capture ON public.pbk_safety_audit;
CREATE TRIGGER pbk_census_capture AFTER INSERT OR UPDATE OR DELETE ON public.pbk_safety_audit
FOR EACH ROW EXECUTE FUNCTION public.pbk_census_source_trigger();

DROP TRIGGER IF EXISTS pbk_census_no_truncate ON public.activity_log;
CREATE TRIGGER pbk_census_no_truncate BEFORE TRUNCATE ON public.activity_log
FOR EACH STATEMENT EXECUTE FUNCTION public.pbk_census_reject_mutation();
DROP TRIGGER IF EXISTS pbk_census_no_truncate ON public.conversation_events;
CREATE TRIGGER pbk_census_no_truncate BEFORE TRUNCATE ON public.conversation_events
FOR EACH STATEMENT EXECUTE FUNCTION public.pbk_census_reject_mutation();
DROP TRIGGER IF EXISTS pbk_census_no_truncate ON public.pbk_qa_audit;
CREATE TRIGGER pbk_census_no_truncate BEFORE TRUNCATE ON public.pbk_qa_audit
FOR EACH STATEMENT EXECUTE FUNCTION public.pbk_census_reject_mutation();
DROP TRIGGER IF EXISTS pbk_census_no_truncate ON public.pbk_safety_audit;
CREATE TRIGGER pbk_census_no_truncate BEFORE TRUNCATE ON public.pbk_safety_audit
FOR EACH STATEMENT EXECUTE FUNCTION public.pbk_census_reject_mutation();
DROP TRIGGER IF EXISTS pbk_census_immutable ON public.pbk_runtime_census_journal;
CREATE TRIGGER pbk_census_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.pbk_runtime_census_journal
FOR EACH STATEMENT EXECUTE FUNCTION public.pbk_census_reject_mutation();
DROP TRIGGER IF EXISTS pbk_census_immutable ON public.pbk_runtime_census_proofs;
CREATE TRIGGER pbk_census_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.pbk_runtime_census_proofs
FOR EACH STATEMENT EXECUTE FUNCTION public.pbk_census_reject_mutation();

ALTER TABLE public.activity_log ENABLE ALWAYS TRIGGER pbk_census_capture;
ALTER TABLE public.conversation_events ENABLE ALWAYS TRIGGER pbk_census_capture;
ALTER TABLE public.pbk_qa_audit ENABLE ALWAYS TRIGGER pbk_census_capture;
ALTER TABLE public.pbk_safety_audit ENABLE ALWAYS TRIGGER pbk_census_capture;
ALTER TABLE public.activity_log ENABLE ALWAYS TRIGGER pbk_census_no_truncate;
ALTER TABLE public.conversation_events ENABLE ALWAYS TRIGGER pbk_census_no_truncate;
ALTER TABLE public.pbk_qa_audit ENABLE ALWAYS TRIGGER pbk_census_no_truncate;
ALTER TABLE public.pbk_safety_audit ENABLE ALWAYS TRIGGER pbk_census_no_truncate;
ALTER TABLE public.pbk_runtime_census_journal ENABLE ALWAYS TRIGGER pbk_census_immutable;
ALTER TABLE public.pbk_runtime_census_proofs ENABLE ALWAYS TRIGGER pbk_census_immutable;

-- Builtins only: existing source writers need no census helper EXECUTE.
-- Match these immutable expressions exactly in page predicates and ordering.
CREATE INDEX IF NOT EXISTS pbk_census_activity_ref_idx ON public.activity_log
  (encode(sha256(decode(replace('pbk.census.identity.v2:runtime_archive:' || id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex'))
  WHERE workspace_id='pbk' AND source LIKE 'runtime-event:%';
CREATE INDEX IF NOT EXISTS pbk_census_conversation_ref_idx ON public.conversation_events
  (encode(sha256(decode(replace('pbk.census.identity.v2:conversation_projection:' || id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex')) WHERE workspace_id='pbk';
CREATE INDEX IF NOT EXISTS pbk_census_qa_ref_idx ON public.pbk_qa_audit
  (encode(sha256(decode(replace('pbk.census.identity.v2:qa:' || id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex')) WHERE tenant_id='pbk';
CREATE INDEX IF NOT EXISTS pbk_census_safety_ref_idx ON public.pbk_safety_audit
  (encode(sha256(decode(replace('pbk.census.identity.v2:safety:' || id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex')) WHERE tenant_id='pbk';

CREATE OR REPLACE FUNCTION public.pbk_census_page(p_kind text, after_ref text DEFAULT '', page_size integer DEFAULT 128)
RETURNS TABLE(source_kind text,source_ref text,digest text,projection_bytes bigint,outcome text,clock_valid boolean)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $census$
BEGIN
  IF page_size IS NULL OR page_size < 1 OR page_size > 512 OR after_ref IS NULL
    OR (after_ref <> '' AND after_ref !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid census page bounds'; END IF;
  -- Each branch is fixed SQL. Limit indexed identities before evaluating projections.
  CASE p_kind
    WHEN 'runtime_archive' THEN
      RETURN QUERY WITH rows AS MATERIALIZED (
        SELECT encode(sha256(decode(replace('pbk.census.identity.v2:runtime_archive:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex') AS ref,
          public.pbk_census_projection('runtime_archive',to_jsonb(s)) AS body
        FROM public.activity_log s WHERE s.workspace_id='pbk' AND s.source LIKE 'runtime-event:%'
          AND encode(sha256(decode(replace('pbk.census.identity.v2:runtime_archive:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex')>after_ref
        ORDER BY encode(sha256(decode(replace('pbk.census.identity.v2:runtime_archive:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex') LIMIT page_size)
      SELECT p_kind,r.ref,public.pbk_census_digest(r.body),public.pbk_census_bytes(r.body),
        public.pbk_census_outcome(p_kind,r.body),public.pbk_census_clock_valid(p_kind,r.body,statement_timestamp()) FROM rows r ORDER BY r.ref;
    WHEN 'conversation_projection' THEN
      RETURN QUERY WITH rows AS MATERIALIZED (
        SELECT encode(sha256(decode(replace('pbk.census.identity.v2:conversation_projection:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex') AS ref,
          public.pbk_census_projection('conversation_projection',to_jsonb(s)) AS body
        FROM public.conversation_events s WHERE s.workspace_id='pbk'
          AND encode(sha256(decode(replace('pbk.census.identity.v2:conversation_projection:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex')>after_ref
        ORDER BY encode(sha256(decode(replace('pbk.census.identity.v2:conversation_projection:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex') LIMIT page_size)
      SELECT p_kind,r.ref,public.pbk_census_digest(r.body),public.pbk_census_bytes(r.body),
        public.pbk_census_outcome(p_kind,r.body),public.pbk_census_clock_valid(p_kind,r.body,statement_timestamp()) FROM rows r ORDER BY r.ref;
    WHEN 'qa' THEN
      RETURN QUERY WITH rows AS MATERIALIZED (
        SELECT encode(sha256(decode(replace('pbk.census.identity.v2:qa:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex') AS ref,public.pbk_census_projection('qa',to_jsonb(s)) AS body
        FROM public.pbk_qa_audit s WHERE s.tenant_id='pbk' AND encode(sha256(decode(replace('pbk.census.identity.v2:qa:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex')>after_ref
        ORDER BY encode(sha256(decode(replace('pbk.census.identity.v2:qa:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex') LIMIT page_size)
      SELECT p_kind,r.ref,public.pbk_census_digest(r.body),public.pbk_census_bytes(r.body),
        public.pbk_census_outcome(p_kind,r.body),public.pbk_census_clock_valid(p_kind,r.body,statement_timestamp()) FROM rows r ORDER BY r.ref;
    WHEN 'safety' THEN
      RETURN QUERY WITH rows AS MATERIALIZED (
        SELECT encode(sha256(decode(replace('pbk.census.identity.v2:safety:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex') AS ref,public.pbk_census_projection('safety',to_jsonb(s)) AS body
        FROM public.pbk_safety_audit s WHERE s.tenant_id='pbk' AND encode(sha256(decode(replace('pbk.census.identity.v2:safety:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex')>after_ref
        ORDER BY encode(sha256(decode(replace('pbk.census.identity.v2:safety:' || s.id::text,chr(92),chr(92)||chr(92)), 'escape')), 'hex') LIMIT page_size)
      SELECT p_kind,r.ref,public.pbk_census_digest(r.body),public.pbk_census_bytes(r.body),
        public.pbk_census_outcome(p_kind,r.body),public.pbk_census_clock_valid(p_kind,r.body,statement_timestamp()) FROM rows r ORDER BY r.ref;
    ELSE RAISE EXCEPTION 'Invalid census source kind';
  END CASE;
END
$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_journal_page(after_sequence bigint,through_sequence bigint,page_size integer DEFAULT 128)
RETURNS SETOF public.pbk_runtime_census_journal LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $census$
BEGIN
  IF after_sequence IS NULL OR through_sequence IS NULL OR after_sequence < 0 OR through_sequence < after_sequence
    OR page_size IS NULL OR page_size < 1 OR page_size > 512 THEN RAISE EXCEPTION 'Invalid census journal page bounds'; END IF;
  RETURN QUERY SELECT j.* FROM public.pbk_runtime_census_journal j
    WHERE j.sequence>after_sequence AND j.sequence<=through_sequence ORDER BY j.sequence LIMIT page_size;
END
$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_installation()
RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $census$
WITH tables AS (
  SELECT c.oid,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
  FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'
    AND c.relname IN ('pbk_runtime_census_head','pbk_runtime_census_journal','pbk_runtime_census_state','pbk_runtime_census_entries','pbk_runtime_census_proofs')
), objects AS (
  SELECT 'table:'||t.relname AS name,to_jsonb(t)-'oid' AS description FROM tables t
  UNION ALL
  SELECT 'column:'||t.relname||':'||a.attname,jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),
    'notnull',a.attnotnull,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl)
  FROM tables t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
  UNION ALL
  SELECT 'constraint:'||t.relname||':'||c.conname,to_jsonb(pg_get_constraintdef(c.oid,true))
  FROM tables t JOIN pg_constraint c ON c.conrelid=t.oid
  UNION ALL
  SELECT 'policy:'||t.relname||':'||p.polname,to_jsonb(p)-'oid'-'polrelid'
  FROM tables t JOIN pg_policy p ON p.polrelid=t.oid
  UNION ALL
  SELECT 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl)
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'pbk_census_%'
  UNION ALL
  SELECT 'trigger:'||c.relname||':'||t.tgname,
    jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal
    AND t.tgname IN ('pbk_census_capture','pbk_census_no_truncate','pbk_census_immutable')
  UNION ALL
  SELECT 'index:'||c.relname,jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),
    'valid',i.indisvalid,'ready',i.indisready)
  FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  WHERE c.relnamespace='public'::regnamespace AND
    (c.relname LIKE 'pbk_census_%' OR i.indrelid IN (SELECT oid FROM tables))
)
SELECT coalesce(jsonb_object_agg(name,description ORDER BY name),'{}'::jsonb) FROM objects
$census$;

CREATE OR REPLACE FUNCTION public.pbk_census_verify_installation()
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $census$
SELECT coalesce((SELECT h.installation IS NOT NULL AND h.installation=public.pbk_census_installation()
  FROM public.pbk_runtime_census_head h WHERE h.id=true),false)
$census$;

REVOKE ALL ON FUNCTION public.pbk_census_digest(jsonb),public.pbk_census_bytes(jsonb),
  public.pbk_census_identity(text,text),public.pbk_census_projection(text,jsonb),
  public.pbk_census_in_scope(text,jsonb),public.pbk_census_outcome(text,jsonb),
  public.pbk_census_clock_valid(text,jsonb,timestamptz),public.pbk_census_reject_mutation(),
  public.pbk_census_source_trigger(),public.pbk_census_page(text,text,integer),
  public.pbk_census_journal_page(bigint,bigint,integer),public.pbk_census_installation(),
  public.pbk_census_verify_installation() FROM PUBLIC;

UPDATE public.pbk_runtime_census_head SET installation=public.pbk_census_installation()
WHERE id=true AND installation IS NULL;
DO $guard$
BEGIN
  IF NOT public.pbk_census_verify_installation() THEN RAISE EXCEPTION 'Census installation mismatch'; END IF;
END
$guard$;
