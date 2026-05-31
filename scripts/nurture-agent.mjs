const STOP_REPLY_PATTERN = /\b(stop|unsubscribe|cancel|end|remove me)\b/i;

function sqlJson(value) {
  return JSON.stringify(value && typeof value === 'object' ? value : {});
}

function normalizeStage(value = '') {
  return (
    String(value || '')
      .trim()
      .toLowerCase() || 'warm'
  );
}

function renderTemplate(template = '', lead = {}) {
  const replacements = {
    name: lead.first_name || lead.lead_name || lead.name || 'Seller',
    address: lead.address || 'your property',
    phone: lead.phone || '',
    email: lead.email || '',
  };
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => String(replacements[key] ?? ''));
}

export async function ensureNurtureSchema(pool) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable' };
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS public.lead_profiles (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      external_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'nurture-agent',
      status TEXT NOT NULL DEFAULT 'new',
      stage TEXT NOT NULL DEFAULT 'warm',
      temperature TEXT NOT NULL DEFAULT 'warm',
      lead_name TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      owner_type TEXT NOT NULL DEFAULT '',
      participant_role TEXT NOT NULL DEFAULT '',
      motivation_score NUMERIC NOT NULL DEFAULT 0,
      engagement_score NUMERIC NOT NULL DEFAULT 0,
      dnc BOOLEAN NOT NULL DEFAULT FALSE,
      dnc_reason TEXT NOT NULL DEFAULT '',
      assigned_agent TEXT NOT NULL DEFAULT 'Ava',
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE public.lead_profiles
      ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'pbk',
      ADD COLUMN IF NOT EXISTS external_id TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'nurture-agent',
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'warm',
      ADD COLUMN IF NOT EXISTS temperature TEXT NOT NULL DEFAULT 'warm',
      ADD COLUMN IF NOT EXISTS lead_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS participant_role TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS motivation_score NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS engagement_score NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS dnc BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS dnc_reason TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS assigned_agent TEXT NOT NULL DEFAULT 'Ava',
      ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS public.nurture_sequence_templates (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id TEXT NOT NULL DEFAULT 'pbk',
      name TEXT NOT NULL,
      trigger_stage TEXT NOT NULL,
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.nurture_instances (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id TEXT NOT NULL DEFAULT 'pbk',
      lead_id TEXT NOT NULL,
      template_id TEXT REFERENCES public.nurture_sequence_templates(id) ON DELETE SET NULL,
      current_step INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      pause_reason TEXT NOT NULL DEFAULT '',
      next_step_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.nurture_step_logs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id TEXT NOT NULL DEFAULT 'pbk',
      nurture_instance_id TEXT REFERENCES public.nurture_instances(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL DEFAULT '',
      step_index INT NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT '',
      message_sent TEXT NOT NULL DEFAULT '',
      sent_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS nurture_templates_stage_idx
      ON public.nurture_sequence_templates (tenant_id, trigger_stage, is_active);
    CREATE INDEX IF NOT EXISTS lead_profiles_stage_idx
      ON public.lead_profiles (workspace_id, stage, updated_at DESC);
    CREATE INDEX IF NOT EXISTS nurture_instances_lead_idx
      ON public.nurture_instances (tenant_id, lead_id, status);
    CREATE INDEX IF NOT EXISTS nurture_instances_status_next_idx
      ON public.nurture_instances (tenant_id, status, next_step_at);
    CREATE INDEX IF NOT EXISTS nurture_step_logs_instance_idx
      ON public.nurture_step_logs (tenant_id, nurture_instance_id, created_at DESC);
  `);

  await pool.query(
    `INSERT INTO public.nurture_sequence_templates (id, tenant_id, name, trigger_stage, steps, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,TRUE,NOW(),NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       trigger_stage = EXCLUDED.trigger_stage,
       steps = EXCLUDED.steps,
       is_active = TRUE,
       updated_at = NOW()`,
    [
      'pbk-default-probate-warmup',
      'pbk',
      'Probate Warm-up',
      'warm',
      JSON.stringify([
        {
          channel: 'sms',
          delay_hours: 0,
          template:
            'Hey {name}, we have a buyer ready for {address}. Want me to send the cash number?',
        },
        {
          channel: 'email',
          delay_hours: 48,
          template:
            'Still interested in a simple sale for {address}? I can make this easy and no-pressure.',
        },
        { channel: 'call', delay_hours: 72, template: '' },
      ]),
    ]
  );
  return { ok: true };
}

async function upsertLeadProfileFromParams(pool, params = {}) {
  const leadId = String(params.leadId || params.lead_id || params.id || '').trim();
  if (!leadId) return null;
  const fullName = String(params.leadName || params.lead_name || params.name || '').trim();
  const firstName = String(
    params.firstName || params.first_name || fullName.split(/\s+/)[0] || ''
  ).trim();
  const lastName = String(
    params.lastName || params.last_name || fullName.split(/\s+/).slice(1).join(' ') || ''
  ).trim();
  await pool.query(
    `INSERT INTO public.lead_profiles (
       id, workspace_id, external_id, source, status, stage, temperature,
       lead_name, first_name, last_name, email, phone, address, city, state,
       postal_code, motivation_score, engagement_score, assigned_agent, raw, created_at, updated_at
     )
     VALUES (
       $1,'pbk',$2,$3,$4,$5,$6,
       $7,$8,$9,$10,$11,$12,$13,$14,
       $15,$16,$17,$18,$19::jsonb,NOW(),NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       external_id = COALESCE(NULLIF(EXCLUDED.external_id, ''), public.lead_profiles.external_id),
       source = COALESCE(NULLIF(EXCLUDED.source, ''), public.lead_profiles.source),
       status = COALESCE(NULLIF(EXCLUDED.status, ''), public.lead_profiles.status),
       stage = COALESCE(NULLIF(EXCLUDED.stage, ''), public.lead_profiles.stage),
       temperature = COALESCE(NULLIF(EXCLUDED.temperature, ''), public.lead_profiles.temperature),
       lead_name = COALESCE(NULLIF(EXCLUDED.lead_name, ''), public.lead_profiles.lead_name),
       first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), public.lead_profiles.first_name),
       last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), public.lead_profiles.last_name),
       email = COALESCE(NULLIF(EXCLUDED.email, ''), public.lead_profiles.email),
       phone = COALESCE(NULLIF(EXCLUDED.phone, ''), public.lead_profiles.phone),
       address = COALESCE(NULLIF(EXCLUDED.address, ''), public.lead_profiles.address),
       city = COALESCE(NULLIF(EXCLUDED.city, ''), public.lead_profiles.city),
       state = COALESCE(NULLIF(EXCLUDED.state, ''), public.lead_profiles.state),
       postal_code = COALESCE(NULLIF(EXCLUDED.postal_code, ''), public.lead_profiles.postal_code),
       motivation_score = GREATEST(public.lead_profiles.motivation_score, EXCLUDED.motivation_score),
       engagement_score = GREATEST(public.lead_profiles.engagement_score, EXCLUDED.engagement_score),
       assigned_agent = COALESCE(NULLIF(EXCLUDED.assigned_agent, ''), public.lead_profiles.assigned_agent),
       raw = public.lead_profiles.raw || EXCLUDED.raw,
       updated_at = NOW()
     RETURNING *`,
    [
      leadId,
      String(params.externalId || params.external_id || leadId),
      String(params.source || 'nurture-agent'),
      String(params.status || 'new'),
      String(params.stage || params.temperature || 'warm'),
      String(params.temperature || params.stage || 'warm'),
      fullName || firstName || 'Seller',
      firstName,
      lastName,
      String(params.email || ''),
      String(params.phone || params.to || ''),
      String(params.address || params.propertyAddress || ''),
      String(params.city || ''),
      String(params.state || ''),
      String(params.postalCode || params.postal_code || params.zip || ''),
      Number(params.motivationScore || params.motivation_score || params.score || 0),
      Number(params.engagementScore || params.engagement_score || params.score || 0),
      String(params.assignedAgent || params.assigned_agent || 'Ava'),
      sqlJson({ ...params, source: params.source || 'nurture-agent' }),
    ]
  );
  return loadLead(pool, leadId);
}

async function loadTemplateForLead(pool, leadId, templateId = '') {
  if (templateId) {
    const selected = await pool.query(
      `SELECT * FROM public.nurture_sequence_templates WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [templateId]
    );
    if (selected.rows[0]) return selected.rows[0];
  }

  const lead = await pool.query(
    `SELECT id, stage, temperature FROM public.lead_profiles WHERE id = $1 LIMIT 1`,
    [String(leadId || '')]
  );
  const stage = normalizeStage(lead.rows[0]?.stage || lead.rows[0]?.temperature || 'warm');
  const template = await pool.query(
    `SELECT * FROM public.nurture_sequence_templates
     WHERE tenant_id = 'pbk' AND is_active = TRUE AND trigger_stage = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [stage]
  );
  if (template.rows[0]) return template.rows[0];
  const fallback = await pool.query(
    `SELECT * FROM public.nurture_sequence_templates
     WHERE tenant_id = 'pbk' AND is_active = TRUE
     ORDER BY trigger_stage = 'warm' DESC, updated_at DESC
     LIMIT 1`
  );
  return fallback.rows[0] || null;
}

async function loadLead(pool, leadId) {
  const result = await pool.query(
    `SELECT id, lead_name, first_name, email, phone, address, stage, engagement_score, motivation_score
     FROM public.lead_profiles
     WHERE id = $1
     LIMIT 1`,
    [String(leadId || '')]
  );
  return result.rows[0] || null;
}

export async function processNurtureInstance(pool, instanceId, options = {}) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable' };
  await ensureNurtureSchema(pool);
  const instanceResult = await pool.query(
    `SELECT ni.*, nst.steps
     FROM public.nurture_instances ni
     LEFT JOIN public.nurture_sequence_templates nst ON nst.id = ni.template_id
     WHERE ni.id = $1
     LIMIT 1`,
    [String(instanceId || '')]
  );
  const instance = instanceResult.rows[0];
  if (!instance || instance.status !== 'active')
    return { ok: false, reason: 'inactive_or_missing' };

  const steps = Array.isArray(instance.steps) ? instance.steps : [];
  if (instance.current_step >= steps.length) {
    await pool.query(
      `UPDATE public.nurture_instances SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [instance.id]
    );
    return { ok: true, result: 'completed' };
  }

  const lead = await loadLead(pool, instance.lead_id);
  if (!lead) return { ok: false, reason: 'lead_missing' };

  const stepIndex = Number(instance.current_step || 0);
  const step = steps[stepIndex] || {};
  const channel = String(step.channel || '')
    .trim()
    .toLowerCase();
  const message = renderTemplate(step.template || '', lead);
  let status = 'sent';
  let error = '';
  let invokeResult = {};

  try {
    if (channel === 'sms') {
      invokeResult = await options.invokeTool?.('telnyx_sms', {
        leadId: lead.id,
        to: lead.phone,
        text: message,
        source: 'nurture-agent',
      });
    } else if (channel === 'email') {
      invokeResult = await options.invokeTool?.('sendColdEmail', {
        leadId: lead.id,
        to: lead.email,
        subject: 'Quick follow-up from PBK',
        body: message,
        source: 'nurture-agent',
      });
    } else if (channel === 'call') {
      invokeResult = await options.invokeTool?.('telnyx_call', {
        leadId: lead.id,
        to: lead.phone,
        callControlId: `nurture_${instance.id}`,
        source: 'nurture-agent',
      });
    } else {
      status = 'skipped';
      invokeResult = { ok: true, result: 'unsupported_or_empty_channel' };
    }
    if (invokeResult?.ok === false) {
      status = invokeResult.result === 'queued_for_approval' ? 'queued_for_approval' : 'failed';
      error = invokeResult.error || invokeResult.message || '';
    } else if (invokeResult?.result === 'queued_for_approval') {
      status = 'queued_for_approval';
    }
  } catch (err) {
    status = 'failed';
    error = err?.message || String(err);
    invokeResult = { ok: false, error };
  }

  await pool.query(
    `INSERT INTO public.nurture_step_logs (
       tenant_id, nurture_instance_id, lead_id, step_index, channel, message_sent, sent_at, status, error, result, created_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9::jsonb,NOW())`,
    [
      'pbk',
      instance.id,
      lead.id,
      stepIndex,
      channel,
      message,
      status,
      error.slice(0, 1000),
      sqlJson(invokeResult),
    ]
  );

  const nextIndex = stepIndex + 1;
  if (nextIndex >= steps.length) {
    await pool.query(
      `UPDATE public.nurture_instances
       SET current_step = $2, status = 'completed', next_step_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [instance.id, nextIndex]
    );
    return { ok: true, result: 'completed', status, channel, stepIndex };
  }

  const nextStep = steps[nextIndex] || {};
  const delayHours = Math.max(0, Number(nextStep.delay_hours || nextStep.delayHours || 0));
  const nextStepAt = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();
  await pool.query(
    `UPDATE public.nurture_instances
     SET current_step = $2, next_step_at = $3, updated_at = NOW()
     WHERE id = $1`,
    [instance.id, nextIndex, nextStepAt]
  );

  return { ok: true, result: 'step_processed', status, channel, stepIndex, nextStepAt };
}

export async function processDueNurtureInstances(pool, options = {}) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable', processed: 0 };
  await ensureNurtureSchema(pool);
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const due = await pool.query(
    `SELECT id
     FROM public.nurture_instances
     WHERE tenant_id = 'pbk'
       AND status = 'active'
       AND next_step_at IS NOT NULL
       AND next_step_at <= NOW()
     ORDER BY next_step_at ASC
     LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const row of due.rows || []) {
    results.push(await processNurtureInstance(pool, row.id, options));
  }
  return { ok: true, result: 'processed_due_nurture', processed: results.length, results };
}

