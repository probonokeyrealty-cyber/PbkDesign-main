const { Client } = require('pg');
const stageId = 'srv-dbvk7tv40ujc73e0d8gg';
const database = 'pbk_composio_staging';
const role = 'pbk_composio_staging_user';
const leadId = 'pbk-qa-ava-consult-20261123-v1';
const marker = 'PBK_AVA_TRIAGE_STAGING';
let step = 'scope';
let client;
function check(ok) { if (!ok) throw new Error(step); }
const timeout = setTimeout(() => { console.log(marker, 'deadline', step); process.exit(1); }, 55000);
(async () => {
  try {
    check(process.env.RENDER_SERVICE_ID === stageId && Boolean(process.env.PBK_BRIDGE_API_KEY));
    const connectionString = process.env.PBK_DATABASE_URL || process.env.DATABASE_URL;
    const uri = new URL(connectionString);
    check(uri.hostname === 'dpg-dc010uei0phs73bd3ohg-a' && uri.pathname === '/' + database && decodeURIComponent(uri.username) === role);
    client = new Client({ connectionString, connectionTimeoutMillis: 6000, statement_timeout: 6000 });
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const identity = (await client.query('SELECT current_database() AS db, current_user AS role')).rows[0];
    check(identity.db === database && identity.role === role);
    const host = 'http://127.0.0.1:' + process.env.PBK_STAGE_PROOF_LOCAL_PORT;
    const request = async (path, payload, authenticated = true) => {
      const headers = { 'Content-Type': 'application/json' };
      if (authenticated) headers.Authorization = 'Bearer ' + process.env.PBK_BRIDGE_API_KEY;
      const response = await fetch(host + path, { method: payload ? 'POST' : 'GET', headers, body: payload && JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) { step += '_http_' + response.status; check(false); }
      return response.json();
    };
    const rows = async () => (await client.query('SELECT id, from_agent, to_agent, task_type, status, provider_writes, summary, metadata FROM public.pbk_tasks WHERE tenant_id = $1 AND correlation_id = $2 ORDER BY to_agent', ['pbk', leadId])).rows;
    step = 'read_before';
    const before = await request('/state');
    check((await rows()).length === 0 && !before.leadImports.some(lead => lead.leadId === leadId));
    const body = { eventType: 'lead-intake', payload: { _source: 'n8n-lead-intake', source: 'staging-qa-synthetic-no-outreach', leadId, eventId: leadId, score: 88, property: { address: '123 Fictional Fixture Way, Test City' }, seller: { notes: 'Synthetic intake. Executor is coordinating an estate sale.' } } };
    step = 'sample_intake';
    const first = await request('/events', body);
    check(first.ok && first.leadImport?.leadId === leadId && first.leadTriage?.metadata?.consultationIds?.length === 2);
    step = 'replay';
    const replay = await request('/events', body);
    check(replay.replayed && replay.leadTriage?.id === first.leadTriage.id);
    step = 'postgres_rows';
    let saved = [];
    for (let i = 0; i < 8; i++) {
      saved = await rows();
      if (saved.length === 3) break;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    const triage = saved.find(row => row.task_type === 'lead_intake_triage');
    const rex = saved.find(row => row.to_agent === 'Rex' && row.task_type === 'lead_triage_consultation');
    const hermes = saved.find(row => row.to_agent === 'Hermes' && row.task_type === 'lead_triage_consultation');
    check(saved.length === 3 && triage?.id === first.leadTriage.id && rex?.metadata.triageId === triage.id && hermes?.metadata.triageId === triage.id);
    check(triage.metadata.consultationIds.includes(rex.id) && triage.metadata.consultationIds.includes(hermes.id));
    check(rex.metadata.priority.level === 'high' && hermes.metadata.pattern === 'probate_or_estate' && /decision-making authority/i.test(triage.summary));
    check(saved.every(row => row.from_agent === 'Ava' && row.status === 'complete' && row.provider_writes === 'blocked'));
    step = 'side_effect_audit';
    const after = await request('/state');
    const changes = Object.fromEntries(['calls', 'messages', 'contracts', 'approvals'].map(key => [key, (after[key]?.length ?? 0) - (before[key]?.length ?? 0)]));
    check(after.leadImports.filter(lead => lead.leadId === leadId).length === 1 && Object.values(changes).every(n => n === 0));
    step = 'public_health';
    const health = await request('/health', undefined, false);
    check(!JSON.stringify(health).includes(leadId));
    console.log(marker, JSON.stringify({ ok: true, database, leadId, triage: 1, rex: 1, hermes: 1, priority: rex.metadata.priority.level, pattern: hermes.metadata.pattern, replayReusedTriage: true, providerWrites: 'blocked', changes, publicHealthRedacted: true }));
  } catch {
    console.log(marker, JSON.stringify({ ok: false, step }));
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
    clearTimeout(timeout);
  }
})();
