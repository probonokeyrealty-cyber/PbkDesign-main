-- PBK observability layer for Ava turn latency, alerts, and guardrail views.

CREATE TABLE IF NOT EXISTS public.pbk_turn_latency (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  call_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  speech_final_to_reply_start_ms INT,
  turn_completion_ms INT,
  transcript_to_tts_ms INT,
  reply_mode TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  ok BOOLEAN,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_turn_latency_lookup_idx
  ON public.pbk_turn_latency (tenant_id, call_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_turn_latency_perf_idx
  ON public.pbk_turn_latency (tenant_id, turn_completion_ms, speech_final_to_reply_start_ms, created_at DESC);

ALTER TABLE public.pbk_turn_latency ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pbk_observability_alerts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_observability_alerts_lookup_idx
  ON public.pbk_observability_alerts (tenant_id, alert_type, severity, created_at DESC);

ALTER TABLE public.pbk_observability_alerts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW public.guardrail_violations
WITH (security_invoker = true)
AS
SELECT
  id,
  tenant_id,
  tool_name,
  blocked,
  approval_required,
  validation->'violations' AS violations,
  validation->'warnings' AS warnings,
  source,
  created_at
FROM public.pbk_safety_audit
WHERE blocked = true
   OR COALESCE(jsonb_array_length(validation->'violations'), 0) > 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_turn_latency TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_observability_alerts TO service_role;
    GRANT SELECT ON public.guardrail_violations TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pbk_turn_latency'
      AND policyname = 'pbk_turn_latency_service_role_all'
  ) THEN
    CREATE POLICY pbk_turn_latency_service_role_all
      ON public.pbk_turn_latency
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pbk_observability_alerts'
      AND policyname = 'pbk_observability_alerts_service_role_all'
  ) THEN
    CREATE POLICY pbk_observability_alerts_service_role_all
      ON public.pbk_observability_alerts
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
