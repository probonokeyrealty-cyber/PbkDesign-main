-- PL/pgSQL trigger fields resolve at execution. Check the trigger and runtime
-- retention target/readback columns before installing any retention objects.
DO $$
DECLARE
  missing_columns text;
BEGIN
  SELECT pg_catalog.string_agg(required.column_name, ', ' ORDER BY required.column_name)
  INTO missing_columns
  FROM pg_catalog.unnest(ARRAY[
    'id', 'payload', 'storage_path', 'storage_bucket', 'workspace_id', 'channel',
    'direction', 'created_at', 'recording_url', 'updated_at'
  ]) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = pg_catalog.to_regclass('public.unified_messages')
      AND attname = required.column_name AND attnum > 0 AND NOT attisdropped
  );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Recording retention requires public.unified_messages columns: %', missing_columns
      USING ERRCODE = '42703';
  END IF;
END;
$$;

CREATE TABLE public.pbk_recording_retention_approvals (
  approval_id text PRIMARY KEY REFERENCES public.approvals(id) ON DELETE RESTRICT,
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  founder_approved_at timestamptz,
  founder_proof text COLLATE "C" CHECK (founder_proof ~ '^[a-f0-9]{64}$'),
  consumed_at timestamptz,
  CHECK (expires_at > issued_at),
  CHECK ((founder_approved_at IS NULL) = (founder_proof IS NULL)),
  CHECK (consumed_at IS NULL OR founder_approved_at IS NOT NULL)
);

ALTER TABLE public.pbk_recording_retention_approvals ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.protect_recording_retention_consumption() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL AND OLD.consumed_at IS DISTINCT FROM NEW.consumed_at THEN
    RAISE EXCEPTION 'Recording retention approvals can only be consumed once';
  END IF;
  IF OLD.founder_approved_at IS NOT NULL AND (
    OLD.founder_approved_at IS DISTINCT FROM NEW.founder_approved_at OR OLD.founder_proof IS DISTINCT FROM NEW.founder_proof
  ) THEN
    RAISE EXCEPTION 'Recording retention founder proof cannot change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_recording_retention_consumption
BEFORE UPDATE OF consumed_at, founder_approved_at, founder_proof ON public.pbk_recording_retention_approvals
FOR EACH ROW EXECUTE FUNCTION public.protect_recording_retention_consumption();

CREATE TABLE public.pbk_recording_retention_attempts (
  approval_id text NOT NULL REFERENCES public.pbk_recording_retention_approvals(approval_id) ON DELETE RESTRICT,
  message_id text NOT NULL,
  bucket text NOT NULL,
  storage_key text COLLATE "C" NOT NULL,
  object_version uuid NOT NULL,
  row_version text NOT NULL,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'confirmed', 'not_dispatched')),
  started_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  finished_at timestamptz,
  CHECK ((outcome = 'pending') = (finished_at IS NULL)),
  PRIMARY KEY (approval_id, message_id)
);

-- A confirmed key stays retired. A pending key is quarantined until there is
-- definitive evidence; a different approval must never retry it.
CREATE UNIQUE INDEX pbk_recording_retention_fenced_key
ON public.pbk_recording_retention_attempts (storage_key)
WHERE outcome IN ('pending', 'confirmed');
CREATE INDEX pbk_recording_retention_pending_message
ON public.pbk_recording_retention_attempts (message_id) WHERE outcome = 'pending';

ALTER TABLE public.pbk_recording_retention_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.pbk_recording_storage_writes (
  token uuid PRIMARY KEY,
  message_id text NOT NULL,
  bucket text NOT NULL,
  storage_key text COLLATE "C",
  archive_bucket text COLLATE "C",
  archive_key text COLLATE "C",
  operation text NOT NULL CHECK (operation IN ('capture', 'delete')),
  started_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  rejected_at timestamptz,
  rejection_code text,
  CHECK ((archive_bucket IS NULL) = (archive_key IS NULL)),
  CHECK ((rejected_at IS NULL AND rejection_code IS NULL) OR
    (rejected_at IS NOT NULL AND operation = 'capture' AND rejection_code IS NOT DISTINCT FROM 'InvalidMimeType'))
);

