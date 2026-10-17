// reports.js — Reports and Dashboards, the way Lightning does them: a report list by folder, a report
// page (chart, summary or matrix, detail rows, drill-down, CSV) and a builder with a live preview.
// AI on top: ✨ describe a report in words and it builds it, ✨ Explain reads a report back to you,
// ✨ dashboard briefings, and ✨ "build a dashboard about…".
//
// A report is { id, name, folder, object, filters, groupBy, groupBy2, aggregate: {fn, field}, chart,
// columns, sort, dir }; a dashboard is { id, name, folder, components: [{ reportId, type, chart, title, goal }] }.

(() => {
  const FNS = [['count', 'Record count'], ['sum', 'Sum'], ['avg', 'Average'], ['min', 'Min'], ['max', 'Max']];
  const CHARTS = [['', 'No chart'], ['bar', 'Bar'], ['hbar', 'Horizontal'], ['line', 'Line'], ['area', 'Area'], ['donut', 'Donut'], ['funnel', 'Funnel'], ['stacked', 'Stacked']];
  const numeric = (f) => f && (['number', 'currency', 'percent', 'rollup'].includes(f.type) || (f.type === 'formula' && ['currency', 'number', 'percent'].includes(f.format)));
  const objList = () => DB.objects().map(DB.meta).filter((m) => m && !m.hidden);
  const RS = {}; // per-report view state: { chart, drill, limit, sort, dir }
  const DR = {}; // builder drafts by report id ('new' for a new one)

  // ---------- small helpers ----------

  function groupables(obj) {
    const out = [];
    for (const f of Filters.fields(obj)) {
      if (['date', 'datetime'].includes(f.type)) for (const g of ['month', 'quarter', 'year']) out.push({ name: `${f.name}:${g}`, label: `${f.label} (by ${g})` });
      else if (['picklist', 'multipicklist', 'lookup', 'checkbox'].includes(f.type) || (f.type === 'text' && !f.system)) out.push({ name: f.name, label: f.label });
    }
    return out;
  }
  function groupLabel(obj, g) {
    if (!g) return '';
    const [f, gran] = String(g).split(':');
    const fd = Filters.fieldOf(obj, f);
    return (fd ? fd.label : f) + (gran ? ` (${gran})` : '');
  }
  function measureLabel(m, agg) {
    if (!agg || agg.fn === 'count' || !agg.field) return 'Record count';
    const f = m.field[agg.field];
    return `${(FNS.find((x) => x[0] === agg.fn) || [0, agg.fn])[1]} of ${f ? f.label : agg.field}`;
  }
  function colLabel(m, c) { const f = Filters.fieldOf(m.name, c); return f ? f.label : c; }
  function cell(m, r, c, first) {
    let v;
    if (c.includes('.')) v = DB.path(r, c);
    else if (m.field[c]) v = Field.view(m.name, m.field[c], r);
    else v = r[c];
    return first ? h('a.reclink', { href: '#/r/' + r.Id }, v instanceof Node ? v.textContent : String(v == null || v === '' ? DB.name(r.Id) : v)) : v;
  }
  function plain(m, r, c) {
    if (c.includes('.')) return DB.path(r, c);
    const f = m.field[c];
    return f && f.type === 'lookup' ? DB.name(r[c]) : DB.display(m.name, c, r[c]);
  }
  function normalize(spec) {
    const m = DB.meta(spec.object);
    return Object.assign({ filters: [], aggregate: { fn: 'count' }, chart: spec.groupBy ? 'bar' : '', columns: m ? m.list.slice(0, 6) : [] }, spec);
  }
  function exportCsv(rep) {
    const res = DB.runReport(rep);
    const m = res.meta;
    const cols = rep.columns && rep.columns.length ? rep.columns : m.list;
    const q = (s) => { const t = String(s == null ? '' : s); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [cols.map((c) => q(colLabel(m, c))).join(',')].concat(res.rows.map((r) => cols.map((c) => q(plain(m, r, c))).join(',')));
    window.host.exportFile(`${rep.name || 'Report'}.csv`, lines.join('\n')).then((ok) => ok && UI.toast(`Exported ${res.rows.length} rows`));
  }

  // ---------- ✨ words → report spec ----------

  async function aiSpec(words) {
    const objs = objList();
    const describe = objs.map((m) => `## ${m.name} (${m.plural})\n` + Filters.fields(m.name).filter((f) => !f.system || ['CreatedDate', 'OwnerId'].includes(f.name))
      .map((f) => `${f.name}:${f.type === 'formula' || f.type === 'rollup' ? f.format || 'text' : f.type}${f.options ? '[' + f.options.slice(0, 10).join('|') + ']' : ''}`).join(', ')).join('\n');
    const r = await Einstein.ask({
      task: 'report-builder',
      system: 'You design CRM reports. Use only the objects and fields listed. Group dates with a suffix :month, :quarter or :year (e.g. CloseDate:month). Use "$me" for the current user and "$today" for today. Money in plain numbers.',
      prompt: `Today: ${today()}\nFilter operators: ${Filters.OPS.map((o) => o[0]).join(', ')} (in/notin values comma-separated; lastn/nextn take days; no value for isnull, notnull, thisquarter, nextquarter, thismonth, today)\nCharts: bar, hbar, line, area, donut, funnel, stacked (needs groupBy2), or empty for none.\n\n${describe}\n\nBuild this report: ${words}`,
      schema: Einstein.S.obj({
        name: Einstein.S.str('short report name'),
        object: Einstein.S.str('object API name'),
        filters: Einstein.S.arr(Einstein.S.obj({ field: Einstein.S.str(), op: Einstein.S.str(), value: Einstein.S.str() })),
        groupBy: Einstein.S.str('field to group rows by, or empty'),
        groupBy2: Einstein.S.str('second grouping for a matrix, or empty'),
        fn: Einstein.S.oneOf(FNS.map((x) => x[0])),
        field: Einstein.S.str('numeric field to aggregate, empty for count'),
        chart: Einstein.S.str('chart type or empty'),
        columns: Einstein.S.arr(Einstein.S.str('field API name')),
        sort: Einstein.S.str('field to sort detail rows by, or empty'),
        dir: Einstein.S.oneOf(['asc', 'desc']),
      }),
    });
    const m = DB.meta(r.object);
    if (!m) throw new Error(`${Einstein.word()} picked an object that doesn't exist (${r.object}). Try naming the object.`);
    const okGroup = (g) => g && Filters.fieldOf(m.name, String(g).split(':')[0]) ? g : null;
    const filters = (r.filters || []).map((x) => { const f = Filters.fieldOf(m.name, x.field); return f && Filters.OPS.some((o) => o[0] === x.op) ? [x.field, x.op, Filters.coerce(f, x.op, x.value)] : null; }).filter(Boolean);
    const groupBy = okGroup(r.groupBy);
    const field = numeric(m.field[r.field]) ? r.field : null;
    const cols = (r.columns || []).filter((c) => Filters.fieldOf(m.name, c));
    return normalize({
      name: r.name || 'AI report', folder: 'AI Reports', object: m.name, filters, groupBy, groupBy2: groupBy ? okGroup(r.groupBy2) : null,
      aggregate: field && r.fn !== 'count' ? { fn: r.fn, field } : { fn: 'count' },
      chart: groupBy && Charts.types.includes(r.chart) ? r.chart : groupBy ? 'bar' : '',
      columns: cols.length ? cols : m.list.slice(0, 6), sort: m.field[r.sort] ? r.sort : null, dir: r.dir || 'desc', ai: words,
    });
  }

  // ---------- the result: stats, chart, summary/matrix, detail rows ----------

  function result(spec, st, redraw) {
    let res;
    try { res = DB.runReport(spec); } catch (e) { return UI.empty('⚠️', "This report can't run", e.message); }
    const m = res.meta;
    const f = Charts.formatterFor(m, res.agg);
    const type = st.chart != null ? st.chart : spec.chart || '';
    const drill = st.drill != null ? res.groups.find((g) => g.key === st.drill) : null;
    const out = [];
    out.push(h('div.rstats', UI.stat('Total records', fmt.num(res.rows.length)), res.agg.fn !== 'count' ? UI.stat(measureLabel(m, res.agg), f(res.total)) : null,
      spec.groupBy ? UI.stat(groupLabel(m.name, spec.groupBy), `${res.groups.length} groups`) : null));

    if (spec.groupBy) {
      const pills = h('div.pills', CHARTS.filter(([t]) => t !== 'stacked' || spec.groupBy2).map(([t, l]) => h(`button.pill${type === t ? '.on' : ''}`, { onclick: () => { st.chart = t; redraw(); } }, l)));
      if (type) {
        const data = Charts.fromReport(res, type);
        out.push(UI.card('Chart', Charts.draw(type, data, { format: f, height: 260, onClick: (d) => { if (d && d.key != null) { st.drill = d.key; st.limit = 50; redraw(); } } }), { icon: '📊', actions: pills, className: 'rchart' }));
      } else out.push(h('div.pillrow', pills));

      // Summary or matrix
      const share = (v) => (res.total && ['count', 'sum'].includes(res.agg.fn) ? Math.round((v / res.total) * 100) : null);
      let table;
      if (spec.groupBy2) {
        const k2 = res.keys2 || [];
        const colTotal = (k) => DB.aggregate(res.rows.filter((r) => DB.groupKey(m, r, spec.groupBy2) === k), res.agg);
        table = h('table.grid.compact.matrix',
          h('thead', h('tr', h('th', `${groupLabel(m.name, spec.groupBy)} ↓ / ${groupLabel(m.name, spec.groupBy2)} →`), k2.map((k) => h('th.num', k)), h('th.num', 'Total'))),
          h('tbody', res.groups.map((g) => h(`tr.click${drill === g ? '.selected' : ''}`, { onclick: () => { st.drill = g.key; redraw(); } }, h('td', h('b', g.key)),
            k2.map((k) => { const s = (g.sub || []).find((x) => x.key === k); return h('td.num', s ? f(s.value) : ''); }), h('td.num', h('b', f(g.value)))))),
          h('tfoot', h('tr', h('td', 'Grand total'), k2.map((k) => h('td.num', f(colTotal(k)))), h('td.num', h('b', f(res.total))))));
      } else {
        table = h('table.grid.compact',
          h('thead', h('tr', h('th', groupLabel(m.name, spec.groupBy)), h('th.num', measureLabel(m, res.agg)), res.agg.fn !== 'count' ? h('th.num', 'Records') : null, h('th', 'Share'))),
          h('tbody', res.groups.map((g) => h(`tr.click${drill === g ? '.selected' : ''}`, { onclick: () => { st.drill = g.key; st.limit = 50; redraw(); } }, h('td', h('b', g.key)), h('td.num', f(g.value)),
            res.agg.fn !== 'count' ? h('td.num', g.rows.length) : null,
            h('td', share(g.value) != null ? h('span.sharebar', { style: { '--w': share(g.value) + '%' } }, share(g.value) + '%') : '')))),
          h('tfoot', h('tr', h('td', 'Grand total'), h('td.num', h('b', f(res.total))), res.agg.fn !== 'count' ? h('td.num', res.rows.length) : null, h('td'))));
      }
      out.push(UI.card(spec.groupBy2 ? 'Matrix' : 'Summary', h('div.tablewrap', table), { icon: '🧮', count: res.groups.length }));
    }

    // Detail rows (or one group's rows when drilled in)
    const cols = spec.columns && spec.columns.length ? spec.columns : m.list;
    let rows = drill ? drill.rows : res.rows;
    if (st.sort) {
      const k = st.sort, d = st.dir === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => { const x = k.includes('.') ? DB.path(a, k) : a[k], y = k.includes('.') ? DB.path(b, k) : b[k]; return (x == null) - (y == null) || (x > y ? d : x < y ? -d : 0); });
    }
    const lim = st.limit || 50;
    const head = cols.map((c) => h(`th.sortable${st.sort === c ? '.sorted' : ''}`, { onclick: () => { st.dir = st.sort === c && st.dir !== 'desc' ? 'desc' : 'asc'; st.sort = c; redraw(); } }, colLabel(m, c), st.sort === c ? h('span.arrow', st.dir === 'desc' ? '↓' : '↑') : null));
    out.push(UI.card(drill ? `Rows in “${drill.key}”` : 'Detail rows', h('div',
      drill ? h('div.chips', h('span.fchip', `${groupLabel(m.name, spec.groupBy)} = ${drill.key}`, h('button.x', { onclick: () => { st.drill = null; redraw(); }, title: 'Show all rows' }, '×'))) : null,
      rows.length ? h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', head)), h('tbody', rows.slice(0, lim).map((r) => h('tr', cols.map((c, i) => h('td', cell(m, r, c, i === 0)))))))) : h('p.muted.pad', 'No rows match this report.'),
      rows.length > lim ? h('button.link.more', { onclick: () => { st.limit = lim + 100; redraw(); } }, `Show more (${rows.length - lim} left)`) : null),
    { icon: '📄', count: rows.length }));
    return h('div.rresult', out);
  }

  function explainAsk(rep) {
    const res = DB.runReport(rep);
    const f = Charts.formatterFor(res.meta, res.agg);
    const groups = res.groups.slice(0, 25).map((g) => `- ${g.key}: ${f(g.value)} (${g.rows.length} rows)${g.sub ? ' — ' + g.sub.map((s) => `${s.key} ${f(s.value)}`).join(', ') : ''}`).join('\n');
    return { task: 'report-explain', prompt: `Explain this report to a busy manager: the headline, what stands out (biggest, smallest, unusual), and one thing to do about it. Under 140 words, bullets, link records with [[Id]] when you name one.

Report: ${rep.name} — ${res.meta.plural}${rep.filters.length ? ', filtered by ' + rep.filters.map((x) => Filters.text(rep.object, x)).join('; ') : ''}
Measure: ${measureLabel(res.meta, res.agg)}; total ${f(res.total)} across ${res.rows.length} rows.
${rep.groupBy ? `Grouped by ${groupLabel(rep.object, rep.groupBy)}${rep.groupBy2 ? ' then ' + groupLabel(rep.object, rep.groupBy2) : ''}:\n${groups}` : ''}

Top rows:
${Einstein.listContext(rep.object, res.rows.slice(0, 12), (rep.columns || []).filter((c) => !c.includes('.')))}` };
  }

  // ---------- Reports home ----------

  let listQ = '';
  Views.reports = (ctx) => {
    const all = DB.cfg.list('reports');
    const folders = uniq(all.map((r) => r.folder || 'Unfiled')).sort();
    const folder = ctx.params.folder || null;
    const t = listQ.toLowerCase();
    const rows = all.filter((r) => (!folder || (r.folder || 'Unfiled') === folder) && (!t || `${r.name} ${r.object} ${r.folder}`.toLowerCase().includes(t)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const ask = h('input.aiq', { placeholder: 'Describe a report — e.g. “won deals by month this year as a line chart”', onkeydown: (e) => { if (e.key === 'Enter') build(); } });
    const go = h('button.btn.ai', { onclick: () => build() }, '✨ Build it');
    async function build() {
      const words = ask.value.trim();
      if (!words) { ask.focus(); return; }
      go.disabled = true; go.replaceChildren(h('span.spinner.sm'), ` ${Einstein.word()}…`);
      try { DR.new = await aiSpec(words); Shell.go('#/report/new'); UI.toast(`${Einstein.word()} built a draft — check it and save`, 'ai'); }
      catch (e) { UI.toast(e.message, 'err'); go.disabled = false; go.replaceChildren('✨ Build it'); }
    }
    const search = h('input.listq', { type: 'search', placeholder: 'Search reports…', value: listQ, oninput: debounce((e) => { listQ = e.target.value; Shell.render(); }, 250) });
    const menuFor = (r) => (e) => UI.menu(e.currentTarget, [
      { label: 'Edit', icon: '✏️', run: () => Shell.go(`#/report/${r.id}?edit=1`) },
      { label: 'Clone', icon: '⧉', run: () => { const c = DB.cfg.add('reports', Object.assign({}, r, { id: undefined, name: r.name + ' (copy)' })); Shell.go('#/report/' + c.id); } },
      { label: 'Export CSV', icon: '⬇️', run: () => exportCsv(r) },
      '-',
      { label: 'Delete', icon: '🗑', danger: true, run: async () => { if (await UI.confirm(`Delete “${r.name}”?`, 'Dashboards that use it will show an empty slot.')) { DB.cfg.remove('reports', r.id); UI.toast('Report deleted'); } } },
    ]);
    return h('div.page.reportspage',
      h('header.pagehead', h('span.objicon', { style: { width: '40px', height: '40px', background: '#2e844a' } }, '📈'),
        h('div', h('div.eyebrow', 'Reports'), h('h1', folder || 'All Reports')), h('div.grow'), search,
        h('button.btn.primary', { onclick: () => { delete DR.new; Shell.go('#/report/new'); } }, 'New Report')),
      h('div.aibar', h('span.aibar-ic', '✨'), ask, go),
      h('div.search-cols',
        h('nav.facets', h('button' + (!folder ? '.on' : ''), { onclick: () => ctx.set({ folder: null }) }, 'All Reports', h('span.count', all.length)),
          folders.map((fo) => h('button' + (folder === fo ? '.on' : ''), { onclick: () => ctx.set({ folder: fo }) }, '📁 ' + fo, h('span.count', all.filter((r) => (r.folder || 'Unfiled') === fo).length)))),
        h('div.search-res', rows.length ? h('div.tablewrap', h('table.grid',
          h('thead', h('tr', h('th', 'Report'), h('th', 'Folder'), h('th', 'Object'), h('th', 'Grouped by'), h('th', 'Chart'), h('th', 'Created'), h('th'))),
          h('tbody', rows.map((r) => { const m = DB.meta(r.object); return h('tr',
            h('td.namecell', h('a.reclink', { href: '#/report/' + r.id }, r.name), r.ai ? h('span.pill.sm', { title: 'Built from: ' + r.ai }, '✨') : null),
            h('td', r.folder || 'Unfiled'), h('td', m ? m.plural : r.object), h('td', m && r.groupBy ? groupLabel(r.object, r.groupBy) + (r.groupBy2 ? ' › ' + groupLabel(r.object, r.groupBy2) : '') : '—'),
            h('td', r.chart || '—'), h('td', fmt.date(r.createdAt)), h('td.act', h('button.iconbtn.sm', { onclick: menuFor(r), title: 'Actions' }, '▾'))); }))))
          : UI.empty('📈', 'No reports here', t ? 'Try a different search.' : 'Build one with New Report, or describe it above.'))));
  };

  // ---------- one report ----------

  Views.report = (id, ctx) => {
    if (id === 'new' || ctx.params.edit) return builder(id, ctx);
    const rep = DB.cfg.get('reports', id);
    if (!rep) return UI.empty('📈', 'Report not found', 'It may have been deleted.', h('a.btn', { href: '#/app/' + Shell.current().appId + '/reports' }, 'All reports'));
    const spec = normalize(rep);
    const m = DB.meta(spec.object);
    const st = RS[id] || (RS[id] = { limit: 50 });
    const box = h('div');
    const redraw = () => box.replaceChildren(result(spec, st, redraw));
    redraw();
    const showExplain = st.explain;
    const explain = Einstein.card({ key: `explain:rep:${id}`, title: 'Einstein explains this report', label: 'Explain', icon: '✨', className: 'wide', auto: true,
      intro: `${Einstein.word()} reads the numbers and tells you what they mean.`, ask: () => explainAsk(spec),
      actions: () => [h('button.btn.sm', { onclick: () => Shell.ask(`About the report “${rep.name}”: what should I dig into next?`) }, 'Ask a follow-up')] });
    const addToDash = (e) => {
      const ds = DB.cfg.list('dashboards');
      UI.menu(e.currentTarget, ds.length ? ds.map((d) => ({ label: d.name, icon: '📊', run: () => { DB.cfg.update('dashboards', d.id, { components: d.components.concat([{ reportId: id, title: rep.name }]) }); UI.toast(`Added to ${d.name}`, 'ok', { label: 'Open', run: () => Shell.go('#/dashboard/' + d.id) }); } }))
        : [{ label: 'No dashboards yet', disabled: true, run: () => {} }]);
    };
    return h('div.page.reportpage',
      h('header.pagehead', h('span.objicon', { style: { width: '40px', height: '40px', background: '#2e844a' } }, '📈'),
        h('div', h('div.eyebrow', `Report · ${rep.folder || 'Unfiled'}`), h('h1', rep.name),
          h('div.muted', [m ? m.plural : rep.object, rep.groupBy ? 'grouped by ' + groupLabel(rep.object, rep.groupBy) + (rep.groupBy2 ? ' and ' + groupLabel(rep.object, rep.groupBy2) : '') : 'tabular', measureLabel(m, spec.aggregate)].join(' · '))),
        h('div.grow'),
        h(`button.btn.ai${showExplain ? '.on' : ''}`, { onclick: () => { st.explain = !st.explain; Shell.render(); } }, '✨ Explain'),
        h('button.btn', { onclick: () => Shell.go(`#/report/${id}?edit=1`) }, 'Edit'),
        h('button.btn', { onclick: () => exportCsv(spec) }, 'Export'),
        h('button.iconbtn', { title: 'More', onclick: (e) => UI.menu(e.currentTarget, [
          { label: 'Add to dashboard', icon: '📊', run: () => addToDash(e) },
          { label: 'Save as…', icon: '⧉', run: () => { const c = DB.cfg.add('reports', Object.assign({}, rep, { id: undefined, name: rep.name + ' (copy)' })); Shell.go(`#/report/${c.id}?edit=1`); } },
          { label: 'Ask Agentforce about it', icon: '✨', run: () => Shell.ask(`Look at the report “${rep.name}” (${m ? m.plural : rep.object}) and tell me what stands out.`) },
          '-',
          { label: 'Delete', icon: '🗑', danger: true, run: async () => { if (await UI.confirm(`Delete “${rep.name}”?`, 'Dashboards that use it will show an empty slot.')) { DB.cfg.remove('reports', id); Shell.go('#/app/' + Shell.current().appId + '/reports'); } } },
        ]) }, '▾')),
      spec.filters.length ? h('div.chips', spec.filters.map((x) => h('span.fchip.locked', Filters.text(spec.object, x)))) : null,
      showExplain ? explain : null,
      box);
  };

  // ---------- builder with live preview ----------

  function builder(id, ctx) {
    const isNew = id === 'new';
    const existing = !isNew && DB.cfg.get('reports', id);
    if (!isNew && !existing) return UI.empty('📈', 'Report not found');
    if (!DR[id]) DR[id] = isNew ? normalize({ name: 'New Report', folder: 'My Reports', object: 'Opportunity', groupBy: 'StageName', aggregate: { fn: 'sum', field: 'Amount' }, chart: 'bar' }) : JSON.parse(JSON.stringify(normalize(existing)));
    const d = DR[id];
    const st = { limit: 25 };
    const panel = h('aside.bpanel');
    const preview = h('main.bpreview', { dataset: { scroll: 'rb-' + id } });
    const drawPreview = () => preview.replaceChildren(h('div.eyebrow', 'Live preview'), result(d, st, drawPreview));

    const sel = (value, options, onchange) => h('select', { onchange: (e) => onchange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: String(value || '') === v }, l)));
    function drawPanel() {
      const m = DB.meta(d.object);
      const groups = groupables(d.object);
      const nums = m.fields.filter(numeric);
      const colsAll = Filters.fields(d.object, { through: false }).filter((f) => !f.system || ['CreatedDate', 'OwnerId', 'LastModifiedDate'].includes(f.name));
      panel.replaceChildren(
        h('label', 'Report name', h('input', { value: d.name, oninput: (e) => { d.name = e.target.value; } })),
        h('label', 'Folder', h('input', { value: d.folder || '', list: 'rb-folders', oninput: (e) => { d.folder = e.target.value; } }),
          h('datalist#rb-folders', uniq(DB.cfg.list('reports').map((r) => r.folder).filter(Boolean)).map((f) => h('option', { value: f })))),
        h('label', 'Report type (object)', sel(d.object, objList().map((x) => [x.name, x.plural]), (v) => {
          Object.assign(d, { object: v, filters: [], groupBy: null, groupBy2: null, aggregate: { fn: 'count' }, columns: DB.meta(v).list.slice(0, 6), sort: null });
          drawPanel(); drawPreview();
        })),
        h('div.bsec', h('div.bsec-h', 'Filters', h('button.link', { onclick: () => Filters.editor(d.object, (f) => { d.filters.push(f); drawPanel(); drawPreview(); }) }, '+ Add')),
          d.filters.length ? h('div.chips', d.filters.map((x, i) => h('span.fchip', Filters.text(d.object, x), h('button.x', { onclick: () => { d.filters.splice(i, 1); drawPanel(); drawPreview(); } }, '×')))) : h('p.muted.sm', 'All records')),
        h('label', 'Group rows by', sel(d.groupBy, [['', '— None (tabular) —'], ...groups.map((g) => [g.name, g.label])], (v) => { d.groupBy = v || null; if (!v) { d.groupBy2 = null; d.chart = ''; } else if (!d.chart) d.chart = 'bar'; drawPanel(); drawPreview(); })),
        d.groupBy ? h('label', 'Then group columns by (matrix)', sel(d.groupBy2, [['', '— None —'], ...groups.filter((g) => g.name !== d.groupBy).map((g) => [g.name, g.label])], (v) => { d.groupBy2 = v || null; if (!v && d.chart === 'stacked') d.chart = 'bar'; drawPreview(); })) : null,
        h('div.row2',
          h('label', 'Measure', sel(d.aggregate.fn, nums.length ? FNS : FNS.slice(0, 1), (v) => { d.aggregate = v === 'count' ? { fn: 'count' } : { fn: v, field: d.aggregate.field || (nums[0] && nums[0].name) }; drawPanel(); drawPreview(); })),
          d.aggregate.fn !== 'count' ? h('label', 'Of', sel(d.aggregate.field, nums.map((f) => [f.name, f.label]), (v) => { d.aggregate.field = v; drawPreview(); })) : null),
        d.groupBy ? h('label', 'Chart', sel(d.chart, CHARTS.filter(([t]) => t !== 'stacked' || d.groupBy2), (v) => { d.chart = v; st.chart = null; drawPreview(); })) : null,
        h('div.bsec', h('div.bsec-h', 'Columns', h('span.muted.sm', `${d.columns.length} shown`)),
          h('div.bcols', colsAll.map((f) => h('label.check', h('input', { type: 'checkbox', checked: d.columns.includes(f.name), onchange: (e) => {
            if (e.target.checked) d.columns.push(f.name); else d.columns = d.columns.filter((c) => c !== f.name);
            drawPreview();
          } }), f.label)))),
        h('div.row2',
          h('label', 'Sort rows by', sel(d.sort, [['', '— Default —'], ...colsAll.map((f) => [f.name, f.label])], (v) => { d.sort = v || null; drawPreview(); })),
          h('label', 'Direction', sel(d.dir || 'asc', [['asc', 'Ascending'], ['desc', 'Descending']], (v) => { d.dir = v; drawPreview(); }))));
    }

    const ask = h('input.aiq', { placeholder: isNew ? 'Describe the report and Einstein fills in the builder…' : 'Describe a change — e.g. “only this quarter, by owner”', onkeydown: (e) => { if (e.key === 'Enter') aiFill(); } });
    const go = h('button.btn.ai', { onclick: () => aiFill() }, '✨ Fill in');
    async function aiFill() {
      const words = ask.value.trim();
      if (!words) { ask.focus(); return; }
      go.disabled = true; go.replaceChildren(h('span.spinner.sm'), ` ${Einstein.word()}…`);
      try {
        const base = isNew ? '' : ` Start from this report and change it: ${JSON.stringify({ name: d.name, object: d.object, filters: d.filters, groupBy: d.groupBy, groupBy2: d.groupBy2, aggregate: d.aggregate, chart: d.chart, columns: d.columns })}.`;
        const spec = await aiSpec(words + base);
        Object.assign(d, spec, { folder: d.folder && !isNew ? d.folder : spec.folder });
        ask.value = '';
        drawPanel(); drawPreview();
        UI.toast('Builder updated — check the preview', 'ai');
      } catch (e) { UI.toast(e.message, 'err'); }
      go.disabled = false; go.replaceChildren('✨ Fill in');
    }

    const save = () => {
      if (!String(d.name || '').trim()) { UI.toast('Give the report a name', 'err'); return; }
      const clean = { name: d.name.trim(), folder: (d.folder || '').trim() || 'My Reports', object: d.object, filters: d.filters, groupBy: d.groupBy || null, groupBy2: d.groupBy2 || null,
        aggregate: d.aggregate, chart: d.groupBy ? d.chart || '' : '', columns: d.columns, sort: d.sort || null, dir: d.dir || 'asc', ai: d.ai || undefined };
      const r = isNew ? DB.cfg.add('reports', clean) : DB.cfg.update('reports', id, clean);
      delete DR[id];
      UI.toast(isNew ? 'Report saved' : 'Report updated');
      Shell.go('#/report/' + r.id);
    };
    const cancel = () => { delete DR[id]; Shell.go(isNew ? '#/app/' + Shell.current().appId + '/reports' : '#/report/' + id); };

    drawPanel(); drawPreview();
    return h('div.page.builderpage',
      h('header.pagehead', h('span.objicon', { style: { width: '40px', height: '40px', background: '#2e844a' } }, '🛠'),
        h('div', h('div.eyebrow', 'Report builder'), h('h1', isNew ? 'New report' : `Edit · ${existing.name}`)), h('div.grow'),
        h('button.btn', { onclick: cancel }, 'Cancel'), h('button.btn.primary', { onclick: save }, 'Save')),
      h('div.aibar', h('span.aibar-ic', '✨'), ask, go),
      h('div.builder-cols', panel, preview));
  }

  // ---------- Dashboards ----------

  function component(c, i, d, editing) {
    const rep = DB.cfg.get('reports', c.reportId);
    const tools = editing ? h('div.row-acts',
      h('button.iconbtn.sm', { title: 'Move left', disabled: i === 0, onclick: () => move(d, i, -1) }, '←'),
      h('button.iconbtn.sm', { title: 'Move right', disabled: i === d.components.length - 1, onclick: () => move(d, i, 1) }, '→'),
      h('button.iconbtn.sm', { title: 'Edit', onclick: () => compEditor(d, i) }, '⚙︎'),
      h('button.iconbtn.sm', { title: 'Remove', onclick: () => { const cs = d.components.slice(); cs.splice(i, 1); DB.cfg.update('dashboards', d.id, { components: cs }); } }, '×'))
      : rep ? h('a.iconbtn.sm', { href: '#/report/' + rep.id, title: 'Open report' }, '↗') : null;
    if (!rep) return UI.card(c.title || 'Missing report', h('p.muted', 'The report behind this component was deleted.'), { className: 'dcomp', actions: tools });
    let res;
    try { res = DB.runReport(rep); } catch (e) { return UI.card(c.title || rep.name, h('p.muted', e.message), { className: 'dcomp', actions: tools }); }
    const f = Charts.formatterFor(res.meta, res.agg);
    const type = c.type || 'chart';
    let body;
    if (type === 'metric') {
      const pct = c.goal ? clamp(Math.round((res.total / c.goal) * 100), 0, 999) : null;
      body = h('div.metric', h('div.metric-v', f(res.total)), h('div.metric-s', measureLabel(res.meta, res.agg) + ` · ${res.rows.length} records`),
        pct != null ? h('div.metric-goal', h('span.bar', { style: { '--w': Math.min(pct, 100) + '%' } }), `${pct}% of ${f(c.goal)} goal`) : null);
    } else if (type === 'gauge') {
      body = Charts.draw('gauge', [{ label: c.title || rep.name, value: res.total }], { goal: c.goal || null, format: f });
    } else if (rep.groupBy) {
      const t = c.chart || rep.chart || 'bar';
      body = Charts.draw(t, Charts.fromReport(res, t, 8), { format: f, height: 200, onClick: () => Shell.go('#/report/' + rep.id) });
    } else {
      const cols = (rep.columns || res.meta.list).slice(0, 3);
      body = h('table.grid.compact', h('tbody', res.rows.slice(0, 6).map((r) => h('tr', cols.map((col, j) => h('td', cell(res.meta, r, col, j === 0)))))));
    }
    return UI.card(c.title || rep.name, body, { className: `dcomp ${type === 'metric' ? 'is-metric' : ''}`, actions: tools });
  }
  function move(d, i, by) {
    const cs = d.components.slice();
    const [x] = cs.splice(i, 1);
    cs.splice(i + by, 0, x);
    DB.cfg.update('dashboards', d.id, { components: cs });
  }
  function compEditor(d, i) {
    const c = i == null ? { reportId: (DB.cfg.list('reports')[0] || {}).id, type: 'chart' } : Object.assign({}, d.components[i]);
    const reps = DB.cfg.list('reports');
    const rsel = h('select', reps.map((r) => h('option', { value: r.id, selected: r.id === c.reportId }, `${r.name} (${r.folder || 'Unfiled'})`)));
    const tsel = h('select', [['chart', 'Chart'], ['metric', 'Metric (one number)'], ['gauge', 'Gauge']].map(([v, l]) => h('option', { value: v, selected: (c.type || 'chart') === v }, l)));
    const csel = h('select', h('option', { value: '' }, "Report's own chart"), CHARTS.slice(1).map(([v, l]) => h('option', { value: v, selected: c.chart === v }, l)));
    const title = h('input', { value: c.title || '', placeholder: 'Defaults to the report name' });
    const goal = h('input', { type: 'number', value: c.goal || '', placeholder: 'Optional' });
    UI.modal({ title: i == null ? 'Add component' : 'Edit component',
      body: h('div.form-grid', h('label', 'Source report', rsel), h('label', 'Display as', tsel), h('label', 'Chart type', csel), h('label', 'Title', title), h('label', 'Goal (metric and gauge)', goal)),
      actions: [{ label: 'Cancel', run: () => {} }, { label: i == null ? 'Add' : 'Save', primary: true, run: () => {
        if (!rsel.value) { UI.toast('Make a report first', 'err'); return false; }
        const nc = { reportId: rsel.value, type: tsel.value === 'chart' ? undefined : tsel.value, chart: csel.value || undefined, title: title.value.trim() || undefined, goal: Number(goal.value) || undefined };
        const cs = d.components.slice();
        if (i == null) cs.push(nc); else cs[i] = nc;
        DB.cfg.update('dashboards', d.id, { components: cs });
      } }] });
  }

  function dashSummary(d) {
    return d.components.map((c) => {
      const rep = DB.cfg.get('reports', c.reportId);
      if (!rep) return null;
      try {
        const res = DB.runReport(rep);
        const f = Charts.formatterFor(res.meta, res.agg);
        return `- ${c.title || rep.name}: ${measureLabel(res.meta, res.agg)} ${f(res.total)} over ${res.rows.length} ${res.meta.plural.toLowerCase()}${res.groups.length ? '; ' + res.groups.slice(0, 8).map((g) => `${g.key} ${f(g.value)}`).join(', ') : ''}${c.goal ? `; goal ${f(c.goal)}` : ''}`;
      } catch (e) { return null; }
    }).filter(Boolean).join('\n');
  }

  async function aiDashboard(words) {
    const reps = DB.cfg.list('reports');
    const r = await Einstein.ask({
      task: 'dashboard-builder',
      prompt: `Design a dashboard for: ${words}\n\nPick 4–8 components from these existing reports (use their ids). If an important view is missing, describe up to 3 new reports in plain words in "missing".\n\nReports:\n${reps.map((x) => `${x.id}: ${x.name} — ${x.object}${x.groupBy ? ' by ' + x.groupBy : ''}`).join('\n')}`,
      schema: Einstein.S.obj({
        name: Einstein.S.str('dashboard name'),
        components: Einstein.S.arr(Einstein.S.obj({ reportId: Einstein.S.str(), type: Einstein.S.oneOf(['chart', 'metric', 'gauge']), title: Einstein.S.str() })),
        missing: Einstein.S.arr(Einstein.S.str('a report described in words')),
      }),
    });
    const comps = (r.components || []).filter((c) => DB.cfg.get('reports', c.reportId)).map((c) => ({ reportId: c.reportId, type: c.type === 'chart' ? undefined : c.type, title: c.title }));
    for (const words2 of (r.missing || []).slice(0, 3)) {
      try { const spec = await aiSpec(words2); const nr = DB.cfg.add('reports', spec); comps.push({ reportId: nr.id, title: spec.name }); } catch (e) { /* skip a report the AI couldn't map */ }
    }
    if (!comps.length) throw new Error(`${Einstein.word()} couldn't match any reports. Try different words.`);
    return DB.cfg.add('dashboards', { name: r.name || 'AI dashboard', folder: 'AI Dashboards', components: comps, ai: words });
  }

  Views.dashboards = (ctx) => {
    const all = DB.cfg.list('dashboards');
    const ask = h('input.aiq', { placeholder: 'Describe a dashboard — e.g. “service health for the support manager”', onkeydown: (e) => { if (e.key === 'Enter') build(); } });
    const go = h('button.btn.ai', { onclick: () => build() }, '✨ Build dashboard');
    async function build() {
      const words = ask.value.trim();
      if (!words) { ask.focus(); return; }
      go.disabled = true; go.replaceChildren(h('span.spinner.sm'), ` ${Einstein.word()}…`);
      try { const d = await aiDashboard(words); UI.toast(`${Einstein.word()} built “${d.name}”`, 'ai'); Shell.go('#/dashboard/' + d.id); }
      catch (e) { UI.toast(e.message, 'err'); go.disabled = false; go.replaceChildren('✨ Build dashboard'); }
    }
    const create = () => {
      const name = h('input', { placeholder: 'e.g. My Team Pipeline' });
      const folder = h('input', { value: 'My Dashboards' });
      UI.modal({ title: 'New dashboard', body: h('div.form-grid', h('label', 'Name', name), h('label', 'Folder', folder)),
        actions: [{ label: 'Cancel', run: () => {} }, { label: 'Create', primary: true, run: () => {
          if (!name.value.trim()) { UI.toast('Give it a name', 'err'); return false; }
          const d = DB.cfg.add('dashboards', { name: name.value.trim(), folder: folder.value.trim() || 'My Dashboards', components: [] });
          DS[d.id] = { edit: true };
          Shell.go('#/dashboard/' + d.id);
        } }] });
    };
    return h('div.page.dashpage',
      h('header.pagehead', h('span.objicon', { style: { width: '40px', height: '40px', background: '#c23934' } }, '📊'),
        h('div', h('div.eyebrow', 'Dashboards'), h('h1', 'All Dashboards')), h('div.grow'),
        h('button.btn.primary', { onclick: create }, 'New Dashboard')),
      h('div.aibar', h('span.aibar-ic', '✨'), ask, go),
      all.length ? h('div.dashlist', all.map((d) => h('a.dashtile', { href: '#/dashboard/' + d.id },
        h('div.dt-ic', '📊'), h('b', d.name), h('small', `${d.folder || 'Unfiled'} · ${d.components.length} components${d.ai ? ' · ✨' : ''}`),
        h('div.dt-chips', uniq(d.components.map((c) => (DB.cfg.get('reports', c.reportId) || {}).object).filter(Boolean)).map((o) => UI.icon(o, 20))))))
        : UI.empty('📊', 'No dashboards yet', 'Create one, or describe it above and let Einstein build it.'));
  };

  const DS = {};
  Views.dashboard = (id, ctx) => {
    const d = DB.cfg.get('dashboards', id);
    if (!d) return UI.empty('📊', 'Dashboard not found', 'It may have been deleted.');
    const st = DS[id] || (DS[id] = {});
    const brief = Einstein.card({ key: `dbrief:${id}:${today()}`, title: 'Dashboard briefing', label: 'Brief me', icon: '✨', className: 'wide', auto: true,
      intro: `${Einstein.word()} reads every component and tells you the story.`,
      ask: () => ({ task: 'dashboard-briefing', prompt: `Brief me on the dashboard “${d.name}” as of ${fmt.date(today())}: the headline, 2–4 things that stand out, and what to do next. Bullets, under 150 words.\n\n${dashSummary(d)}` }) });
    return h('div.page.dashboardpage',
      h('header.pagehead', h('span.objicon', { style: { width: '40px', height: '40px', background: '#c23934' } }, '📊'),
        h('div', h('div.eyebrow', `Dashboard · ${d.folder || 'Unfiled'}`), h('h1', d.name), h('div.muted', `As of ${fmt.datetime(new Date())} · viewing as ${(DB.me() || {}).Name || ''}`)),
        h('div.grow'),
        h(`button.btn.ai${st.brief ? '.on' : ''}`, { onclick: () => { st.brief = !st.brief; Shell.render(); } }, '✨ Briefing'),
        h('button.btn', { onclick: () => { Shell.render(); UI.toast('Dashboard refreshed'); } }, '↻ Refresh'),
        h(`button.btn${st.edit ? '.primary' : ''}`, { onclick: () => { st.edit = !st.edit; Shell.render(); } }, st.edit ? 'Done' : 'Edit'),
        h('button.iconbtn', { title: 'More', onclick: (e) => UI.menu(e.currentTarget, [
          { label: 'Rename', icon: '✏️', run: () => { const n = h('input', { value: d.name }); UI.modal({ title: 'Rename dashboard', body: h('label', 'Name', n), actions: [{ label: 'Cancel', run: () => {} }, { label: 'Save', primary: true, run: () => { if (n.value.trim()) DB.cfg.update('dashboards', id, { name: n.value.trim() }); } }] }); } },
          { label: 'Clone', icon: '⧉', run: () => { const c = DB.cfg.add('dashboards', { name: d.name + ' (copy)', folder: d.folder, components: d.components.slice() }); Shell.go('#/dashboard/' + c.id); } },
          { label: 'Share to Slack', icon: '💬', run: () => { DB.slackPost('general', `📊 *${d.name}*\n${dashSummary(d)}`, DB.org().me); UI.toast('Posted to #general', 'ok', { label: 'Open', run: () => Shell.go('#/app/slack/slack?ch=general') }); } },
          { label: 'Ask Agentforce about it', icon: '✨', run: () => Shell.ask(`Here is the dashboard “${d.name}”:\n${dashSummary(d)}\nWhat should I focus on?`) },
          '-',
          { label: 'Delete', icon: '🗑', danger: true, run: async () => { if (await UI.confirm(`Delete “${d.name}”?`, 'Its reports stay.')) { DB.cfg.remove('dashboards', id); Shell.go('#/app/' + Shell.current().appId + '/dashboards'); } } },
        ]) }, '▾')),
      st.brief ? brief : null,
      h(`div.dashgrid${st.edit ? '.editing' : ''}`, d.components.map((c, i) => component(c, i, d, st.edit)),
        st.edit || !d.components.length ? h('button.dcomp.addtile', { onclick: () => compEditor(d, null) }, h('span', '+'), 'Add component') : null));
  };
})();
