// util.js — small helpers every screen uses: DOM building, formatting, toasts, modals, menus.
// Classic scripts share one global scope, so these are plain globals (h, fmt, UI…).

// The DOM's own append/prepend/replaceChildren take children the way h() does: null/false are skipped and
// arrays are flattened, so `cond ? node : null` never prints "null".
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const native = proto[m];
    proto[m] = function (...kids) { return native.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false)); };
  }
}

// h('div.card#main', {onclick, style, …}, child, [children], 'text') → element.
// Text children are always text nodes; the only raw-HTML door is md(), which escapes first.
function h(tag, attrs, ...kids) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') setStyle(el, v);
    else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
// SVG elements (charts, maps, flow canvases).
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') setStyle(el, v);
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
// Style objects may hold CSS variables ('--c'), which only setProperty understands.
function setStyle(el, v) {
  for (const [k, x] of Object.entries(v)) {
    if (x == null) continue;
    if (k.startsWith('--')) el.style.setProperty(k, x); else el.style[k] = x;
  }
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const sum = (arr, f = (x) => x) => arr.reduce((n, x) => n + (Number(f(x)) || 0), 0);
const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {});
const uniq = (arr) => [...new Set(arr)];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// Days are kept as 'YYYY-MM-DD' (date fields) or ISO strings (datetime fields).
const DAY = 86400000;
const today = () => isoDay(new Date());
function isoDay(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
function addDays(day, n) { const d = new Date(String(day || today()).slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); }
function daysBetween(a, b) { return Math.round((new Date(String(b).slice(0, 10) + 'T12:00:00') - new Date(String(a).slice(0, 10) + 'T12:00:00')) / DAY); }
function quarterOf(day) { const d = new Date(String(day).slice(0, 10) + 'T12:00:00'); return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`; }
function monthOf(day) { return String(day).slice(0, 7); }

const fmt = {
  money(n, cents) {
    if (n == null || n === '' || isNaN(n)) return '';
    return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents ? 2 : 0 });
  },
  short(n) { // $1.2M
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n.toFixed(0);
  },
  num(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); },
  pct(n) { return n == null || n === '' ? '' : `${Math.round(Number(n))}%`; },
  date(d) { if (!d) return ''; const x = new Date(String(d).length === 10 ? d + 'T12:00:00' : d); return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); },
  dateShort(d) { if (!d) return ''; const x = new Date(String(d).length === 10 ? d + 'T12:00:00' : d); return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); },
  time(d) { return d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; },
  datetime(d) { return d ? `${fmt.date(d)}, ${fmt.time(d)}` : ''; },
  ago(d) {
    if (!d) return '';
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 0) { const f = -s; if (f < 3600) return `in ${Math.round(f / 60)}m`; if (f < 86400) return `in ${Math.round(f / 3600)}h`; return `in ${Math.round(f / 86400)}d`; }
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return fmt.date(d);
  },
};

// Tiny markdown for AI text: **bold**, *italic*, `code`, bullets, numbered lists, headings, links,
// and [[recordId]] → a link to that record. Every piece of text is escaped before any tag is added.
function md(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let html = '', list = null;
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\[\[([a-zA-Z0-9]{15,18})\]\]/g, (_, id) => `<a href="#/r/${id}" class="reclink">${esc(DB.name(id) || id)}</a>`);
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h4>${inline(m[1])}</h4>`; }
    else if (!l.trim()) { close(); }
    else { close(); html += `<p>${inline(l)}</p>`; }
  }
  close();
  const el = h('div.md');
  el.innerHTML = html;
  return el;
}

// Seeded random numbers so the demo org looks the same every reset.
function rng(seed) {
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.weighted = (pairs) => { const t = sum(pairs, (p) => p[1]); let x = r() * t; for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; } return pairs[0][0]; };
  return r;
}

// ---------- UI kit: toasts, modals, menus, tabs, badges ----------

