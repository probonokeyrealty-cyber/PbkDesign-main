-- Finish PBK's public-schema containment.
--
-- The first lockdown removed direct anon/authenticated grants. Supabase's
-- default PUBLIC schema privilege still granted inherited USAGE, and pgvector
-- routines remained exposed because the extension was installed in public.

REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension extension_record
    JOIN pg_namespace extension_namespace
      ON extension_namespace.oid = extension_record.extnamespace
    WHERE extension_record.extname = 'vector'
      AND extension_record.extrelocatable
      AND extension_namespace.nspname = 'public'
  ) THEN
    ALTER EXTENSION vector SET SCHEMA extensions;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA extensions TO service_role;
