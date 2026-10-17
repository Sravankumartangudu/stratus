// list.js — an object's tab: list views (table or Kanban), sorting, filters, inline edit, bulk actions,
// CSV export, and the AI on top: "✨ Filter with AI" turns plain words into filters, and Einstein list
// insights reads the rows and says what stands out.
//
// Filters is shared with the report builder:
//   Filters.text(obj, [field, op, value]) → "Stage isn't Closed Won"
//   Filters.editor(obj, onAdd)            → opens the "Add filter" dialog
//   Filters.ai(obj, words)                → Promise<{ filters, sort, dir, explain }>

const Filters = (() => {
  const OPS = [
    ['eq', 'equals'], ['ne', "doesn't equal"], ['contains', 'contains'], ['starts', 'starts with'],
    ['gt', 'greater than'], ['lt', 'less than'], ['ge', 'at least'], ['le', 'at most'],
    ['in', 'is one of'], ['notin', 'is none of'], ['isnull', 'is blank'], ['notnull', "isn't blank"],
    ['thisquarter', 'is this quarter'], ['nextquarter', 'is next quarter'], ['thismonth', 'is this month'], ['today', 'is today'],
    ['lastn', 'in the last N days'], ['nextn', 'in the next N days'],
  ];
  const OP_LABEL = Object.fromEntries(OPS);
  const NO_VALUE = new Set(['isnull', 'notnull', 'thisquarter', 'nextquarter', 'thismonth', 'today']);

  function fieldOf(obj, name) {
    const m = DB.meta(obj);
    if (m.field[name]) return m.field[name];
    if (name.includes('.')) {
      const [a, b] = name.split('.');
      const f = m.field[a];
      const ref = f && f.type === 'lookup' && [].concat(f.ref)[0];
      const g = ref && DB.meta(ref).field[b];
      if (g) return Object.assign({}, g, { label: `${f.label} › ${g.label}` });
    }
    return null;
  }

  function valueText(obj, f, v) {
    if (v === '$me') return 'me';
    if (v === '$today') return 'today';
    if (Array.isArray(v)) return v.map((x) => valueText(obj, f, x)).join(', ');
    if (f && f.type === 'lookup') return DB.name(v) || v;
    if (f && ['currency'].includes(f.type)) return fmt.money(v);
    if (f && f.type === 'date') return fmt.date(v);
    return String(v);
  }
  function text(obj, [field, op, v]) {
    const f = fieldOf(obj, field);
    const lbl = f ? f.label : field;
    if (NO_VALUE.has(op)) return `${lbl} ${OP_LABEL[op]}`;
    if (op === 'lastn' || op === 'nextn') return `${lbl} in the ${op === 'lastn' ? 'last' : 'next'} ${v} days`;
    return `${lbl} ${OP_LABEL[op] || op} ${valueText(obj, f, v)}`;
  }

  // The fields people filter and group by (plus a few through a lookup, like Account › Industry).
  function fields(obj, { through = true } = {}) {
    const m = DB.meta(obj);
    const out = m.fields.filter((f) => !['json', 'id'].includes(f.type) && !f.hidden);
    if (through) for (const f of m.fields) {
      if (f.type !== 'lookup' || Array.isArray(f.ref) || f.system || f.name === 'OwnerId') continue;
      const pm = DB.meta(f.ref);
      for (const g of pm.fields.filter((x) => ['picklist', 'checkbox'].includes(x.type)).slice(0, 4)) out.push(Object.assign({}, g, { name: `${f.name}.${g.name}`, label: `${f.label} › ${g.label}` }));
    }
    return out;
  }

  // Turns typed text into the right kind of value for a field.
  function coerce(f, op, raw) {
    if (NO_VALUE.has(op)) return null;
    if (op === 'lastn' || op === 'nextn') return Number(raw) || 30;
    if (op === 'in' || op === 'notin') return (Array.isArray(raw) ? raw : String(raw).split(',')).map((x) => coerce(f, 'eq', String(x).trim()));
    if (raw === '$me' || raw === '$today') return raw;
    if (!f) return raw;
    if (f.type === 'checkbox') return /^(true|yes|1|✓)$/i.test(String(raw));
    if (['number', 'currency', 'percent'].includes(f.type) || (f.type === 'formula' && f.format === 'currency') || f.type === 'rollup') {
      const n = Number(String(raw).replace(/[$,%\s]/g, '').replace(/k$/i, '000').replace(/m$/i, '000000'));
      return isNaN(n) ? raw : n;
    }
    if (f.type === 'picklist' && f.options) return f.options.find((o) => o.toLowerCase() === String(raw).toLowerCase()) || raw;
    if (f.type === 'lookup') {
      if (DB.get(raw)) return raw;
      const hit = DB.search(String(raw), { objectsOnly: [].concat(f.ref), limit: 1 })[0];
      return hit ? hit.rec.Id : raw;
    }
    return raw;
  }

  function editor(obj, onAdd, start) {
    const list = fields(obj);
    const fsel = h('select', list.map((f) => h('option', { value: f.name, selected: start && start[0] === f.name }, f.label)));
    const osel = h('select');
    const vbox = h('div.fval');
    let w = null;
    const draw = () => {
      const f = list.find((x) => x.name === fsel.value);
      const ops = OPS.filter(([o]) => {
        if (['thisquarter', 'nextquarter', 'thismonth', 'today', 'lastn', 'nextn'].includes(o)) return ['date', 'datetime'].includes(f.type);
        if (['gt', 'lt', 'ge', 'le'].includes(o)) return ['number', 'currency', 'percent', 'date', 'datetime', 'formula', 'rollup'].includes(f.type);
        if (['contains', 'starts'].includes(o)) return ['text', 'textarea', 'email', 'phone', 'url', 'formula', 'autonumber'].includes(f.type);
        if (['in', 'notin'].includes(o)) return ['picklist', 'multipicklist', 'text'].includes(f.type);
        return true;
      });
      const keep = osel.value;
      osel.replaceChildren(...ops.map(([o, l]) => h('option', { value: o, selected: o === keep || (start && start[1] === o) }, l)));
      drawValue();
    };
    const drawValue = () => {
      const f = list.find((x) => x.name === fsel.value);
      const op = osel.value;
      if (NO_VALUE.has(op)) { w = null; vbox.replaceChildren(); return; }
      if (op === 'lastn' || op === 'nextn') { w = Field.input(obj, { type: 'number' }, 30); vbox.replaceChildren(w.el, h('span.muted', ' days')); return; }
      if ((op === 'in' || op === 'notin') && f.options) { w = Field.input(obj, Object.assign({}, f, { type: 'multipicklist' }), []); vbox.replaceChildren(w.el); return; }
      if (f.type === 'lookup' && f.ref === 'User') {
        const users = DB.all('User');
        const s = h('select', h('option', { value: '$me' }, 'Me'), users.map((u) => h('option', { value: u.Id }, u.Name)));
        w = { get: () => s.value };
        vbox.replaceChildren(s);
        return;
      }
      w = Field.input(obj, Object.assign({}, f, { type: f.type === 'formula' || f.type === 'rollup' ? (f.format || 'text') : f.type === 'autonumber' ? 'text' : f.type === 'textarea' ? 'text' : f.type }), start ? start[2] : null);
      vbox.replaceChildren(w.el);
    };
    fsel.addEventListener('change', draw);
    osel.addEventListener('change', drawValue);
    draw();
    UI.modal({ title: 'Add filter', body: h('div.filter-ed', h('label', 'Field', fsel), h('label', 'Operator', osel), h('label', 'Value', vbox)),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Add', primary: true, run: () => {
        const f = list.find((x) => x.name === fsel.value);
        const raw = w ? w.get() : null;
        if (w && (raw == null || raw === '' || (Array.isArray(raw) && !raw.length))) { UI.toast('Give the filter a value', 'err'); return false; }
        onAdd([f.name, osel.value, coerce(f, osel.value, raw)]);
        return true;
      } }] });
  }

  // "open deals over 100k closing this quarter" → filters this app understands.
  async function ai(obj, words) {
    const m = DB.meta(obj);
    const list = fields(obj).filter((f) => !f.system || ['CreatedDate', 'LastModifiedDate'].includes(f.name));
    const describe = list.map((f) => `${f.name}: ${f.label} (${f.type === 'formula' || f.type === 'rollup' ? f.format || 'text' : f.type}${f.options ? ' — ' + f.options.join(' | ') : ''}${f.type === 'lookup' && f.name !== 'OwnerId' ? ', give the record name' : ''})`).join('\n');
    const r = await Einstein.ask({
      task: 'list-filter',
      system: 'You turn a request into filters for a CRM list. Use only the fields listed. Use "$me" for the current user (e.g. "my", "mine") and "$today" for today. Money in plain numbers (100k = 100000).',
      prompt: `Object: ${m.plural}\nToday: ${today()}\nOperators: ${OPS.map(([o, l]) => `${o} (${l})`).join(', ')}\nFor in/notin give values separated by commas. For lastn/nextn give a number of days. Leave value empty for isnull, notnull, thisquarter, nextquarter, thismonth, today.\n\nFields:\n${describe}\n\nRequest: ${words}`,
      schema: Einstein.S.obj({
        filters: Einstein.S.arr(Einstein.S.obj({ field: Einstein.S.str('field API name'), op: Einstein.S.oneOf(OPS.map((o) => o[0])), value: Einstein.S.str('value, or empty') })),
        sort: Einstein.S.str('field API name to sort by, or empty'),
        dir: Einstein.S.oneOf(['asc', 'desc']),
        explain: Einstein.S.str('one short sentence saying what the list now shows'),
      }),
    });
    const out = [];
    const skipped = [];
    for (const x of r.filters || []) {
      const f = fieldOf(obj, x.field);
      if (!f || !OP_LABEL[x.op]) { skipped.push(x.field); continue; }
      out.push([x.field, x.op, coerce(f, x.op, x.value)]);
    }
    return { filters: out, sort: fieldOf(obj, r.sort || '') ? r.sort : null, dir: r.dir || 'asc', explain: r.explain, skipped, meta: r.meta };
  }

  return { OPS, text, editor, ai, fields, fieldOf, coerce };
})();

