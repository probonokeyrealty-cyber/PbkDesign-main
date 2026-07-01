#!/usr/bin/env node
import pg from 'pg';

const { Pool } = pg;

const leadId = String(process.argv[2] || process.env.PBK_LEAD_RAW_PROOF_ID || '').trim();

if (!leadId) {
  console.error('PBK_LEAD_RAW_PROOF_ERROR missing lead id argument');
  process.exit(1);
}

const connectionString = String(process.env.PBK_DATABASE_URL || process.env.DATABASE_URL || '').trim();

if (!connectionString) {
  console.error('PBK_LEAD_RAW_PROOF_ERROR missing PBK_DATABASE_URL or DATABASE_URL');
  process.exit(1);
}

const requiredBooleans = [
  'hasLeadProfile',
  'hasLeadProfileAlias',
  'hasPortalRecord',
  'hasPortalRecordAlias',
  'hasContracts',
  'hasContractContext',
  'hasContractContextAlias',
  'hasApprovals',
  'hasApprovalContext',
  'hasApprovalContextAlias',
  'hasLiveCallDetails',
  'hasLiveCallDetailsAlias',
  'hasFieldProvenance',
  'hasFieldProvenanceAlias',
];

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  const result = await pool.query(
    `SELECT jsonb_build_object(
      'id', id,
      'email', email,
      'address', address,
      'hasLeadProfile', raw ? 'leadProfile',
      'hasLeadProfileAlias', raw ? 'lead_profile',
      'hasPortalRecord', raw ? 'portalRecord',
      'hasPortalRecordAlias', raw ? 'portal_record',
      'hasContracts', raw ? 'contracts',
      'hasContractContext', raw ? 'contractContext',
      'hasContractContextAlias', raw ? 'contract_context',
      'hasApprovals', raw ? 'approvals',
      'hasApprovalContext', raw ? 'approvalContext',
      'hasApprovalContextAlias', raw ? 'approval_context',
      'hasLiveCallDetails', raw ? 'liveCallDetails',
      'hasLiveCallDetailsAlias', raw ? 'live_call_details',
      'hasFieldProvenance', raw ? 'fieldProvenance',
      'hasFieldProvenanceAlias', raw ? 'field_provenance',
      'leadProfileCustom', raw #>> '{leadProfile,customProofField}',
      'portalCustom', raw #>> '{portalRecord,customPortalField}',
      'contractCustom', raw #>> '{contractContext,customContractField}',
      'approvalCustom', raw #>> '{approvalContext,customApprovalField}',
      'callCustom', raw #>> '{liveCallDetails,customCallField}',
      'provenanceType', jsonb_typeof(raw->'fieldProvenance')
    ) AS proof
    FROM public.lead_profiles
    WHERE workspace_id = 'pbk' AND id = $1`,
    [leadId]
  );

  const proof = result.rows[0]?.proof || { id: leadId, missing: true };
  const missing = proof.missing ? ['lead_profiles row'] : requiredBooleans.filter((key) => proof[key] !== true);
  const customMissing = [
    ['leadProfileCustom', 'lead-profile-preserved'],
    ['portalCustom', 'portal-preserved'],
    ['contractCustom', 'contract-preserved'],
    ['approvalCustom', 'approval-preserved'],
    ['callCustom', 'call-preserved'],
    ['provenanceType', 'array'],
  ].filter(([key, expected]) => proof[key] !== expected);

  console.log(
    `PBK_LEAD_RAW_PROOF ${JSON.stringify({
      ok: missing.length === 0 && customMissing.length === 0,
      leadId,
      proof,
      missing,
      customMissing: customMissing.map(([key, expected]) => ({ key, expected, actual: proof[key] ?? null })),
    })}`
  );

  if (missing.length || customMissing.length) process.exitCode = 1;
} catch (error) {
  console.error(`PBK_LEAD_RAW_PROOF_ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
