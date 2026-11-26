import assert from 'node:assert/strict';

export async function connectReadOnlyPage(target, cdpOrigin) {
  const address = new URL(target.webSocketDebuggerUrl);
  const origin = new URL(cdpOrigin);
  assert.equal(origin.protocol, 'http:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'QA source must be loopback');
  assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash, 'QA source origin must be bare');
  assert.ok(origin.pathname === '/', 'QA source must use a root origin');
  assert.equal(address.protocol, 'ws:');
  assert.equal(address.host, origin.host);
  assert.ok(!address.username && !address.password && !address.search && !address.hash, 'QA source debugger target must be bare');
  assert.match(address.pathname, /^\/devtools\/page\/[a-zA-Z0-9_-]+$/);
  const socket = new WebSocket(address);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error('Read-only browser request failed'));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('QA source connection timed out')), 20000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('QA source connection failed')); }, { once: true });
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    assert.ok(['Runtime.evaluate', 'Network.getCookies'].includes(method));
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Read-only browser operation timed out'));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    url: () => target.url,
    async evaluate(fn, arg) {
      const result = await request('Runtime.evaluate', {
        expression: `(${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'})`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw new Error('QA source read failed');
      return result.result.value;
    },
    async cookies(base) {
      const result = await request('Network.getCookies', { urls: [base] });
      return result.cookies.map(cookie => {
        const { name, value, domain, path, expires, httpOnly, secure, sameSite } = cookie;
        const item = { name, value, domain, path, expires, httpOnly, secure, sameSite: sameSite ?? 'Lax' };
        if (cookie.partitionKey) {
          item.partitionKey = cookie.partitionKey.topLevelSite;
          item._crHasCrossSiteAncestor = cookie.partitionKey.hasCrossSiteAncestor;
        }
        return item;
      });
    },
    close: () => socket.close(),
  };
}
