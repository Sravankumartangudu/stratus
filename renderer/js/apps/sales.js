// sales.js — the Sales app's own screens and record add-ons:
//   Pages.forecast  Collaborative Forecast: quota, categories, owners, manager adjustments, ✨ forecast call
//   Pages.calendar  week and month of Events with open Tasks, ✨ plan my week, ✨ meeting prep
//   Record.extend   Opportunity: Deal coach (MEDDICC gaps) and Quote tabs · Lead: ✨ research brief

(() => {
  const CLOSED = ['Closed Won', 'Closed Lost'];
  const EARLY = ['Prospecting', 'Qualification', 'Needs Analysis'];
  const isOpen = (o) => !CLOSED.includes(o.StageName);
  const CATS = ['Closed', 'Commit', 'Best Case', 'Pipeline'];
  const MGR = ['Sales Manager', 'Admin', 'Executive'];
  const isoOf = (v) => String(v || '').slice(0, 10);

  // The forecast category: closed deals are Closed, otherwise the record's field, else from probability.
  function catOf(o) {
    if (o.StageName === 'Closed Won') return 'Closed';
    if (o.StageName === 'Closed Lost') return 'Omitted';
    if (['Commit', 'Best Case', 'Pipeline', 'Omitted'].includes(o.ForecastCategory)) return o.ForecastCategory;
    const p = Number(o.Probability) || 0;
    return p >= 80 ? 'Commit' : p >= 60 ? 'Best Case' : 'Pipeline';
  }

  // ---------- quarters ----------

  const qParts = (q) => ({ n: Number(String(q).charAt(1)), y: Number(String(q).slice(3)) });
  function shiftQ(q, k) {
    const { n, y } = qParts(q);
    const i = y * 4 + (n - 1) + k;
    return `Q${(i % 4) + 1} ${Math.floor(i / 4)}`;
  }
  function qMonths(q) {
    const { n, y } = qParts(q);
    return [0, 1, 2].map((i) => `${y}-${String(3 * (n - 1) + i + 1).padStart(2, '0')}`);
  }
  const qEnd = (q) => { const m = qMonths(q)[2]; return isoDay(new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0)); };
  const monthName = (ym) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'short' });

  // ---------- deal risk flags (plain rules, no AI) ----------

  const lastTouch = (id) => {
    const d = DB.activity(id).map((a) => isoOf(a.ActivityDate || a.StartDateTime || a.MessageDate || a.CreatedDate)).filter((x) => x && x <= today()).sort().pop();
    return d ? daysBetween(d, today()) : null;
  };
  const pushed = (id) => DB.org().history.some((x) => x.rid === id && x.f === 'CloseDate' && x.o && x.n && x.n > x.o);

  function flags(o) {
    if (!isOpen(o)) return [];
    const f = [];
    if (o.CloseDate < today()) f.push({ t: 'Close date passed', tone: 'bad' });
    const t = lastTouch(o.Id);
    if (t == null || t > 14) f.push({ t: t == null ? 'No activity' : `Stale ${t}d`, tone: 'warn' });
    if (pushed(o.Id)) f.push({ t: 'Pushed', tone: 'warn' });
    if (!o.NextStep) f.push({ t: 'No next step', tone: 'warn' });
    if (catOf(o) === 'Commit' && (o.WinScore || 0) < 50) f.push({ t: `Win score ${o.WinScore || 0}`, tone: 'bad' });
    if (['Commit', 'Best Case'].includes(catOf(o)) && EARLY.includes(o.StageName)) f.push({ t: 'Early stage', tone: 'warn' });
    return f;
  }
  const flagChips = (fl) => fl.map((x) => h(`span.fc-flag.${x.tone}`, x.t));

  // ============================ Forecast ============================

  Pages.forecast = {
    title: 'Forecast', icon: '📈',
    render(ctx) {
      const P = ctx.params;
      const q = P.q && /^Q[1-4] \d{4}$/.test(P.q) ? P.q : quarterOf(today());
      const who = P.who === 'team' ? 'team' : 'me';
      const meId = DB.org().me;
      const me = DB.me() || {};
      const canAdj = MGR.includes(me.Role);
      const adjAll = DB.org().prefs.forecastAdj || (DB.org().prefs.forecastAdj = {});
      const adjKey = (own, cat) => `${q}|${own}|${cat}`;

      const inQ = DB.all('Opportunity').filter((o) => o.CloseDate && quarterOf(o.CloseDate) === q && catOf(o) !== 'Omitted');
      const scoped = who === 'me' ? inQ.filter((o) => o.OwnerId === meId) : inQ;
      const ownerIds = who === 'me' ? [meId] : uniq([...DB.all('User').filter((u) => u.Quota).map((u) => u.Id), ...scoped.map((o) => o.OwnerId)]);
      const quotaOf = (id) => Number((DB.get(id) || {}).Quota) || 0;
      const raw = (own, cat) => sum(scoped.filter((o) => o.OwnerId === own && catOf(o) === cat), (o) => o.Amount);
      const val = (own, cat) => { const a = adjAll[adjKey(own, cat)]; return a ? Number(a.value) || 0 : raw(own, cat); };
      const tot = (cat) => sum(ownerIds, (id) => val(id, cat));
      const quota = who === 'me' ? quotaOf(meId) : sum(DB.all('User').filter((u) => u.Quota), (u) => u.Quota);
      const closed = tot('Closed'), commit = closed + tot('Commit'), best = commit + tot('Best Case'), pipe = best + tot('Pipeline');
      const pctQ = (n) => (quota ? Math.round((n / quota) * 100) + '%' : '—');
      const daysLeft = Math.max(0, daysBetween(today(), qEnd(q)));
      const adjusted = ownerIds.some((id) => CATS.some((c) => adjAll[adjKey(id, c)]));

      // header
      const quarters = [-4, -3, -2, -1, 0, 1, 2].map((k) => shiftQ(quarterOf(today()), k));
      if (!quarters.includes(q)) quarters.push(q);
      const go = (patch) => ctx.set(Object.assign({ cat: null, own: null }, patch));
      const head = h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '📈'),
        h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Forecast')),
        h('div.fc-qpick',
          h('button.iconbtn', { onclick: () => go({ q: shiftQ(q, -1) }), title: 'Previous quarter' }, '‹'),
          h('select', { onchange: (e) => go({ q: e.target.value }) }, quarters.map((x) => h('option', { value: x, selected: x === q }, x + (x === quarterOf(today()) ? ' (current)' : '')))),
          h('button.iconbtn', { onclick: () => go({ q: shiftQ(q, 1) }), title: 'Next quarter' }, '›')),
        h('div.seg', [['me', 'Me'], ['team', 'Team']].map(([k, l]) => h(`button${who === k ? '.on' : ''}`, { onclick: () => go({ who: k }) }, l))),
        h('div.grow'),
        h('span.muted', `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in ${q}`),
        h('a.btn', { href: Shell.objUrl('Opportunity') }, '👑 Opportunities'));

      const kpis = h('div.kpis',
        UI.stat('Quota', quota ? fmt.short(quota) : '—', who === 'me' ? 'Your quarterly quota' : 'Team quarterly quota', 'var(--muted)'),
        UI.stat('Closed Won', fmt.short(closed), `${pctQ(closed)} of quota`, 'var(--ok)'),
        UI.stat('Commit forecast', fmt.short(commit), `Closed + Commit · ${pctQ(commit)}`, 'var(--accent)'),
        UI.stat('Best Case forecast', fmt.short(best), `${pctQ(best)} of quota`, 'var(--warn)'),
        UI.stat('Pipeline', fmt.short(pipe), `${scoped.filter(isOpen).length} open deals`, 'var(--ai)'),
        UI.stat('Gap to quota', quota ? fmt.short(Math.max(0, quota - commit)) : '—', quota && commit >= quota ? 'Quota covered by commit 🎉' : 'Still to cover from Best Case', quota && commit >= quota ? 'var(--ok)' : 'var(--bad)'));

      // gauge + chart
      const gauge = UI.card('Attainment', h('div.fc-gauge',
        Charts.draw('gauge', [{ label: 'Commit forecast', value: commit }], { format: fmt.short, goal: quota || undefined, max: quota ? Math.max(quota * 1.25, pipe * 0.0 + quota) : undefined }),
        h('div.fc-gl', h('span', h('i.fc-sw', { style: { background: Charts.color(0) } }), `Closed ${fmt.short(closed)}`), h('span', h('i.fc-sw', { style: { background: Charts.color(1) } }), `Commit ${fmt.short(commit)}`)),
        h('div.fc-bar', h('i.fc-bar-closed', { style: { background: Charts.color(0), width: quota ? clamp((closed / quota) * 100, 0, 100) + '%' : '0%' } }),
          h('i.fc-bar-commit', { style: { background: Charts.color(1), width: quota ? clamp(((commit - closed) / quota) * 100, 0, 100) + '%' : '0%' } }),
          h('i.fc-bar-best', { style: { background: Charts.color(2), width: quota ? clamp(((best - commit) / quota) * 100, 0, 100) + '%' : '0%' } })),
        h('div.muted.fc-legend', 'Closed · Commit · Best Case against quota')), { icon: '🎯' });

      let chartData;
      let chartTitle;
      const nameToId = {};
      if (who === 'team') {
        chartTitle = 'Forecast by owner';
        const keys = ownerIds.map((id) => { const n = DB.name(id) || 'Unassigned'; nameToId[n] = id; return n; });
        chartData = { keys, series: CATS.map((c) => ({ label: c, values: Object.fromEntries(ownerIds.map((id) => [DB.name(id) || 'Unassigned', val(id, c)])) })) };
      } else {
        chartTitle = 'Forecast by close month';
        const ms = qMonths(q);
        chartData = { keys: ms.map(monthName), series: CATS.map((c) => ({ label: c, values: Object.fromEntries(ms.map((m) => [monthName(m), sum(scoped.filter((o) => monthOf(o.CloseDate) === m && catOf(o) === c), (o) => o.Amount)])) })) };
      }
      const hasData = chartData.series.some((s) => Object.values(s.values).some((v) => v));
      const chart = UI.card(chartTitle, hasData ? Charts.draw('stacked', chartData, { format: fmt.short, width: 1040, height: 330,
        onClick: (d) => go({ cat: d.series, own: nameToId[d.label] || null }) }) : UI.empty('📉', 'Nothing forecast yet', `No opportunities close in ${q}.`), { icon: '📊' });

      // owner × category table
      const cell = (own, cat) => {
        const v = val(own, cat);
        const a = adjAll[adjKey(own, cat)];
        const on = P.cat === cat && (P.own || '') === (own === 'ALL' ? '' : own);
        return h(`td.num.fc-cell${on ? '.sel' : ''}`,
          h('button.fc-val', { onclick: () => go({ cat, own: own === 'ALL' ? null : own }), title: `Show ${cat} deals` }, v ? fmt.short(v) : '—'),
          a ? h('span.fc-adj', { title: `Adjusted from ${fmt.short(raw(own, cat))}${a.note ? ' · ' + a.note : ''}` }, '✎') : null,
          canAdj && own !== 'ALL' && cat !== 'Closed' ? h('button.fc-edit', { title: `Adjust ${cat} for ${DB.name(own)}`, onclick: () => adjust(own, cat) }, '✎') : null);
      };
      const adjust = (own, cat) => {
        const cur = adjAll[adjKey(own, cat)];
        const num = h('input', { type: 'number', step: 1000, value: String(cur ? cur.value : raw(own, cat)) });
        const note = h('input', { type: 'text', placeholder: 'Why? e.g. "Customer confirmed PO for next week"', value: cur ? cur.note || '' : '' });
        UI.modal({ title: `Adjust ${cat} · ${DB.name(own)}`, body: h('div.form',
          h('p.muted', `Deals add up to ${fmt.money(raw(own, cat))}. Your adjustment replaces that number in ${q}'s forecast; the deals themselves don't change.`),
          h('label', 'Forecast amount', num), h('label', 'Note', note)),
        actions: [{ label: 'Cancel', run: () => {} },
          cur ? { label: 'Reset', run: () => { delete adjAll[adjKey(own, cat)]; DB.save(); Shell.render(); UI.toast('Adjustment removed'); } } : null,
          { label: 'Save adjustment', primary: true, run: () => {
            const v = Number(num.value);
            if (isNaN(v) || v < 0) { UI.toast('Enter an amount of zero or more', 'err'); return false; }
            if (v === raw(own, cat)) delete adjAll[adjKey(own, cat)]; else adjAll[adjKey(own, cat)] = { value: v, note: note.value.trim(), by: meId, at: new Date().toISOString() };
            DB.save(); Shell.render(); UI.toast('Forecast adjusted');
          } }].filter(Boolean) });
      };
      const rows = ownerIds.map((id) => {
        const t = quotaOf(id);
        const f = val(id, 'Closed') + val(id, 'Commit');
        return h('tr', h('td', h('div.fc-own', UI.avatar(DB.name(id), 24), h('b', DB.name(id) || 'Unassigned'))),
          h('td.num', t ? fmt.short(t) : '—'), CATS.map((c) => cell(id, c)),
          h('td.num', h('b', fmt.short(f))), h('td.num', t ? h('span.fc-att', { class: f >= t ? 'ok' : f >= t * 0.7 ? 'warn' : 'bad' }, Math.round((f / t) * 100) + '%') : '—'));
      });
      const totalRow = who === 'team' ? h('tr.fc-total', h('td', h('b', 'Team total')), h('td.num', fmt.short(quota)), CATS.map((c) => cell('ALL', c)), h('td.num', h('b', fmt.short(commit))),
        h('td.num', quota ? Math.round((commit / quota) * 100) + '%' : '—')) : null;
      const totalCats = (c) => tot(c);
      const table = UI.card('Forecast by owner and category', h('div.tablewrap',
        h('table.grid.fc-table',
          h('thead', h('tr', h('th', 'Owner'), h('th.num', 'Quota'), CATS.map((c, i) => h('th.num', h('i.fc-sw', { style: { background: Charts.color(i) } }), c)), h('th.num', 'Closed + Commit'), h('th.num', 'Attainment'))),
          h('tbody', rows, totalRow && (totalRow.querySelectorAll('td').forEach((td, i) => { if (i >= 2 && i <= 5) td.title = `${CATS[i - 2]} total ${fmt.money(totalCats(CATS[i - 2]))}`; }), totalRow))),
        h('p.muted.fc-note', canAdj ? '✎ Hover a Commit, Best Case or Pipeline number to adjust it. Click a number to see its deals.' : 'Click a number to see its deals. Managers can adjust the numbers.',
          adjusted ? h('button.link', { onclick: () => { for (const id of ownerIds) for (const c of CATS) delete adjAll[adjKey(id, c)]; DB.save(); Shell.render(); } }, ' Clear all adjustments') : null)),
      { icon: '🧮', actions: h('span.muted', who === 'team' ? 'All owners' : DB.name(meId)) });

      // drill-down
      let drill = null;
      if (P.cat && CATS.includes(P.cat)) {
        const deals = scoped.filter((o) => catOf(o) === P.cat && (!P.own || o.OwnerId === P.own)).sort((a, b) => (b.Amount || 0) - (a.Amount || 0));
        drill = UI.card(`${P.cat} deals${P.own ? ' · ' + DB.name(P.own) : ''}`, deals.length ? h('div.tablewrap', h('table.grid.compact',
          h('thead', h('tr', ['Opportunity', 'Account', 'Stage', 'Close date', 'Win score', 'Amount', 'Flags'].map((x, i) => h(`th${i === 5 ? '.num' : ''}`, x)))),
          h('tbody', deals.map((o) => h('tr', h('td.namecell', h('a.reclink', { href: '#/r/' + o.Id }, o.Name)), h('td', DB.name(o.AccountId)), h('td', o.StageName),
            h('td', fmt.dateShort(o.CloseDate)), h('td', h('span.score.sm', { style: { '--s': scoreColor(o.WinScore || 0) } }, o.WinScore || 0)),
            h('td.num', fmt.money(o.Amount)), h('td', flagChips(flags(o)))))))) : h('p.muted.pad', 'No deals here.'),
        { icon: '🔎', count: deals.length, actions: h('div.row-acts', h('a.btn.sm', { href: Shell.objUrl('Opportunity') }, 'Open pipeline list'), h('button.btn.sm', { onclick: () => go({}) }, '× Close')) });
      }

      // risks (always on) and the ✨ call
      const watch = scoped.filter((o) => isOpen(o) && ['Commit', 'Best Case'].includes(catOf(o))).map((o) => ({ o, f: flags(o) })).filter((x) => x.f.length)
        .sort((a, b) => (b.o.Amount || 0) - (a.o.Amount || 0));
      const atRisk = sum(watch.filter((x) => catOf(x.o) === 'Commit'), (x) => x.o.Amount);
      const risks = UI.card('Deals to watch', watch.length ? h('div.fc-risks',
        h('p.muted.pad', `${watch.length} Commit / Best Case deal${watch.length > 1 ? 's' : ''} have warning signs${atRisk ? ` · ${fmt.short(atRisk)} of Commit is exposed` : ''}.`),
        watch.slice(0, 8).map(({ o, f }) => h('div.fc-risk', h('div.grow', h('a.reclink', { href: '#/r/' + o.Id }, o.Name), h('small', `${catOf(o)} · ${o.StageName} · closes ${fmt.dateShort(o.CloseDate)} · ${DB.name(o.OwnerId)}`), h('div.fc-flags', flagChips(f))),
          h('b', fmt.short(o.Amount)))),
        watch.length > 8 ? h('p.muted.pad', `…and ${watch.length - 8} more`) : null) : h('p.muted.pad', '✅ No warning signs on Commit or Best Case deals.'), { icon: '🚩', count: watch.length });

      const dealLines = scoped.filter((o) => isOpen(o) && ['Commit', 'Best Case'].includes(catOf(o))).sort((a, b) => (b.Amount || 0) - (a.Amount || 0)).slice(0, 14)
        .map((o) => `- [[${o.Id}]] ${o.Name}: ${fmt.money(o.Amount)}, ${catOf(o)}, ${o.StageName}, close ${o.CloseDate}, win score ${o.WinScore || 0}, owner ${DB.name(o.OwnerId)}${flags(o).length ? '; warnings: ' + flags(o).map((x) => x.t).join(', ') : ''}`).join('\n');
      const call = Einstein.card({
        key: `fc-call:${q}:${who}:${Math.round(commit)}`, title: 'Forecast call', icon: '✨', label: 'Make the call',
        intro: `${Einstein.word()} reads the numbers and the deals behind them: what will likely land, what could slip, and what to do about it.`,
        ask: () => ({ task: 'forecast-call',
          system: 'You are a sales operations analyst giving a forecast call to a sales leader. Be direct and quantified; name deals with [[Id]] links; do not invent deals or numbers.',
          prompt: `Quarter ${q} (${daysLeft} days left), scope: ${who === 'me' ? DB.name(meId) : 'whole team'}.\nQuota ${fmt.money(quota)}. Closed ${fmt.money(closed)}; Commit forecast (closed + commit) ${fmt.money(commit)}; Best case ${fmt.money(best)}; total pipeline ${fmt.money(pipe)}.${adjusted ? '\nA manager has adjusted some numbers.' : ''}\n\nCommit and Best Case deals:\n${dealLines || '(none)'}\n\nGive: a 2-3 sentence call on what will likely land (and a number), the biggest risks (slipping, stale, pushed deals), and 3-4 concrete actions.`,
          schema: Einstein.S.obj({ summary: Einstein.S.str('2-3 sentences: the call'), landing: Einstein.S.num('likely landing in dollars for the scope'), risks: Einstein.S.arr(Einstein.S.str('one risk, naming the deal'), 'biggest risks'), actions: Einstein.S.arr(Einstein.S.str('one concrete action'), '3-4 actions') }) }),
        render: (r) => h('div.fc-call',
          h('div.fc-land', h('span.muted', 'Likely to land'), h('b', fmt.short(r.landing)), quota ? h('span.muted', `${Math.round((r.landing / quota) * 100)}% of quota`) : null),
          md(r.summary), h('h4', 'Risks'), h('ul', (r.risks || []).map((x) => h('li', md(x)))), h('h4', 'What to do'), h('ol', (r.actions || []).map((x) => h('li', md(x))))),
      });

      return h('div.page.fc-page', head, kpis, h('div.fc-top', gauge, chart), table, drill, h('div.fc-bottom', risks, call));
    },
  };

  // ============================ Calendar ============================

  const START_H = 7, END_H = 20, HOUR = 46;
  const dayOf = (d) => isoDay(d);
  const dow = (day) => new Date(day + 'T12:00:00').getDay();
  const weekStart = (day) => addDays(day, -dow(day));
  const fmtHour = (hh) => (hh === 0 || hh === 24 ? '12 AM' : hh === 12 ? 'Noon' : hh > 12 ? `${hh - 12} PM` : `${hh} AM`);
  const dayLabel = (day, o) => new Date(day + 'T12:00:00').toLocaleDateString('en-US', o);
  const slotISO = (day, hours) => { const d = new Date(day + 'T00:00:00'); d.setHours(Math.floor(hours), Math.round((hours % 1) * 60), 0, 0); return d.toISOString(); };
  const hrs = (iso) => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };

  function lanes(evs) {
    const out = [];
    let cluster = [], end = 0;
    const flush = () => {
      const ln = [];
      for (const x of cluster) { let i = ln.findIndex((l) => l <= x.s); if (i < 0) { i = ln.length; ln.push(0); } ln[i] = x.t; x.lane = i; }
      cluster.forEach((x) => { x.n = ln.length; });
      out.push(...cluster);
      cluster = [];
    };
    for (const x of evs) { if (cluster.length && x.s >= end) { flush(); end = 0; } cluster.push(x); end = Math.max(end, x.t); }
    flush();
    return out;
  }

  Pages.calendar = {
    title: 'Calendar', icon: '🗓️',
    render(ctx) {
      const P = ctx.params;
      const view = P.v === 'month' ? 'month' : 'week';
      const anchor = /^\d{4}-\d{2}-\d{2}$/.test(P.d || '') ? P.d : today();
      const who = P.who === 'all' ? 'all' : 'me';
      const meId = DB.org().me;
      const mine = (r) => who === 'all' || r.OwnerId === meId;
      const events = DB.all('Event').filter((e) => e.StartDateTime && mine(e)).sort((a, b) => a.StartDateTime.localeCompare(b.StartDateTime));
      const tasks = DB.all('Task').filter((t) => t.Status !== 'Completed' && t.ActivityDate && mine(t));
      const evOn = (day) => events.filter((e) => dayOf(e.StartDateTime) === day);
      const taskOn = (day) => tasks.filter((t) => t.ActivityDate === day);
      const nav = (patch) => ctx.set(Object.assign({}, patch));
      const newEvent = (day, hour, len = 1) => Form.open('Event', { defaults: { StartDateTime: slotISO(day, hour), EndDateTime: slotISO(day, hour + len), OwnerId: meId, Subject: '' } });

      const first = view === 'week' ? weekStart(anchor) : null;
      const step = (k) => (view === 'week' ? addDays(anchor, 7 * k) : (() => { const d = new Date(anchor + 'T12:00:00'); d.setDate(1); d.setMonth(d.getMonth() + k); return isoDay(d); })());
      const title = view === 'week'
        ? `${dayLabel(first, { month: 'short', day: 'numeric' })} – ${dayLabel(addDays(first, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`
        : dayLabel(anchor, { month: 'long', year: 'numeric' });

      const head = h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '🗓️'),
        h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Calendar')),
        h('div.cal-nav', h('button.btn', { onclick: () => nav({ d: null }) }, 'Today'),
          h('button.iconbtn', { onclick: () => nav({ d: step(-1) }), title: 'Previous' }, '‹'), h('button.iconbtn', { onclick: () => nav({ d: step(1) }), title: 'Next' }, '›'),
          h('b.cal-title', title)),
        h('div.grow'),
        h('div.seg', [['me', 'My calendar'], ['all', 'Everyone']].map(([k, l]) => h(`button${who === k ? '.on' : ''}`, { onclick: () => nav({ who: k === 'me' ? null : k }) }, l))),
        h('div.seg', [['week', 'Week'], ['month', 'Month']].map(([k, l]) => h(`button${view === k ? '.on' : ''}`, { onclick: () => nav({ v: k === 'week' ? null : k }) }, l))),
        h('button.btn.primary', { onclick: () => newEvent(today(), Math.min(END_H - 1, Math.max(START_H, new Date().getHours() + 1))) }, '+ New Event'));

      const sel = P.ev && DB.get(P.ev) ? P.ev : null;
      const pickPrep = (id) => ctx.set({ ev: id }, true);

      // an Event block / chip
      const evTip = (e) => `${e.Subject}\n${fmt.time(e.StartDateTime)}${e.EndDateTime ? ' – ' + fmt.time(e.EndDateTime) : ''}${e.Location ? '\n' + e.Location : ''}${e.WhatId ? '\n' + DB.name(e.WhatId) : ''}`;
      const prepBtn = (e) => h('button.cal-prep', { title: '✨ Prep for this meeting', onclick: (ev) => { ev.stopPropagation(); pickPrep(e.Id); } }, '✨');
      const taskChip = (t) => h('a.cal-task' + (t.Priority === 'High' ? '.hi' : ''), { href: '#/r/' + t.Id, title: `${t.Subject}${t.WhatId ? ' · ' + DB.name(t.WhatId) : ''}` }, h('span', '✓'), t.Subject);

      let body;
      if (view === 'week') {
        const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(first, i));
        const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
        const head7 = h('div.cal-wk-head', h('div.cal-corner'), days.map((d) => h(`div.cal-dh${d === today() ? '.today' : ''}`, { onclick: () => nav({ v: null, d }) }, h('small', dayLabel(d, { weekday: 'short' })), h('b', dayLabel(d, { day: 'numeric' })))));
        const allday = h('div.cal-allday', h('div.cal-corner', 'Tasks'), days.map((d) => {
          const ts = taskOn(d);
          return h('div.cal-adc', ts.slice(0, 3).map(taskChip), ts.length > 3 ? h('button.link', { onclick: () => nav({ v: 'month', d }) }, `+${ts.length - 3} more`) : null);
        }));
        const cols = days.map((d) => {
          const col = h(`div.cal-col${d === today() ? '.today' : ''}`, {
            style: { height: hours.length * HOUR + 'px' },
            title: 'Click to add an event',
            onclick: (e) => {
              if (e.target !== col && !e.target.classList.contains('cal-now')) return;
              const y = e.clientY - col.getBoundingClientRect().top;
              newEvent(d, START_H + Math.floor((y / HOUR) * 2) / 2);
            },
          });
          const evs = lanes(evOn(d).map((e) => ({ e, s: clamp(hrs(e.StartDateTime), START_H, END_H - 0.5), t: clamp(e.EndDateTime ? hrs(e.EndDateTime) : hrs(e.StartDateTime) + 1, START_H + 0.5, END_H) })));
          for (const x of evs) {
            const e = x.e;
            const t = Math.max(x.t, x.s + 0.5);
            col.append(h(`div.cal-ev${t - x.s <= 0.5 ? '.short' : ''}${e.Id === sel ? '.sel' : ''}${e.StartDateTime < new Date().toISOString() ? '.past' : ''}`, {
              style: { top: (x.s - START_H) * HOUR + 'px', height: (t - x.s) * HOUR - 2 + 'px', left: `calc(${(x.lane / x.n) * 100}% + 2px)`, width: `calc(${100 / x.n}% - 4px)` },
              title: evTip(e), onclick: (ev) => { ev.stopPropagation(); Shell.go('#/r/' + e.Id); },
            }, prepBtn(e), h('b', e.Subject), h('small', fmt.time(e.StartDateTime), e.Location && t - x.s > 0.5 ? ' · ' + e.Location : '')));
          }
          if (d === today()) {
            const n = hrs(new Date().toISOString());
            if (n >= START_H && n <= END_H) col.append(h('div.cal-now', { style: { top: (n - START_H) * HOUR + 'px' } }));
          }
          return col;
        });
        body = h('div.cal-week', head7, allday,
          h('div.cal-body', { dataset: { scroll: 'cal-body' } }, h('div.cal-hours', hours.map((hh) => h('div.cal-hr', { style: { height: HOUR + 'px' } }, h('span', fmtHour(hh))))), cols));
      } else {
        const m0 = new Date(anchor + 'T12:00:00');
        m0.setDate(1);
        const gridStart = weekStart(isoDay(m0));
        const nWeeks = Math.ceil((dow(isoDay(m0)) + new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate()) / 7);
        const cells = Array.from({ length: nWeeks * 7 }, (_, i) => addDays(gridStart, i));
        body = h('div.cal-month',
          h('div.cal-mh', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => h('div', n))),
          h('div.cal-mg', { style: { gridTemplateRows: `repeat(${nWeeks}, minmax(104px, 1fr))` } }, cells.map((d) => {
            const es = evOn(d), ts = taskOn(d);
            const items = [...es.map((e) => h('a.cal-mev' + (e.Id === sel ? '.sel' : ''), { href: '#/r/' + e.Id, title: evTip(e), onclick: (ev) => ev.stopPropagation() }, h('i', fmt.time(e.StartDateTime).replace(':00', '').replace(' ', '').toLowerCase()), e.Subject)),
              ...ts.map(taskChip)];
            const cell = h(`div.cal-mc${monthOf(d) !== monthOf(isoDay(m0)) ? '.out' : ''}${d === today() ? '.today' : ''}`, {
              onclick: (e) => { if (e.target === cell || e.target.classList.contains('cal-mn')) newEvent(d, 9); },
            }, h('div.cal-mn', d === today() ? h('span', dayLabel(d, { day: 'numeric' })) : dayLabel(d, { day: 'numeric' })),
            items.slice(0, 3), items.length > 3 ? h('button.link', { onclick: () => nav({ v: null, d }) }, `+${items.length - 3} more`) : null);
            return cell;
          })));
      }

      // side column: ✨ plan, ✨ prep, tasks needing attention
      const wk = today();
      const upcoming = events.filter((e) => dayOf(e.StartDateTime) >= wk && dayOf(e.StartDateTime) <= addDays(wk, 7));
      const overdue = tasks.filter((t) => t.ActivityDate < today()).sort((a, b) => a.ActivityDate.localeCompare(b.ActivityDate));
      const hotDeals = DB.all('Opportunity').filter((o) => isOpen(o) && mine(o) && ((o.WinScore || 0) >= 60 || daysBetween(today(), o.CloseDate) <= 21)).sort((a, b) => (b.Amount || 0) - (a.Amount || 0)).slice(0, 8);
      const plan = Einstein.card({
        key: `cal-plan:${wk}:${who}`, title: 'Plan my week', icon: '✨', label: 'Plan my week',
        intro: `${Einstein.word()} looks at your meetings, overdue tasks and hottest deals, then suggests what to do first.`,
        ask: () => ({ task: 'plan-week',
          system: 'You are a sharp sales coach planning a rep\'s week. Prioritize by revenue impact and urgency. Link deals with [[Id]].',
          prompt: `Today is ${today()}.\n\nMeetings in the next 7 days:\n${upcoming.length ? Einstein.listContext('Event', upcoming, ['StartDateTime', 'Location', 'WhatId', 'WhoId']) : '(none)'}\n\nOverdue tasks:\n${overdue.length ? Einstein.listContext('Task', overdue.slice(0, 12), ['Status', 'Priority', 'ActivityDate', 'WhatId']) : '(none)'}\n\nOpen tasks due this week:\n${Einstein.listContext('Task', tasks.filter((t) => t.ActivityDate >= today() && t.ActivityDate <= addDays(today(), 7)).slice(0, 12), ['Priority', 'ActivityDate', 'WhatId']) || '(none)'}\n\nHot deals:\n${hotDeals.length ? Einstein.listContext('Opportunity', hotDeals, ['AccountId', 'StageName', 'Amount', 'CloseDate', 'WinScore', 'NextStep']) : '(none)'}\n\nWrite a short summary of the week, then a prioritized plan (day or time + what), then up to 3 new tasks worth creating.`,
          schema: Einstein.S.obj({ summary: Einstein.S.str('2 sentences on the shape of the week'), plan: Einstein.S.arr(Einstein.S.obj({ when: Einstein.S.str('day or time, e.g. "Mon morning"'), what: Einstein.S.str('what to do and why') }), 'prioritized, most important first'),
            tasks: Einstein.S.arr(Einstein.S.obj({ subject: Einstein.S.str('task subject'), days: Einstein.S.num('due in this many days from today'), dealId: Einstein.S.str('record Id of the related deal, or empty') }), 'up to 3 new tasks') }) }),
        render: (r) => h('div.cal-plan', md(r.summary),
          h('ol', (r.plan || []).map((p) => h('li', h('b', p.when + ': '), md(p.what)))),
          (r.tasks || []).length ? h('div', h('h4', 'Suggested tasks'), r.tasks.map((t) => h('div.cal-sugg', h('span.grow', t.subject, h('small', ` · due ${fmt.dateShort(addDays(today(), Math.max(0, Math.round(t.days || 0))))}`)),
            t.done ? h('span.tick', '✓ Added') : h('button.btn.sm', { onclick: () => {
              const deal = DB.get(t.dealId);
              DB.insert('Task', { Subject: t.subject, ActivityDate: addDays(today(), Math.max(0, Math.round(t.days || 0))), Priority: 'High', OwnerId: meId, WhatId: deal && DB.objectOf(deal.Id) === 'Opportunity' ? deal.Id : null, WhoId: deal && deal.ContactId ? deal.ContactId : null });
              t.done = true; UI.toast('Task added');
            } }, 'Add')))) : null),
      });

      const prepPool = events.filter((e) => dayOf(e.StartDateTime) >= addDays(today(), -3) && dayOf(e.StartDateTime) <= addDays(today(), 21));
      const cur = (sel && DB.objectOf(sel) === 'Event' && DB.get(sel)) || prepPool.find((e) => e.StartDateTime >= new Date().toISOString()) || prepPool[0] || null;
      const prepSel = prepPool.length ? h('select.cal-prepsel', { onchange: (e) => pickPrep(e.target.value) }, prepPool.map((e) => h('option', { value: e.Id, selected: cur && e.Id === cur.Id }, `${dayLabel(dayOf(e.StartDateTime), { month: 'short', day: 'numeric' })} ${fmt.time(e.StartDateTime)} · ${e.Subject}`))) : null;
      const prep = cur ? Einstein.card({
        key: `cal-prep:${cur.Id}`, title: 'Meeting prep', icon: '✨', label: 'Prep me',
        intro: `${cur.Subject} · ${fmt.datetime(cur.StartDateTime)}. ${Einstein.word()} gathers the account, deal and contact history into a briefing.`,
        ask: () => ({ task: 'meeting-prep',
          system: 'You prepare salespeople for meetings. Be specific to the records given; never invent facts. Link records with [[Id]].',
          prompt: `Prepare me for this meeting.\n\n${Einstein.recordContext(cur.Id, { depth: 1 })}\n\n${cur.WhatId && DB.get(cur.WhatId) ? 'Related record:\n' + Einstein.recordContext(cur.WhatId, { depth: 2, rows: 5 }) + '\n\n' : ''}${cur.WhoId && DB.get(cur.WhoId) ? 'Attendee:\n' + Einstein.recordContext(cur.WhoId, { depth: 1, rows: 4 }) : ''}`,
          schema: Einstein.S.obj({ goal: Einstein.S.str('the one outcome to leave with'), background: Einstein.S.arr(Einstein.S.str('a fact about the attendee, account or deal'), '3-5 facts'), agenda: Einstein.S.arr(Einstein.S.str('agenda step'), '3-4 steps'),
            questions: Einstein.S.arr(Einstein.S.str('a good question to ask'), '3-4 questions'), watchouts: Einstein.S.arr(Einstein.S.str('a risk or sensitivity'), '1-3 items') }) }),
        render: (r) => h('div.cal-prepout', h('p', h('b', 'Goal: '), md(r.goal)), h('h4', 'Background'), h('ul', (r.background || []).map((x) => h('li', md(x)))), h('h4', 'Suggested agenda'), h('ol', (r.agenda || []).map((x) => h('li', md(x)))),
          h('h4', 'Questions to ask'), h('ul', (r.questions || []).map((x) => h('li', md(x)))), (r.watchouts || []).length ? [h('h4', 'Watch-outs'), h('ul', r.watchouts.map((x) => h('li', md(x))))] : null),
        actions: () => [h('a.btn.sm', { href: '#/r/' + cur.Id }, 'Open event')],
      }) : UI.card('Meeting prep', h('p.muted.pad', 'No meetings coming up. Click an empty slot to schedule one.'), { icon: '✨' });

      const due = UI.card('Needs attention', overdue.length ? h('div', overdue.slice(0, 6).map((t) => h('div.trow',
        h('input', { type: 'checkbox', title: 'Mark complete', onchange: (e) => DB.update(t.Id, { Status: e.target.checked ? 'Completed' : 'Not Started' }) }),
        h('div.grow', h('a.reclink', { href: '#/r/' + t.Id }, t.Subject), h('small', t.WhatId ? DB.name(t.WhatId) : '')), h('span.tl-when.overdue', fmt.dateShort(t.ActivityDate)))),
      overdue.length > 6 ? h('a.link.pad', { href: Shell.objUrl('Task') }, `View all ${overdue.length} overdue`) : null) : h('p.muted.pad', '✅ Nothing overdue.'), { icon: '⏰', count: overdue.length || null });

      return h('div.page.cal-page', head, h('div.cal-layout', h('div.card.cal-main', body), h('aside.cal-side', plan, prepSel ? h('div.cal-prepwrap', h('label.muted', 'Meeting'), prepSel) : null, prep, due)));
    },
  };

  // ============================ Opportunity: Deal coach ============================

  const MEDDICC = [
    ['M', 'Metrics', 'The measurable value: savings, payback, kWh, ROI.'],
    ['E', 'Economic buyer', 'Who signs the cheque, and have we met them?'],
    ['D', 'Decision criteria', 'What they will compare vendors on.'],
    ['D', 'Decision process', 'The steps, people and dates between here and signature.'],
    ['I', 'Identify pain', 'The problem that makes this urgent.'],
    ['C', 'Champion', 'An insider who sells for us when we are not in the room.'],
    ['C', 'Competition', 'Who else is in the deal, including doing nothing.'],
  ];
  const SENIOR = /chief|ceo|cfo|coo|cto|vp\b|vice president|president|owner|founder|director|head of|general manager/i;

  function meddicc(o) {
    const acts = DB.activity(o.Id);
    const blob = [o.Description, o.NextStep, ...acts.map((a) => `${a.Subject || ''} ${a.Description || ''} ${a.TextBody || ''}`)].join(' ');
    const contacts = DB.all('Contact').filter((c) => c.AccountId === o.AccountId);
    const senior = contacts.filter((c) => SENIOR.test(c.Title || ''));
    const seniorTouched = senior.find((c) => o.ContactId === c.Id || acts.some((a) => a.WhoId === c.Id));
    const champ = o.ContactId && DB.get(o.ContactId);
    const champTouches = champ ? acts.filter((a) => a.WhoId === champ.Id && isoOf(a.ActivityDate || a.StartDateTime || a.MessageDate || a.CreatedDate) >= addDays(today(), -30)).length : 0;
    const upcoming = acts.filter((a) => (a.StartDateTime && a.StartDateTime > new Date().toISOString()) || (DB.objectOf(a.Id) === 'Task' && a.Status !== 'Completed')).length;
    const ev = [
      /roi|saving|payback|kwh|\d\s?%|\$\s?\d|cost|bill|reduc/i.test(blob) ? 'Value is mentioned in notes or activity.' : null,
      seniorTouched ? `${DB.name(seniorTouched.Id)} (${seniorTouched.Title}) is engaged.` : null,
      /criteria|requirement|spec|must have|compare|evaluat|rfp|warranty|financing|price/i.test(blob) ? 'Criteria or comparison points appear in activity.' : null,
      o.NextStep && upcoming ? `Next step: "${o.NextStep}", with ${upcoming} upcoming item${upcoming > 1 ? 's' : ''}.` : null,
      (o.Description || '').length > 40 || /problem|pain|issue|outage|goal|reliab|need|backup|blackout/i.test(blob) ? 'A reason to buy is written down.' : null,
      champ && champTouches ? `${DB.name(champ.Id)} touched ${champTouches}× in 30 days.` : null,
      o.Competitor && o.Competitor !== 'None' ? `Known competitor: ${o.Competitor}.` : o.Competitor === 'None' ? 'Recorded as no competitor.' : null,
    ];
    const manual = (DB.org().prefs.meddicc || {})[o.Id] || {};
    return MEDDICC.map(([letter, name, hint], i) => ({ i, letter, name, hint, evidence: ev[i], confirmed: !!manual[i], covered: !!ev[i] || !!manual[i] }));
  }
  const setConfirm = (id, i, on) => {
    const all = DB.org().prefs.meddicc || (DB.org().prefs.meddicc = {});
    const m = all[id] || (all[id] = {});
    if (on) m[i] = true; else delete m[i];
    DB.save();
    Shell.render();
  };

  function coachTab(o) {
    const rows = meddicc(o);
    const got = rows.filter((r) => r.covered).length;
    const gaps = rows.filter((r) => !r.covered);
    return h('div.dc-coach',
      h('div.dc-score', h('div.dc-ring', Record.ring(Math.round((got / rows.length) * 100), scoreColor(Math.round((got / rows.length) * 100)))),
        h('div', h('b', `${got} of ${rows.length} MEDDICC elements covered`), h('p.muted', gaps.length ? `Gaps: ${gaps.map((g) => g.name).join(', ')}.` : 'Every element has evidence. Keep it fresh.'))),
      h('div.dc-rows', rows.map((r) => h(`div.dc-row${r.covered ? '.ok' : '.gap'}`,
        h('span.dc-letter', r.letter), h('div.grow', h('b', r.name), h('small', r.evidence || r.hint), r.confirmed && !r.evidence ? h('small.dc-conf', 'Marked as covered by you') : null),
        h('span.dc-state', r.covered ? '✓ Evidence' : '⚠ Gap'),
        r.evidence ? null : h('button.btn.sm', { onclick: () => setConfirm(o.Id, r.i, !r.confirmed) }, r.confirmed ? 'Undo' : 'Mark covered')))),
      Einstein.card({
        key: `coach:${o.Id}:${got}:${o.StageName}`, title: 'Deal coach', icon: '✨', label: 'Coach me on this deal',
        intro: `${Einstein.word()} reviews this deal against MEDDICC and tells you what to ask next.`,
        ask: () => ({ task: 'deal-coach',
          system: 'You are a veteran enterprise sales coach using MEDDICC. Be concrete and short. Never invent facts about the customer; if something is unknown, say how to find out.',
          prompt: `MEDDICC check (rule-based):\n${rows.map((r) => `- ${r.name}: ${r.covered ? 'covered' + (r.evidence ? ' (' + r.evidence + ')' : '') : 'GAP'}`).join('\n')}\n\nDeal:\n${Einstein.recordContext(o.Id)}`,
          schema: Einstein.S.obj({ assessment: Einstein.S.str('2-3 sentences: honest read of the deal'), gaps: Einstein.S.arr(Einstein.S.obj({ element: Einstein.S.str('MEDDICC element'), question: Einstein.S.str('the exact question to ask'), tactic: Einstein.S.str('how and who to ask') }), 'one per real gap'),
            nextStep: Einstein.S.str('a crisp Next Step line, under 90 characters') }) }),
        render: (r) => h('div.dc-out', md(r.assessment), (r.gaps || []).map((g) => h('div.dc-gap', h('b', g.element), h('p', '“' + g.question + '”'), h('small.muted', g.tactic))),
          r.nextStep ? h('div.dc-next', h('div.grow', h('small.muted', 'Suggested next step'), h('div', r.nextStep)),
            h('button.btn.sm', { onclick: () => { DB.update(o.Id, { NextStep: r.nextStep }); UI.toast('Next step updated'); } }, 'Use it')) : null),
      }));
  }

  // ============================ Opportunity: Quote ============================

  function quoteTab(o) {
    const items = DB.all('OpportunityLineItem').filter((x) => x.OpportunityId === o.Id);
    if (!items.length) return UI.empty('🧾', 'No quote lines yet', 'Add products on the Related tab, then come back to price the quote.',
      h('button.btn.primary', { onclick: () => { UI._tabs['rec:Opportunity'] = 'related'; Shell.render(); } }, 'Go to products'));
    const list = (x) => (Number(x.Quantity) || 0) * (Number(x.UnitPrice) || 0);
    const subtotal = sum(items, list), total = sum(items, (x) => x.TotalPrice), disc = subtotal - total;
    const acct = DB.get(o.AccountId);
    const num = (x, field, min, max) => h('input.qt-in', { type: 'number', min, max, step: field === 'Discount' ? 1 : field === 'UnitPrice' ? 10 : 1, value: String(x[field] == null ? 0 : x[field]),
      onchange: (e) => { const v = Number(e.target.value); if (isNaN(v) || v < min || (max != null && v > max)) { UI.toast(`${field} must be between ${min} and ${max == null ? '∞' : max}`, 'err'); e.target.value = x[field]; return; } DB.update(x.Id, { [field]: v }); } });
    const text = () => [`Quote for ${acct ? acct.Name : DB.name(o.AccountId)} — ${o.Name}`, `Valid until ${fmt.date(addDays(today(), 30))}`, '',
      ...items.map((x) => `${x.Quantity} × ${DB.name(x.Product2Id)} @ ${fmt.money(x.UnitPrice)}${x.Discount ? ` (−${x.Discount}%)` : ''} = ${fmt.money(x.TotalPrice)}`), '',
      `Subtotal ${fmt.money(subtotal)}`, disc ? `Discount −${fmt.money(disc)}` : null, `Total ${fmt.money(total)}`].filter((l) => l != null).join('\n');
    return h('div.qt',
      h('div.qt-head', h('div', h('b', `Quote · ${o.Name}`), h('small.muted', `${acct ? acct.Name : ''} · valid until ${fmt.date(addDays(today(), 30))}`)), h('div.grow'),
        h('button.btn.sm', { onclick: () => UI.copy(text()) }, '⧉ Copy as text'),
        h('button.btn.sm', { onclick: () => Record.email(o.Id, { subject: `Your quote: ${o.Name}`, body: text() }) }, '✉️ Email quote')),
      h('div.tablewrap', h('table.grid.compact.qt-table',
        h('thead', h('tr', h('th', 'Product'), h('th.num', 'Qty'), h('th.num', 'Unit price'), h('th.num', 'Discount %'), h('th.num', 'Total'))),
        h('tbody', items.map((x) => h('tr', h('td', h('a.reclink', { href: '#/r/' + x.Product2Id }, DB.name(x.Product2Id))), h('td.num', num(x, 'Quantity', 1)), h('td.num', num(x, 'UnitPrice', 0)),
          h('td.num', num(x, 'Discount', 0, 100)), h('td.num', fmt.money(x.TotalPrice))))))),
      h('div.qt-sum', h('div', h('span', 'Subtotal'), h('b', fmt.money(subtotal))), disc ? h('div.off', h('span', 'Discount'), h('b', '−' + fmt.money(disc))) : null, h('div.big', h('span', 'Quote total'), h('b', fmt.money(total)))),
      Math.round(total) !== Math.round(o.Amount || 0) ? h('div.qt-sync', h('span', `The opportunity Amount is ${fmt.money(o.Amount)}.`), h('button.btn.sm.primary', { onclick: () => { DB.update(o.Id, { Amount: total }); UI.toast('Amount updated to ' + fmt.money(total)); } }, `Set Amount to ${fmt.short(total)}`)) : h('p.muted', '✓ Matches the opportunity Amount.'));
  }

  Record.extend('Opportunity', {
    tabs: (o) => {
      const t = [{ id: 'coach', label: '🧭 Deal coach', count: isOpen(o) ? meddicc(o).filter((r) => !r.covered).length || null : null, render: () => coachTab(o) }];
      t.push({ id: 'quote', label: '🧾 Quote', count: DB.all('OpportunityLineItem').filter((x) => x.OpportunityId === o.Id).length || null, render: () => quoteTab(o) });
      return t;
    },
    actions: (o) => (isOpen(o) ? [{ label: 'Deal coach', ai: true, icon: '🧭', run: () => { UI._tabs['rec:Opportunity'] = 'coach'; Shell.render(); } }] : []),
  });

  // ============================ Lead: research brief ============================

  Record.extend('Lead', {
    side: (l) => Einstein.card({
      key: `lead-brief:${l.Id}`, title: 'Research brief', icon: '🔎', label: 'Research this lead',
      intro: `${Einstein.word()} prepares a first-call brief from this record and general knowledge. It cannot browse the web, so verify before you quote it.`,
      ask: () => ({ task: 'lead-research',
        system: 'You prepare salespeople for a first call with a lead. Use only the record and well-known general knowledge; say "unverified" when you are inferring. Never invent specifics about the company.',
        prompt: `Lead record:\n${Einstein.recordContext(l.Id, { depth: 1 })}\n\nOur company sells solar panels, batteries, EV chargers, smart-home devices and energy software.`,
        schema: Einstein.S.obj({ overview: Einstein.S.str('2-3 sentences on who they are and why they might buy'), needs: Einstein.S.arr(Einstein.S.str('a likely need or trigger'), '3 items'), talking: Einstein.S.arr(Einstein.S.str('a talking point or product angle'), '3 items'),
          openers: Einstein.S.str('a warm, specific one-sentence opener for the first message'), questions: Einstein.S.arr(Einstein.S.str('a discovery question'), '3 questions') }) }),
      render: (r) => h('div.ld-brief', md(r.overview), h('h4', 'Likely needs'), h('ul', (r.needs || []).map((x) => h('li', x))), h('h4', 'Angles'), h('ul', (r.talking || []).map((x) => h('li', x))),
        h('h4', 'Discovery questions'), h('ul', (r.questions || []).map((x) => h('li', x))), h('div.ld-open', h('small.muted', 'Opener'), h('div', r.openers))),
      actions: (r) => [h('button.btn.sm', { onclick: () => Record.email(l.Id, { body: r.openers }) }, '✉️ Draft email')],
    }),
  });
})();
