(function initPbkAvaPublicChat() {
  if (window.PBK_PUBLIC_AVA_CHAT_LOADED) return;
  window.PBK_PUBLIC_AVA_CHAT_LOADED = true;

  const scriptUrl = document.currentScript && document.currentScript.src;
  const scriptOrigin = scriptUrl
    ? new URL(scriptUrl, window.location.href).origin
    : window.location.origin;
  const endpoint =
    window.PBK_PUBLIC_AVA_CHAT_ENDPOINT || `${scriptOrigin}/api/public/ava-chat`;
  const mountId = window.PBK_PUBLIC_AVA_CHAT_MOUNT || 'pbk-ava-public-chat';
  const primary = window.PBK_PUBLIC_AVA_CHAT_ACCENT || '#71f7c8';
  const host = document.getElementById(mountId) || document.body.appendChild(document.createElement('div'));
  host.id = mountId;

  host.innerHTML = `
    <style>
      .pbk-ava-chat-root {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483000;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #f8fafc;
      }
      .pbk-ava-chat-button {
        width: 64px;
        height: 64px;
        border: 0;
        border-radius: 22px;
        color: #06130e;
        background: radial-gradient(circle at 30% 20%, #ffffff 0, ${primary} 40%, #0f766e 100%);
        box-shadow: 0 20px 55px rgba(15, 118, 110, 0.38);
        cursor: pointer;
        font-size: 27px;
        font-weight: 900;
        letter-spacing: -0.08em;
      }
      .pbk-ava-chat-panel {
        display: none;
        width: min(390px, calc(100vw - 32px));
        max-height: min(620px, calc(100vh - 120px));
        margin-bottom: 14px;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 28px;
        background:
          linear-gradient(145deg, rgba(9, 24, 22, 0.96), rgba(10, 15, 27, 0.98)),
          radial-gradient(circle at top right, rgba(113, 247, 200, 0.18), transparent 42%);
        box-shadow: 0 28px 85px rgba(2, 6, 23, 0.55);
        backdrop-filter: blur(18px);
      }
      .pbk-ava-chat-panel[data-open="true"] { display: flex; flex-direction: column; }
      .pbk-ava-chat-head {
        padding: 18px 18px 14px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }
      .pbk-ava-chat-eyebrow {
        color: ${primary};
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .pbk-ava-chat-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        margin-top: 6px;
        font-size: 18px;
        font-weight: 850;
      }
      .pbk-ava-chat-close {
        border: 0;
        border-radius: 999px;
        width: 30px;
        height: 30px;
        color: #e2e8f0;
        background: rgba(148, 163, 184, 0.14);
        cursor: pointer;
      }
      .pbk-ava-chat-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 290px;
        padding: 16px;
        overflow-y: auto;
      }
      .pbk-ava-chat-msg {
        max-width: 86%;
        padding: 10px 12px;
        border-radius: 16px;
        font-size: 13px;
        line-height: 1.45;
      }
      .pbk-ava-chat-msg[data-role="assistant"] {
        align-self: flex-start;
        border: 1px solid rgba(113, 247, 200, 0.18);
        background: rgba(113, 247, 200, 0.1);
      }
      .pbk-ava-chat-msg[data-role="user"] {
        align-self: flex-end;
        color: #07140f;
        background: ${primary};
      }
      .pbk-ava-chat-form {
        display: flex;
        gap: 8px;
        padding: 12px;
        border-top: 1px solid rgba(148, 163, 184, 0.18);
      }
      .pbk-ava-chat-input {
        min-width: 0;
        flex: 1;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 999px;
        padding: 11px 13px;
        color: #f8fafc;
        background: rgba(15, 23, 42, 0.78);
        outline: none;
      }
      .pbk-ava-chat-submit {
        border: 0;
        border-radius: 999px;
        padding: 0 16px;
        color: #07140f;
        background: ${primary};
        font-weight: 800;
        cursor: pointer;
      }
      .pbk-ava-chat-foot {
        padding: 0 14px 14px;
        color: #94a3b8;
        font-size: 11px;
      }
      @media (max-width: 560px) {
        .pbk-ava-chat-root { right: 12px; bottom: 12px; }
        .pbk-ava-chat-panel {
          width: calc(100vw - 24px);
          max-height: calc(100vh - 94px);
        }
      }
    </style>
    <div class="pbk-ava-chat-root">
      <section class="pbk-ava-chat-panel" aria-live="polite" aria-label="PBK Ava chat panel">
        <header class="pbk-ava-chat-head">
          <div class="pbk-ava-chat-eyebrow">PBK public Ava</div>
          <div class="pbk-ava-chat-title">
            <span>Ask about a cash offer</span>
            <button class="pbk-ava-chat-close" type="button" aria-label="Close chat">x</button>
          </div>
        </header>
        <div class="pbk-ava-chat-body">
          <div class="pbk-ava-chat-msg" data-role="assistant">I can answer PBK questions or save your property info for the team. Calls, texts, emails, and contracts still require approval.</div>
        </div>
        <form class="pbk-ava-chat-form">
          <input class="pbk-ava-chat-input" name="message" autocomplete="off" placeholder="Address, question, or callback request..." />
          <button class="pbk-ava-chat-submit" type="submit">Send</button>
        </form>
        <div class="pbk-ava-chat-foot">Public chat is read-only except lead capture. Provider writes are blocked.</div>
      </section>
      <button class="pbk-ava-chat-button" type="button" aria-label="Open PBK Ava chat">A</button>
    </div>
  `;

  const panel = host.querySelector('.pbk-ava-chat-panel');
  const button = host.querySelector('.pbk-ava-chat-button');
  const close = host.querySelector('.pbk-ava-chat-close');
  const body = host.querySelector('.pbk-ava-chat-body');
  const form = host.querySelector('.pbk-ava-chat-form');
  const input = host.querySelector('.pbk-ava-chat-input');
  const history = [];

  function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'pbk-ava-chat-msg';
    div.dataset.role = role;
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    history.push({ role: role === 'assistant' ? 'assistant' : 'user', content: text, at: new Date().toISOString() });
  }

  async function sendMessage(text) {
    addMessage('user', text);
    input.value = '';
    input.disabled = true;
    const pending = 'Ava is checking PBK knowledge...';
    addMessage('assistant', pending);
    const pendingEl = body.lastElementChild;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, messages: history.slice(-10), source: 'website-widget' }),
      });
      const payload = await response.json();
      pendingEl.textContent = payload.answer || payload.error || 'Ava could not answer that yet.';
    } catch (error) {
      pendingEl.textContent = 'Ava could not reach PBK right now. Please try again in a minute.';
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  button.addEventListener('click', () => {
    const next = panel.dataset.open !== 'true';
    panel.dataset.open = String(next);
    if (next) input.focus();
  });
  close.addEventListener('click', () => {
    panel.dataset.open = 'false';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) sendMessage(text);
  });
}());
