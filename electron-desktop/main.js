const path = require('node:path');
const { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray } = require('electron');

const DASHBOARD_URL = process.env.PBK_DESKTOP_DASHBOARD_URL || 'https://pbkcommandcenter.netlify.app';
const HOTKEY = process.env.PBK_DESKTOP_HOTKEY || 'CommandOrControl+Shift+A';

let win = null;
let tray = null;

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
  createWindow();
  createTray();
  const registered = globalShortcut.register(HOTKEY, () => dispatchVoiceEvent('pbk-desktop-start-voice'));
  if (!registered) {
    console.warn(`[pbk-ava-desktop] hotkey registration failed: ${HOTKEY}`);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  win?.show();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
