# PBK Ava Desktop

Privacy-safe Electron wrapper for PBK Command Center. It loads the live dashboard, adds a system tray menu, and maps `CommandOrControl+Shift+A` to the existing Ava voice panel.

## What It Does

- Opens the PBK dashboard in a native desktop window.
- Adds tray actions for `Open Dashboard`, `Start Voice`, `Stop Voice`, and `Quit`.
- Sends `pbk-desktop-start-voice` and `pbk-desktop-stop-voice` events into the dashboard.
- Reuses the dashboard's existing browser mic flow, Deepgram stream session, approval guardrails, and ElevenLabs TTS endpoint when enabled.

## What It Does Not Do Yet

- It does not run wake-word detection.
- It does not always listen in the background.
- It does not bypass browser microphone permission prompts.
- It does not bypass PBK approval mode or provider-write safeguards.

## Run Locally

```powershell
cd "C:\Users\Dell\Documents\New project 2\PbkDesign-main\electron-desktop"
npm install
npm start
```

Optional environment values:

```powershell
$env:PBK_DESKTOP_DASHBOARD_URL="https://pbkcommandcenter.netlify.app"
$env:PBK_DESKTOP_HOTKEY="CommandOrControl+Shift+A"
```

## Next Controlled Upgrade

Wake word support should be added as a separate privacy review because it changes Ava from push-to-talk to continuous listening.
