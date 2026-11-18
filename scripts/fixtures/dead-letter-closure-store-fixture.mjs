import { createHash, randomBytes } from 'node:crypto';
import { collectDeadLetterClosureEvidence } from '../dead-letter-closure-evidence.mjs';
import { closureBinding, createClosureIntent } from '../dead-letter-closure-protocol.mjs';

// Disposable local schemas only; never import bridge startup or ambient credentials.
export const CLOSURE_SOURCE_FIXTURE_SQL = `
CREATE TABLE public.event_dead_letters(id text PRIMARY KEY,tenant_id text,event_id text,event_type text,
 source text,payload jsonb,error text,created_at timestamptz);
CREATE TABLE public.calls(id text PRIMARY KEY,workspace_id text,provider text,telnyx_call_control_id text,
 telnyx_call_leg_id text,telnyx_call_session_id text,transcript jsonb,notes text,created_at timestamptz,updated_at timestamptz);
CREATE TABLE public.pbk_call_qa_scores(id text PRIMARY KEY,tenant_id text,call_id text,score numeric,grade text,
 breakdown jsonb,transcript_snippet text,metadata jsonb,created_at timestamptz);
CREATE TABLE public.call_embeddings(id text PRIMARY KEY,workspace_id text,call_id text,source_text text,transcript_hash text,
 synthetic boolean,embedding_model text,embedding text,metadata jsonb,created_at timestamptz,updated_at timestamptz);
CREATE TABLE public.pbk_eval_runs(id text PRIMARY KEY,tenant_id text,suite_name text,source text,ok boolean,total int,
 passed int,failed int,created_at timestamptz,report jsonb);
CREATE TABLE public.approvals(id text PRIMARY KEY,workspace_id text,type text,status text,payload jsonb,
 decided_at timestamptz,created_at timestamptz,updated_at timestamptz);
CREATE TABLE public.provider_action_dispatches(id text PRIMARY KEY,payload jsonb);
INSERT INTO public.provider_action_dispatches VALUES ('locked','{"state":"unknown"}');`;

export async function seedClosureSources(query) {
  const text = 'The owner discussed the property condition and requested a later conversation. '.repeat(2).trim();
  await query(`INSERT INTO public.event_dead_letters VALUES ('dead-private','pbk','event-private','call.completed',
    'telnyx-deepgram-finalize',$1,'original failure',now()-interval '1 hour')`,
  [JSON.stringify({ workspaceId: 'pbk', callId: 'call-private', transcript: text })]);
  await query(`INSERT INTO public.pbk_call_qa_scores VALUES ('call-qa-event-event-private','pbk','call-private',54,
    'needs_coaching',$1,$2,'{}',now()-interval '30 minutes')`,
  [JSON.stringify({ painProbe: 8, objectionHandling: 18, offerPresentation: 7, nextStep: 6, toneRapport: 15 }), text]);
  await query(`INSERT INTO public.call_embeddings VALUES ('memory-private','pbk','call-private',$1,$2,false,
    'text-embedding-3-small',$3,'{}',now()-interval '30 minutes',now()-interval '30 minutes')`,
  [text, createHash('sha256').update(text).digest('hex'), JSON.stringify([0.5, ...Array(1535).fill(0)])]);
}

export function closureTestAuthority() { return { secret: randomBytes(32).toString('base64'), revision: 'b'.repeat(40) }; }

export async function seedClosureApproval(query, authority, { id = 'approval-private', action = 'close_internal',
  predecessor = null, manifest, createdAt = new Date(Date.now() - 1000).toISOString() } = {}) {
  if (!manifest) {
    const evidence = await collectDeadLetterClosureEvidence({ query: async (sql, values) => {
      const r = await query(sql, values); return { rows: r.rows, rowCount: r.rowCount };
    }, ...authority, now: Date.now() });
    if (!evidence.ok || !evidence.cases[0]?.eligible) throw new Error('Fixture evidence incomplete');
    manifest = evidence.cases[0].manifest;
  }
  const intent = createClosureIntent({ ...authority, approvalId: id, action, recordRef: manifest.recordRef,
    manifest, predecessor, createdAt });
  const payload = { id, type: 'admin', status: 'approved', approvalAction: 'dead_letter_internal_closure',
    actedAt: createdAt, metadata: { deadLetterClosureIntent: intent } };
  await query(`INSERT INTO public.approvals VALUES ($1,'pbk','admin','approved',$2,$3,$3,$3)`,
    [id, JSON.stringify(payload), createdAt]);
  return { approvalId: id, intent, manifest };
}

export const closureHead = (authority, row) => ({ id: row.id, hash: closureBinding(authority.secret, 'ledger-row', row) });
