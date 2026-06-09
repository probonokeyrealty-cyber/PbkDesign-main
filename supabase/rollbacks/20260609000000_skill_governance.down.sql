-- Rollback for 20260609000000_skill_governance.sql.
-- Do not place this file in supabase/migrations; the PBK migration runner applies
-- every SQL file in that folder. Run manually only if intentionally reverting the
-- Skill Studio authority schema.

DROP TABLE IF EXISTS public.skill_projection_outbox;
DROP TABLE IF EXISTS public.skill_audit_events;
DROP TABLE IF EXISTS public.skill_activations;
DROP TABLE IF EXISTS public.agent_skill_assignments;
DROP TABLE IF EXISTS public.skill_approvals;
DROP TABLE IF EXISTS public.skill_versions;
DROP TABLE IF EXISTS public.skill_definitions;
