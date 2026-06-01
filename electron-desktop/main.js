const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, Menu, nativeImage, Tray } = require('electron');
const WebSocket = require('ws');
const {
  buildBridgeSidecarUrl,
  buildCommandResult,
  buildSidecarStatusPayload,
  isTruthy,
  limitText,
  normalizeAllowedRoots,
  validateSidecarCommand,
} = require('./sidecar-core');

const DASHBOARD_URL = process.env.PBK_DESKTOP_DASHBOARD_URL || 'https://pbkcommandcenter.netlify.app';
const HOTKEY = process.env.PBK_DESKTOP_HOTKEY || 'CommandOrControl+Shift+A';
const SIDECAR_ID = process.env.PBK_SIDECAR_ID || `pbk-sidecar-${os.hostname()}`;
const SIDECAR_ENABLED = !/^(0|false|no)$/i.test(String(process.env.PBK_DESKTOP_SIDECAR_ENABLED || 'true').trim());
const SIDECAR_BRIDGE_URL = buildBridgeSidecarUrl(process.env.PBK_SIDECAR_BRIDGE_URL || process.env.PBK_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com');
const SIDECAR_TOKEN = String(process.env.PBK_SIDECAR_TOKEN || process.env.PBK_BRIDGE_API_KEY || '').trim();
const SIDECAR_AUTOMATION_ENABLED = isTruthy(process.env.PBK_SIDECAR_AUTOMATION_ENABLED);
const SIDECAR_SCREEN_ENABLED = process.env.PBK_SIDECAR_SCREEN_ENABLED === undefined
  ? true
  : isTruthy(process.env.PBK_SIDECAR_SCREEN_ENABLED);
const SIDECAR_LOCAL_LLM_ENABLED = isTruthy(process.env.PBK_SIDECAR_LOCAL_LLM_ENABLED);
const SIDECAR_ALLOWED_ROOTS_RAW = process.env.PBK_SIDECAR_ALLOWED_ROOTS || '';

let win = null;
let tray = null;
let sidecarSocket = null;
let sidecarReconnectTimer = null;
let sidecarStartedAt = new Date().toISOString();
let sidecarLastBridgeMessageAt = '';
let sidecarWatchers = new Map();

function isRecoverablePipeError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || '');
  return code === 'EPIPE' || /EPIPE|broken pipe/i.test(message);
}

function guardProcessPipe(stream) {
  if (!stream?.on || stream.__pbkPipeGuardInstalled) return;
  stream.__pbkPipeGuardInstalled = true;
  stream.on('error', (error) => {
    // Electron on Windows can surface stdout/stderr EPIPE as an uncaught main-process error.
    // Treat only broken log pipes as recoverable; the sidecar socket will reconnect separately.
    if (!isRecoverablePipeError(error)) {
      try {
        stream.write(`[pbk-ava-desktop] process stream error: ${error?.message || error}\n`);
      } catch {}
    }
  });
}

guardProcessPipe(process.stdout);
guardProcessPipe(process.stderr);

