import { createHash, createPublicKey, timingSafeEqual, verify, randomUUID } from 'node:crypto';

export const NEON_AUTH_URL =
  'https://ep-divine-silence-b4ckkyun.neonauth.c-6.us-east-2.aws.neon.tech/pbk_academy/auth';
const AUTH = new URL(NEON_AUTH_URL);
const APP_ORIGIN =
  'https://br-purple-recipe-b4mgs6in-pbkacademy.compute.c-6.us-east-2.aws.neon.tech';
const digest = (s) => createHash('sha256').update(s).digest('hex');
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const email = (s) =>
  typeof s === 'string' && s.length < 255 && /^[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+$/.test(s);

export function createNeonVerifier({ fetcher = fetch, now = Date.now } = {}) {
  let cached,
    until = 0,
    refreshAt = 0,
    pending;
  async function keys(force) {
    if (pending) return pending;
    if (cached && now() < until && (!force || now() < refreshAt)) return cached;
    if (!cached && now() < refreshAt) throw fail(503, 'signature_keys_unavailable');
    if (!pending) {
      refreshAt = now() + 15000;
      pending = (async () => {
        const r = await fetcher(NEON_AUTH_URL + '/.well-known/jwks.json', {
          redirect: 'error',
          signal: AbortSignal.timeout(2000),
        });
        if (!r.ok) throw fail(503, 'signature_keys_unavailable');
        const text = await r.text();
        if (text.length > 65536) throw fail(503, 'signature_keys_unavailable');
        const data = JSON.parse(text);
        if (!Array.isArray(data.keys)) throw fail(503, 'signature_keys_unavailable');
        cached = data.keys;
        until = now() + 300000;
        return cached;
      })().finally(() => {
        pending = undefined;
      });
    }
    return pending;
  }
  return async (raw, headers) => {
    const signature = headers['x-neon-signature'],
      kid = headers['x-neon-signature-kid'],
      stamp = headers['x-neon-timestamp'];
    if (
      typeof signature !== 'string' ||
      signature.length > 2048 ||
      typeof kid !== 'string' ||
      kid.length > 200 ||
      !/^\d{13}$/.test(stamp || '')
    )
      throw fail(401, 'invalid_signature');
    const age = now() - Number(stamp);
    if (age > 300000 || age < -60000) throw fail(401, 'expired_signature');
    const parts = signature.split('.');
    if (
      parts.length !== 3 ||
      parts[1] !== '' ||
      !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]+$/.test(parts[2])
    )
      throw fail(401, 'invalid_signature');
    let protectedHeader;
    try {
      protectedHeader = JSON.parse(Buffer.from(parts[0], 'base64url'));
    } catch {
      throw fail(401, 'invalid_signature');
    }
    if (
      protectedHeader.alg !== 'EdDSA' ||
      protectedHeader.kid !== kid ||
      protectedHeader.crit ||
      protectedHeader.b64 === false
    )
      throw fail(401, 'invalid_signature');
    let list = await keys(false),
      key = list.find((k) => k.kid === kid);
    if (!key) {
      list = await keys(true);
      key = list.find((k) => k.kid === kid);
    }
    if (!key || key.kty !== 'OKP' || key.crv !== 'Ed25519') throw fail(401, 'invalid_signature');
    const input = `${parts[0]}.${Buffer.from(`${stamp}.${Buffer.from(raw).toString('base64url')}`).toString('base64url')}`;
    let valid = false;
    try {
      valid = verify(
        null,
        Buffer.from(input),
        createPublicKey({ key, format: 'jwk' }),
        Buffer.from(parts[2], 'base64url')
      );
    } catch {
      /* Invalid keys and signatures fail closed. */
    }
    if (!valid) throw fail(401, 'invalid_signature');
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      throw fail(400, 'invalid_event');
    }
    if (
      !/^[a-f0-9-]{36}$/i.test(event.event_id || '') ||
      event.event_id !== headers['x-neon-event-id'] ||
      event.event_type !== headers['x-neon-event-type'] ||
      event.context?.endpoint_id !== AUTH.hostname.split('.')[0]
    )
      throw fail(400, 'invalid_event');
    return event;
  };
}

