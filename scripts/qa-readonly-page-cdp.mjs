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
  let terminalError;
  let handshake;
  function stop(error) {
    if (terminalError) return;
    terminalError = error;
    clearTimeout(handshake.timer);
    handshake.reject(error);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    socket.removeEventListener('open', onOpen);
    socket.removeEventListener('message', onMessage);
    socket.removeEventListener('error', onError);
    socket.removeEventListener('close', onClose);
    try { socket.close(); } catch { /* Close only this client's transport. */ }
  }
  function onOpen() {
    clearTimeout(handshake.timer);
    handshake.resolve();
  }
  function onError() { stop(new Error('QA source connection failed')); }
  function onClose() { stop(new Error('QA source connection closed')); }
  function onMessage(event) {
    let message;
    try { message = JSON.parse(event.data); }
    catch { stop(new Error('QA source response invalid')); return; }
    if (!message || typeof message !== 'object') {
      stop(new Error('QA source response invalid'));
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error('Read-only browser request failed'));
    else request.resolve(message.result);
  }
  const ready = new Promise((resolve, reject) => {
    handshake = { resolve, reject, timer: setTimeout(() => stop(new Error('QA source connection timed out')), 20000) };
  });
  socket.addEventListener('open', onOpen, { once: true });
  socket.addEventListener('message', onMessage);
  socket.addEventListener('error', onError);
  socket.addEventListener('close', onClose);
  await ready;
  const request = (method, params) => new Promise((resolve, reject) => {
    if (terminalError) return reject(terminalError);
    assert.ok(['Runtime.evaluate', 'Network.getCookies'].includes(method));
    const id = ++sequence;
    const timer = setTimeout(() => stop(new Error('Read-only browser operation timed out')), 30000);
    pending.set(id, { resolve, reject, timer });
    try { socket.send(JSON.stringify({ id, method, params })); }
    catch { stop(new Error('Read-only browser request failed')); }
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
    close: () => stop(new Error('QA source connection closed')),
  };
}
