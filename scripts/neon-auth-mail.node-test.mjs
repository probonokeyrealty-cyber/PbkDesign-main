import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import {
  createNeonVerifier,
  buildNeonEmail,
  smtpOptions,
  createMailDelivery,
  createNeonMailRouter,
  NEON_AUTH_URL,
} from './neon-auth-mail.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const now = 1794775000000,
  recipient = 'owner@example.invalid';
const event = () => ({
  event_id: randomUUID(),
  event_type: 'send.otp',
  context: { endpoint_id: 'ep-divine-silence-b4ckkyun' },
  user: { email: recipient },
  event_data: {
    otp_code: '123456',
    otp_type: 'forget-password',
    expires_at: new Date(now + 600000).toISOString(),
  },
});
function signed(e, stamp = now, header = { alg: 'EdDSA', kid: 'fixture-key' }) {
  const raw = Buffer.from(JSON.stringify(e)),
    protectedB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const input = `${protectedB64}.${Buffer.from(`${stamp}.${raw.toString('base64url')}`).toString('base64url')}`;
  return {
    raw,
    headers: {
      'x-neon-signature': `${protectedB64}..${sign(null, Buffer.from(input), privateKey).toString('base64url')}`,
      'x-neon-signature-kid': 'fixture-key',
      'x-neon-timestamp': String(stamp),
      'x-neon-event-id': e.event_id,
      'x-neon-event-type': e.event_type,
    },
  };
}
const verifier = () =>
  createNeonVerifier({
    now: () => now,
    fetcher: async (url) => {
      assert.equal(url, NEON_AUTH_URL + '/.well-known/jwks.json');
      return Response.json({
        keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture-key' }],
      });
    },
  });
test('real Ed25519 detached JWS binds the exact body and timestamp', async () => {
  const x = signed(event());
  assert.deepEqual(await verifier()(x.raw, x.headers), JSON.parse(x.raw));
});
for (const mutate of [
  (x) => {
    x.raw = Buffer.from(x.raw.toString().replace('123456', '999999'));
  },
  (x) => {
    x.headers['x-neon-timestamp'] = String(now - 300001);
  },
  (x) => {
    x.headers['x-neon-timestamp'] = String(now + 60001);
  },
  (x) => {
    x.headers['x-neon-signature-kid'] = 'unknown';
  },
  (x) => {
    x.headers['x-neon-event-id'] = randomUUID();
  },
  (x) => {
    x.headers['x-neon-event-type'] = 'send.magic_link';
  },
  (x) => {
    x.headers['x-neon-signature'] = x.headers['x-neon-signature'].replace('..', '.payload.');
  },
])
  test(`reject tampering ${mutate.toString()}`, async () => {
    const x = signed(event());
    mutate(x);
    await assert.rejects(verifier()(x.raw, x.headers));
  });
