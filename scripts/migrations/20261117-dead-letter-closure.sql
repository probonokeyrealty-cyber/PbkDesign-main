-- Fixed, reviewed DDL. Only the guarded migration runner installs this schema.
-- The existing trusted server role owns these objects. Owner/superuser DDL is
-- outside the tamper boundary; this is not an authority to execute provider work.
CREATE FUNCTION public.pbk_closure_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $closure$
BEGIN
  RAISE EXCEPTION 'PBK closure ledger is immutable' USING ERRCODE = '55000';
END;
$closure$;

CREATE TABLE public.pbk_dead_letter_closure_ledger (
  id text NOT NULL,
  tenant_id text NOT NULL,
  ordinal bigint GENERATED ALWAYS AS IDENTITY,
  admitted_at timestamptz NOT NULL,
  insert_xid xid8 NOT NULL,
  record_ref text NOT NULL,
  approval_ref text NOT NULL,
  intent_binding text NOT NULL,
  action text NOT NULL,
  previous_id text,
  report jsonb NOT NULL,
  CONSTRAINT pbk_closure_pkey PRIMARY KEY (id),
  CONSTRAINT pbk_closure_ordinal_key UNIQUE (ordinal),
  CONSTRAINT pbk_closure_intent_key UNIQUE (intent_binding),
  CONSTRAINT pbk_closure_previous_fk FOREIGN KEY (previous_id)
    REFERENCES public.pbk_dead_letter_closure_ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT pbk_closure_id_check CHECK (id ~ '^[a-zA-Z0-9_:-]{1,120}$'),
  CONSTRAINT pbk_closure_tenant_check CHECK (tenant_id = 'pbk'),
  CONSTRAINT pbk_closure_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT pbk_closure_admission_check CHECK (pg_catalog.isfinite(admitted_at)),
  CONSTRAINT pbk_closure_xid_check CHECK (insert_xid > '0'::xid8 AND insert_xid = pg_catalog.pg_current_xact_id()),
  CONSTRAINT pbk_closure_record_check CHECK (record_ref ~ '^[a-f0-9]{64}$'),
  CONSTRAINT pbk_closure_approval_check CHECK (approval_ref ~ '^[a-f0-9]{64}$'),
  CONSTRAINT pbk_closure_intent_check CHECK (intent_binding ~ '^[a-f0-9]{64}$'),
  CONSTRAINT pbk_closure_action_check CHECK (action IN ('close_internal', 'revoke_internal')),
  CONSTRAINT pbk_closure_report_check CHECK ((
    pg_catalog.jsonb_typeof(report) = 'object'
    AND pg_catalog.octet_length(report::text) <= 65536
    AND report @> pg_catalog.jsonb_build_object(
      'schemaVersion', 'pbk-dead-letter-closure-v1', 'receiptId', id,
      'tenantId', tenant_id, 'ordinal', ordinal::text,
      'admittedAt', pg_catalog.to_char(admitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'insertXid', insert_xid::text, 'recordRef', record_ref,
      'approvalRef', approval_ref, 'intentBinding', intent_binding, 'action', action)
    AND pg_catalog.jsonb_typeof(report -> 'attestation') = 'object'
    AND report #>> '{attestation,version}' = 'pbk-dead-letter-closure-v1'
    AND report #>> '{attestation,signature}' ~ '^[a-f0-9]{64}$'
    AND CASE WHEN previous_id IS NULL THEN report -> 'predecessor' = 'null'::jsonb
      ELSE pg_catalog.jsonb_typeof(report -> 'predecessor') = 'object'
        AND report #>> '{predecessor,id}' = previous_id END
    AND (action <> 'revoke_internal' OR previous_id IS NOT NULL)
  ) IS TRUE)
);

CREATE INDEX pbk_closure_record_ordinal_idx ON public.pbk_dead_letter_closure_ledger
  USING btree (tenant_id, record_ref, ordinal DESC);
ALTER TABLE public.pbk_dead_letter_closure_ledger ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER pbk_closure_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.pbk_dead_letter_closure_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.pbk_closure_reject_mutation();
ALTER TABLE public.pbk_dead_letter_closure_ledger ENABLE ALWAYS TRIGGER pbk_closure_immutable;

REVOKE ALL ON TABLE public.pbk_dead_letter_closure_ledger FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.pbk_dead_letter_closure_ledger_ordinal_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pbk_closure_reject_mutation() FROM PUBLIC;

-- Existing default privileges can grant browser roles access at object creation.
-- Revoke only these new objects, never source tables or global/default grants.
DO $closure_acl$
DECLARE browser_role text;
BEGIN
  FOR browser_role IN SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon', 'authenticated') AND rolname <> current_user
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.pbk_dead_letter_closure_ledger FROM %I', browser_role);
    EXECUTE pg_catalog.format('REVOKE ALL ON SEQUENCE public.pbk_dead_letter_closure_ledger_ordinal_seq FROM %I', browser_role);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.pbk_closure_reject_mutation() FROM %I', browser_role);
  END LOOP;
END;
$closure_acl$;