function safeWarn(...args) {
  try {
    console.warn(...args);
  } catch (error) {
    if (!isRecoverablePipeError(error)) {
      try {
        process.stderr.write(`[pbk-ava-desktop] log failed: ${error?.message || error}\n`);
      } catch {}
    }
  }
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stop-color="#7dd3fc"/>
          <stop offset=".55" stop-color="#2A97DA"/>
          <stop offset="1" stop-color="#0A0A0A"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="20" fill="url(#g)"/>
      <text x="31" y="43" text-anchor="middle" font-family="Georgia, serif" font-size="34" font-style="italic" font-weight="800" fill="#F9FAFB">A</text>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function dispatchVoiceEvent(eventName) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send(eventName);
  win.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName === 'pbk-desktop-stop-voice' ? 'pbk-desktop-stop-voice' : 'pbk-desktop-start-voice')}));`,
  ).catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'PBK Ava Desktop',
    backgroundColor: '#0A0A0A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(DASHBOARD_URL);

  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

function getSidecarAllowedRoots() {
  const fallbackRoots = [
    app.getPath('documents'),
    app.getPath('desktop'),
    app.getPath('downloads'),
  ].filter(Boolean);
  return normalizeAllowedRoots(SIDECAR_ALLOWED_ROOTS_RAW, fallbackRoots);
}

function sendSidecarMessage(message) {
  if (!sidecarSocket || sidecarSocket.readyState !== WebSocket.OPEN) return false;
  try {
    sidecarSocket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    if (!isRecoverablePipeError(error)) safeWarn('[pbk-ava-desktop] sidecar send failed:', error?.message || error);
    return false;
  }
}

function buildLocalSidecarStatus(connected = false) {
  return buildSidecarStatusPayload({
    connected,
    sidecarId: SIDECAR_ID,
    machineName: os.hostname(),
    startedAt: sidecarStartedAt,
    lastBridgeMessageAt: sidecarLastBridgeMessageAt,
    allowedRoots: getSidecarAllowedRoots(),
    automationEnabled: SIDECAR_AUTOMATION_ENABLED,
    screenEnabled: SIDECAR_SCREEN_ENABLED,
    localLlmEnabled: SIDECAR_LOCAL_LLM_ENABLED,
  });
}

async function runLocalLlmQuery(command) {
  const response = await fetch(process.env.PBK_OLLAMA_URL || 'http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: command.model || process.env.PBK_OLLAMA_MODEL || 'phi3',
      stream: false,
      messages: [{ role: 'user', content: String(command.query || command.prompt || '').slice(0, 8000) }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`);
  }
  const payload = await response.json();
  return payload?.message?.content || payload?.response || '';
}

async function captureScreenPayload(command) {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: {
      width: Number(command.width || 1280),
      height: Number(command.height || 720),
    },
  });
  const source = sources.find((item) => item.name && !/entire screen/i.test(item.name)) || sources[0];
  if (!source) throw new Error('No desktop capture source available.');
  return {
    sourceName: source.name,
    displayId: source.display_id || '',
    imageDataUrl: source.thumbnail.toDataURL(),
    ocrText: '',
    note: 'OCR is optional. Screenshot image is returned locally to the bridge for Ava/Rex review.',
  };
}

function watchFolderForSidecar(command) {
  const watcherId = command.id || `${command.action}-${Date.now()}`;
  if (sidecarWatchers.has(watcherId)) return { watcherId, status: 'already_watching' };
  const watcher = require('node:fs').watch(command.path, { recursive: true }, (eventType, filename) => {
    sendSidecarMessage({
      type: 'sidecar.event',
      event: 'file_changed',
      sidecarId: SIDECAR_ID,
      payload: {
        watcherId,
        eventType,
        path: filename ? path.join(command.path, filename) : command.path,
      },
      at: new Date().toISOString(),
    });
  });
  sidecarWatchers.set(watcherId, watcher);
  return { watcherId, status: 'watching' };
}

function scheduleSidecarReconnect() {
  if (app.isQuitting || !SIDECAR_ENABLED) return;
  if (sidecarReconnectTimer) clearTimeout(sidecarReconnectTimer);
  sidecarReconnectTimer = setTimeout(connectDesktopSidecar, 5000);
}

