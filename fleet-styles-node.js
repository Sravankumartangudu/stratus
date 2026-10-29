// fleet-styles-node — FleetStyles.swift for Electron apps: the design style the app wears, picked in its own
// Settings or in Nexus › 🎨 Style per app, the same in both within seconds.
//
// Master copy: ~/Nexus/styles/fleet-styles-node.js. scripts/sync-styles.sh copies it into the Electron apps
// (NODE_APPS there); don't edit the copies. Main process only.
//
// Same file as the Swift apps: ~/.nexus/styles.json  { apps: { <bundle id>: { app, style, styles, updated } } }.
// Node has no flock, so an Electron app reads, changes and swaps the file in one go (write to a temp file, rename)
// without holding styles.lock: a pick made in the app in the same instant as one in Nexus can lose one of the two.
// Picks are clicks, so that's left as it is.
//
//   const styles = require('./fleet-styles-node');
//   styles.start({ app: 'Water Buddy', id: 'com.waterbuddy.app',
//                  get: () => settings.uiStyle, set: v => { settings.uiStyle = v; save(); }, changed: () => … });
//   styles.wear(win.webContents)    every window that wears the style (<html data-style>, on every load)
//   styles.choose(id)               the user picked one in Settings
//   styles.pick() / styles.list     for the Settings page (FleetStyles.picker in the kit's script half)
//   styles.parentInstalled()        Nexus is on this Mac (then the page can say the pick is in the common settings)
// Without Nexus (or with no id, as in tests) nothing is read or written, and the app's own setting is all there is.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ALL = [
  ['standard', 'Standard', "The app's usual look."],
  ['skeuo', 'Skeuomorphic', 'Real things: linen, stitched paper, brushed metal, glossy buttons.'],
  ['flat', 'Flat', 'No depth: solid colours, no shadows, small corners.'],
  ['material', 'Material', 'Paper layers with shadows, underlined tabs, uppercase buttons.'],
  ['neumorph', 'Neumorphic', 'Soft UI: shapes pushed out of, or pressed into, the page.'],
  ['glass', 'Glassmorphism', 'Frosted see-through panes over a colourful backdrop.'],
  ['liquid', 'Liquid Glass', 'Clear glass with bright rims, an inner glow and capsule controls.'],
  ['clay', 'Claymorphism', 'Puffy pastel clay shapes and rounded type.'],
  ['brutal', 'Neo-brutalism', 'Thick black outlines, hard shadows, loud flat fills.'],
  ['swiss', 'Swiss minimal', 'Rules and type instead of boxes: black, white and one red.'],
  ['bento', 'Bento grid', 'Big rounded tiles in mixed tints, big numbers.'],
  ['retro', 'Retro', 'A Windows 95 desktop: bevelled grey windows, blue title bars.'],
  ['aurora', 'Aurora', 'Soft colour glows behind clean cards, gradient accents.'],
  ['cyber', 'Cyber', 'Neon edges on near-black, mono type, faint scan lines.'],
].map(([id, name, blurb]) => ({ id, name, blurb }));

const DIR = path.join(os.homedir(), '.nexus');
const FILE = path.join(DIR, 'styles.json');
const NEXUS_APPS = ['/Applications/Nexus.app', path.join(os.homedir(), 'Applications/Nexus.app')];

let opts = null;
const pages = new Set();

const ids = () => ALL.map(s => s.id);
const parentInstalled = () => NEXUS_APPS.some(p => fs.existsSync(p));

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).apps || {}; } catch { return {}; }
}

// Read, change one entry, write (only if it changed), with a new "updated" on it.
function update(change) {
  const apps = read();
  const before = JSON.stringify(apps[opts.id] || null);
  const e = change(Object.assign({}, apps[opts.id] || {}));
  if (!e || JSON.stringify(e) === before) return;
  e.updated = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  apps[opts.id] = e;
  const sorted = Object.fromEntries(Object.keys(apps).sort().map(k => [k, apps[k]]));
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ apps: sorted }, null, 2));
    fs.renameSync(tmp, FILE);
  } catch { /* Nexus's folder isn't writable: the app's own setting still holds */ }
}

/** The style this app wears. */
function pick() {
  const v = opts && opts.get();
  return ids().includes(v) ? v : 'standard';
}

function dress(wc) {
  if (wc.isDestroyed()) return;
  wc.executeJavaScript(`document.documentElement.setAttribute('data-style', '${pick()}')`).catch(() => {});   // ids are plain words
}
const redress = () => pages.forEach(dress);

/** A window that wears the style: <html data-style> now, and on every page it loads later. */
function wear(wc) {
  pages.add(wc);
  wc.on('dom-ready', () => dress(wc));
  wc.once('destroyed', () => pages.delete(wc));
  if (!wc.isLoading()) dress(wc);
}

/** Call once at launch, after the app's settings are loaded. */
function start(o) {
  opts = o;
  if (!o.id || !parentInstalled()) return;
  let wearing = pick();
  update(e => {
    if (ids().includes(e.style)) wearing = e.style;           // picked in Nexus while the app was closed
    return Object.assign(e, { app: o.app, style: wearing, styles: ALL });
  });
  if (wearing !== pick()) o.set(wearing);
  fs.watchFile(FILE, { interval: 3000 }, () => {
    const s = (read()[o.id] || {}).style;
    if (!ids().includes(s) || s === pick()) return;
    o.set(s);
    redress();
    if (o.changed) o.changed();
  });
}

/** The user picked a style in the app's Settings: wear it, and Nexus shows it too. */
function choose(id) {
  if (!opts || !ids().includes(id) || id === pick()) return;
  opts.set(id);
  if (opts.id && parentInstalled()) update(e => Object.assign(e, { style: id }));
  redress();
}

module.exports = { start, wear, choose, pick, parentInstalled, list: ALL, all: ALL };
