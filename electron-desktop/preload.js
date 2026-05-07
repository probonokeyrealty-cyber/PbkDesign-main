const { contextBridge, ipcRenderer } = require('electron');

function dispatch(name) {
  window.dispatchEvent(new CustomEvent(name));
}

ipcRenderer.on('pbk-desktop-start-voice', () => dispatch('pbk-desktop-start-voice'));
ipcRenderer.on('pbk-desktop-stop-voice', () => dispatch('pbk-desktop-stop-voice'));

contextBridge.exposeInMainWorld('pbkDesktop', {
  onStartVoice(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = () => callback();
    window.addEventListener('pbk-desktop-start-voice', handler);
    return () => window.removeEventListener('pbk-desktop-start-voice', handler);
  },
  onStopVoice(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = () => callback();
    window.addEventListener('pbk-desktop-stop-voice', handler);
    return () => window.removeEventListener('pbk-desktop-stop-voice', handler);
  },
});
