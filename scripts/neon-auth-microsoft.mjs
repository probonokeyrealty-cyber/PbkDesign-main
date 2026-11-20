import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const REDIRECT =
  'https://pbk-openclaw-bridge.onrender.com/api/webhooks/neon-auth-mail/oauth/callback';
const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com';
const SCOPES = [
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = (s) =>
  typeof s === 'string' && s.length < 255 && /^[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+$/.test(s);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const fail = (code, status = 503) => Object.assign(new Error(code), { code, status });
const localErrors = new WeakSet();
function deny(code, status) {
  const error = fail(code, status);
  localErrors.add(error);
  throw error;
}

// The supplied pool belongs to the router (max: 2); this adapter never closes it.
export function createMicrosoftMail({
  env = process.env,
  pool,
  fetcher = fetch,
  clientFactory,
  mimeFactory,
} = {}) {
  let initialized;
  function config() {
    const sender = env.PBK_NEON_MAIL_FROM;
    const recipient = env.PBK_NEON_MAIL_TEST_TO;
    const keyText = env.PBK_NEON_MS_CACHE_KEY;
    if (
      !email(sender) ||
      !email(recipient) ||
      !UUID.test(env.PBK_NEON_MS_CLIENT_ID || '') ||
      !UUID.test(env.PBK_NEON_MS_TENANT_ID || '') ||
      typeof env.PBK_NEON_MS_CLIENT_SECRET !== 'string' ||
      !env.PBK_NEON_MS_CLIENT_SECRET.trim() ||
      typeof keyText !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(keyText)
    )
      deny('microsoft_mail_not_configured');
    const key = Buffer.from(keyText, 'base64');
    if (key.length !== 32 || key.toString('base64') !== keyText)
      deny('microsoft_mail_not_configured');
    return {
      sender,
      recipient,
      key,
      tenant: env.PBK_NEON_MS_TENANT_ID.toLowerCase(),
      clientId: env.PBK_NEON_MS_CLIENT_ID.toLowerCase(),
    };
  }
  const safe =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        if (localErrors.has(error)) throw error;
        throw fail('microsoft_mail_unavailable');
      }
    };
  function seal(value, kind, c) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', c.key, iv);
    cipher.setAAD(
      Buffer.from(`pbk-neon-ms:${kind}:${c.clientId}:${c.tenant}:${c.sender.toLowerCase()}`)
    );
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  function unseal(value, kind, c) {
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', c.key, bytes.subarray(0, 12));
    cipher.setAAD(
      Buffer.from(`pbk-neon-ms:${kind}:${c.clientId}:${c.tenant}:${c.sender.toLowerCase()}`)
    );
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
    );
  }
  async function schema() {
    if (!pool?.query || !pool?.connect) deny('microsoft_mail_storage_unavailable');
    // One multi-statement query is one implicit transaction. Serialize first-start DDL
    // with cache use, too; only the supplied privileged service role receives a policy.
    if (!initialized)
      initialized = pool
        .query(
          `
      SET LOCAL lock_timeout = '750ms';
      SET LOCAL statement_timeout = '1000ms';
      SELECT pg_advisory_xact_lock(741902, 11943);
      CREATE TABLE IF NOT EXISTS pbk_neon_ms_oauth_state (
        state_hash text PRIMARY KEY, encrypted_pkce text NOT NULL, expires_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pbk_neon_ms_oauth_cache (
        id integer PRIMARY KEY CHECK (id = 1), encrypted_cache text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      REVOKE ALL ON pbk_neon_ms_oauth_state, pbk_neon_ms_oauth_cache FROM PUBLIC;
      ALTER TABLE pbk_neon_ms_oauth_state ENABLE ROW LEVEL SECURITY;
      ALTER TABLE pbk_neon_ms_oauth_state FORCE ROW LEVEL SECURITY;
      ALTER TABLE pbk_neon_ms_oauth_cache ENABLE ROW LEVEL SECURITY;
      ALTER TABLE pbk_neon_ms_oauth_cache FORCE ROW LEVEL SECURITY;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'pbk_neon_ms_oauth_state' AND policyname = 'pbk_neon_ms_service') THEN
          CREATE POLICY pbk_neon_ms_service ON pbk_neon_ms_oauth_state TO CURRENT_USER USING (true) WITH CHECK (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'pbk_neon_ms_oauth_cache' AND policyname = 'pbk_neon_ms_service') THEN
          CREATE POLICY pbk_neon_ms_service ON pbk_neon_ms_oauth_cache TO CURRENT_USER USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `
        )
        .catch((error) => {
          initialized = undefined;
          throw error;
        });
    await initialized;
  }
  async function request(url, options) {
    return fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(6000) });
  }
  async function client(c) {
    const network = async (url, options, method) => {
      const endpoint = new URL(url);
      if (endpoint.origin !== LOGIN || endpoint.username || endpoint.password)
        deny('microsoft_oauth_endpoint_denied');
      const response = await request(url, {
        method,
        headers: options?.headers,
        ...(method === 'POST' ? { body: options?.body } : {}),
      });
      if (!response.ok) deny('microsoft_oauth_request_failed');
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.json(),
      };
    };
    const options = {
      auth: {
        clientId: c.clientId,
        authority: `${LOGIN}/${c.tenant}`,
        clientSecret: env.PBK_NEON_MS_CLIENT_SECRET,
        knownAuthorities: ['login.microsoftonline.com'],
      },
      system: {
        disableInternalRetries: true,
        loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} },
        networkClient: {
          sendGetRequestAsync: (url, options) => network(url, options, 'GET'),
          sendPostRequestAsync: (url, options) => network(url, options, 'POST'),
        },
      },
    };
    if (clientFactory) return clientFactory(options);
    // Deployment pins the official @azure/msal-node dependency to 7.2.2.
    const { ConfidentialClientApplication } = await import('@azure/msal-node');
    return new ConfidentialClientApplication(options);
  }
  function identity(result, c, previous) {
    const account = result?.account;
    if (
      !result?.accessToken ||
      !account?.homeAccountId ||
      account.tenantId?.toLowerCase() !== c.tenant ||
      result.tenantId?.toLowerCase() !== c.tenant ||
      (previous && account.homeAccountId !== previous.homeAccountId)
    )
      deny('microsoft_identity_mismatch', 403);
    return account;
  }
  async function me(token, c, previous) {
    const response = await request(`${GRAPH}/v1.0/me?$select=id,mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status !== 200) deny('microsoft_sender_verification_failed');
    const user = await response.json();
    // Prefer the mailbox address; UPN is only a fallback for mail-less accounts.
    const address = user.mail || user.userPrincipalName;
    if (
      typeof user.id !== 'string' ||
      !user.id ||
      typeof address !== 'string' ||
      address.toLowerCase() !== c.sender.toLowerCase() ||
      (previous && previous.graphId !== user.id)
    )
      deny('microsoft_sender_mismatch', 403);
    return user.id;
  }
  async function locked(c, acquire) {
    await schema();
    const db = await pool.connect();
    let discard = false;
    let connectionLost = false;
    const onClientError = () => {
      connectionLost = true;
      discard = true;
    };
    db.on?.('error', onClientError);
    const checkConnection = () => {
      if (connectionLost) deny('microsoft_storage_connection_lost');
    };
    try {
      await db.query('BEGIN');
      await db.query(
        "SET LOCAL lock_timeout = '750ms'; SET LOCAL statement_timeout = '1000ms'; SET LOCAL idle_in_transaction_session_timeout = '20000ms'"
      );
      // One global cache row: all processes serialize refresh and reauthorization here.
      await db.query('SELECT pg_advisory_xact_lock(741902, 11943)');
      const stored = await db.query(
        'SELECT encrypted_cache FROM pbk_neon_ms_oauth_cache WHERE id=1'
      );
      const previous = stored.rows[0]
        ? unseal(stored.rows[0].encrypted_cache, 'cache', c)
        : undefined;
      const app = await client(c);
      const cache = app.getTokenCache();
      if (previous) cache.deserialize(previous.serialized);
      const result = await acquire(app, cache, previous);
      checkConnection();
      const account = identity(result, c, previous);
      const graphId = await me(result.accessToken, c, previous);
      checkConnection();
      await db.query(
        `INSERT INTO pbk_neon_ms_oauth_cache(id,encrypted_cache) VALUES(1,$1)
        ON CONFLICT(id) DO UPDATE SET encrypted_cache=EXCLUDED.encrypted_cache,updated_at=now()`,
        [
          seal(
            { serialized: cache.serialize(), homeAccountId: account.homeAccountId, graphId },
            'cache',
            c
          ),
        ]
      );
      await db.query('COMMIT');
      checkConnection();
      return result.accessToken;
    } catch (error) {
      try {
        await db.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      db.release(discard ? new Error('microsoft_transaction_uncertain') : undefined);
      if (!discard) db.removeListener?.('error', onClientError);
    }
  }
  async function token(c) {
    return locked(c, async (app, cache, previous) => {
      if (!previous) deny('microsoft_authorization_required', 409);
      const account = await cache.getAccountByHomeId(previous.homeAccountId);
      if (!account) deny('microsoft_authorization_required', 409);
      return app.acquireTokenSilent({ account, scopes: [...SCOPES] });
    });
  }
  return {
    configured() {
      try {
        config();
        return true;
      } catch {
        return false;
      }
    },
    begin: safe(async () => {
      const c = config();
      await schema();
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const app = await client(c);
      const authUrl = await app.getAuthCodeUrl({
        scopes: [...SCOPES],
        redirectUri: REDIRECT,
        responseMode: 'form_post',
        state,
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
        codeChallengeMethod: 'S256',
        loginHint: c.sender,
      });
      const url = new URL(authUrl);
      if (
        url.origin !== LOGIN ||
        url.username ||
        url.password ||
        url.pathname.toLowerCase() !== `/${c.tenant}/oauth2/v2.0/authorize`
      )
        deny('microsoft_oauth_endpoint_denied');
      await pool.query('DELETE FROM pbk_neon_ms_oauth_state WHERE expires_at <= now()');
      await pool.query(
        "INSERT INTO pbk_neon_ms_oauth_state(state_hash,encrypted_pkce,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
        [hash(state), seal({ verifier }, 'pkce', c)]
      );
      return authUrl;
    }),
    complete: safe(async (form) => {
      const c = config();
      if (
        !(form instanceof URLSearchParams) ||
        form.getAll('state').length !== 1 ||
        !/^[A-Za-z0-9_-]{43}$/.test(form.get('state') || '')
      )
        deny('microsoft_oauth_state_invalid', 400);
      await schema();
      // Deliberately outside the cache transaction: even a failed exchange consumes state.
      const claimed = await pool.query(
        'DELETE FROM pbk_neon_ms_oauth_state WHERE state_hash=$1 AND expires_at > now() RETURNING encrypted_pkce',
        [hash(form.get('state'))]
      );
      if (!claimed.rows.length) deny('microsoft_oauth_state_invalid', 400);
      if (
        form.has('error') ||
        form.getAll('code').length !== 1 ||
        !form.get('code') ||
        form.get('code').length > 8192
      )
        deny('microsoft_oauth_callback_invalid', 400);
      const { verifier } = unseal(claimed.rows[0].encrypted_pkce, 'pkce', c);
      await locked(c, (app) =>
        app.acquireTokenByCode({
          code: form.get('code'),
          codeVerifier: verifier,
          scopes: [...SCOPES],
          redirectUri: REDIRECT,
        })
      );
      return { authorized: true };
    }),
    verify: safe(async () => {
      await token(config());
      return true;
    }),
    sendMail: safe(async (message, id) => {
      const c = config();
      if (!email(message?.to) || message.to.toLowerCase() !== c.recipient.toLowerCase())
        deny('recipient_not_in_controlled_test', 403);
      if (typeof id !== 'string' || !id) deny('microsoft_message_invalid', 400);
      const accessToken = await token(c);
      const factory = mimeFactory || (await import('nodemailer')).default.createTransport;
      const transport = await factory({
        streamTransport: true,
        buffer: true,
        newline: 'windows',
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      let built;
      try {
        built = await transport.sendMail({
          from: { name: 'PBK | Probono Key Realty', address: c.sender },
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          messageId: `<pbk-neon-${hash(id)}@${c.sender.split('@')[1]}>`,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      } finally {
        transport.close?.();
      }
      if (!Buffer.isBuffer(built?.message)) deny('microsoft_mime_failed');
      const response = await request(`${GRAPH}/v1.0/me/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'text/plain' },
        body: built.message.toString('base64'),
      });
      // Never retry an ambiguous write. The caller's durable ledger owns reconciliation.
      if (response.status !== 202) deny('microsoft_send_not_accepted');
      return { accepted: [message.to] };
    }),
  };
}
