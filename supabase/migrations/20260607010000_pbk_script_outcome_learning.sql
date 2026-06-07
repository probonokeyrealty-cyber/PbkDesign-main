CREATE UNIQUE INDEX IF NOT EXISTS scripts_workspace_id_id_idx
  ON public.scripts (workspace_id, id);

CREATE TABLE IF NOT EXISTS public.pbk_script_outcome_events (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  script_id TEXT NOT NULL,
  lead_id TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  outcome_label TEXT NOT NULL DEFAULT 'observed',
  success BOOLEAN,
  reward NUMERIC,
  deal_value NUMERIC NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id)
);

DO $$
DECLARE
  existing_primary_key TEXT;
BEGIN
  SELECT constraint_name
  INTO existing_primary_key
  FROM information_schema.table_constraints
  WHERE table_schema = 'public'
    AND table_name = 'pbk_script_outcome_events'
    AND constraint_type = 'PRIMARY KEY'
  LIMIT 1;

  IF existing_primary_key IS NOT NULL
     AND pg_get_constraintdef(
       (
         SELECT oid
         FROM pg_constraint
         WHERE conname = existing_primary_key
           AND conrelid = 'public.pbk_script_outcome_events'::regclass
       )
     ) = 'PRIMARY KEY (id)' THEN
    EXECUTE format(
      'ALTER TABLE public.pbk_script_outcome_events DROP CONSTRAINT %I',
      existing_primary_key
    );
    ALTER TABLE public.pbk_script_outcome_events
      ADD PRIMARY KEY (workspace_id, id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pbk_script_outcome_events_workspace_script_fk'
  ) THEN
    ALTER TABLE public.pbk_script_outcome_events
      ADD CONSTRAINT pbk_script_outcome_events_workspace_script_fk
      FOREIGN KEY (workspace_id, script_id)
      REFERENCES public.scripts (workspace_id, id)
      ON DELETE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS pbk_script_outcome_events_script_created_idx
  ON public.pbk_script_outcome_events (workspace_id, script_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_script_outcome_events_call_idx
  ON public.pbk_script_outcome_events (workspace_id, call_id)
  WHERE call_id <> '';

ALTER TABLE public.pbk_script_outcome_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_script_outcome_events TO service_role;
  END IF;
END
$$;
