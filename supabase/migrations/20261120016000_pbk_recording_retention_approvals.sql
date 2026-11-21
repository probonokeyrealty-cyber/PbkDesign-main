BEGIN;

CREATE TABLE public.pbk_recording_retention_approvals (
  approval_id text PRIMARY KEY REFERENCES public.approvals(id) ON DELETE RESTRICT,
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > issued_at)
);

ALTER TABLE public.pbk_recording_retention_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pbk_recording_retention_approvals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.pbk_recording_retention_approvals TO service_role;
GRANT UPDATE (consumed_at) ON public.pbk_recording_retention_approvals TO service_role;

CREATE FUNCTION public.protect_recording_retention_consumption() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION 'Recording retention approvals can only be consumed once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_recording_retention_consumption
BEFORE UPDATE OF consumed_at ON public.pbk_recording_retention_approvals
FOR EACH ROW EXECUTE FUNCTION public.protect_recording_retention_consumption();

COMMIT;
