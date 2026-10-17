// Stratus — a working CRM for your Mac that works the way Salesforce does, with AI everywhere.
//
// The main process owns the window, the menu-bar cloud, files on disk (the org and settings) and the AI.
// Everything else — objects, records, apps, Einstein and Agentforce — lives in the renderer (renderer/).

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeTheme, nativeImage, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const ai = require('./ai');
const nexus = require('./nexus-beacon'); // reports health to Nexus (the fleet monitor)

const APPS = [
  ['sales', 'Sales'], ['service', 'Service'], ['marketing', 'Marketing'], ['commerce', 'Commerce'],
  ['agentforce', 'Agentforce'], ['datacloud', 'Data Cloud'], ['tableau', 'Tableau'], ['slack', 'Slack'],
  ['mulesoft', 'MuleSoft'], ['fieldservice', 'Field Service'],
];
const DEFAULTS = {
  appearance: 'system', // 'system' (follows macOS), 'light' or 'dark'
  ai: { provider: '', models: {}, bases: {} },
  window: null,
};

let win = null;
let tray = null;
let settings = null;
let dir = '';
let orgSize = 0;
let lastAi = null; // { ok, at, error } for the heartbeat

const fresh = process.argv.includes('--fresh');
const testing = !!process.env.STRATUS_TEST; // tools/test.js: temp data folder, no single-instance lock, no beacon

// ---------- files ----------

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
function writeJSON(f, v) {
  fs.writeFileSync(f + '.tmp', JSON.stringify(v));
  fs.renameSync(f + '.tmp', f);
}

function loadSettings() {
  const s = Object.assign({}, DEFAULTS, readJSON(path.join(dir, 'settings.json')) || {});
  if (!['system', 'light', 'dark'].includes(s.appearance)) s.appearance = DEFAULTS.appearance;
  return s;
}
function saveSettings() { writeJSON(path.join(dir, 'settings.json'), settings); }

const orgFile = () => path.join(dir, 'org.json');

// ---------- window ----------

function createWindow() {
  const b = settings.window || {};
  win = new BrowserWindow({
    width: b.width || 1440, height: b.height || 900, x: b.x, y: b.y, minWidth: 1024, minHeight: 640,
    title: 'Stratus', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f3f3f3', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  const remember = () => { if (win && !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) { settings.window = win.getBounds(); saveSettings(); } };
  win.on('resized', remember);
  win.on('moved', remember);
  win.on('close', (e) => { if (!app.quitting) { e.preventDefault(); win.hide(); } }); // keep running in the menu bar
  // Links open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}

function show(route) {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  app.focus({ steal: true });
  if (route) win.webContents.send('navigate', route);
}

// ---------- menu-bar cloud ----------

function trayTemplate() {
  const st = ai.state();
  return [
    { label: 'Open Stratus', click: () => show() },
    { label: 'Apps', submenu: APPS.map(([id, label]) => ({ label, click: () => show(`#/app/${id}`) })) },
    { label: 'Ask Agentforce…', click: () => show('#/agent') },
    { label: 'Global search…', click: () => show('#/search') },
    { type: 'separator' },
    { label: st.problem ? `✨ ${st.label} — needs setup` : `✨ ${st.label}`, enabled: false },
    { label: 'Appearance', submenu: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => ({
      label, type: 'radio', checked: settings.appearance === v, click: () => setAppearance(v),
    })) },
    { label: 'Settings…', click: () => show('#/settings') },
    { type: 'separator' },
    { label: 'Quit Stratus', click: () => { app.quitting = true; app.quit(); } },
  ];
}

function makeTray() {
  if (tray) return;
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Stratus');
  refreshTray();
}
function dropTray() { if (tray) { tray.destroy(); tray = null; } }
function refreshTray() { if (tray) tray.setContextMenu(Menu.buildFromTemplate(trayTemplate())); }

function setAppearance(v) {
  settings.appearance = v;
  nativeTheme.themeSource = v;
  saveSettings();
  refreshTray();
  if (win && !win.isDestroyed()) win.webContents.send('settings', publicSettings());
}

function publicSettings() { return { appearance: settings.appearance, ai: ai.state(), version: app.getVersion() }; }

// ---------- app menu (Edit is what makes copy/paste work) ----------

function appMenu() {
  const go = (route) => () => show(route);
  return Menu.buildFromTemplate([
    { label: 'Stratus', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'Cmd+,', click: go('#/settings') },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' },
      { label: 'Quit Stratus', accelerator: 'Cmd+Q', click: () => { app.quitting = true; app.quit(); } },
    ] },
    { role: 'editMenu' },
    { label: 'Go', submenu: [
      { label: 'Home', accelerator: 'Cmd+Shift+H', click: go('#/home') },
      { label: 'App Launcher', accelerator: 'Cmd+Shift+A', click: go('#/launcher') },
      { label: 'Search', accelerator: 'Cmd+K', click: go('#/search') },
      { label: 'Agentforce', accelerator: 'Cmd+J', click: go('#/agent') },
      { type: 'separator' },
      ...APPS.map(([id, label], i) => ({ label, accelerator: i < 9 ? `Cmd+${i + 1}` : undefined, click: go(`#/app/${id}`) })),
      { type: 'separator' },
      { label: 'Back', accelerator: 'Cmd+[', click: () => win && win.webContents.navigationHistory.goBack() },
      { label: 'Forward', accelerator: 'Cmd+]', click: () => win && win.webContents.navigationHistory.goForward() },
    ] },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Stratus on GitHub', click: () => shell.openExternal('https://github.com/Sravankumartangudu/stratus') }] },
  ]);
}