export function buildNeonEmail(event, allowedRecipient, now = Date.now()) {
  const to = event.user?.email?.trim().toLowerCase();
  if (!email(allowedRecipient) || to !== allowedRecipient.toLowerCase())
    throw fail(403, 'recipient_not_in_controlled_test');
  const data = event.event_data || {};
  if (!Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= now)
    throw fail(400, 'expired_event');
  if (data.delivery_preference === 'sms') throw fail(400, 'unsupported_delivery_channel');
  const purpose = event.event_type === 'send.otp' ? data.otp_type : data.link_type;
  const titles = {
    'sign-in': 'Sign in to PBK Academy',
    'email-verification': 'Confirm your PBK email',
    'forget-password': 'Reset your PBK Academy password',
  };
  const title = titles[purpose];
  if (!title) throw fail(400, 'unsupported_email_purpose');
  let action, plain;
  if (event.event_type === 'send.otp') {
    if (!/^\d{6}$/.test(data.otp_code || '')) throw fail(400, 'invalid_code');
    action = `<p style="font-family:monospace;font-size:30px;font-weight:bold">${escape(data.otp_code)}</p>`;
    plain = `Your one-time code: ${data.otp_code}\nEnter it on the PBK Academy page where you requested it.`;
  } else if (event.event_type === 'send.magic_link') {
    let link;
    try {
      link = new URL(data.link_url);
    } catch {
      throw fail(400, 'invalid_link');
    }
    if (
      link.protocol !== 'https:' ||
      link.username ||
      link.password ||
      !(
        (link.origin === AUTH.origin && link.pathname.startsWith(AUTH.pathname + '/')) ||
        link.origin === APP_ORIGIN
      )
    )
      throw fail(400, 'untrusted_link');
    action = `<p><a href="${escape(link.href)}" style="display:inline-block;padding:16px 24px;background:#102f42;color:#fff;text-decoration:none;line-height:20px;border-radius:4px">${title}</a></p><p style="font-size:13px;word-break:break-all">${escape(link.href)}</p>`;
    plain = `Continue securely: ${link.href}`;
  } else throw fail(400, 'unsupported_event');
  const body =
    'You requested this account action in PBK Academy. This email is from Probono Key Realty, not a property offer.';
  const safety =
    'Use only the newest message. Never share this code or link, or your password. If you did not request this, ignore this email and contact PBK through your usual trusted contact.';
  return {
    to,
    subject: `PBK | ${title.replace(/PBK /g, '')}`,
    text: `PBK Academy | Probono Key Realty\n\n${title}\n\n${body}\n\n${plain}\n\n${safety}`,
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f4f8fb;font-family:Arial,sans-serif;color:#102f42"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px"><table role="presentation" width="100%" style="max-width:560px;background:#fff;border-top:4px solid #3299da"><tr><td style="padding:24px"><p style="font-size:24px;font-weight:bold">PBK</p><p style="font-size:13px">Probono Key Realty &middot; Account Security</p><h1 style="font-family:Georgia,serif;font-size:28px">${title}</h1><p style="font-size:16px;line-height:1.6">${body}</p>${action}<p style="font-size:13px;line-height:1.6;color:#526673">${safety}</p><hr style="border:0;border-top:1px solid #dce6ed"><p style="font-size:12px">PBK Academy &middot; Probono Key Realty<br>Existing account permissions still apply.</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export function smtpOptions(env) {
  if (
    !email(env.PBK_NEON_SMTP_USER) ||
    !env.PBK_NEON_SMTP_PASSWORD ||
    env.PBK_NEON_MAIL_FROM !== env.PBK_NEON_SMTP_USER ||
    !email(env.PBK_NEON_MAIL_TEST_TO)
  )
    throw fail(503, 'mail_provider_not_configured');
  return {
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    requireTLS: true,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: 'smtp.office365.com' },
    auth: { user: env.PBK_NEON_SMTP_USER, pass: env.PBK_NEON_SMTP_PASSWORD },
    connectionTimeout: 2000,
    greetingTimeout: 2000,
    socketTimeout: 8000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

// A durable claim prevents a lost SMTP acknowledgement from causing a duplicate send.
export function createMailDelivery({ ledger, send }) {
  return async (eventId, payloadHash, message) => {
    const claim = await ledger.claim(eventId, payloadHash);
    if (!claim.acquired) {
      if (claim.hash !== payloadHash) throw fail(409, 'event_payload_conflict');
      if (claim.status === 'sent') return { smtpAccepted: true, duplicate: true };
      throw fail(503, 'delivery_reconciliation_required');
    }
    try {
      const result = await send(message, eventId);
      if (!result.accepted?.some((v) => String(v).toLowerCase() === message.to.toLowerCase()))
        throw fail(503, 'smtp_recipient_not_accepted');
      await ledger.finish(eventId, 'sent');
      return { smtpAccepted: true };
    } catch {
      // Even a process crash leaves the claim in place. Never automatically resend an uncertain SMTP write.
      await ledger.finish(eventId, 'unknown').catch(() => {});
      throw fail(503, 'delivery_reconciliation_required');
    }
  };
}

export function createNeonMailRouter({
  env = process.env,
  transporterFactory,
  poolFactory,
  verifyEvent = createNeonVerifier(),
} = {}) {
  let transporter, pool, initialized, opening;
  async function resources() {
    if (opening) return opening;
    opening = openResources().catch((error) => {
      opening = undefined;
      throw error;
    });
    return opening;
  }
  async function openResources() {
    const options = smtpOptions(env);
    if (!env.PBK_DATABASE_URL) throw fail(503, 'mail_ledger_not_configured');
    if (!transporter) {
      const factory = transporterFactory || (await import('nodemailer')).default.createTransport;
      transporter = factory(options);
    }
    if (!pool) {
      const Pool = poolFactory || (await import('pg')).default.Pool;
      pool = new Pool({
        connectionString: env.PBK_DATABASE_URL,
        max: 2,
        connectionTimeoutMillis: 1500,
        query_timeout: 1500,
        idleTimeoutMillis: 10000,
      });
      pool.on?.('error', () => {});
    }
    if (!initialized)
      initialized = pool
        .query(
          `CREATE TABLE IF NOT EXISTS pbk_neon_auth_mail_events (event_id text PRIMARY KEY, payload_hash text NOT NULL, status text NOT NULL CHECK (status IN ('sending','sent','unknown')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON pbk_neon_auth_mail_events FROM PUBLIC;`
        )
        .catch((e) => {
          initialized = undefined;
          throw e;
        });
    await initialized;
    return { transporter, pool };
  }
  const ledger = {
    async claim(id, hash) {
      const { pool } = await resources();
      const result = await pool.query(
        "INSERT INTO pbk_neon_auth_mail_events(event_id,payload_hash,status) VALUES($1,$2,'sending') ON CONFLICT DO NOTHING RETURNING event_id",
        [id, hash]
      );
      if (result.rows.length) return { acquired: true };
      const old = await pool.query(
        'SELECT payload_hash,status FROM pbk_neon_auth_mail_events WHERE event_id=$1',
        [id]
      );
      return { acquired: false, hash: old.rows[0]?.payload_hash, status: old.rows[0]?.status };
    },
    async finish(id, status) {
      const { pool } = await resources();
      await pool.query(
        'UPDATE pbk_neon_auth_mail_events SET status=$2,updated_at=now() WHERE event_id=$1',
        [id, status]
      );
    },
  };
  const deliver = createMailDelivery({
    ledger,
    send: async (message, id) => {
      const { transporter } = await resources();
      return transporter.sendMail({
        ...message,
        from: { name: 'PBK | Probono Key Realty', address: env.PBK_NEON_MAIL_FROM },
        messageId: `<pbk-neon-${digest(id)}@${env.PBK_NEON_MAIL_FROM.split('@')[1]}>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    },
  });
  const reply = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  async function rawBody(req) {
    const chunks = [];
    let size = 0;
    const timeout = setTimeout(() => req.destroy(fail(408, 'body_timeout')), 2000);
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32768) throw fail(413, 'request_too_large');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timeout);
    }
  }
  return async (req, res) => {
    const path = new URL(req.url, 'http://bridge.local').pathname;
    if (!['/api/webhooks/neon-auth-mail', '/api/admin/neon-auth-mail'].includes(path)) return false;
    try {
      if (path === '/api/admin/neon-auth-mail') {
        const expected = Buffer.from(`Bearer ${env.PBK_BRIDGE_API_KEY || ''}`),
          actual = Buffer.from(String(req.headers.authorization || ''));
        if (
          !env.PBK_BRIDGE_API_KEY ||
          expected.length !== actual.length ||
          !timingSafeEqual(expected, actual)
        )
          throw fail(401, 'unauthorized');
        if (req.method === 'GET') {
          let configured = true;
          try {
            smtpOptions(env);
          } catch {
            configured = false;
          }
          const counts = pool
            ? (
                await pool.query(
                  'SELECT status,count(*)::int AS count FROM pbk_neon_auth_mail_events GROUP BY status'
                )
              ).rows
            : [];
          reply(res, 200, { configured, mode: 'owner-only-controlled-test', events: counts });
          return true;
        }
        if (req.method !== 'POST') throw fail(405, 'method_not_allowed');
        const input = JSON.parse(await rawBody(req));
        if (input.action === 'diagnose') {
          const { auth: _auth, ...options } = smtpOptions(env);
          const factory =
            transporterFactory || (await import('nodemailer')).default.createTransport;
          const probe = factory({
            ...options,
            ...(input.authenticate === true ? { auth: _auth } : {}),
            connectionTimeout: 12000,
            greetingTimeout: 8000,
            socketTimeout: 12000,
            dnsTimeout: 3000,
          });
          const started = Date.now();
          try {
            await probe.verify();
            reply(res, 200, {
              smtpReachable: true,
              tlsRequired: true,
              authenticated: input.authenticate === true,
              elapsedMs: Date.now() - started,
            });
          } catch (error) {
            // Never expose provider text: it may contain account identifiers or SMTP content.
            const code = /^[A-Z_]{2,32}$/.test(error.code || '') ? error.code : 'SMTP_PROBE_FAILED';
            const command = /^AUTH(?: (?:LOGIN|PLAIN|XOAUTH2))?$/.test(error.command || '')
              ? 'AUTH'
              : ['CONN', 'EHLO', 'HELO', 'STARTTLS'].includes(error.command)
                ? error.command
                : 'unknown';
            reply(res, 200, {
              smtpReachable: false,
              authenticated: false,
              code,
              command,
              ...(Number.isInteger(error.responseCode) ? { responseCode: error.responseCode } : {}),
              ...(/(?:smtpclientauthentication|smtp auth|basic authentication) is disabled/i.test(
                error.response || ''
              )
                ? { reason: 'smtp_auth_disabled' }
                : {}),
              elapsedMs: Date.now() - started,
            });
          } finally {
            probe.close?.();
          }
          return true;
        }
        if (!['verify', 'test'].includes(input.action)) throw fail(400, 'unknown_action');
        const { transporter } = await resources();
        await transporter.verify();
        if (input.action === 'verify')
          reply(res, 200, {
            smtpVerified: true,
            tlsRequired: true,
            mode: 'owner-only-controlled-test',
          });
        else if (input.action === 'test') {
          const id = randomUUID();
          const result = await deliver(id, digest(id), {
            to: env.PBK_NEON_MAIL_TEST_TO,
            subject: 'PBK | Microsoft 365 delivery verification',
            text: 'PBK | Probono Key Realty\nThis is your requested owner-only email delivery test. No password or verification code is included. No customer has been contacted.',
            html: '<h1>PBK</h1><p>Probono Key Realty</p><p>This is your requested owner-only email delivery test. No password or verification code is included. No customer has been contacted.</p>',
          });
          reply(res, 200, { ...result, eventId: id });
        } else throw fail(400, 'unknown_action');
        return true;
      }
      if (req.method !== 'POST') throw fail(405, 'method_not_allowed');
      const raw = await rawBody(req);
      const event = await verifyEvent(raw, req.headers);
      const message = buildNeonEmail(event, env.PBK_NEON_MAIL_TEST_TO);
      reply(res, 200, await deliver(event.event_id, digest(raw), message));
    } catch (error) {
      reply(res, error.status || 503, { error: error.code || 'mail_delivery_unavailable' });
    }
    return true;
  };
}
