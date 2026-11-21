BEGIN;

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
REVOKE ALL ON public.pbk_recording_retention_approvals FROM PUBLIC, anon, authenticated, service_role;

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

ALTER TABLE public.pbk_recording_retention_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pbk_recording_retention_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.pbk_recording_retention_attempts TO service_role;

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

CREATE FUNCTION public.pbk_recording_storage_pointers(storage_path text, payload jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT DISTINCT pointer COLLATE "C" FROM unnest(ARRAY[
    storage_path, payload->>'storagePath', payload->>'storage_path',
    payload->>'recordingStoragePath', payload->>'recording_storage_path'
  ]) AS raw(value)
  CROSS JOIN LATERAL (SELECT ltrim(btrim(raw.value,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '/') AS pointer) cleaned
  WHERE pointer <> '';
$$;

CREATE FUNCTION public.protect_recording_retention_pointer() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  incoming text[] := ARRAY[]::text[];
  outgoing text[] := ARRAY[]::text[];
  pointers text[];
  key text;
  keys text[];
BEGIN
  IF TG_OP <> 'DELETE' THEN
    incoming := ARRAY(SELECT public.pbk_recording_storage_pointers(NEW.storage_path, NEW.payload));
  END IF;
  IF TG_OP <> 'INSERT' THEN
    outgoing := ARRAY(SELECT public.pbk_recording_storage_pointers(OLD.storage_path, OLD.payload));
  END IF;
  pointers := incoming || outgoing;
  IF cardinality(pointers) = 0 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted')
    OR row_security_active('public.pbk_recording_retention_attempts'::regclass) THEN
    RAISE EXCEPTION 'Recording pointer requires a current, complete retention view' USING ERRCODE = '55000';
  END IF;
  -- Include bucket-prefixed aliases, and serialize only on candidate keys.
  SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM (
    SELECT unnest(pointers) AS k UNION
    SELECT substr(p, strpos(p, '/') + 1) FROM unnest(pointers) AS p WHERE strpos(p, '/') > 0
  ) variants;
  FOREACH key IN ARRAY keys LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(key, 300501)) THEN
      RAISE EXCEPTION 'Recording pointer is being reserved' USING ERRCODE = '55P03';
    END IF;
  END LOOP;
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
REVOKE ALL ON FUNCTION public.protect_recording_retention_pointer() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_recording_retention_pointer
BEFORE INSERT OR UPDATE OR DELETE ON public.unified_messages
FOR EACH ROW EXECUTE FUNCTION public.protect_recording_retention_pointer();

CREATE FUNCTION public.protect_recording_retention_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  -- TRUNCATE already holds ACCESS EXCLUSIVE, so no new reservation can start.
  IF current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted')
    OR row_security_active('public.pbk_recording_retention_attempts'::regclass)
    OR EXISTS (SELECT 1 FROM public.pbk_recording_retention_attempts WHERE outcome = 'pending') THEN
    RAISE EXCEPTION 'Cannot truncate messages while recording retention is pending or unverified' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_recording_retention_truncate() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_recording_retention_truncate
BEFORE TRUNCATE ON public.unified_messages
FOR EACH STATEMENT EXECUTE FUNCTION public.protect_recording_retention_truncate();

COMMIT;