async function handleSidecarCommand(rawCommand) {
  const validation = validateSidecarCommand(rawCommand, {
    allowedRoots: getSidecarAllowedRoots(),
    automationEnabled: SIDECAR_AUTOMATION_ENABLED,
    screenEnabled: SIDECAR_SCREEN_ENABLED,
    localLlmEnabled: SIDECAR_LOCAL_LLM_ENABLED,
  });
  const command = validation.command || rawCommand;
  if (!validation.ok) {
    sendSidecarMessage(buildCommandResult(command, {
      ok: false,
      result: 'rejected',
      error: validation.reason,
      payload: { reason: validation.reason },
    }));
    return;
  }

  try {
    let payload = {};
    if (command.action === 'ping' || command.action === 'status') {
      payload = buildLocalSidecarStatus(true);
    } else if (command.action === 'read_file') {
      const content = await fs.readFile(command.path, 'utf8');
      payload = {
        path: command.path,
        content: limitText(content, Number(command.maxBytes || 64 * 1024)),
      };
    } else if (command.action === 'list_dir') {
      const entries = await fs.readdir(command.path, { withFileTypes: true });
      payload = {
        path: command.path,
        entries: entries.slice(0, Number(command.limit || 200)).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        })),
      };
    } else if (command.action === 'screenshot' || command.action === 'screenshot_ocr') {
      payload = await captureScreenPayload(command);
    } else if (command.action === 'type_text') {
      clipboard.writeText(String(command.text || ''));
      payload = {
        copiedToClipboard: true,
        note: 'Text copied to clipboard. Full OS typing requires an optional automation driver and explicit PBK_SIDECAR_AUTOMATION_ENABLED=true.',
      };
    } else if (command.action === 'llm_query') {
      payload = { answer: await runLocalLlmQuery(command) };
    } else if (command.action === 'watch_folder') {
      payload = watchFolderForSidecar(command);
    }
    sendSidecarMessage(buildCommandResult(command, { ok: true, payload }));
  } catch (error) {
    sendSidecarMessage(buildCommandResult(command, {
      ok: false,
      result: 'failed',
      error: error?.message || String(error),
    }));
  }
}

function connectDesktopSidecar() {
  if (!SIDECAR_ENABLED) return;
  if (sidecarSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(sidecarSocket.readyState)) return;
  const url = new URL(SIDECAR_BRIDGE_URL);
  if (SIDECAR_TOKEN) url.searchParams.set('token', SIDECAR_TOKEN);
  sidecarSocket = new WebSocket(url.toString(), {
    headers: SIDECAR_TOKEN ? { Authorization: `Bearer ${SIDECAR_TOKEN}` } : {},
  });
  sidecarSocket.on('open', () => {
    sendSidecarMessage({
      type: 'sidecar.hello',
      sidecarId: SIDECAR_ID,
      status: buildLocalSidecarStatus(true),
    });
  });
  sidecarSocket.on('message', (raw) => {
    try {
      sidecarLastBridgeMessageAt = new Date().toISOString();
      const message = JSON.parse(String(raw || '{}'));
      if (message.type === 'sidecar.command' || message.type === 'command') {
        void handleSidecarCommand(message.payload || message);
      }
    } catch (error) {
      safeWarn('[pbk-ava-desktop] ignored malformed sidecar message:', error?.message || error);
    }
  });
  sidecarSocket.on('close', () => {
    scheduleSidecarReconnect();
  });
  sidecarSocket.on('error', (error) => {
    safeWarn('[pbk-ava-desktop] sidecar socket error:', error?.message || error);
    try { sidecarSocket?.terminate?.(); } catch {}
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('PBK Ava Desktop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => { win?.show(); win?.focus(); } },
    { label: 'Start Voice', click: () => dispatchVoiceEvent('pbk-desktop-start-voice') },
    { label: 'Stop Voice', click: () => dispatchVoiceEvent('pbk-desktop-stop-voice') },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('double-click', () => {
    win?.show();
    win?.focus();
  });
}

app.whenReady().then(() => {
  sidecarStartedAt = new Date().toISOString();
  createWindow();
  createTray();
  connectDesktopSidecar();
  const registered = globalShortcut.register(HOTKEY, () => dispatchVoiceEvent('pbk-desktop-start-voice'));
  if (!registered) {
    safeWarn(`[pbk-ava-desktop] hotkey registration failed: ${HOTKEY}`);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  win?.show();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const watcher of sidecarWatchers.values()) {
    try { watcher.close(); } catch {}
  }
  sidecarWatchers = new Map();
  if (sidecarReconnectTimer) clearTimeout(sidecarReconnectTimer);
  try { sidecarSocket?.close(); } catch {}
});