(() => {
  const state = {}; // obj → { view, filters, q, sort, dir, limit, sel:Set, insights, explain }
  const st = (obj) => (state[obj] = state[obj] || { filters: [], q: '', sort: null, dir: 'asc', limit: 100, sel: new Set(), view: null, insights: false, explain: '' });

  function views(obj) {
    const m = DB.meta(obj);
    const saved = ((DB.org().prefs.views || {})[obj] || []).map((v) => Object.assign({ custom: true }, v));
    return [...m.views, ...saved];
  }

  function exportCsv(obj, rows, cols) {
    const m = DB.meta(obj);
    const cell = (s) => { const t = String(s == null ? '' : s); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [cols.map((c) => cell(m.field[c] ? m.field[c].label : c)).join(',')];
    for (const r of rows) lines.push(cols.map((c) => cell(m.field[c] && m.field[c].type === 'lookup' ? DB.name(r[c]) : DB.display(obj, c, r[c]))).join(','));
    window.host.exportFile(`${m.plural}.csv`, lines.join('\n')).then((ok) => ok && UI.toast(`Exported ${rows.length} ${m.plural.toLowerCase()}`));
  }

  // The Kanban card for one record.
  function card(obj, r, m) {
    const amountField = m.field.Amount ? 'Amount' : m.field.TotalAmount ? 'TotalAmount' : null;
    const score = ['WinScore', 'Score'].find((f) => m.field[f] && r[f] != null);
    const owner = r.OwnerId && DB.get(r.OwnerId);
    return h('div.kcard', { draggable: true, dataset: { id: r.Id }, ondragstart: (e) => { e.dataTransfer.setData('text/plain', r.Id); e.currentTarget.classList.add('drag'); }, ondragend: (e) => e.currentTarget.classList.remove('drag') },
      h('a.kname', { href: '#/r/' + r.Id }, DB.name(r.Id)),
      (m.compact || m.list.slice(1, 3)).filter((c) => c !== m.kanban && c !== amountField).slice(0, 2).map((c) => {
        const v = Field.view(obj, c, r);
        return v ? h('div.kline', v) : null;
      }),
      h('div.kfoot', amountField && r[amountField] != null ? h('b', fmt.money(r[amountField])) : null, h('div.grow'),
        score ? h('span.score.sm', { style: { '--s': scoreColor(r[score]) }, title: m.field[score].label }, r[score]) : null,
        r.Priority && ['High', 'Critical'].includes(r.Priority) ? h('span.pill.sm', { style: { '--c': STATUS_COLORS[r.Priority] } }, r.Priority) : null,
        owner ? UI.avatar(owner.Name, 22) : null));
  }

  function kanban(obj, rows, m) {
    const f = m.field[m.kanban];
    const amountField = m.field.Amount ? 'Amount' : null;
    const cols = (f.options || []).map((opt) => ({ opt, rows: rows.filter((r) => r[m.kanban] === opt) }));
    const drop = (opt) => (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      const r = DB.get(id);
      if (!r || r[m.kanban] === opt) return;
      try { DB.update(id, { [m.kanban]: opt }); UI.toast(`${DB.name(id)} → ${opt}`); } catch (err) { UI.toast(err.message, 'err'); }
    };
    return h('div.kanban', { dataset: { scroll: 'kanban-' + obj } }, cols.map((c) => h('div.kcol', {
      ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: (e) => e.currentTarget.classList.remove('over'), ondrop: drop(c.opt),
    },
    h('header.khead', { style: { '--c': STATUS_COLORS[c.opt] || 'var(--accent)' } }, h('b', c.opt), h('span.count', c.rows.length),
      amountField ? h('div.ksum', fmt.short(sum(c.rows, (r) => r[amountField]))) : null),
    h('div.kbody', { dataset: { scroll: `k-${obj}-${c.opt}` } }, c.rows.slice(0, 60).map((r) => card(obj, r, m)), c.rows.length > 60 ? h('div.muted.kmore', `+${c.rows.length - 60} more`) : null))));
  }

  function table(obj, rows, m, s, ctx, cols) {
    const sortBy = (c) => { if (s.sort === c) s.dir = s.dir === 'asc' ? 'desc' : 'asc'; else { s.sort = c; s.dir = 'asc'; } Shell.render(); };
    const allOn = rows.length && rows.slice(0, s.limit).every((r) => s.sel.has(r.Id));
    const head = h('tr', h('th.ck', h('input', { type: 'checkbox', checked: allOn, onchange: (e) => { for (const r of rows.slice(0, s.limit)) e.target.checked ? s.sel.add(r.Id) : s.sel.delete(r.Id); Shell.render(); } })),
      cols.map((c) => { const f = m.field[c]; return h(`th.sortable${s.sort === c ? '.sorted' : ''}`, { onclick: () => sortBy(c) }, f ? f.label : c, s.sort === c ? h('span.arrow', s.dir === 'asc' ? ' ▲' : ' ▼') : null); }),
      h('th.act'));
    const body = rows.slice(0, s.limit).map((r) => h(`tr${s.sel.has(r.Id) ? '.selected' : ''}`,
      h('td.ck', h('input', { type: 'checkbox', checked: s.sel.has(r.Id), onchange: (e) => { e.target.checked ? s.sel.add(r.Id) : s.sel.delete(r.Id); Shell.render(); } })),
      cols.map((c, i) => {
        const f = m.field[c];
        if (i === 0 || c === m.nameField) return h('td.namecell', h('a.reclink', { href: '#/r/' + r.Id }, DB.name(r.Id) || '(no name)'));
        const td = h('td', { title: f && Field.editable(f) ? 'Double-click to edit' : null }, f ? Field.view(obj, f, r) : String(r[c] == null ? '' : r[c]));
        if (f && Field.editable(f)) td.addEventListener('dblclick', () => inlineEdit(td, obj, r, f));
        return td;
      }),
      h('td.act', h('button.iconbtn.sm', { onclick: (e) => UI.menu(e.currentTarget, [
        { label: 'Edit', icon: '✏️', run: () => Form.open(obj, { record: r }) },
        { label: 'Clone', icon: '⧉', run: () => Form.clone(r.Id) },
        { label: 'Delete', icon: '🗑', danger: true, run: () => Form.remove(r.Id) },
      ]) }, '▾'))));
    return h('div.tablewrap', { dataset: { scroll: 'table-' + obj } }, h('table.grid', h('thead', head), h('tbody', body)),
      rows.length > s.limit ? h('div.more', h('button.btn', { onclick: () => { s.limit += 200; Shell.render(); } }, `Show more (${rows.length - s.limit} left)`)) : null);
  }

  function inlineEdit(td, obj, r, f) {
    if (td.classList.contains('inline-edit')) return;
    const w = Field.input(obj, f, r[f.name]);
    const done = () => { td.classList.remove('inline-edit'); Shell.render(); };
    const save = () => {
      try { DB.update(r.Id, { [f.name]: w.get() }); } catch (e) { UI.toast(e.message, 'err'); return; }
      done();
    };
    td.classList.add('inline-edit');
    td.replaceChildren(h('div.ie', w.el, h('button.btn.sm.primary', { onclick: save }, '✓'), h('button.btn.sm', { onclick: done }, '✕')));
    td.addEventListener('keydown', (e) => { if (e.key === 'Enter' && f.type !== 'textarea') save(); if (e.key === 'Escape') done(); });
    w.focus();
  }

  function bulkBar(obj, s, m) {
    const ids = [...s.sel].filter((id) => DB.get(id));
    if (!ids.length) return null;
    const editable = m.fields.filter((f) => Field.editable(f) && ['picklist', 'checkbox', 'date', 'lookup', 'number', 'currency'].includes(f.type));
    return h('div.bulk', h('b', `${ids.length} selected`),
      m.field.OwnerId ? h('button.btn.sm', { onclick: () => {
        const users = DB.query('User', { sort: 'Name' });
        const sel = h('select', users.map((u) => h('option', { value: u.Id }, u.Name)));
        UI.modal({ title: `Change owner of ${ids.length} records`, body: h('label', 'New owner', sel), actions: [{ label: 'Cancel', run: () => {} }, { label: 'Change Owner', primary: true, run: () => {
          for (const id of ids) DB.update(id, { OwnerId: sel.value });
          UI.toast(`${ids.length} records now belong to ${DB.name(sel.value)}`);
        } }] });
      } }, 'Change Owner') : null,
      h('button.btn.sm', { onclick: () => {
        const fsel = h('select', editable.map((f) => h('option', { value: f.name }, f.label)));
        const box = h('div');
        let w;
        const draw = () => { const f = m.field[fsel.value]; w = Field.input(obj, f, null); box.replaceChildren(w.el); };
        fsel.addEventListener('change', draw);
        draw();
        UI.modal({ title: `Update ${ids.length} records`, body: h('div.filter-ed', h('label', 'Field', fsel), h('label', 'New value', box)), actions: [{ label: 'Cancel', run: () => {} }, { label: 'Update', primary: true, run: () => {
          let ok = 0;
          for (const id of ids) { try { DB.update(id, { [fsel.value]: w.get() }); ok++; } catch (e) { UI.toast(`${DB.name(id)}: ${e.message}`, 'err'); } }
          UI.toast(`Updated ${ok} record${ok === 1 ? '' : 's'}`);
        } }] });
      } }, 'Update field'),
      h('button.btn.sm.ai', { onclick: () => Shell.ask(`Look at these ${m.plural.toLowerCase()} and tell me what to do next: ${ids.slice(0, 25).map((id) => `[[${id}]]`).join(', ')}`) }, '✨ Ask Agentforce'),
      h('button.btn.sm.danger', { onclick: async () => {
        if (!(await UI.confirm(`Delete ${ids.length} records?`, 'They go to the Recycle Bin, where you can restore them.'))) return;
        for (const id of ids) if (DB.get(id)) DB.remove(id);
        s.sel.clear();
        UI.toast(`Deleted ${ids.length} records`);
      } }, 'Delete'),
      h('button.link', { onclick: () => { s.sel.clear(); Shell.render(); } }, 'Clear'));
  }

  Views.list = (obj, ctx) => {
    const m = DB.meta(obj);
    const s = st(obj);
    const all = views(obj);
    const vi = clamp(Number(ctx.params.view) || 0, 0, all.length - 1);
    if (s.view !== vi) { s.view = vi; s.filters = []; s.explain = ''; s.sel.clear(); s.limit = 100; s.insights = false; }
    const view = all[vi];
    const mode = m.kanban && (ctx.params.mode || (DB.org().prefs.listMode || {})[obj]) === 'kanban' ? 'kanban' : 'table';
    const filters = [...(view.filters || []), ...s.filters];
    const rows = DB.query(obj, { filters, q: s.q, sort: s.sort || view.sort || m.nameField, dir: s.sort ? s.dir : view.dir || 'asc' });
    const cols = view.columns || m.list;

    const setMode = (md) => { (DB.org().prefs.listMode = DB.org().prefs.listMode || {})[obj] = md; DB.save(); ctx.set({ mode: md }); };
    const viewMenu = (e) => UI.menu(e.currentTarget, [
      ...all.map((v, i) => ({ label: (i === vi ? '✓ ' : '   ') + v.name, run: () => ctx.set({ view: i }) })),
      '-',
      { label: 'Save as new list view…', icon: '＋', run: () => saveView(obj, filters, cols, ctx) },
      view.custom ? { label: `Delete "${view.name}"`, icon: '🗑', danger: true, run: () => {
        const list = DB.org().prefs.views[obj];
        list.splice(list.findIndex((v) => v.name === view.name), 1);
        DB.save();
        ctx.set({ view: 0 });
      } } : null,
    ].filter(Boolean));

    const search = h('input.listq', { type: 'search', placeholder: 'Search this list…', value: s.q });
    search.addEventListener('input', debounce(() => { s.q = search.value; s.limit = 100; Shell.render(); setTimeout(() => { const i = $('.listq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); }, 250));

    // ✨ Filter with AI
    const aiq = h('input.aiq', { type: 'text', placeholder: aiExample(obj) });
    const aiGo = h('button.btn.ai', '✨ Filter');
    const runAi = async () => {
      const words = aiq.value.trim();
      if (!words) { aiq.focus(); return; }
      if (!Einstein.ready()) { UI.toast(Einstein.state().problem, 'err', { label: 'Settings', run: () => Shell.go('#/settings') }); return; }
      aiGo.disabled = true;
      aiGo.replaceChildren(h('span.spinner.sm'), ` ${Einstein.word()}…`);
      try {
        const r = await Filters.ai(obj, words);
        s.filters = r.filters;
        if (r.sort) { s.sort = r.sort; s.dir = r.dir; }
        s.explain = r.explain + (r.skipped.length ? ` (skipped unknown fields: ${r.skipped.join(', ')})` : '');
        s.limit = 100;
        Shell.render();
      } catch (e) { UI.toast(e.message, 'err'); aiGo.disabled = false; aiGo.replaceChildren('✨ Filter'); }
    };
    aiGo.addEventListener('click', runAi);
    aiq.addEventListener('keydown', (e) => { if (e.key === 'Enter') runAi(); });

    const chips = h('div.chips',
      (view.filters || []).map((f) => h('span.fchip.locked', { title: 'Part of this list view' }, Filters.text(obj, f))),
      s.filters.map((f, i) => h('span.fchip', Filters.text(obj, f), h('button.x', { onclick: () => { s.filters.splice(i, 1); s.explain = ''; Shell.render(); }, title: 'Remove' }, '×'))),
      h('button.link', { onclick: () => Filters.editor(obj, (f) => { s.filters.push(f); Shell.render(); }) }, '＋ Add filter'),
      s.filters.length ? h('button.link', { onclick: () => { s.filters = []; s.explain = ''; Shell.render(); } }, 'Clear filters') : null);

    const insights = s.insights ? Einstein.card({
      key: `list:${obj}:${vi}:${JSON.stringify(s.filters)}:${s.q}`, title: 'Einstein list insights', label: 'Read this list',
      intro: `${Einstein.word()} reads these ${rows.length} ${m.plural.toLowerCase()} and tells you what stands out.`, auto: true,
      ask: () => ({ task: 'list-insights', prompt: `List view "${view.name}" of ${m.plural} — ${rows.length} records${s.filters.length ? ', filtered by ' + s.filters.map((f) => Filters.text(obj, f)).join('; ') : ''}.\nSay what stands out: totals and patterns, the records that need attention and why (link them), and 2–3 concrete next steps. Keep it under 160 words.\n\nRecords (first ${Math.min(rows.length, 70)}):\n${Einstein.listContext(obj, rows.slice(0, 70))}` }),
    }) : null;

    const total = m.field.Amount ? sum(rows, (r) => r.Amount) : m.field.TotalAmount ? sum(rows, (r) => r.TotalAmount) : null;
    return h('div.page.listpage',
      h('header.pagehead',
        UI.icon(obj, 40),
        h('div', h('div.eyebrow', m.plural), h('button.viewpick', { onclick: viewMenu }, view.name, ' ▾')),
        h('div.grow'),
        search,
        m.kanban ? h('div.seg', h(`button${mode === 'table' ? '.on' : ''}`, { onclick: () => setMode('table'), title: 'Table' }, '☰'), h(`button${mode === 'kanban' ? '.on' : ''}`, { onclick: () => setMode('kanban'), title: 'Kanban' }, '▥')) : null,
        h('button.btn', { onclick: () => exportCsv(obj, rows, cols) }, 'Export'),
        h(`button.btn.ai${s.insights ? '.on' : ''}`, { onclick: () => { s.insights = !s.insights; Shell.render(); } }, '✨ Insights'),
        obj !== 'User' || DB.me().Role === 'Admin' ? h('button.btn.primary', { onclick: () => Form.open(obj, { defaults: newDefaults(obj, view) }) }, 'New') : null),
      h('div.listmeta', h('span', `${rows.length} item${rows.length === 1 ? '' : 's'}`), total != null ? h('span', ` · ${fmt.money(total)}`) : null,
        h('span', ` · Sorted by ${(m.field[s.sort || view.sort || m.nameField] || {}).label || 'Name'}`)),
      h('div.aibar', h('span.aibar-ic', '✨'), aiq, aiGo, s.explain ? h('span.ai-explain', s.explain) : null),
      chips,
      insights,
      bulkBar(obj, s, m),
      rows.length ? (mode === 'kanban' ? kanban(obj, rows, m) : table(obj, rows, m, s, ctx, cols))
        : UI.empty(m.icon, `No ${m.plural.toLowerCase()} to show`, filters.length || s.q ? 'Try removing a filter or the search.' : `Create the first one.`,
          h('button.btn.primary', { onclick: () => Form.open(obj) }, `New ${m.label}`)));
  };

  // A new record from a list starts with the list's obvious values (e.g. "Hot Leads" → Rating Hot).
  function newDefaults(obj, view) {
    const d = {};
    for (const [f, op, v] of view.filters || []) if (op === 'eq' && v !== '$me' && v !== '$today' && DB.meta(obj).field[f] && Field.editable(DB.meta(obj).field[f])) d[f] = v;
    return d;
  }

  function saveView(obj, filters, cols, ctx) {
    const name = h('input', { type: 'text', placeholder: 'e.g. Big deals this quarter' });
    UI.modal({ title: 'New list view', body: h('div.filter-ed', h('label', 'List name', name), h('p.muted', `Keeps the ${filters.length} filter${filters.length === 1 ? '' : 's'} you have now.`)),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Save', primary: true, run: () => {
        if (!name.value.trim()) return false;
        const prefs = DB.org().prefs;
        prefs.views = prefs.views || {};
        (prefs.views[obj] = prefs.views[obj] || []).push({ name: name.value.trim(), filters: filters.slice(), columns: cols });
        DB.save();
        st(obj).filters = [];
        ctx.set({ view: views(obj).length - 1 });
        UI.toast('List view saved');
      } }] });
  }

  function aiExample(obj) {
    return {
      Opportunity: 'e.g. "my open deals over 100k closing this quarter"',
      Lead: 'e.g. "hot leads from webinars with a score above 70"',
      Case: 'e.g. "critical cases waiting on us, oldest first"',
      Account: 'e.g. "Platinum customers in healthcare"',
      Contact: 'e.g. "executives at hot accounts"',
      Task: 'e.g. "my overdue calls"',
      WorkOrder: 'e.g. "unscheduled battery jobs"',
      Order: 'e.g. "storefront orders over $2,000 this month"',
    }[obj] || `Describe the ${DB.meta(obj).plural.toLowerCase()} you want to see…`;
  }
})();
