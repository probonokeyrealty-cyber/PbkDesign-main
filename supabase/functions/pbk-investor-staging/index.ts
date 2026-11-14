import { readLimitedBody } from './bodyLimit.mjs';
import { execute, membership, verificationInput } from './domain.mjs';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const BUCKET = 'pbk-investor-staging';
const origins = new Set([
  'http://localhost:5179',
  'http://127.0.0.1:5179',
  'https://pbk-investor-staging--pbkcenter.netlify.app',
  'https://probono-key-realty.webflow.io',
]);
const providerHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
};
const json = (data: unknown, status = 200, origin = '') =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(origins.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
  });
async function provider(path: string, options: RequestInit = {}) {
  const r = await fetch(`${URL}${path}`, {
    ...options,
    headers: { ...providerHeaders, ...options.headers },
  });
  if (!r.ok) {
    const e = new Error(`Staging provider request failed (${r.status}).`);
    (e as any).status = 502;
    throw e;
  }
  return r.status === 204 ? null : await r.json();
}
async function read() {
  const rows = await provider(
    '/rest/v1/pbk_investor_staging_state?id=eq.staging&select=revision,data'
  );
  if (!rows?.[0]) throw new Error('Staging storage is not initialized.');
  return rows[0];
}
async function commit(revision: number, data: unknown) {
  return await provider('/rest/v1/rpc/pbk_investor_staging_commit', {
    method: 'POST',
    body: JSON.stringify({ expected_revision: revision, next_data: data }),
  });
}
async function digest(token: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  )
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
async function mutate(fn: (data: any) => any) {
  for (let n = 0; n < 5; n++) {
    const row = await read();
    const output = fn(row.data);
    if (!output.changed || (await commit(row.revision, output.state))) return output.result;
  }
  const e = new Error('Another update completed first. Please retry.');
  (e as any).status = 409;
  throw e;
}
async function identity(req: Request, data: any) {
  const header = req.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer '))
    throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  const token = header.slice(7);
  const session = data.sessions?.[await digest(token)];
  if (!session || session.expiresAt <= Date.now())
    throw Object.assign(new Error('Your session expired. Sign in again.'), { status: 401 });
  const response = await fetch(`${URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: header },
  });
  if (!response.ok)
    throw Object.assign(new Error('Your session expired. Sign in again.'), { status: 401 });
  const user = await response.json();
  if (user.id !== session.uid) throw Object.assign(new Error('Invalid session.'), { status: 401 });
  membership(data, user.id);
  return { uid: user.id, hash: await digest(token) };
}
async function fileInfo(req: Request, input: any) {
  const row = await read();
  const { uid } = await identity(req, row.data);
  const member = membership(row.data, uid);
  const p = row.data.properties[input.id];
  if (!p) throw Object.assign(new Error('Property not available.'), { status: 404 });
  if (member.role === 'investor') execute(row.data, uid, 'property', { id: input.id });
  const visibleIds =
    member.role === 'investor'
      ? p.published.assets.map((a: any) => a.id)
      : p.assets.map((a: any) => a.id);
  const asset = p.assets.find((a: any) => a.id === input.assetId && visibleIds.includes(a.id));
  if (!asset) throw Object.assign(new Error('File not available.'), { status: 404 });
  const signed = await provider(`/storage/v1/object/sign/${BUCKET}/${asset.path}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: 60 }),
  });
  return { url: `${URL}/storage/v1${signed.signedURL}`, expiresIn: 60 };
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  if (origin && !origins.has(origin)) return json({ error: 'Origin not allowed.' }, 403);
  if (req.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
        'Access-Control-Max-Age': '600',
      },
    });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405, origin);
  try {
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > 14_000_000) return json({ error: 'Request too large.' }, 413, origin);
    if (req.headers.get('Content-Type')?.startsWith('multipart/form-data')) {
      const before = await read();
      const { uid } = await identity(req, before.data);
      const m = membership(before.data, uid);
      if (!['editor', 'reviewer'].includes(m.role))
        return json({ error: 'Staff access is required.' }, 403, origin);
      const uploadBody = await readLimitedBody(req, 11_000_000);
      const form = await new Response(uploadBody, {
        headers: { 'Content-Type': req.headers.get('Content-Type')! },
      }).formData();
      const id = String(form.get('id') || '');
      const revision = Number(form.get('revision'));
      const file = form.get('file');
      if (
        !(file instanceof File) ||
        file.size > 10_000_000 ||
        file.size === 0 ||
        !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)
      )
        return json({ error: 'Choose a PDF, JPG, PNG or WebP up to 10 MB.' }, 400, origin);
      const rights = String(form.get('rights') || '').trim();
      const title = String(form.get('title') || file.name).slice(0, 200);
      const alt = String(form.get('alt') || '').slice(0, 400);
      if (!rights || rights.length > 1000 || (file.type !== 'application/pdf' && !alt))
        return json({ error: 'Media rights and photo alt text are required.' }, 400, origin);
      if (!before.data.properties[id])
        return json({ error: 'Staff access is required.' }, 403, origin);
      if (before.data.properties[id].revision !== revision)
        return json({ error: 'Property changed. Reload before uploading.' }, 409, origin);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const signature = Array.from(bytes.slice(0, 12));
      const valid =
        file.type === 'application/pdf'
          ? String.fromCharCode(...signature.slice(0, 5)) === '%PDF-'
          : file.type === 'image/jpeg'
            ? signature[0] === 255 && signature[1] === 216 && signature[2] === 255
            : file.type === 'image/png'
              ? signature.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
              : String.fromCharCode(...signature.slice(0, 4)) === 'RIFF' &&
                String.fromCharCode(...signature.slice(8, 12)) === 'WEBP';
      if (!valid) return json({ error: 'File contents do not match its type.' }, 400, origin);
      const assetId = crypto.randomUUID();
      const path = `${id}/${assetId}`;
      const upload = await fetch(`${URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: {
          apikey: SERVICE,
          Authorization: `Bearer ${SERVICE}`,
          'Content-Type': file.type,
          'x-upsert': 'false',
        },
        body: bytes,
      });
      if (!upload.ok) throw new Error('Private upload failed.');
      const result = await mutate((data) => {
        membership(data, uid);
        return execute(data, uid, 'asset', {
          id,
          revision,
          asset: {
            id: assetId,
            path,
            title,
            alt,
            kind: file.type === 'application/pdf' ? 'packet' : 'photo',
            mime: file.type,
            rights,
            buyerVisible: form.get('buyerVisible') === 'true',
            uploadedBy: uid,
            uploadedAt: new Date().toISOString(),
          },
        });
      });
      return json(result, 200, origin);
    }
    const raw = new TextDecoder().decode(await readLimitedBody(req, 100_000));
    if (raw.length > 100_000) return json({ error: 'Request too large.' }, 413, origin);
    const input = JSON.parse(raw);
    const command = String(input.command || '');
    const payload = input.payload || {};
    if (command === 'authStart') {
      const email = String(payload.email || '')
        .trim()
        .toLowerCase();
      const row = await read();
      const found =
        row.data.invitations?.[email]?.approved ||
        Object.values(row.data.members).find(
          (m: any) => m.email?.toLowerCase() === email && m.approved
        );
      if (found && !email.endsWith('@example.com')) {
        // Provider rate-limits OTP delivery. Unknown/pending members get the same response.
        await fetch(`${URL}/auth/v1/otp`, {
          method: 'POST',
          headers: { apikey: ANON, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, create_user: true }),
        });
      }
      return json(
        { message: 'If your access is approved, a sign-in code will arrive by email.' },
        200,
        origin
      );
    }
    if (command === 'authVerify') {
      const response = await fetch(`${URL}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify(verificationInput(payload.email, payload.code, URL)),
      });
      if (!response.ok) return json({ error: 'That code is invalid or expired.' }, 401, origin);
      const auth = await response.json();
      const hash = await digest(auth.access_token);
      await mutate((data) => {
        if (!data.members[auth.user.id]) {
          const email = String(auth.user.email || '').toLowerCase();
          const invite = data.invitations?.[email];
          if (!auth.user.email_confirmed_at || !invite?.approved)
            throw Object.assign(new Error('Your portal access is not approved.'), { status: 403 });
          data.members[auth.user.id] = {
            email,
            role: 'investor',
            approved: true,
            highLevelContactId: invite.highLevelContactId || '',
          };
          data.audit.push({
            id: crypto.randomUUID(),
            actor: auth.user.id,
            action: 'approved_investor_signed_in',
            entityId: auth.user.id,
            at: new Date().toISOString(),
            detail: { approvedBy: invite.approvedBy },
          });
        }
        membership(data, auth.user.id);
        data.sessions ||= {};
        for (const [key, value] of Object.entries(data.sessions) as any)
          if (value.expiresAt <= Date.now()) delete data.sessions[key];
        data.sessions[hash] = {
          uid: auth.user.id,
          expiresAt: Math.min(Date.now() + 3600_000, Date.now() + auth.expires_in * 1000),
        };
        return { changed: true, state: data, result: {} };
      });
      return json(
        { token: auth.access_token, expiresIn: Math.min(3600, auth.expires_in) },
        200,
        origin
      );
    }
    if (command === 'file') return json(await fileInfo(req, payload), 200, origin);
    if (command === 'asset') return json({ error: 'Use the private upload action.' }, 400, origin);
    const current = await read();
    const { uid, hash } = await identity(req, current.data);
    if (command === 'logout') {
      await mutate((data) => {
        delete data.sessions?.[hash];
        return { changed: true, state: data, result: { signedOut: true } };
      });
      return json({ signedOut: true }, 200, origin);
    }
    const result = await mutate((data) => {
      const session = data.sessions?.[hash];
      if (!session || session.expiresAt <= Date.now())
        throw Object.assign(new Error('Sign in again.'), { status: 401 });
      return execute(data, uid, command, payload);
    });
    return json(result, 200, origin);
  } catch (error) {
    return json(
      { error: (error as Error).message || 'Unable to complete that action.' },
      (error as any).status || 500,
      origin
    );
  }
});