const UI = {
  toast(msg, kind = 'ok', action) {
    let box = $('#toasts');
    if (!box) box = document.body.appendChild(h('div#toasts'));
    const t = h(`div.toast.${kind}`, h('span.toast-ic', kind === 'ok' ? '✓' : kind === 'err' ? '!' : kind === 'ai' ? '✨' : 'i'), h('span', msg),
      action ? h('button.link', { onclick: () => { action.run(); t.remove(); } }, action.label) : null,
      h('button.x', { onclick: () => t.remove(), title: 'Dismiss' }, '×'));
    box.appendChild(t);
    const life = kind === 'err' ? 7000 : action ? 6500 : 4200;
    setTimeout(() => t.classList.add('gone'), life);
    setTimeout(() => t.remove(), life + 600);
  },

  // UI.modal({title, body: node, wide, actions:[{label, primary, run: () => true|false|Promise}]}) → {close, box}
  // An action returning false keeps the modal open.
  modal({ title, body, actions = [], wide, onClose, className }) {
    const close = () => { back.remove(); document.removeEventListener('keydown', key); onClose && onClose(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    const foot = h('div.modal-foot', actions.map((a) => h(`button.btn${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}`, {
      onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try { const r = await a.run(); if (r !== false) close(); } finally { btn.disabled = false; }
      },
    }, a.label)));
    const box = h(`div.modal${wide ? '.wide' : ''}`, { class: className }, h('div.modal-head', h('h2', title), h('button.x', { onclick: close, title: 'Close' }, '×')),
      h('div.modal-body', body), actions.length ? foot : null);
    const back = h('div.modal-back', { onmousedown: (e) => { if (e.target === back) close(); } }, box);
    document.body.appendChild(back);
    document.addEventListener('keydown', key);
    setTimeout(() => { const f = box.querySelector('input:not([type=checkbox]),textarea,select'); if (f) f.focus(); }, 30);
    return { close, box };
  },

  confirm(title, detail, label = 'Delete') {
    return new Promise((res) => {
      let answered = false;
      UI.modal({ title, body: h('p', detail), onClose: () => { if (!answered) res(false); },
        actions: [{ label: 'Cancel', run: () => {} }, { label, primary: true, danger: label === 'Delete', run: () => { answered = true; res(true); } }] });
    });
  },

  // A dropdown menu under `anchor`: items [{label, run, icon, danger}] or '-'.
  menu(anchor, items) {
    $$('.popmenu').forEach((m) => m.remove());
    const r = anchor.getBoundingClientRect();
    const m = h('div.popmenu', items.map((it) => it === '-' ? h('hr') : h(`button${it.danger ? '.danger' : ''}`, {
      onclick: () => { m.remove(); it.run(); }, disabled: it.disabled,
    }, it.icon ? h('span.mi', it.icon) : null, it.label)));
    document.body.appendChild(m);
    const w = m.offsetWidth;
    m.style.top = `${Math.max(8, Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8))}px`;
    m.style.left = `${clamp(r.right - w, 8, window.innerWidth - w - 8)}px`;
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
    return m;
  },

  // Tabs: [{id, label, count?, render: () => node}] → element; remembers the open tab by `key`.
  tabs(tabs, key, active) {
    const mem = UI._tabs || (UI._tabs = {});
    let cur = active || mem[key] || tabs[0].id;
    if (!tabs.some((t) => t.id === cur)) cur = tabs[0].id;
    const body = h('div.tab-body');
    const bar = h('div.tabs');
    const draw = () => {
      bar.replaceChildren(...tabs.map((t) => h(`button.tab${t.id === cur ? '.on' : ''}`, { onclick: () => { cur = mem[key] = t.id; draw(); } }, t.label, t.count != null ? h('span.count', t.count) : null)));
      const tab = tabs.find((t) => t.id === cur);
      body.replaceChildren(tab.render());
    };
    draw();
    return h('div.tabset', bar, body);
  },

  badge(text, color) { return h('span.badge', { style: color ? { '--b': color } : null }, text); },
  avatar(name, size = 28, color) {
    const hue = [...String(name || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
    // Yellows and greens look far lighter than blues at the same lightness, so darken them to keep white initials readable.
    const light = hue > 45 && hue < 205 ? 34 : 46;
    return h('span.avatar', { style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px', background: color || `hsl(${hue} 55% ${light}%)` }, title: name }, initials(name));
  },
  icon(obj, size = 32) {
    const m = DB.meta(obj) || { icon: '📄', color: '#888' };
    return h('span.objicon', { style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.55) + 'px', background: m.color } }, m.icon);
  },
  empty(icon, title, detail, action) {
    return h('div.empty', h('div.empty-ic', icon), h('h3', title), detail ? h('p', detail) : null, action || null);
  },
  card(title, body, opts = {}) {
    return h('section.card', { class: opts.className }, title ? h('header.card-head', opts.icon ? h('span.card-ic', opts.icon) : null, h('h3', title),
      opts.count != null ? h('span.count', opts.count) : null, h('div.grow'), opts.actions || null) : null, h('div.card-body', body));
  },
  spinner(label) { return h('div.spin-row', h('span.spinner'), label ? h('span', label) : null); },
  stat(label, value, sub, color) { return h('div.stat', { style: color ? { '--c': color } : null }, h('div.stat-l', label), h('div.stat-v', value), sub ? h('div.stat-s', sub) : null); },
  copy(text) { navigator.clipboard.writeText(text); UI.toast('Copied'); },
  // Opens an external link in the browser.
  open(url) { window.host.open(url); },
};
