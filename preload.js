const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  loadOrg: () => ipcRenderer.invoke('org:load'),
  saveOrg: (org) => ipcRenderer.invoke('org:save', org),
  resetOrg: () => ipcRenderer.invoke('app:reset'),
  settings: () => ipcRenderer.invoke('settings:get'),
  setAppearance: (v) => ipcRenderer.invoke('settings:appearance', v),
  setStyle: (v) => ipcRenderer.invoke('settings:style', v),
  aiConfigure: (patch) => ipcRenderer.invoke('ai:configure', patch),
  aiModels: (id) => ipcRenderer.invoke('ai:models', id),
  aiAsk: (req) => ipcRenderer.invoke('ai:ask', req),
  open: (url) => ipcRenderer.invoke('app:open', url),
  exportFile: (name, text) => ipcRenderer.invoke('app:export', { name, text }),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, r) => cb(r)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
});
