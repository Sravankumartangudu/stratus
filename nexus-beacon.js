// nexus-beacon.js — drop-in heartbeat for Nexus (the fleet monitor), for Electron / Node apps.
//
// To make an Electron app visible to Nexus with live health, in the main process (main.js):
//   const nexus = require("./nexus-beacon");
//   nexus.start({ id: "local.water-buddy", name: "Water Buddy", version: app.getVersion() });
//   // optionally report richer health each beat:
//   nexus.start({ id: "local.water-buddy", name: "Water Buddy", version: app.getVersion(),
//                 status: () => paused ? ["warn", "reminders paused"] : ["ok", "on duty"] });
//   // and, so the app can live in Nexus's menu, the tray menu's template and a way to show/hide the tray:
//   nexus.attach({ menu: () => trayTemplate(), setVisible: (on) => on ? makeTray() : dropTray() });
//
// Writes ~/.nexus/heartbeats/<id>.json every 30s and a final "offline" beat on quit. After `attach`
// it also mirrors the menu to ~/.nexus/menus/<id>.json when Nexus asks, runs the items Nexus picks
// (~/.nexus/inbox/<id>/), and hides the tray while "Keep agents in Nexus" is on (~/.nexus/folder.json)
// and Nexus is running. No dependency on Nexus being installed; safe to require unconditionally.

const fs = require("fs");
const os = require("os");
const path = require("path");

let opts = null;
let timer = null;
let menuOpts = null;
let visible = null;

const home = path.join(os.homedir(), ".nexus");
function dir() {
  return path.join(home, "heartbeats");
}

function write(status, detail) {
  if (!opts) return;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const obj = {
      id: opts.id, name: opts.name, version: opts.version || "?",
      pid: process.pid, status, detail: detail || "",
      ts: Math.floor(Date.now() / 1000),
    };
    fs.writeFileSync(path.join(dir(), `${opts.id}.json`), JSON.stringify(obj, null, 2));
  } catch (_) { /* heartbeat is best-effort */ }
}

function beat() {
  let status = "ok", detail = "";
  if (typeof opts.status === "function") {
    try { const r = opts.status(); if (Array.isArray(r)) { status = r[0]; detail = r[1] || ""; } } catch (_) {}
  }
  write(status, detail);
}

function start(options) {
  opts = options;
  beat();
  timer = setInterval(beat, 30000);
  if (timer.unref) timer.unref();
  const bye = () => {
    write("offline", "quit");
    try { fs.unlinkSync(menuFile()); } catch (_) {}
  };
  process.on("exit", bye);
  process.on("SIGTERM", () => { bye(); process.exit(0); });
  process.on("SIGINT", () => { bye(); process.exit(0); });
}

// ---------- living in Nexus's menu ----------

const menuFile = () => path.join(home, "menus", `${opts.id}.json`);
const inbox = () => path.join(home, "inbox", opts.id);
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return null; } };

// Nexus writes an "offline" beat when it quits; a beat older than 75s means it isn't running.
function nexusUp() {
  const b = readJSON(path.join(dir(), "com.stangudu.nexus.json"));
  return !!b && b.status !== "offline" && Date.now() / 1000 - (b.ts || 0) < 75;
}

function applyFolder() {
  if (!menuOpts || typeof menuOpts.setVisible !== "function") return;
  const cfg = readJSON(path.join(home, "folder.json")) || {};
  const on = !(cfg.enabled && nexusUp() && !(cfg.shown || []).includes(opts.id));
  if (on === visible) return;
  visible = on;
  try { menuOpts.setVisible(on); } catch (_) {}
}

// Each entry is a separator or {t: title, e: enabled, s: checked, k: [submenu]}; `i` is its index.
function dumpMenu() {
  if (!menuOpts) return;
  const entries = (items) => (items || []).map((it, i) => {
    if (it.visible === false) return null;
    if (it.type === "separator") return { i, sep: true };
    const e = { i, t: it.label || "", e: it.enabled !== false, s: !!it.checked };
    if (Array.isArray(it.submenu)) e.k = entries(it.submenu);
    return e;
  }).filter(Boolean);
  try {
    fs.mkdirSync(path.dirname(menuFile()), { recursive: true });
    const obj = { id: opts.id, name: opts.name, ts: Math.floor(Date.now() / 1000), items: entries(menuOpts.menu()) };
    fs.writeFileSync(menuFile() + ".tmp", JSON.stringify(obj));
    fs.renameSync(menuFile() + ".tmp", menuFile());
  } catch (_) {}
}

// Runs the item at `path`, checking the title still matches; if not, the item with that title on the last level.
function perform(at, title) {
  let items = menuOpts.menu();
  for (const i of at.slice(0, -1)) {
    items = items && items[i] && items[i].submenu;
    if (!Array.isArray(items)) return;
  }
  let it = items[at[at.length - 1]];
  if (!it || (it.label || "") !== title) it = items.find((x) => (x.label || "") === title);
  if (it && it.enabled !== false && typeof it.click === "function") it.click();
  setTimeout(dumpMenu, 300);
}

function readInbox() {
  let files = [];
  try { files = fs.readdirSync(inbox()).filter((f) => f.endsWith(".json")).sort(); } catch (_) { return; }
  for (const f of files) {
    const p = path.join(inbox(), f), cmd = readJSON(p);
    try { fs.unlinkSync(p); } catch (_) {}
    if (!cmd) continue;
    if (cmd.cmd === "dump") dumpMenu();
    else if (cmd.cmd === "folder") applyFolder();
    else if (cmd.cmd === "perform" && Array.isArray(cmd.path) && cmd.path.length) perform(cmd.path, cmd.title || "");
  }
}

function attach(options) {
  menuOpts = options;
  try { fs.mkdirSync(inbox(), { recursive: true }); } catch (_) {}
  try { fs.watch(inbox(), () => readInbox()); } catch (_) {}
  // Nexus starting or quitting decides whether the tray may hide.
  const t = setInterval(applyFolder, 10000);
  if (t.unref) t.unref();
  readInbox();
  applyFolder();
  dumpMenu();
}

module.exports = { start, beat, attach };
