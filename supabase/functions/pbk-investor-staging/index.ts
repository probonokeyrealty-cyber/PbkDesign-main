import { storePrivateAsset } from './uploadLifecycle.mjs';
import { readLimitedBody } from './bodyLimit.mjs';
import { execute, membership, verificationInput } from './domain.mjs';
import { authRedirectUrl, registerVerifiedSession } from './authSession.mjs';
import {
  PUBLIC_INVESTOR_ORIGIN,
  isAllowedOrigin,
  assertEntryCommand,
  assertEntryMember,
} from './entryPolicy.mjs';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const BUCKET = 'pbk-investor-staging';
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
      ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
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
async function beginVerifiedSession(token: string, origin: string) {
  // A callback fragment is untrusted until Auth validates its bearer token.
  const response = await fetch(`${URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw Object.assign(Error('Your sign-in link expired. Request a fresh sign-in link.'), {
      status: 401,
    });
  const user = await response.json();
  let expiresAt = NaN;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    expiresAt = Number(JSON.parse(atob(part)).exp) * 1000;
  } catch {}
  const hash = await digest(token);
  return await mutate((data) => {
    const expiresIn = registerVerifiedSession(data, user, hash, expiresAt, origin);
    return { changed: true, state: data, result: { expiresIn } };
  });
}
async function fileInfo(req: Request, input: any) {
  const row = await read();
  const { uid } = await identity(req, row.data);
  const member = membership(row.data, uid);
  assertEntryMember(req.headers.get('Origin') || '', member);
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
// Only generated, durably reserved paths can be removed. Never scan/delete a bucket.
async function reconcileUpload(entry: any) {
  const current = await read();
  const property = Object.values(current.data.properties).find((p: any) =>
    p.assets.some((a: any) => a.path === entry.path)
  ) as any;
  if (property) return { property };
  if (!current.data.pendingUploads?.[entry.id]) return null;
  if (
    !/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(entry.path) ||
    entry.path !== entry.propertyId + '/' + entry.id
  )
    throw Error('Invalid staging upload reservation.');
  await provider('/storage/v1/object/' + BUCKET, {
    method: 'DELETE',
    body: JSON.stringify({ prefixes: [entry.path] }),
  });
  await mutate((data) => {
    delete data.pendingUploads?.[entry.id];
    return { state: data, changed: true, result: {} };
  });
  return null;
}
async function retryStaleUploads(data: any) {
  const old = Object.values(data.pendingUploads || {})
    .filter((p: any) => p.createdAt < Date.now() - 3600_000)
    .slice(0, 10);
  for (const entry of old) {
    try {
      await reconcileUpload(entry);
    } catch {
      console.warn('Private staging upload cleanup deferred.');
    }
  }
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  if (origin && !isAllowedOrigin(origin)) return json({ error: 'Origin not allowed.' }, 403);
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
      assertEntryCommand(origin, 'asset');
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
      await retryStaleUploads(before.data);
      const entry = { id: assetId, path, propertyId: id, createdAt: Date.now() };
      const result = await storePrivateAsset({
        reserve: () =>
          mutate((data) => {
            const actor = membership(data, uid);
            if (!['editor', 'reviewer'].includes(actor.role))
              throw Object.assign(Error('Staff access is required.'), { status: 403 });
            if (data.properties[id]?.revision !== revision)
              throw Object.assign(Error('Property changed. Reload before uploading.'), {
                status: 409,
              });
            data.pendingUploads ||= {};
            if (Object.keys(data.pendingUploads).length >= 50)
              throw Object.assign(Error('Pending upload cleanup is required. Try again later.'), {
                status: 507,
              });
            data.pendingUploads[assetId] = entry;
            if (JSON.stringify(data).length > 8_000_000)
              throw Object.assign(Error('Staging capacity reached.'), { status: 507 });
            return { state: data, changed: true, result: {} };
          }),
        upload: async () => {
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
        },
        attach: async () => {
          return await mutate((data) => {
            membership(data, uid);
            const output = execute(data, uid, 'asset', {
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
            delete output.state.pendingUploads?.[assetId];
            return output;
          });
        },
        reconcile: () => reconcileUpload(entry),
      });
      return json(result, 200, origin);
    }
    const raw = new TextDecoder().decode(await readLimitedBody(req, 100_000));
    if (raw.length > 100_000) return json({ error: 'Request too large.' }, 413, origin);
    const input = JSON.parse(raw);
    const command = String(input.command || '');
    const payload = input.payload || {};
    assertEntryCommand(origin, command);
    if (command === 'authStart') {
      const email = String(payload.email || '')
        .trim()
        .toLowerCase();
      const row = await read();
      const found =
        row.data.invitations?.[email]?.approved ||
        Object.values(row.data.members).find(
          (m: any) =>
            m.email?.toLowerCase() === email &&
            m.approved &&
            (origin !== PUBLIC_INVESTOR_ORIGIN || m.role === 'investor')
        );
      if (found && !email.endsWith('@example.com')) {
        // Provider rate-limits OTP delivery. Unknown/pending members get the same response.
        const sent = await fetch(
          `${URL}/auth/v1/otp?redirect_to=${encodeURIComponent(authRedirectUrl(origin))}`,
          {
            method: 'POST',
            headers: { apikey: ANON, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, create_user: true }),
          }
        );
        if (!sent.ok)
          return json(
            { error: 'Unable to send a sign-in link right now. Please retry shortly.' },
            503,
            origin
          );
      }
      return json(
        { message: 'If your access is approved, a sign-in link will arrive by email.' },
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
      const session = await beginVerifiedSession(auth.access_token, origin);
      return json({ token: auth.access_token, ...session }, 200, origin);
    }
    if (command === 'authCallback') {
      const header = req.headers.get('Authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token || token.length > 8192)
        return json({ error: 'Request a fresh sign-in link.' }, 401, origin);
      return json(await beginVerifiedSession(token, origin), 200, origin);
    }
    if (command === 'file') return json(await fileInfo(req, payload), 200, origin);
    if (command === 'asset') return json({ error: 'Use the private upload action.' }, 400, origin);
    const current = await read();
    const { uid, hash } = await identity(req, current.data);
    assertEntryMember(origin, membership(current.data, uid));
    if (command === 'logout') {
      await mutate((data) => {
        data.endedSessions ||= {};
        // Retain only a hash so a consumed callback cannot resurrect a signed-out session.
        data.endedSessions[hash] = Math.max(
          data.sessions?.[hash]?.providerExpiresAt || 0,
          Date.now() + 3600000
        );
        delete data.sessions?.[hash];
        return { changed: true, state: data, result: { signedOut: true } };
      });
      return json({ signedOut: true }, 200, origin);
    }
    const result = await mutate((data) => {
      const session = data.sessions?.[hash];
      if (!session || session.expiresAt <= Date.now())
        throw Object.assign(new Error('Sign in again.'), { status: 401 });
      assertEntryMember(origin, membership(data, uid));
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
