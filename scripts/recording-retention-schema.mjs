export async function assertRecordingRetentionSchema(pool) {
  if (!pool) throw new Error('Recording retention requires the bridge Postgres connection.');
  const { rows } = await pool.query(`
    WITH required(rel, privileges) AS (
      VALUES
        ('public.approvals', ARRAY['SELECT', 'INSERT', 'UPDATE']),
        ('public.unified_messages', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
        ('public.pbk_recording_retention_approvals', ARRAY['SELECT', 'INSERT', 'UPDATE']),
        ('public.pbk_recording_retention_attempts', ARRAY['SELECT', 'INSERT', 'UPDATE']),
        ('public.pbk_recording_storage_writes', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
    ), relations AS (
      SELECT to_regclass(rel) AS oid, privileges FROM required
    )
    SELECT
      COALESCE((SELECT bool_and(r.oid IS NOT NULL
        AND NOT row_security_active(r.oid)
        AND has_table_privilege(r.oid, p.privilege))
        FROM relations r CROSS JOIN LATERAL unnest(r.privileges) AS p(privilege)), false)
      AND (SELECT count(*) = 2 FROM pg_catalog.pg_trigger
        WHERE tgrelid = to_regclass('public.unified_messages')
          AND tgname IN ('protect_recording_retention_pointer', 'protect_recording_retention_truncate')
          AND (tgenabled = 'A' OR (tgenabled = 'O' AND current_setting('session_replication_role') = 'origin')))
      AND (SELECT count(*) = 2 FROM pg_catalog.pg_attribute
        WHERE attrelid = to_regclass('public.pbk_recording_storage_writes')
          AND attname IN ('rejected_at', 'rejection_code') AND NOT attisdropped)
      AND (SELECT count(*) = 3
        FROM (VALUES ('pbk_recording_storage_active_message', 'message_id'),
          ('pbk_recording_storage_active_key', 'storage_key'),
          ('pbk_recording_storage_active_archive', 'archive_key')) AS expected(index_name, key_name)
        JOIN pg_catalog.pg_index idx ON idx.indexrelid = to_regclass('public.' || expected.index_name)
        JOIN pg_catalog.pg_attribute col ON col.attrelid = idx.indrelid AND col.attname = expected.key_name
        WHERE idx.indrelid = to_regclass('public.pbk_recording_storage_writes')
          AND idx.indisunique AND idx.indisvalid AND idx.indisready
          AND idx.indnatts = 1 AND idx.indkey[0] = col.attnum
          AND pg_get_expr(idx.indpred, idx.indrelid) = '(rejected_at IS NULL)')
      AND has_schema_privilege('public', 'USAGE')
      AND COALESCE(has_function_privilege(
        to_regprocedure('public.pbk_recording_has_untyped_pointer(jsonb)'), 'EXECUTE'), false)
      AS ready`);
  if (rows[0]?.ready !== true) {
    throw new Error('Recording retention schema or runtime-role access is incomplete.');
  }
}
