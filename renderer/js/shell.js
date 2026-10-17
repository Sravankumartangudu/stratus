// shell.js — the frame around every screen: the header (App Launcher, global search, the AI chip,
// Agentforce, Setup, the user menu), the current app's navigation tabs, and the router that draws the
// page for each URL.
//
// Routes (location.hash):
//   #/app/<appId>[/<tab>][?…]   an app's tab: 'home', an object's list view, 'reports', 'dashboards' or a page id
//   #/r/<recordId>              a record page               #/search?q=…        global search results
//   #/report/<id>  #/dashboard/<id>                          #/setup/<section>/…  Setup
//   #/settings                                               #/home #/agent #/launcher #/search  (shortcuts)
// Apps register their own screens in Pages: Pages.forecast = { title, icon, render(ctx) → node, live? }.
// A page with live: false isn't redrawn when data changes (it manages its own updates).

const Pages = {};
const Views = {};

const Shell = (() => {
  let settings = { appearance: 'system', ai: null, version: '' };
  let route = null;
  let prevHash = '';
  let appId = localStorage.getItem('stratus.app') || 'sales';
  let pending = false;
  let page = null; // the Pages entry being shown, if any
  const els = {};
  const SHORTCUTS = new Set(['home', 'agent', 'launcher']);

  // ---------- routes ----------

  function parse(hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');
    const [p, qs] = raw.split('?');
    const parts = p.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (_) { return x; } });
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    return { hash: '#/' + raw, parts, params };
  }
  const build = (parts, params) => {
    const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null && v !== '')).toString();
    return '#/' + parts.map(encodeURIComponent).join('/') + (qs ? '?' + qs : '');
  };
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  const app = (id) => APPS.find((a) => a.id === (id || appId)) || APPS[0];
  function setApp(id) {
    if (!APPS.some((a) => a.id === id) || id === appId) return;
    appId = id;
    localStorage.setItem('stratus.app', id);
  }
  // The app that shows an object, preferring the current one.
  function appFor(obj) {
    if (app().tabs.includes(obj) || customTabs(app()).includes(obj)) return appId;
    const m = DB.meta(obj);
    return (m && m.apps && m.apps[0]) || appId;
  }
  const objUrl = (obj, params) => build(['app', appFor(obj), obj], params);

  function customTabs(a) {
    return DB.objects().filter((o) => { const m = DB.meta(o); return m.custom && (m.apps || []).includes(a.id); });
  }
  function tabInfo(t) {
    if (t === 'home') return { id: 'home', label: 'Home', icon: '🏠' };
    if (t === 'reports') return { id: 'reports', label: 'Reports', icon: '📈' };
    if (t === 'dashboards') return { id: 'dashboards', label: 'Dashboards', icon: '📊' };
    if (t.startsWith('page:')) {
      const id = t.slice(5);
      const pg = Pages[id];
      return { id, label: pg ? pg.title : id, icon: pg ? pg.icon : '▫️' };
    }
    const m = DB.meta(t);
    return m ? { id: t, label: m.plural, icon: m.icon, obj: t } : null;
  }
  const tabsOf = (a) => [...a.tabs, ...customTabs(a)].map(tabInfo).filter(Boolean);
  const firstTab = (a) => tabsOf(a)[0].id;

  // ---------- frame ----------

  const waffle = () => svg('svg', { viewBox: '0 0 18 18', width: 18, height: 18, class: 'waffle-ic' },
    [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => svg('circle', { cx: 3 + c * 6, cy: 3 + r * 6, r: 1.9 }))));

  function frame() {
    els.appName = h('a.appname');
    els.ai = h('button.aichip', { onclick: () => go('#/settings'), title: 'AI used by Einstein and Agentforce — click to change' });
    els.agentBtn = h('button.iconbtn.agentbtn', { onclick: () => togglePanel(), title: 'Agentforce (⌘J)' }, '✨');
    els.avatar = h('button.avatarbtn', { onclick: (e) => userMenu(e.currentTarget), title: 'You' });
    els.search = searchBox();
    els.top = h('header#top',
      h('div.lights'),
      h('button.iconbtn.waffle', { onclick: launcher, title: 'App Launcher (⌘⇧A)' }, waffle()),
      els.appName,
      els.search,
      h('div.grow'),
      els.ai,
      els.agentBtn,
      h('button.iconbtn', { onclick: () => go('#/setup'), title: 'Setup' }, '⚙︎'),
      els.avatar);
    els.nav = h('nav#nav');
    els.main = h('main#main');
    els.panel = h('aside#panel');
    document.body.appendChild(h('div#shell', els.top, els.nav, h('div#work', els.main, els.panel)));
  }

  function drawHeader() {
    const a = app();
    els.appName.replaceChildren(h('span.appic', { style: { background: a.color } }, a.icon), h('span', a.name));
    els.appName.href = '#/app/' + a.id;
    const st = Einstein.state();
    els.ai.replaceChildren(h('span.dot' + (st.problem ? '.off' : '')), st.problem ? 'Set up AI' : st.label);
    els.ai.classList.toggle('warn', !!st.problem);
    const me = DB.me();
    els.avatar.replaceChildren(UI.avatar(me ? me.Name : '?', 30));
  }

  function drawNav(active) {
    const a = app();
    const list = tabsOf(a);
    if (active && !list.some((t) => t.id === active)) {
      const extra = tabInfo(active.includes(':') ? active : (DB.meta(active) ? active : 'page:' + active));
      if (extra) list.push(Object.assign({ temp: true }, extra));
    }
    els.nav.style.setProperty('--app', a.color);
    els.nav.replaceChildren(...list.map((t) => h(`a.navtab${t.id === active ? '.on' : ''}${t.temp ? '.temp' : ''}`,
      { href: build(['app', a.id, t.id]) }, t.icon ? h('span.navic', t.icon) : null, t.label)));
  }

  // ---------- rendering ----------

  function ctxFor(r, tab) {
    return {
      app: app(), appId, tab, parts: r.parts, params: r.params, route: r,
      // Change this page's URL parameters (list view, filters, mode…) and redraw.
      set(patch, replace) {
        const params = Object.assign({}, r.params, patch);
        const hash = build(r.parts, params);
        if (replace) { history.replaceState(null, '', hash); render(); } else go(hash);
      },
    };
  }

  function renderTab(t, r) {
    const ctx = ctxFor(r, t);
    if (t === 'home') return Views.home(ctx);
    if (t === 'reports') return Views.reports(ctx);
    if (t === 'dashboards') return Views.dashboards(ctx);
    if (DB.meta(t)) return Views.list(t, ctx);
    const pg = Pages[t];
    if (!pg) return UI.empty('🧭', 'Nothing here yet', `There's no page called "${t}".`);
    page = pg;
    return pg.render(ctx);
  }

  function render() {
    route = parse(location.hash || '#/');
    const [kind, a, b] = route.parts;
    if (SHORTCUTS.has(kind) || (kind === 'search' && !route.params.q)) {
      history.replaceState(null, '', prevHash || '#/app/' + appId);
      navigate(route.hash);
      return;
    }
    page = null;
    let node, active = null;
    try {
      switch (kind) {
        case 'app': {
          if (!APPS.some((x) => x.id === a)) { location.replace('#/app/' + appId); return; }
          setApp(a);
          // Tabs are listed as 'page:forecast' but linked as '#/app/sales/forecast'; accept either.
          active = (b || firstTab(app())).replace(/^page:/, '');
          node = renderTab(active, route);
          break;
        }
        case 'r': {
          const obj = DB.objectOf(a);
          active = obj;
          node = Views.record(a, ctxFor(route, obj));
          break;
        }
        case 'search': node = Views.search(route.params.q, ctxFor(route, 'search')); break;
        case 'report': active = 'reports'; node = Views.report(a, ctxFor(route, 'reports')); break;
        case 'dashboard': active = 'dashboards'; node = Views.dashboard(a, ctxFor(route, 'dashboards')); break;
        case 'setup': node = Views.setup(route.parts.slice(1), ctxFor(route, 'setup')); break;
        case 'settings': node = Views.settings(ctxFor(route, 'settings')); break;
        default: location.replace('#/app/' + appId); return;
      }
    } catch (e) {
      console.error(e);
      node = UI.empty('⚠️', 'This page hit a problem', e.message);
    }
    prevHash = route.hash;
    const keepScroll = els.main.dataset.hash === route.hash ? els.main.scrollTop : 0;
    const inner = keepScroll ? saveScrolls() : null;
    els.main.replaceChildren(node || h('div'));
    els.main.dataset.hash = route.hash;
    els.main.scrollTop = keepScroll;
    if (inner) restoreScrolls(inner);
    drawHeader();
    drawNav(active);
    document.title = titleOf(kind, a, active);
    pending = false;
  }
  function titleOf(kind, id, active) {
    if (kind === 'r') return `${DB.name(id) || 'Record'} | Stratus`;
    const t = active && tabInfo(DB.meta(active) ? active : (['home', 'reports', 'dashboards'].includes(active) ? active : 'page:' + active));
    return `${t ? t.label + ' | ' : ''}${app().name} | Stratus`;
  }
  // Scrolling areas inside a page (Kanban boards, consoles) keep their place when the page redraws.
  function saveScrolls() {
    return $$('[data-scroll]', els.main).map((el) => [el.dataset.scroll, el.scrollTop, el.scrollLeft]);
  }
  function restoreScrolls(list) {
    for (const [k, top, left] of list) {
      const el = $(`[data-scroll="${k}"]`, els.main);
      if (el) { el.scrollTop = top; el.scrollLeft = left; }
    }
  }

  // Data changed: redraw the page, unless someone is typing or a dialog is open (then redraw later).
  const busy = () => {
    if ($('.modal-back') || $('.popmenu')) return true;
    const a = document.activeElement;
    return !!(a && els.main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || !!$('.inline-edit', els.main);
  };
  const refresh = debounce(() => {
    if (page && page.live === false) { drawHeader(); return; }
    if (busy()) { pending = true; return; }
    render();
  }, 250);
  setInterval(() => { if (pending && !busy()) render(); }, 1200);

  // ---------- shortcuts from the menu, tray and links ----------

  function navigate(r) {
    const p = parse(r);
    const k = p.parts[0];
    if (k === 'search' && !p.params.q) { focusSearch(); return; }
    if (k === 'agent') { togglePanel(true); return; }
    if (k === 'launcher') { launcher(); return; }
    if (k === 'home') { const a = app(); go(build(['app', a.id, a.tabs.includes('home') ? 'home' : firstTab(a)])); return; }
    go(p.hash);
  }

  // ---------- global search ----------

  function searchBox() {
    const input = h('input.gsearch', { type: 'search', placeholder: 'Search records, or ask Agentforce…', spellcheck: false });
    const drop = h('div.sdrop');
    let items = [], sel = 0;
    const open = () => { draw(); drop.classList.add('open'); };
    const close = () => drop.classList.remove('open');
    const pick = (i) => { const it = items[i]; if (!it) return; close(); input.blur(); it.run(); if (!it.keep) input.value = ''; };
    function row(icon, title, sub, run, cls) { return { node: (i) => h(`button.srow${cls ? '.' + cls : ''}${i === sel ? '.sel' : ''}`, { onmousedown: (e) => { e.preventDefault(); pick(i); } }, icon, h('span.st', title), sub ? h('span.ss', sub) : null), run }; }
    function draw() {
      const q = input.value.trim();
      items = [];
      if (!q) {
        for (const id of DB.org().recent.slice(0, 8)) {
          const obj = DB.objectOf(id);
          if (!obj || !DB.get(id)) continue;
          items.push(row(UI.icon(obj, 22), DB.name(id), DB.meta(obj).label, () => go('#/r/' + id)));
        }
      } else {
        for (const r of DB.search(q, { limit: 7 })) {
          const m = DB.meta(r.obj);
          const sub = (m.compact || []).map((f) => DB.display(r.obj, f, r.rec[f])).filter(Boolean).slice(0, 2).join(' · ');
          items.push(row(UI.icon(r.obj, 22), DB.name(r.rec.Id), `${m.label}${sub ? ' · ' + sub : ''}`, () => go('#/r/' + r.rec.Id)));
        }
        items.push(row(h('span.sic', '🔍'), `Search for “${q}”`, 'All results', () => go(build(['search'], { q })), 'more'));
        items.push(row(h('span.sic', '✨'), `Ask Agentforce: “${q}”`, Einstein.ready() ? Einstein.state().label : 'Set up AI first', () => ask(q), 'ai'));
      }
      sel = clamp(sel, 0, Math.max(0, items.length - 1));
      drop.replaceChildren(!q ? h('div.shead', items.length ? 'Recent items' : 'Type to search every object') : null, ...items.map((it, i) => it.node(i)));
    }
    input.addEventListener('focus', open);
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('input', () => { sel = 0; open(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        const q = input.value.trim();
        if (!q) { pick(sel); return; }
        // Enter on a typed query opens the full results unless a record row is highlighted.
        pick(sel > 0 || items.length <= 2 ? sel : items.length - 2);
      } else if (e.key === 'Escape') { input.value = ''; input.blur(); }
    });
    els.searchInput = input;
    return h('div.gsearch-wrap', h('span.gsearch-ic', '🔍'), input, drop);
  }
  function focusSearch() { els.searchInput.focus(); els.searchInput.select(); }

  // ---------- App Launcher ----------

  function launcher() {
    const q = h('input.launch-q', { type: 'search', placeholder: 'Search apps and items…' });
    const body = h('div.launch');
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      const apps = APPS.filter((a) => !t || (a.name + ' ' + a.tagline).toLowerCase().includes(t));
      const items = DB.objects().filter((o) => !DB.meta(o).hidden).map((o) => DB.meta(o)).filter((m) => !t || m.plural.toLowerCase().includes(t));
      body.replaceChildren(
        h('h4', 'Apps'),
        h('div.launch-apps', apps.map((a) => h(`a.launch-app${a.id === appId ? '.on' : ''}`, { href: '#/app/' + a.id, onclick: () => m.close() },
          h('span.launch-ic', { style: { background: a.color } }, a.icon), h('div', h('b', a.name), h('span', a.tagline))))),
        h('h4', 'All items'),
        h('div.launch-items', items.map((mt) => h('a.launch-item', { href: objUrl(mt.name), onclick: () => m.close() }, UI.icon(mt.name, 22), mt.plural)),
          h('a.launch-item', { href: build(['app', appId, 'reports']), onclick: () => m.close() }, h('span.objicon.sm', '📈'), 'Reports'),
          h('a.launch-item', { href: build(['app', appId, 'dashboards']), onclick: () => m.close() }, h('span.objicon.sm', '📊'), 'Dashboards')));
    };
    q.addEventListener('input', draw);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $('.launch-app', body) || $('.launch-item', body); if (a) a.click(); } });
    draw();
    const m = UI.modal({ title: 'App Launcher', body: h('div', q, body), wide: true, className: 'launcher' });
  }

  // ---------- user menu ----------

  function userMenu(anchor) {
    const me = DB.me() || {};
    UI.menu(anchor, [
      { label: `${me.Name || 'You'}${me.Title ? ' · ' + me.Title : ''}`, disabled: true, run: () => {} },
      { label: 'My profile', icon: '👤', run: () => go('#/r/' + me.Id) },
      { label: 'Switch user…', icon: '🔁', run: switchUser },
      '-',
      { label: 'Settings', icon: '⚙️', run: () => go('#/settings') },
      { label: 'Setup', icon: '🛠️', run: () => go('#/setup') },
      '-',
      { label: 'Reset demo org…', icon: '♻️', danger: true, run: resetOrg },
    ]);
  }
  function switchUser() {
    const users = DB.query('User', { filters: [['IsActive', 'eq', true]], sort: 'Name' });
    const m = UI.modal({ title: 'Log in as another user', body: h('div.userpick', h('p.muted', 'See the org the way each person does — "My" list views, home and assignments follow the user.'),
      users.map((u) => h(`button.userrow${u.Id === DB.org().me ? '.on' : ''}`, { onclick: () => { DB.setMe(u.Id); m.close(); UI.toast(`You're now ${u.Name}`); } },
        UI.avatar(u.Name, 32), h('div', h('b', u.Name), h('span', [u.Title, u.Role].filter(Boolean).join(' · ')))))) });
  }
  async function resetOrg() {
    const ok = await window.host.resetOrg();
    if (!ok) return;
    DB.boot(null);
    Einstein.results.clear();
    UI.toast('The demo org is back to its starting data');
    go('#/app/' + appId);
  }

  // ---------- Agentforce side panel ----------

  const panelOpen = () => !!DB.org().prefs.agentPanel;
  function togglePanel(force) {
    const on = force != null ? force : !panelOpen();
    DB.org().prefs.agentPanel = on;
    DB.save();
    drawPanel();
    if (on) setTimeout(() => { const i = $('textarea, input', els.panel); if (i) i.focus(); }, 60);
  }
  function drawPanel() {
    const on = panelOpen();
    document.body.classList.toggle('panel-on', on);
    els.agentBtn.classList.toggle('on', on);
    if (!on) { els.panel.replaceChildren(); return; }
    if (!els.panel.firstChild) {
      els.panel.replaceChildren(typeof Agentforce !== 'undefined' ? Agentforce.panel(() => togglePanel(false))
        : UI.empty('🤖', 'Agentforce', 'The Agentforce app is missing.'));
    }
  }
  // Ask Agentforce something from anywhere (search box, record pages, list views).
  function ask(q) {
    togglePanel(true);
    if (typeof Agentforce !== 'undefined') Agentforce.send(q);
  }

  // What the user is looking at — Agentforce uses this as context.
  function current() {
    const r = route || parse(location.hash);
    const [kind, a, b] = r.parts;
    if (kind === 'r') return { recordId: a, obj: DB.objectOf(a), appId };
    if (kind === 'app' && b && DB.meta(b)) return { obj: b, appId, params: r.params };
    if (kind === 'report') return { reportId: a, appId };
    if (kind === 'dashboard') return { dashboardId: a, appId };
    return { appId, page: kind === 'app' ? b : kind };
  }

  // ---------- start ----------

  async function start() {
    frame();
    settings = await window.host.settings();
    Einstein.setState(settings.ai);
    // Settings are re-sent on theme changes and after launch; only redraw pages when the AI setup really changed.
    let aiSeen = JSON.stringify(Einstein.state());
    Einstein.onState((s) => {
      drawHeader();
      const now = JSON.stringify(s);
      if (now !== aiSeen) { aiSeen = now; refresh(); }
    });
    window.host.onSettings((s) => { settings = s; Einstein.setState(s.ai); });
    window.host.onNavigate(navigate);
    DB.on((e) => {
      if (e.kind === 'user' || e.kind === 'meta') drawHeader();
      refresh();
    });
    window.addEventListener('hashchange', render);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelOpen() && els.panel.contains(document.activeElement)) togglePanel(false);
    });
    // Record links inside AI text and chatter open in place.
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#/"]');
      if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); render(); }
    });
    drawPanel();
    render();
  }

  return {
    start, render, go, navigate, build, parse, objUrl, appFor, app, setApp, current, ask, togglePanel, panelOpen,
    settings: () => settings, setSettings: (s) => { settings = s; }, tabsOf, focusSearch, launcher, switchUser,
    refresh: () => refresh(),
  };
})();
