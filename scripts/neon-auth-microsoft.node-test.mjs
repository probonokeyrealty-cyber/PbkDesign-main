import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createMicrosoftMail } from './neon-auth-microsoft.mjs';

const tenant = '11111111-1111-4111-8111-111111111111';
const sender = 'owner@example.test';
const secret = 'PRIVATE-CLIENT-SECRET';
const token = 'PRIVATE-ACCESS-TOKEN';
function harness() {
  const env = {
    PBK_NEON_MAIL_FROM: sender,
    PBK_NEON_MAIL_TEST_TO: 'test@example.test',
    PBK_NEON_MS_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
    PBK_NEON_MS_TENANT_ID: tenant,
    PBK_NEON_MS_CLIENT_SECRET: secret,
    PBK_NEON_MS_CACHE_KEY: Buffer.alloc(32, 17).toString('base64'),
  };
  const h = {
    env,
    states: new Map(),
    sql: [],
    http: [],
    clients: [],
    mime: [],
    status: 202,
    user: { id: 'graph-owner-id', mail: sender, userPrincipalName: sender },
    result: {
      accessToken: token,
      tenantId: tenant,
      account: { homeAccountId: 'home-owner-id', tenantId: tenant },
    },
    acquisitions: 0,
    releases: 0,
  };
  let queue = Promise.resolve();
  async function query(sql, params = []) {
    h.sql.push({ sql, params });
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    if (sql.startsWith('INSERT INTO pbk_neon_ms_oauth_state')) {
      h.states.set(params[0], { encrypted_pkce: params[1], expires: Date.now() + 600000 });
    } else if (sql.startsWith('DELETE FROM pbk_neon_ms_oauth_state WHERE state_hash')) {
      const state = h.states.get(params[0]);
      if (state && state.expires > Date.now()) {
        h.states.delete(params[0]);
        return { rows: [state] };
      }
    } else if (sql.startsWith('SELECT encrypted_cache')) {
      return { rows: h.cache ? [{ encrypted_cache: h.cache }] : [] };
    } else if (sql.startsWith('INSERT INTO pbk_neon_ms_oauth_cache')) h.cache = params[0];
    return { rows: [] };
  }
  const pool = {
    query,
    async connect() {
      let unlock, snapshot;
      const events = new EventEmitter();
      h.dbEvents = events;
      return {
        on: events.on.bind(events),
        removeListener: events.removeListener.bind(events),
        async query(sql, params) {
          if (sql === 'ROLLBACK' && h.rollbackError) throw Error('rollback timed out');
          if (sql.includes('pg_advisory_xact_lock')) {
            if (h.lockError) throw Error('lock timed out');
            const pending = queue;
            queue = new Promise((resolve) => {
              unlock = resolve;
            });
            await pending;
            snapshot = h.cache;
          }
          const result = await query(sql, params);
          if (sql === 'ROLLBACK') h.cache = snapshot;
          if (sql === 'COMMIT' || sql === 'ROLLBACK') unlock?.();
          return result;
        },
        release(error) {
          h.releases++;
          h.destroyed = Boolean(error);
          if (error) unlock?.();
        },
      };
    },
  };
  const clientFactory = (options) => {
    h.clients.push(options);
    let serialized = '';
    const acquire = async () => {
      h.acquisitions++;
      if (h.acquireGate) await h.acquireGate;
      if (h.acquireError) throw new Error(`${secret} ${token} provider says nope`);
      serialized += '|PRIVATE-REFRESH-TOKEN';
      return h.result;
    };
    return {
      getAuthCodeUrl: async (request) => {
        h.auth = request;
        return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${new URLSearchParams({ state: request.state, response_mode: request.responseMode })}`;
      },
      acquireTokenByCode: async (request) => {
        h.code = request;
        return acquire();
      },
      acquireTokenSilent: async (request) => {
        h.silent = request;
        return acquire();
      },
      getTokenCache: () => ({
        serialize: () => serialized,
        deserialize: (value) => {
          h.deserialized = value;
          serialized = value;
        },
        getAccountByHomeId: async (id) => {
          h.lookup = id;
          return h.result.account;
        },
      }),
    };
  };
  const fetcher = async (url, options) => {
    h.http.push({ url, options });
    if (url.endsWith('/sendMail')) {
      if (h.sendError) throw new Error(`${secret} ${token}`);
      return {
        status: h.status,
        text: () => {
          throw new Error('must not read provider error body');
        },
      };
    }
    return { status: 200, json: async () => h.user };
  };
  const mimeFactory = (options) => ({
    sendMail: async (message) => {
      h.mime.push({ options, message });
      return { message: Buffer.from('MIME multipart/alternative\r\nplain + html') };
    },
    close() {
      h.mimeClosed = true;
    },
  });
  h.make = () => createMicrosoftMail({ env, pool, clientFactory, fetcher, mimeFactory });
  h.adapter = h.make();
  h.form = () => new URLSearchParams({ state: h.auth.state, code: 'PRIVATE-AUTH-CODE' });
  h.authorize = async () => {
    await h.adapter.begin();
    return h.adapter.complete(h.form());
  };
  h.message = { to: env.PBK_NEON_MAIL_TEST_TO, subject: 'PBK', text: 'plain', html: '<p>html</p>' };
  return h;
}

test('configuration is synchronous, strict, and does not import providers or touch storage', async () => {
  const h = harness();
  assert.equal(h.adapter.configured(), true);
  for (const field of Object.keys(h.env)) {
    const old = h.env[field];
    delete h.env[field];
    assert.equal(h.adapter.configured(), false, field);
    await assert.rejects(h.adapter.begin(), { code: 'microsoft_mail_not_configured' });
    h.env[field] = old;
  }
  h.env.PBK_NEON_MS_TENANT_ID = 'common';
  assert.equal(h.adapter.configured(), false);
  assert.equal(h.sql.length, 0);
  assert.equal(h.http.length, 0);
});

test('uncertain rollback destroys the connection and locks have server-side deadlines', async () => {
  const h = harness();
  await h.authorize();
  const lockAt = h.sql.findIndex(
    (entry) => entry.sql === 'SELECT pg_advisory_xact_lock(741902, 11943)'
  );
  assert.ok(
    h.sql.slice(0, lockAt).some((entry) => entry.sql.includes("SET LOCAL lock_timeout = '750ms'"))
  );
  assert.ok(h.sql.some((entry) => entry.sql.includes("SET LOCAL statement_timeout = '1000ms'")));
  h.lockError = true;
  h.rollbackError = true;
  await assert.rejects(h.adapter.verify(), { code: 'microsoft_mail_unavailable' });
  assert.equal(h.destroyed, true);
});

test('checked-out database errors during provider waits fail closed without an unhandled event', async () => {
  const h = harness();
  await h.authorize();
  let release;
  h.acquireGate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = h.adapter.verify();
  try {
    while (h.acquisitions < 2) await new Promise((resolve) => setImmediate(resolve));
    assert.doesNotThrow(() => h.dbEvents.emit('error', Error('private connection failure')));
  } finally {
    release();
  }
  await assert.rejects(pending, { code: 'microsoft_storage_connection_lost' });
  assert.equal(h.destroyed, true);
  assert.equal(h.mime.length, 0);
});

test('PKCE form_post flow encrypts durable state and cache; verify sends no mail', async () => {
  const h = harness();
  const url = new URL(await h.adapter.begin());
  assert.equal(url.searchParams.get('response_mode'), 'form_post');
  assert.equal(Buffer.from(h.auth.state, 'base64url').length, 32);
  assert.equal(h.auth.codeChallengeMethod, 'S256');
  assert.deepEqual(h.auth.scopes, [
    'https://graph.microsoft.com/Mail.Send',
    'https://graph.microsoft.com/User.Read',
    'offline_access',
  ]);
  assert.equal(
    h.auth.redirectUri,
    'https://pbk-openclaw-bridge.onrender.com/api/webhooks/neon-auth-mail/oauth/callback'
  );
  assert.equal(h.http.length, 0);
  assert.deepEqual(await h.adapter.complete(h.form()), { authorized: true });
  assert.equal(
    h.auth.codeChallenge,
    createHash('sha256').update(h.code.codeVerifier).digest('base64url')
  );
  const persisted = JSON.stringify(h.sql);
  for (const value of [
    secret,
    token,
    'PRIVATE-REFRESH-TOKEN',
    h.code.codeVerifier,
    h.auth.state,
    'home-owner-id',
  ])
    assert.ok(!persisted.includes(value), value);
  assert.match(persisted, /ENABLE ROW LEVEL SECURITY/);
  assert.match(persisted, /REVOKE ALL/);
  assert.match(persisted, /TO CURRENT_USER/);
  assert.equal(await h.make().verify(), true);
  assert.equal(h.lookup, 'home-owner-id');
  assert.match(h.deserialized, /PRIVATE-REFRESH-TOKEN/);
  assert.ok(h.http.every((v) => v.url.endsWith('/me?$select=id,mail,userPrincipalName')));
  assert.ok(
    h.http.every((v) => v.options.redirect === 'error' && v.options.signal instanceof AbortSignal)
  );
  assert.equal(h.mime.length, 0);
  const config = h.clients[0];
  assert.equal(config.auth.authority, `https://login.microsoftonline.com/${tenant}`);
  assert.equal(config.system.disableInternalRetries, true);
  assert.equal(config.system.loggerOptions.piiLoggingEnabled, false);
});

test('callback rejects missing, wrong, expired, duplicate, and replayed state', async () => {
  const h = harness();
  await h.adapter.begin();
  for (const form of [
    new URLSearchParams(),
    new URLSearchParams({ state: 'x'.repeat(43), code: 'code' }),
    new URLSearchParams(`state=${h.auth.state}&state=${h.auth.state}&code=code`),
  ]) {
    await assert.rejects(h.adapter.complete(form), { code: 'microsoft_oauth_state_invalid' });
  }
  const form = h.form();
  await h.adapter.complete(form);
  await assert.rejects(h.adapter.complete(form), { code: 'microsoft_oauth_state_invalid' });
  await h.adapter.begin();
  for (const value of h.states.values()) value.expires = 0;
  await assert.rejects(h.adapter.complete(h.form()), { code: 'microsoft_oauth_state_invalid' });
  assert.equal(h.acquisitions, 1);
});

test('failed/provider-error callbacks consume state without leaking secrets', async () => {
  for (const errorCallback of [true, false]) {
    const h = harness();
    await h.adapter.begin();
    const form = h.form();
    if (errorCallback) form.set('error', `${secret} ${token}`);
    else h.acquireError = true;
    await assert.rejects(h.adapter.complete(form), (error) => {
      assert.ok(!`${error.stack} ${JSON.stringify(error)}`.includes(secret));
      assert.ok(!error.message.includes(token));
      return true;
    });
    await assert.rejects(h.adapter.complete(form), { code: 'microsoft_oauth_state_invalid' });
    assert.equal(h.cache, undefined);
  }
});

test('wrong sender or tenant is denied before persisting credentials or sending', async () => {
  for (const mismatch of ['mail', 'upn', 'accountTenant', 'resultTenant']) {
    const h = harness();
    if (mismatch === 'mail') h.user.mail = 'other@example.test';
    if (mismatch === 'upn') {
      h.user.mail = null;
      h.user.userPrincipalName = 'other@example.test';
    }
    if (mismatch === 'accountTenant') h.result.account.tenantId = 'wrong';
    if (mismatch === 'resultTenant') h.result.tenantId = 'wrong';
    await assert.rejects(h.authorize(), {
      code: mismatch.includes('Tenant')
        ? 'microsoft_identity_mismatch'
        : 'microsoft_sender_mismatch',
    });
    assert.equal(h.cache, undefined);
    assert.equal(h.mime.length, 0);
    assert.ok(h.sql.some((v) => v.sql === 'ROLLBACK'));
  }
});

test('reauthorization and silent refresh cannot mutate pinned identity', async () => {
  for (const mismatch of ['home', 'graph']) {
    const h = harness();
    await h.authorize();
    const saved = h.cache;
    if (mismatch === 'home') h.result.account.homeAccountId = 'other-home';
    else h.user.id = 'other-graph';
    await assert.rejects(h.authorize(), {
      code: mismatch === 'home' ? 'microsoft_identity_mismatch' : 'microsoft_sender_mismatch',
    });
    assert.equal(h.cache, saved);
    await assert.rejects(h.adapter.verify());
    assert.equal(h.cache, saved);
  }
});

test('send enforces exact recipient, verifies sender, builds safe MIME, and returns acceptance only', async () => {
  const h = harness();
  await h.authorize();
  const initial = h.http.length;
  for (const to of [
    'outsider@example.test',
    `${h.message.to},outsider@example.test`,
    [h.message.to],
  ]) {
    await assert.rejects(h.adapter.sendMail({ ...h.message, to }, 'id'), {
      code: 'recipient_not_in_controlled_test',
    });
  }
  assert.equal(h.http.length, initial);
  h.user.mail = sender.toUpperCase();
  assert.deepEqual(
    await h.adapter.sendMail(
      {
        ...h.message,
        bcc: 'outsider@example.test',
        from: 'evil@example.test',
        raw: 'evil',
        envelope: { to: 'evil' },
      },
      'id'
    ),
    { accepted: [h.message.to] }
  );
  const mime = h.mime[0];
  assert.equal(mime.options.streamTransport, true);
  assert.equal(mime.options.buffer, true);
  assert.equal(mime.message.from.address, sender);
  assert.equal(mime.message.bcc, undefined);
  assert.equal(mime.message.raw, undefined);
  assert.equal(mime.message.envelope, undefined);
  assert.equal(mime.message.disableFileAccess, true);
  assert.equal(mime.message.disableUrlAccess, true);
  assert.match(mime.message.messageId, /^<pbk-neon-[a-f0-9]{64}@example.test>$/);
  const send = h.http.at(-1);
  assert.equal(send.url, 'https://graph.microsoft.com/v1.0/me/sendMail');
  assert.equal(send.options.headers['Content-Type'], 'text/plain');
  assert.equal(
    Buffer.from(send.options.body, 'base64').toString(),
    'MIME multipart/alternative\r\nplain + html'
  );
  assert.equal(h.mimeClosed, true);
  h.user.mail = 'wrong@example.test';
  await assert.rejects(h.adapter.sendMail(h.message, 'id-2'), {
    code: 'microsoft_sender_mismatch',
  });
  assert.equal(h.http.filter((v) => v.url.endsWith('/sendMail')).length, 1);
});

test('send never retries 429/500/non-202 or ambiguous transport failures; errors are sanitized', async () => {
  for (const status of [200, 400, 429, 500, 'network']) {
    const h = harness();
    await h.authorize();
    h.status = status;
    h.sendError = status === 'network';
    await assert.rejects(h.adapter.sendMail(h.message, 'id'), (error) => {
      assert.match(error.code, /^microsoft_(send_not_accepted|mail_unavailable)$/);
      assert.ok(!error.stack.includes(secret));
      assert.ok(!error.stack.includes(token));
      return true;
    });
    assert.equal(h.http.filter((v) => v.url.endsWith('/sendMail')).length, 1);
  }
});

test('cache transactions serialize across adapter instances and never query pool while holding client', async () => {
  const h = harness();
  await h.authorize();
  const first = h.cache;
  await Promise.all([h.make().verify(), h.make().verify()]);
  assert.notEqual(h.cache, first);
  assert.equal(h.deserialized.split('PRIVATE-REFRESH-TOKEN').length - 1, 2);
  assert.equal(h.releases, 3);
  const locks = h.sql.filter((v) => v.sql.startsWith('SELECT pg_advisory_xact_lock'));
  assert.equal(locks.length, 3);
});

test('cache tampering/key rotation fails closed and network adapter refuses other origins', async () => {
  const h = harness();
  await assert.rejects(h.adapter.verify(), { code: 'microsoft_authorization_required' });
  await h.authorize();
  h.env.PBK_NEON_MS_CACHE_KEY = Buffer.alloc(32, 18).toString('base64');
  await assert.rejects(h.adapter.verify(), { code: 'microsoft_mail_unavailable' });
  const network = h.clients[0].system.networkClient;
  await assert.rejects(network.sendGetRequestAsync('https://evil.example.test', {}), {
    code: 'microsoft_oauth_endpoint_denied',
  });
  assert.ok(!h.http.some((v) => v.url.includes('evil')));
});