CREATE UNIQUE INDEX pbk_recording_storage_active_message ON public.pbk_recording_storage_writes (message_id) WHERE rejected_at IS NULL;
CREATE UNIQUE INDEX pbk_recording_storage_active_key ON public.pbk_recording_storage_writes (storage_key) WHERE rejected_at IS NULL;
CREATE UNIQUE INDEX pbk_recording_storage_active_archive ON public.pbk_recording_storage_writes (archive_key) WHERE rejected_at IS NULL;

ALTER TABLE public.pbk_recording_storage_writes ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.protect_recording_retention_outcome() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.outcome <> 'pending' OR NEW.outcome = 'pending' THEN
    RAISE EXCEPTION 'Recording retention outcome can only be finalized once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_recording_retention_outcome
BEFORE UPDATE ON public.pbk_recording_retention_attempts
FOR EACH ROW EXECUTE FUNCTION public.protect_recording_retention_outcome();

CREATE FUNCTION public.pbk_trim_recording_path(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT btrim(value,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

CREATE FUNCTION public.pbk_recording_storage_pointers(storage_path text, payload jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT DISTINCT pointer COLLATE "C" FROM unnest(ARRAY[
    to_jsonb(storage_path), payload->'storagePath', payload->'storage_path',
    payload->'recordingStoragePath', payload->'recording_storage_path'
  ]) AS raw(value)
  CROSS JOIN LATERAL (SELECT trim(both '/' FROM regexp_replace(public.pbk_trim_recording_path(raw.value #>> '{}'), '/+', '/', 'g')) AS pointer) cleaned
  WHERE jsonb_typeof(raw.value) = 'string' AND pointer <> '';
$$;

CREATE FUNCTION public.pbk_recording_has_untyped_pointer(payload jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(ARRAY[
    payload->'storagePath', payload->'storage_path', payload->'recordingStoragePath', payload->'recording_storage_path',
    payload->'s3Key',
    payload#>'{s3Archive,key}', payload#>'{s3Archive,storagePath}', payload#>'{s3Archive,s3Key}',
    payload#>'{s3_archive,key}', payload#>'{s3_archive,storagePath}', payload#>'{s3_archive,s3Key}'
  ]) AS raw(value) WHERE jsonb_typeof(raw.value) NOT IN ('string', 'null'));
$$;

CREATE FUNCTION public.pbk_recording_archive_pointers(payload jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT DISTINCT pointer COLLATE "C" FROM (
    SELECT unnest(ARRAY[a->'key', a->'storagePath', a->'s3Key']) AS raw
    FROM unnest(ARRAY[payload->'s3Archive', payload->'s3_archive']) AS a
    UNION ALL SELECT payload->'s3Key'
  ) AS paths
  CROSS JOIN LATERAL (SELECT ltrim(regexp_replace(translate(public.pbk_trim_recording_path(raw #>> '{}'), chr(92), '/'),
    '/+', '/', 'g'), '/') AS pointer) cleaned
  WHERE jsonb_typeof(raw) = 'string' AND pointer <> '';
$$;

CREATE FUNCTION public.protect_recording_retention_pointer() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  incoming text[] := ARRAY[]::text[];
  outgoing text[] := ARRAY[]::text[];
  pointers text[];
  message_ids text[] := ARRAY[]::text[];
  archive_keys text[] := ARRAY[]::text[];
  key text;
  keys text[];
  message_id_key text;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    IF public.pbk_recording_has_untyped_pointer(NEW.payload) THEN
      RAISE EXCEPTION 'Recording pointers must be strings' USING ERRCODE = '23514';
    END IF;
    incoming := ARRAY(SELECT public.pbk_recording_storage_pointers(NEW.storage_path, NEW.payload));
    archive_keys := ARRAY(SELECT public.pbk_recording_archive_pointers(NEW.payload));
    message_ids := array_append(message_ids, NEW.id);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    outgoing := ARRAY(SELECT public.pbk_recording_storage_pointers(OLD.storage_path, OLD.payload));
    archive_keys := archive_keys || ARRAY(SELECT public.pbk_recording_archive_pointers(OLD.payload));
    message_ids := array_append(message_ids, OLD.id);
  END IF;
  pointers := incoming || outgoing;
  FOREACH message_id_key IN ARRAY message_ids LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(message_id_key, 300502)) THEN
      RAISE EXCEPTION 'Recording row is being reserved' USING ERRCODE = '55P03';
    END IF;
  END LOOP;
  IF cardinality(pointers) = 0 AND cardinality(archive_keys) = 0 AND NOT EXISTS (
    SELECT 1 FROM public.pbk_recording_storage_writes WHERE rejected_at IS NULL AND message_id = ANY(message_ids)
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted')
    OR row_security_active('public.pbk_recording_retention_attempts'::regclass)
    OR row_security_active('public.pbk_recording_storage_writes'::regclass) THEN
    RAISE EXCEPTION 'Recording pointer requires a current, complete retention view' USING ERRCODE = '55000';
  END IF;
  -- Include bucket-prefixed aliases, and serialize only on candidate keys.
  SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM (
    SELECT unnest(pointers) AS k UNION
    SELECT substr(p, strpos(p, '/') + 1) FROM unnest(pointers) AS p WHERE strpos(p, '/') > 0
  ) variants;
  FOREACH key IN ARRAY coalesce(keys, ARRAY[]::text[]) LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(key, 300501)) THEN
      RAISE EXCEPTION 'Recording pointer is being reserved' USING ERRCODE = '55P03';
    END IF;
  END LOOP;
  FOREACH key IN ARRAY archive_keys LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(key, 300503)) THEN
      RAISE EXCEPTION 'Recording archive is being reserved' USING ERRCODE = '55P03';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.pbk_recording_storage_writes w
    WHERE w.rejected_at IS NULL AND (w.message_id = ANY(message_ids) OR w.archive_key = ANY(archive_keys) OR (w.storage_key = ANY(keys)
      AND (w.storage_key = ANY(pointers) OR (w.bucket || '/' || w.storage_key) = ANY(pointers))))
      AND w.token::text COLLATE "C" IS DISTINCT FROM current_setting('pbk.recording_storage_write', true) COLLATE "C"
  ) THEN
    RAISE EXCEPTION 'Recording pointer has an active storage write' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pbk_recording_retention_attempts a
    WHERE a.storage_key = ANY(keys) AND a.outcome IN ('pending', 'confirmed')
      AND (a.storage_key = ANY(incoming) OR (a.bucket || '/' || a.storage_key) = ANY(incoming)
        OR (a.outcome = 'pending' AND (a.storage_key = ANY(outgoing) OR (a.bucket || '/' || a.storage_key) = ANY(outgoing))))
  ) THEN
    RAISE EXCEPTION 'Recording pointer is quarantined or retired' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER protect_recording_retention_pointer
BEFORE INSERT OR UPDATE OR DELETE ON public.unified_messages
FOR EACH ROW EXECUTE FUNCTION public.protect_recording_retention_pointer();

CREATE FUNCTION public.protect_recording_retention_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  -- TRUNCATE already holds ACCESS EXCLUSIVE, so no new reservation can start.
  IF current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted')
    OR row_security_active('public.pbk_recording_retention_attempts'::regclass)
    OR row_security_active('public.pbk_recording_storage_writes'::regclass)
    OR EXISTS (SELECT 1 FROM public.pbk_recording_retention_attempts WHERE outcome = 'pending')
    OR EXISTS (SELECT 1 FROM public.pbk_recording_storage_writes WHERE rejected_at IS NULL) THEN
    RAISE EXCEPTION 'Cannot truncate messages while recording retention is pending or unverified' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER protect_recording_retention_truncate
BEFORE TRUNCATE ON public.unified_messages
FOR EACH STATEMENT EXECUTE FUNCTION public.protect_recording_retention_truncate();

REVOKE ALL ON TABLE public.pbk_recording_retention_approvals, public.pbk_recording_retention_attempts,
  public.pbk_recording_storage_writes FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_recording_retention_pointer(),
  public.protect_recording_retention_truncate() FROM PUBLIC;

-- These roles are optional on a plain PostgreSQL target.
DO $$
DECLARE
  role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.pbk_recording_retention_approvals,
      public.pbk_recording_retention_attempts, public.pbk_recording_storage_writes FROM %I', role_name);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.protect_recording_retention_pointer(),
      public.protect_recording_retention_truncate() FROM %I', role_name);
    IF role_name = 'service_role' THEN
      GRANT SELECT ON TABLE public.pbk_recording_retention_attempts, public.pbk_recording_storage_writes TO service_role;
    END IF;
  END LOOP;
END;
$$;
