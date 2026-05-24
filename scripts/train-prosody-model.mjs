import pg from 'pg';

const { Pool } = pg;

const databaseUrl = String(
  process.env.PBK_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  '',
).trim();

const tenantId = String(process.env.PBK_TENANT_ID || process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1] || 'pbk').trim() || 'pbk';
const days = Math.max(1, Math.min(90, Number(process.argv.find((arg) => arg.startsWith('--days='))?.split('=')[1] || 14)));
const minSamples = Math.max(5, Number(process.argv.find((arg) => arg.startsWith('--min-samples='))?.split('=')[1] || 25));

if (!databaseUrl) {
  console.error(JSON.stringify({
    ok: false,
    result: 'missing_database_url',
    error: 'Set PBK_DATABASE_URL, DATABASE_URL, or SUPABASE_DB_URL before running prosody training.',
  }, null, 2));
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  ssl: /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? false : { rejectUnauthorized: false },
});

function average(rows, field, fallback) {
  const values = rows.map((row) => Number(row[field])).filter(Number.isFinite);
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : fallback;
}

function makeModel(rows = []) {
  const measured = rows.filter((row) => typeof row.outcome_success === 'boolean');
  const successful = measured.filter((row) => row.outcome_success === true);
  const now = new Date().toISOString();
  const version = Date.now();
  const id = `prosody-model-${version}`;

  if (measured.length < minSamples || successful.length < 3) {
    return {
      id,
      tenant_id: tenantId,
      version,
      model_type: 'rule_success_average',
      model_json: {
        emotionAverages: {},
        reason: 'insufficient_data',
        minSamples,
      },
      sample_count: measured.length,
      success_count: successful.length,
      accuracy: null,
      active: false,
      status: 'insufficient_data',
      metadata: { days, minSamples },
      trained_at: now,
    };
  }

  const groups = { global: [] };
  for (const row of successful) {
    const emotion = String(row.emotion || 'neutral').toLowerCase();
    if (!groups[emotion]) groups[emotion] = [];
    groups[emotion].push(row);
    groups.global.push(row);
  }
  const emotionAverages = {};
  for (const [emotion, groupRows] of Object.entries(groups)) {
    emotionAverages[emotion] = {
      sampleCount: groupRows.length,
      stability: average(groupRows, 'stability_chosen', 0.5),
      speed: average(groupRows, 'speed_chosen', 1),
      similarityBoost: average(groupRows, 'similarity_boost_chosen', 0.75),
    };
  }

  return {
    id,
    tenant_id: tenantId,
    version,
    model_type: 'rule_success_average',
    model_json: {
      emotionAverages,
      strategy: 'Use successful-call averages by emotion with global fallback.',
      schemaVersion: 'pbk-prosody-model-v1',
    },
    sample_count: measured.length,
    success_count: successful.length,
    accuracy: Number((successful.length / measured.length).toFixed(3)),
    active: true,
    status: 'trained',
    metadata: { days, minSamples },
    trained_at: now,
  };
}

async function main() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT emotion, stability_chosen, speed_chosen, similarity_boost_chosen, outcome_success
       FROM public.pbk_prosody_decisions
       WHERE tenant_id = $1
         AND outcome_success IS NOT NULL
         AND created_at > NOW() - ($2::int * INTERVAL '1 day')
       ORDER BY created_at DESC
       LIMIT 5000`,
      [tenantId, days],
    );
    const model = makeModel(result.rows || []);
    await client.query('BEGIN');
    if (model.active) {
      await client.query('UPDATE public.pbk_prosody_models SET active = FALSE WHERE tenant_id = $1 AND active IS TRUE', [tenantId]);
    }
    await client.query(
      `INSERT INTO public.pbk_prosody_models (
         id, tenant_id, version, model_type, model_json, sample_count, success_count,
         accuracy, active, status, metadata, trained_at
       )
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12)
       ON CONFLICT (id) DO UPDATE SET
         model_json = EXCLUDED.model_json,
         sample_count = EXCLUDED.sample_count,
         success_count = EXCLUDED.success_count,
         accuracy = EXCLUDED.accuracy,
         active = EXCLUDED.active,
         status = EXCLUDED.status,
         metadata = EXCLUDED.metadata,
         trained_at = EXCLUDED.trained_at,
         updated_at = NOW()`,
      [
        model.id,
        model.tenant_id,
        model.version,
        model.model_type,
        JSON.stringify(model.model_json),
        model.sample_count,
        model.success_count,
        model.accuracy,
        model.active,
        model.status,
        JSON.stringify(model.metadata),
        model.trained_at,
      ],
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({
      ok: true,
      result: model.status,
      tenantId,
      days,
      model: {
        id: model.id,
        active: model.active,
        sampleCount: model.sample_count,
        successCount: model.success_count,
        accuracy: model.accuracy,
      },
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(JSON.stringify({
      ok: false,
      result: 'training_failed',
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