export async function startNurtureSequenceCore(pool, params = {}, options = {}) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable' };
  await ensureNurtureSchema(pool);
  const leadId = String(params.leadId || params.lead_id || '').trim();
  if (!leadId) return { ok: false, result: 'missing_lead_id', error: 'leadId is required.' };
  await upsertLeadProfileFromParams(pool, { ...params, leadId }).catch(() => null);
  const template = await loadTemplateForLead(
    pool,
    leadId,
    params.templateId || params.template_id || ''
  );
  if (!template)
    return {
      ok: false,
      result: 'template_missing',
      error: 'No active nurture template is available.',
    };

  const active = await pool.query(
    `SELECT id FROM public.nurture_instances
     WHERE tenant_id = 'pbk' AND lead_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [leadId]
  );
  if (active.rows[0] && !params.force) {
    return { ok: true, result: 'already_active', nurtureInstanceId: active.rows[0].id };
  }

  const insert = await pool.query(
    `INSERT INTO public.nurture_instances (
       tenant_id, lead_id, template_id, current_step, status, next_step_at, metadata, created_at, updated_at
     )
     VALUES ($1,$2,$3,0,'active',NOW(),$4::jsonb,NOW(),NOW())
     RETURNING *`,
    [
      'pbk',
      leadId,
      template.id,
      sqlJson({
        source: params.source || 'pbk-bridge',
        trigger: params.trigger || 'manual',
        requestedBy: params.requestedBy || params.requested_by || '',
      }),
    ]
  );
  const instance = insert.rows[0];
  if (params.processFirstStep === false || params.process_first_step === false) {
    return { ok: true, result: 'created', nurtureInstanceId: instance.id, instance };
  }
  const processed = await processNurtureInstance(pool, instance.id, options);
  return {
    ok: true,
    result: 'started',
    nurtureInstanceId: instance.id,
    instance,
    firstStep: processed,
  };
}

export async function pauseNurtureForPhoneStop(pool, params = {}) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable' };
  const text = String(params.text || params.body || '').trim();
  if (!STOP_REPLY_PATTERN.test(text)) return { ok: true, result: 'no_stop_intent', paused: 0 };
  const phone = String(params.from || params.phone || '').replace(/[^\d+]/g, '');
  if (!phone) return { ok: false, result: 'missing_phone' };
  const lead = await pool.query(
    `SELECT id FROM public.lead_profiles WHERE regexp_replace(phone, '[^0-9+]', '', 'g') = $1 LIMIT 1`,
    [phone]
  );
  if (!lead.rows[0]) return { ok: true, result: 'lead_not_found', paused: 0 };
  const updated = await pool.query(
    `UPDATE public.nurture_instances
     SET status = 'paused', pause_reason = 'seller_reply_stop', updated_at = NOW()
     WHERE tenant_id = 'pbk' AND lead_id = $1 AND status = 'active'
     RETURNING id`,
    [lead.rows[0].id]
  );
  return { ok: true, result: 'paused', paused: updated.rowCount || 0, leadId: lead.rows[0].id };
}

export async function consultNurtureAgentCore(pool, params = {}) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable' };
  await ensureNurtureSchema(pool);
  const leadId = String(params.leadId || params.lead_id || '').trim();
  if (!leadId) return { ok: false, result: 'missing_lead_id' };
  const lead =
    (await loadLead(pool, leadId)) ||
    (await upsertLeadProfileFromParams(pool, { ...params, leadId }));
  if (!lead) return { ok: false, result: 'lead_missing' };
  const stage = normalizeStage(lead.stage);
  const score = Number(lead.engagement_score ?? lead.motivation_score ?? 0);
  let recommendation = {
    channel: 'email',
    urgency: 'later',
    reason: 'Lead is warm but not urgent; start with a low-friction email.',
  };
  if (/hot|appointment|negotiat|offer/i.test(stage) || score >= 80) {
    recommendation = {
      channel: 'call',
      urgency: 'immediate',
      reason: 'Lead is hot or high-engagement; calling now has the highest upside.',
    };
  } else if (/warm/i.test(stage) || score >= 60) {
    recommendation = {
      channel: 'sms',
      urgency: 'now',
      reason: 'Warm/high-engagement leads respond well to quick SMS follow-up.',
    };
  }
  return {
    ok: true,
    result: 'recommendation',
    lead: {
      id: lead.id,
      name: lead.lead_name || lead.first_name || '',
      stage,
      score,
    },
    recommendation,
  };
}