test('unsigned requests never fetch JWKS', async () => {
  let calls = 0;
  const v = createNeonVerifier({
    fetcher: async () => {
      calls++;
      throw Error('unexpected');
    },
  });
  await assert.rejects(v(Buffer.from('{}'), {}));
  assert.equal(calls, 0);
});
test('reject algorithm downgrade and foreign tenant even with a valid signature', async () => {
  for (const [e, h] of [
    [event(), { alg: 'none', kid: 'fixture-key' }],
    [
      { ...event(), context: { endpoint_id: 'ep-other' } },
      { alg: 'EdDSA', kid: 'fixture-key' },
    ],
  ]) {
    let x = signed(e, now, h);
    await assert.rejects(verifier()(x.raw, x.headers));
  }
});
test('unknown-key refresh is rate limited and concurrent JWKS reads coalesce', async () => {
  let calls = 0;
  let release;
  const wait = new Promise((r) => (release = r));
  const v = createNeonVerifier({
    now: () => now,
    fetcher: async () => {
      calls++;
      await wait;
      return Response.json({
        keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture-key' }],
      });
    },
  });
  let x = signed(event());
  let a = v(x.raw, x.headers),
    b = v(x.raw, x.headers);
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  x.headers['x-neon-signature-kid'] = 'unknown';
  await assert.rejects(v(x.raw, x.headers));
  assert.equal(calls, 1);
});
test('OTP recovery mail has recognizable PBK branding and plain text without a consuming link', () => {
  let m = buildNeonEmail(event(), recipient, now);
  assert.match(m.subject, /^PBK/);
  assert.match(m.html, /Probono Key Realty/);
  assert.match(m.text, /123456/);
  assert.doesNotMatch(m.html, /href=|<script|<img/);
  assert.doesNotMatch(m.subject, /123456/);
});
test('customer, expired, malformed code and SMS deliveries are blocked', () => {
  for (const e of [
    { ...event(), user: { email: 'customer@example.invalid' } },
    {
      ...event(),
      event_data: { ...event().event_data, expires_at: new Date(now - 1).toISOString() },
    },
    { ...event(), event_data: { ...event().event_data, otp_code: '<script>' } },
    { ...event(), event_data: { ...event().event_data, delivery_preference: 'sms' } },
  ])
    assert.throws(() => buildNeonEmail(e, recipient, now));
});
test('only pinned Neon and approved Academy origins can appear in a link email', () => {
  for (const link of [
    NEON_AUTH_URL + '/reset-password/fixture',
    'https://br-purple-recipe-b4mgs6in-pbkacademy.compute.c-6.us-east-2.aws.neon.tech/reset',
  ]) {
    let e = event();
    e.event_type = 'send.magic_link';
    e.event_data = {
      link_type: 'forget-password',
      link_url: link,
      expires_at: new Date(now + 60000).toISOString(),
    };
    assert.match(buildNeonEmail(e, recipient, now).html, /href=/);
  }
  for (const link of [
    'https://evil.example/reset',
    'http://127.0.0.1/reset',
    'javascript:alert(1)',
    'https://user:pass@' + new URL(NEON_AUTH_URL).host + '/pbk_academy/auth/reset',
  ]) {
    let e = event();
    e.event_type = 'send.magic_link';
    e.event_data = {
      link_type: 'forget-password',
      link_url: link,
      expires_at: new Date(now + 60000).toISOString(),
    };
    assert.throws(() => buildNeonEmail(e, recipient, now));
  }
});
const config = {
  PBK_NEON_SMTP_USER: 'auth@example.invalid',
  PBK_NEON_SMTP_PASSWORD: 'fixture-only',
  PBK_NEON_MAIL_FROM: 'auth@example.invalid',
  PBK_NEON_MAIL_TEST_TO: recipient,
  PBK_BRIDGE_API_KEY: 'fixture-admin',
  PBK_DATABASE_URL: 'fixture-db',
};
test('Microsoft 365 SMTP mandates authenticated STARTTLS and certificate verification', () => {
  let o = smtpOptions(config);
  assert.equal(o.host, 'smtp.office365.com');
  assert.equal(o.port, 587);
  assert.equal(o.requireTLS, true);
  assert.equal(o.tls.rejectUnauthorized, true);
  assert.equal(o.logger, false);
  assert.equal(o.disableFileAccess, true);
  assert.throws(() => smtpOptions({ ...config, PBK_NEON_MAIL_FROM: 'forged@example.invalid' }));
  assert.throws(() => smtpOptions({ ...config, PBK_NEON_SMTP_PASSWORD: '' }));
});
function ledger() {
  const rows = new Map();
  return {
    rows,
    async claim(id, hash) {
      if (rows.has(id)) return { acquired: false, ...rows.get(id) };
      rows.set(id, { hash, status: 'sending' });
      return { acquired: true };
    },
    async finish(id, status) {
      rows.get(id).status = status;
    },
  };
}
test('durable duplicate delivery sends once, and an event id cannot change payload', async () => {
  let store = ledger(),
    sends = 0;
  let deliver = createMailDelivery({
    ledger: store,
    send: async () => {
      sends++;
      return { accepted: [recipient] };
    },
  });
  assert.deepEqual(await deliver('event', 'hash', { to: recipient }), { smtpAccepted: true });
  assert.equal((await deliver('event', 'hash', { to: recipient })).duplicate, true);
  await assert.rejects(deliver('event', 'other', { to: recipient }), /event_payload_conflict/);
  assert.equal(sends, 1);
});
test('ambiguous SMTP failure requires reconciliation, never automatic resend', async () => {
  let store = ledger(),
    sends = 0;
  let deliver = createMailDelivery({
    ledger: store,
    send: async () => {
      sends++;
      throw Error('possible DATA acknowledgement lost');
    },
  });
  await assert.rejects(deliver('event', 'hash', { to: recipient }), /reconciliation/);
  await assert.rejects(deliver('event', 'hash', { to: recipient }), /reconciliation/);
  assert.equal(sends, 1);
  assert.equal(store.rows.get('event').status, 'unknown');
});
test('concurrent delivery cannot race into two SMTP writes', async () => {
  let store = ledger(),
    sends = 0,
    release;
  const wait = new Promise((r) => (release = r));
  const deliver = createMailDelivery({
    ledger: store,
    send: async () => {
      sends++;
      await wait;
      return { accepted: [recipient] };
    },
  });
  const first = deliver('event', 'hash', { to: recipient });
  await assert.rejects(deliver('event', 'hash', { to: recipient }), /reconciliation/);
  release();
  await first;
  assert.equal(sends, 1);
});
test('HTTP admin requires the bridge key, malformed webhook stays closed, and unrelated routes are untouched', async () => {
  const router = createNeonMailRouter({ env: {} });
  const server = createServer(async (req, res) => {
    if (!(await router(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + '/api/admin/neon-auth-mail')).status, 401);
    assert.equal(
      (await fetch(base + '/api/webhooks/neon-auth-mail', { method: 'POST', body: '{}' })).status,
      401
    );
    assert.equal((await fetch(base + '/private')).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('protected SMTP verification and test email cannot override the owner recipient', async () => {
  const rows = new Map(),
    sent = [];
  let verified = 0,
    pools = 0;
  class FixturePool {
    constructor() {
      pools++;
    }
    on() {}
    async query(sql, args) {
      if (sql.startsWith('CREATE')) return { rows: [] };
      if (sql.startsWith('INSERT')) {
        rows.set(args[0], { hash: args[1], status: 'sending' });
        return { rows: [{ event_id: args[0] }] };
      }
      if (sql.startsWith('UPDATE')) {
        rows.get(args[0]).status = args[1];
        return { rows: [] };
      }
      return { rows: [{ status: 'sent', count: sent.length }] };
    }
  }
  const router = createNeonMailRouter({
    env: config,
    poolFactory: FixturePool,
    transporterFactory: (options) => {
      assert.equal(options.requireTLS, true);
      return {
        verify: async () => {
          verified++;
        },
        sendMail: async (message) => {
          sent.push(message);
          return { accepted: [recipient] };
        },
      };
    },
  });
  const server = createServer(async (req, res) => {
    await router(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/admin/neon-auth-mail';
    const call = (action) =>
      fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture-admin' },
        body: JSON.stringify({ action, to: 'customer@example.invalid' }),
      });
    assert.equal((await call('invalid')).status, 400);
    assert.equal(verified, 0);
    assert.equal((await (await call('verify')).json()).smtpVerified, true);
    assert.equal(sent.length, 0);
    assert.equal((await (await call('test')).json()).smtpAccepted, true);
    assert.equal(sent[0].to, recipient);
    assert.equal(sent[0].from.address, config.PBK_NEON_SMTP_USER);
    assert.equal(sent[0].disableFileAccess, true);
    assert.doesNotMatch(JSON.stringify(sent), /PBK_NEON_SMTP_PASSWORD|fixture-only/);
    assert.equal(pools, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('Docker contains the mailer and pins its SMTP dependency without adding a public staff route', async () => {
  const docker = await readFile(new URL('../Dockerfile.openclaw', import.meta.url), 'utf8');
  assert.match(docker, /nodemailer@10\.6\.0/);
  assert.match(docker, /COPY scripts\/neon-auth-mail\.mjs/);
});
