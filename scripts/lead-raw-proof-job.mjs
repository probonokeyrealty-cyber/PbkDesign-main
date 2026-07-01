#!/usr/bin/env node
import pg from 'pg';

const { Pool } = pg;

const modeArg = String(process.argv[2] || process.env.PBK_LEAD_RAW_PROOF_ID || '').trim();
const auditMode = modeArg === '--audit' || String(process.env.PBK_LEAD_RAW_PROOF_MODE || '').trim() === 'audit';
const reconcileMode =
  modeArg === '--reconcile' ||
  modeArg === '--reconcile-dry-run' ||
  String(process.env.PBK_LEAD_RAW_PROOF_MODE || '').trim() === 'reconcile';
const applyReconcile =
  modeArg === '--reconcile' ||
  String(process.env.PBK_LEAD_RAW_RECONCILE_CONFIRM || '').trim().toLowerCase() === 'apply';
const leadId = auditMode || reconcileMode ? '' : modeArg;

if (!auditMode && !reconcileMode && !leadId) {
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

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function plainRecord(value) {
  return isRecord(value) ? { ...value } : {};
}

function hasRecordValues(value) {
  return isRecord(value) && Object.keys(value).length > 0;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function normalizePath(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (/creative|seller.?finance|carry/.test(text)) return 'creative-finance';
  if (/mortgage|subject|sub.?to|takeover/.test(text)) return 'mortgage-takeover';
  if (/rbp|retail|novation/.test(text)) return 'rbp';
  if (/land|lot|parcel/.test(text)) return 'land';
  return text || 'cash';
}

function pathLabel(value = '') {
  const path = normalizePath(value);
  if (path === 'creative-finance') return 'Creative Finance';
  if (path === 'mortgage-takeover') return 'Mortgage Takeover';
  if (path === 'rbp') return 'RBP / Novation';
  if (path === 'land') return 'Land';
  return 'Cash Offer';
}

function normalizeTags(value = []) {
  return Array.isArray(value)
    ? value.map((tag) => String(tag || '').trim()).filter(Boolean)
    : String(value || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function buildAnalyzerIndexes(analyzerRuns = []) {
  const byLeadId = new Map();
  const byAddress = new Map();
  const sorted = [...analyzerRuns].sort((left, right) =>
    String(right?.createdAt || '').localeCompare(String(left?.createdAt || ''))
  );
  for (const run of sorted) {
    if (!isRecord(run)) continue;
    const leadId = firstText(run.leadId, run.lead_id);
    const address = firstText(run.address, run.propertyAddress, run.property_address).toLowerCase();
    if (leadId && !byLeadId.has(leadId)) byLeadId.set(leadId, run);
    if (address && !byAddress.has(address)) byAddress.set(address, run);
  }
  return { byLeadId, byAddress, total: sorted.length };
}

function findAnalyzerRunForRow(row = {}, raw = {}, analyzerIndex = {}) {
  const leadIds = [
    row.id,
    raw.leadId,
    raw.lead_id,
    raw.id,
    raw.externalId,
    raw.external_id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  for (const leadId of leadIds) {
    const run = analyzerIndex.byLeadId?.get(leadId);
    if (run) return run;
  }
  const address = firstText(
    row.address,
    raw.address,
    raw.propertyAddress,
    raw.property_address,
    raw.property?.address
  ).toLowerCase();
  return address ? analyzerIndex.byAddress?.get(address) || null : null;
}

function buildAnalyzerPatch(run = {}) {
  if (!isRecord(run)) return {};
  return {
    runId: firstText(run.id, run.runId, run.run_id),
    address: firstText(run.address, run.propertyAddress, run.property_address),
    arv: firstValue(run.arv, run.analysis?.arv),
    mao: firstValue(run.mao, run.analysis?.mao),
    maoRbp: firstValue(run.maoRbp, run.maoRBP, run.analysis?.maoRbp, run.analysis?.maoRBP),
    targetOffer: firstValue(run.targetOffer, run.offer, run.analysis?.targetOffer),
    repairsMid: firstValue(run.repairsMid, run.analysis?.repairsMid),
    estProfit: firstValue(run.estProfit, run.analysis?.estProfit),
    updatedAt: firstText(run.createdAt, run.updatedAt),
  };
}

function reconcileLeadRaw(row = {}, analyzerIndex = {}, now = new Date().toISOString()) {
  const raw = plainRecord(row.raw);
  const sellerRaw = plainRecord(raw.seller);
  const propertyRaw = plainRecord(raw.property);
  const motivationRaw = plainRecord(raw.motivation);
  const complianceRaw = plainRecord(raw.compliance);
  const assignmentRaw = plainRecord(raw.assignment);
  const leadProfileRaw = plainRecord(raw.leadProfile || raw.lead_profile);
  const portalRaw = plainRecord(raw.portalRecord || raw.portal_record);
  const existingCallContext = plainRecord(raw.callContext || raw.call_context);
  const analyzerRun = findAnalyzerRunForRow(row, raw, analyzerIndex);
  const analyzerPatch = buildAnalyzerPatch(analyzerRun);
  const selectedPath = normalizePath(
    firstText(
      raw.selectedPath,
      raw.selected_path,
      raw.path,
      raw.dealPath,
      existingCallContext.selectedPath,
      existingCallContext.selected_path,
      propertyRaw.propertyType,
      propertyRaw.type
    )
  );
  const seller = {
    ...sellerRaw,
    name: firstText(sellerRaw.name, raw.leadName, raw.name, row.lead_name, 'Unknown seller'),
    phone: firstText(sellerRaw.phone, raw.phone, row.phone),
    email: firstText(sellerRaw.email, raw.email, row.email),
    preferredChannel: firstText(sellerRaw.preferredChannel, raw.preferredChannel, 'unknown'),
    bestTimeToCall: firstText(sellerRaw.bestTimeToCall, raw.bestTimeToCall),
    relationshipToProperty: firstText(sellerRaw.relationshipToProperty, raw.relationship, row.owner_type),
    notes: firstText(sellerRaw.notes, raw.sellerNotes),
  };
  const property = {
    ...propertyRaw,
    address: firstText(propertyRaw.address, raw.address, raw.propertyAddress, row.address),
    city: firstText(propertyRaw.city, raw.city, row.city),
    state: firstText(propertyRaw.state, raw.state, row.state),
    zip: firstText(propertyRaw.zip, propertyRaw.postalCode, raw.zip, raw.zipCode, row.postal_code),
    propertyType: firstText(propertyRaw.propertyType, propertyRaw.type, raw.propertyType, raw.property_type),
    askingPrice: firstValue(propertyRaw.askingPrice, raw.askingPrice, motivationRaw.askingPrice),
    arv: firstValue(propertyRaw.arv, raw.arv, analyzerPatch.arv),
    mao: firstValue(propertyRaw.mao, raw.mao, analyzerPatch.mao),
    maoRbp: firstValue(propertyRaw.maoRbp, propertyRaw.maoRBP, raw.maoRbp, raw.maoRBP, analyzerPatch.maoRbp),
    targetOffer: firstValue(propertyRaw.targetOffer, raw.targetOffer, analyzerPatch.targetOffer),
    estimatedRepairs: firstValue(propertyRaw.estimatedRepairs, propertyRaw.repairsMid, raw.estimatedRepairs, analyzerPatch.repairsMid),
    mortgageBalance: firstValue(propertyRaw.mortgageBalance, raw.mortgageBalance),
    lastAnalyzerRunId: firstText(propertyRaw.lastAnalyzerRunId, analyzerPatch.runId),
    lastAnalyzerAt: firstText(propertyRaw.lastAnalyzerAt, analyzerPatch.updatedAt),
  };
  const motivation = {
    ...motivationRaw,
    summary: firstText(motivationRaw.summary, raw.motivationSummary, raw.motivation),
    timeline: firstText(motivationRaw.timeline, raw.timeline, 'unknown'),
    askingPrice: firstValue(motivationRaw.askingPrice, property.askingPrice),
  };
  const compliance = {
    ...complianceRaw,
    tcpaConsent: firstText(complianceRaw.tcpaConsent, complianceRaw.consentStatus, raw.tcpaConsent, raw.consentStatus, 'unknown'),
    consentStatus: firstText(complianceRaw.consentStatus, complianceRaw.tcpaConsent, raw.consentStatus, raw.tcpaConsent, 'unknown'),
    dncStatus: firstText(complianceRaw.dncStatus, raw.dncStatus, row.dnc ? 'dnc' : '', 'needs_review'),
  };
  const assignment = {
    ...assignmentRaw,
    assignedAgent: firstText(assignmentRaw.assignedAgent, raw.assignedAgent, row.assigned_agent, 'Ava'),
    campaign: firstText(assignmentRaw.campaign, raw.campaign),
  };
  const leadProfile = {
    ...leadProfileRaw,
    seller: { ...plainRecord(leadProfileRaw.seller), ...seller },
    property: { ...plainRecord(leadProfileRaw.property), ...property },
    motivation: { ...plainRecord(leadProfileRaw.motivation), ...motivation },
    compliance: { ...plainRecord(leadProfileRaw.compliance), ...compliance },
    assignment: { ...plainRecord(leadProfileRaw.assignment), ...assignment },
    tags: normalizeTags(raw.tags),
    notes: firstValue(raw.notes, raw.internalNotes, ''),
    score: firstValue(raw.score, row.motivation_score),
    source: firstText(raw.source, row.source, 'manual'),
    stage: firstText(raw.stage, row.stage, raw.status, row.status, 'new'),
  };
  const liveCallDetailsBase = plainRecord(raw.liveCallDetails || raw.live_call_details || existingCallContext);
  const liveCallDetails = {
    ...liveCallDetailsBase,
    preferredChannel: firstText(liveCallDetailsBase.preferredChannel, seller.preferredChannel),
    bestTimeToCall: firstText(liveCallDetailsBase.bestTimeToCall, seller.bestTimeToCall),
    relationship: firstText(liveCallDetailsBase.relationship, seller.relationshipToProperty),
    selectedPath,
    selected_path: selectedPath,
    selectedPathLabel: pathLabel(selectedPath),
    assignedAgent: firstText(liveCallDetailsBase.assignedAgent, assignment.assignedAgent),
    tcpaConsent: firstText(liveCallDetailsBase.tcpaConsent, compliance.tcpaConsent),
    dncStatus: firstText(liveCallDetailsBase.dncStatus, compliance.dncStatus),
    lastAnalyzerRunId: firstText(liveCallDetailsBase.lastAnalyzerRunId, analyzerPatch.runId),
    lastAnalyzerAt: firstText(liveCallDetailsBase.lastAnalyzerAt, analyzerPatch.updatedAt),
  };
  const contractBase = plainRecord(raw.contractContext || raw.contract_context || raw.contracts);
  const contracts = {
    ...contractBase,
    sellerName: firstText(contractBase.sellerName, seller.name),
    sellerEmail: firstText(contractBase.sellerEmail, seller.email),
    sellerPhone: firstText(contractBase.sellerPhone, seller.phone),
    propertyAddress: firstText(contractBase.propertyAddress, property.address),
    askingPrice: firstValue(contractBase.askingPrice, property.askingPrice),
    arv: firstValue(contractBase.arv, property.arv),
    mao: firstValue(contractBase.mao, property.mao),
    estimatedRepairs: firstValue(contractBase.estimatedRepairs, property.estimatedRepairs),
    selectedPath: firstText(contractBase.selectedPath, selectedPath),
    readyForDraft: contractBase.readyForDraft ?? Boolean(seller.email && property.address),
    lastAnalyzerRunId: firstText(contractBase.lastAnalyzerRunId, analyzerPatch.runId),
  };
  const approvalBase = plainRecord(raw.approvalContext || raw.approval_context || raw.approvals);
  const approvals = {
    ...approvalBase,
    requiredForContract: approvalBase.requiredForContract ?? true,
    requiredForFirstOutbound:
      approvalBase.requiredForFirstOutbound ??
      (String(compliance.tcpaConsent).toLowerCase() !== 'yes' ||
        String(compliance.dncStatus).toLowerCase() !== 'clear'),
    compliance: {
      ...plainRecord(approvalBase.compliance),
      ...compliance,
    },
  };
  const analyzer =
    hasRecordValues(raw.analyzer)
      ? raw.analyzer
      : hasRecordValues(analyzerPatch)
        ? analyzerPatch
        : plainRecord(raw.analyzer);
  const provenanceBase =
    raw.fieldProvenance !== undefined
      ? raw.fieldProvenance
      : raw.field_provenance !== undefined
        ? raw.field_provenance
        : [];
  const provenance = Array.isArray(provenanceBase)
    ? provenanceBase
    : hasRecordValues(provenanceBase)
      ? [provenanceBase]
      : [];
  const provenanceWithBackfill = provenance.some((item) => item?.source === 'lead-storage-reconcile')
    ? provenance
    : [
        ...provenance,
        {
          field: 'leadStorageContext',
          source: 'lead-storage-reconcile',
          confidence: 1,
          reason: 'Backfilled missing lead context from existing lead, analyzer, and scalar profile fields.',
          at: now,
        },
      ];
  const portalRecord = {
    portalVersion: portalRaw.portalVersion || 'pbk-lead-portal-v1',
    source: portalRaw.source || firstText(raw.source, row.source, 'manual'),
    ...portalRaw,
    leadProfile,
    lead_profile: leadProfile,
    contracts,
    approvals,
    liveCallDetails,
    live_call_details: liveCallDetails,
    ava: {
      ...plainRecord(portalRaw.ava),
      assignedAgent: firstText(plainRecord(portalRaw.ava).assignedAgent, assignment.assignedAgent),
      notes: firstText(plainRecord(portalRaw.ava).notes, seller.notes),
      callContext: {
        ...plainRecord(plainRecord(portalRaw.ava).callContext),
        ...liveCallDetails,
      },
    },
  };
  const nextRaw = {
    ...raw,
    id: firstText(raw.id, row.id),
    leadId: firstText(raw.leadId, raw.lead_id, row.id),
    source: firstText(raw.source, row.source, 'manual'),
    leadSource: firstText(raw.leadSource, raw.lead_source, raw.source, row.source, 'manual'),
    status: firstText(raw.status, row.status, 'new'),
    stage: firstText(raw.stage, row.stage, raw.status, row.status, 'new'),
    seller,
    property,
    motivation,
    compliance,
    assignment,
    leadProfile,
    lead_profile: leadProfile,
    portalRecord,
    portal_record: portalRecord,
    contracts,
    contractContext: contracts,
    contract_context: contracts,
    approvals,
    approvalContext: approvals,
    approval_context: approvals,
    liveCallDetails,
    live_call_details: liveCallDetails,
    analyzer,
    selectedPath,
    selected_path: selectedPath,
    fieldProvenance: provenanceWithBackfill,
    field_provenance: provenanceWithBackfill,
    updatedAt: now,
  };
  return {
    nextRaw,
    changed: JSON.stringify(raw) !== JSON.stringify(nextRaw),
    analyzerMatched: Boolean(analyzerRun),
    analyzerBackfilled: !hasRecordValues(raw.analyzer) && hasRecordValues(analyzer),
  };
}

try {
  if (auditMode) {
    const result = await pool.query(
      `SELECT
        count(*)::INT AS total,
        count(*) FILTER (WHERE raw ? 'leadProfile')::INT AS has_lead_profile,
        count(*) FILTER (WHERE raw ? 'portalRecord')::INT AS has_portal_record,
        count(*) FILTER (WHERE raw ? 'contractContext')::INT AS has_contract_context,
        count(*) FILTER (WHERE raw ? 'approvalContext')::INT AS has_approval_context,
        count(*) FILTER (WHERE raw ? 'fieldProvenance')::INT AS has_field_provenance,
        count(*) FILTER (WHERE NOT (raw ? 'contractContext'))::INT AS missing_contract_context,
        count(*) FILTER (WHERE NOT (raw ? 'approvalContext'))::INT AS missing_approval_context
      FROM public.lead_profiles
      WHERE workspace_id = 'pbk'`
    );

    console.log(`PBK_LEAD_RAW_AUDIT ${JSON.stringify(result.rows[0] || { total: 0 })}`);
    process.exitCode = 0;
  } else if (reconcileMode) {
    const [leadResult, bridgeResult] = await Promise.all([
      pool.query(
        `SELECT id, source, status, stage, lead_name, email, phone, address, city, state,
          postal_code, owner_type, motivation_score, dnc, dnc_reason, assigned_agent,
          raw, created_at, updated_at
        FROM public.lead_profiles
        WHERE workspace_id = 'pbk'
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`
      ),
      pool.query(`SELECT data->'analyzerRuns' AS analyzer_runs FROM bridge_state WHERE id = 'singleton' LIMIT 1`).catch(
        () => ({ rows: [] })
      ),
    ]);
    const analyzerRuns = Array.isArray(bridgeResult.rows[0]?.analyzer_runs)
      ? bridgeResult.rows[0].analyzer_runs
      : [];
    const analyzerIndex = buildAnalyzerIndexes(analyzerRuns);
    const now = new Date().toISOString();
    const planned = [];
    for (const row of leadResult.rows) {
      const reconciliation = reconcileLeadRaw(row, analyzerIndex, now);
      if (!reconciliation.changed) continue;
      planned.push({
        id: row.id,
        raw: reconciliation.nextRaw,
        analyzerMatched: reconciliation.analyzerMatched,
        analyzerBackfilled: reconciliation.analyzerBackfilled,
      });
    }

    if (applyReconcile) {
      for (const item of planned) {
        await pool.query(
          `UPDATE public.lead_profiles
           SET raw = $2::jsonb, updated_at = NOW()
           WHERE workspace_id = 'pbk' AND id = $1`,
          [item.id, JSON.stringify(item.raw)]
        );
      }
    }

    console.log(
      `PBK_LEAD_RAW_RECONCILE ${JSON.stringify({
        ok: true,
        applied: applyReconcile,
        total: leadResult.rows.length,
        changed: planned.length,
        analyzerRuns: analyzerIndex.total,
        analyzerMatched: planned.filter((item) => item.analyzerMatched).length,
        analyzerBackfilled: planned.filter((item) => item.analyzerBackfilled).length,
        ids: planned.map((item) => item.id).slice(0, 30),
      })}`
    );
  } else {
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
  }
} catch (error) {
  console.error(`PBK_LEAD_RAW_PROOF_ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
