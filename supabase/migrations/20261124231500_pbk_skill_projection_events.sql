CREATE TABLE IF NOT EXISTS public.pbk_skill_projection_events (
  event_id uuid PRIMARY KEY,
  audit_event_id uuid NOT NULL,
  workspace_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  skill_version_id uuid,
  event_type text NOT NULL,
  authority_version bigint NOT NULL,
  schema_version integer NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  is_tombstone boolean NOT NULL,
  source_created_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pbk_skill_projection_latest_idx
  ON public.pbk_skill_projection_events (
    workspace_id, aggregate_type, aggregate_id,
    authority_version DESC, source_created_at DESC, event_id DESC
  );

ALTER TABLE public.pbk_skill_projection_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pbk_skill_projection_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.pbk_skill_projection_events TO service_role;

CREATE OR REPLACE VIEW public.pbk_skill_projection_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (workspace_id, aggregate_type, aggregate_id) *
FROM public.pbk_skill_projection_events
ORDER BY workspace_id, aggregate_type, aggregate_id,
  authority_version DESC, source_created_at DESC, event_id DESC;

REVOKE ALL ON public.pbk_skill_projection_latest FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.pbk_skill_projection_latest TO service_role;
NOTIFY pgrst, 'reload schema';