// ---------- IPC ----------

function wire() {
  ipcMain.handle('org:load', () => (fresh ? null : readJSON(orgFile())));
  ipcMain.handle('org:save', (_e, org) => { writeJSON(orgFile(), org); orgSize = Object.values(org.records || {}).reduce((n, r) => n + r.length, 0); return true; });
  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:appearance', (_e, v) => { if (['system', 'light', 'dark'].includes(v)) setAppearance(v); return publicSettings(); });
  ipcMain.handle('ai:configure', (_e, patch) => { const s = ai.configure(patch || {}); refreshTray(); return s; });
  ipcMain.handle('ai:models', async (_e, id) => ai.refreshModels(id));
  ipcMain.handle('ai:ask', async (_e, req) => {
    try {
      const r = await ai.ask(req || {});
      lastAi = { ok: true, at: Date.now() };
      return { ok: true, ...r };
    } catch (e) {
      lastAi = { ok: false, at: Date.now(), error: e.message };
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('app:open', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:export', async (_e, { name, text }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, text);
    return true;
  });
  ipcMain.handle('app:reset', async () => {
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Reset', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Reset the demo org?', detail: 'Every record, custom field, report and setting you made in Stratus goes back to the starting demo data. Your AI settings stay.' });
    if (r.response !== 0) return false;
    try { fs.unlinkSync(orgFile()); } catch (_) {}
    return true;
  });
}

// ---------- start ----------

if (!testing && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => show());
  app.whenReady().then(() => {
    dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    settings = loadSettings();
    ai.init({ dir, settings, save: saveSettings });
    nativeTheme.themeSource = settings.appearance;
    Menu.setApplicationMenu(appMenu());
    wire();
    createWindow();
    if (!testing) makeTray();
    nativeTheme.on('updated', () => { if (win && !win.isDestroyed()) win.webContents.send('settings', publicSettings()); });
    // Claude Code detection finishes shortly after launch; tell the menu and the window.
    setTimeout(() => { refreshTray(); if (win && !win.isDestroyed()) win.webContents.send('settings', publicSettings()); }, 1500);
    if (testing) return;
    nexus.start({
      id: 'com.sravankumartangudu.stratus', name: 'Stratus', version: app.getVersion(),
      status: () => {
        const st = ai.state();
        if (lastAi && !lastAi.ok && Date.now() - lastAi.at < 600000) return ['warn', 'AI: ' + lastAi.error.slice(0, 80)];
        return ['ok', `${orgSize} records · ${st.problem ? 'AI needs setup' : st.label}`];
      },
    });
    nexus.attach({ menu: trayTemplate, setVisible: (on) => (on ? makeTray() : dropTray()) });
  });
  app.on('activate', () => show());
  app.on('before-quit', () => { app.quitting = true; });
}
