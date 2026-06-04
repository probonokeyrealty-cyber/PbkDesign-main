ALTER TABLE public.pbk_call_analyses
  ADD COLUMN IF NOT EXISTS transcript TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS pbk_call_analyses_transcript_ready_idx
  ON public.pbk_call_analyses (tenant_id, created_at DESC)
  WHERE NULLIF(BTRIM(transcript), '') IS NOT NULL;
