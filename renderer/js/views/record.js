// record.js — a record page, laid out the way Lightning does it: the highlights panel with actions, the
// Path, tabs (Activity, Details with inline edit, Related, Chatter, History) and a side column of
// Einstein cards — the predictive score with its top factors, a ✨ summary, and ✨ next best actions you
// can carry out with one click.
//
// Apps add to record pages without touching this file:
//   Record.extend('Case' | '*', {
//     actions: (rec, m) => [{ label, icon, run }],     buttons in the highlights panel
//     tabs:    (rec, m) => [{ id, label, render, first }],
//     side:    (rec, m) => node | [nodes],              cards in the side column (above the Einstein ones)
//     top:     (rec, m) => node,                        a banner under the highlights
//   })
// Shared helpers: Record.email(id, { subject, body }), Record.convert(leadId), Record.links(id).

const Record = (() => {
  const exts = [];
  const extend = (obj, parts) => exts.push(Object.assign({ obj }, parts));
  const extsFor = (obj) => exts.filter((e) => e.obj === obj || e.obj === '*');
  const collect = (obj, key, rec, m) => extsFor(obj).flatMap((e) => (e[key] ? [].concat(e[key](rec, m) || []) : []));

  const pathSel = {};          // record id → the Path step picked (before it's saved)
  const guideOpen = new Set(); // records whose ✨ stage guidance is showing
  let editing = null;          // { id, widgets } while Details is in inline edit
  const showAll = new Set();   // related lists expanded past 6 rows

  const WHAT = () => [].concat(DB.meta('Task').field.WhatId.ref);
  const WHO = ['Contact', 'Lead'];

  // How a new task/event/email attaches to this record (WhatId / WhoId / RelatedToId).
  function links(id) {
    const obj = DB.objectOf(id);
    const rec = DB.get(id);
    if (WHO.includes(obj)) return { WhoId: id, WhatId: obj === 'Contact' && rec.AccountId ? rec.AccountId : null, RelatedToId: id };
    if (WHAT().includes(obj)) return { WhatId: id, WhoId: rec.ContactId || null, RelatedToId: id };
    return { RelatedToId: id };
  }
  const hasActivity = (obj) => WHO.includes(obj) || WHAT().includes(obj);

  // The person an email about this record goes to.
  function recipient(id) {
    const obj = DB.objectOf(id);
    const rec = DB.get(id);
    if (WHO.includes(obj)) return rec;
    if (rec.ContactId && DB.get(rec.ContactId)) return DB.get(rec.ContactId);
    if (obj === 'Account') return DB.all('Contact').find((c) => c.AccountId === id) || null;
    if (rec.AccountId) return DB.all('Contact').find((c) => c.AccountId === rec.AccountId) || null;
    return null;
  }

  // ---------- highlights ----------

  function highlights(rec, m) {
    const id = rec.Id;
    const acts = [
      { label: 'Edit', run: () => Form.open(m.name, { record: rec }) },
      ...collect(m.name, 'actions', rec, m),
      m.name === 'Lead' && rec.Status !== 'Closed - Converted' ? { label: 'Convert', primary: true, run: () => convert(id) } : null,
    ].filter(Boolean);
    const more = [
      { label: 'Clone', icon: '⧉', run: () => Form.clone(id) },
      { label: 'Share to Slack…', icon: '💬', run: () => shareToSlack(id) },
      { label: 'Copy link', icon: '🔗', run: () => UI.copy(`stratus://r/${id}`) },
      '-',
      { label: 'Delete', icon: '🗑', danger: true, run: () => Form.remove(id, () => Shell.go(Shell.objUrl(m.name))) },
    ];
    return h('header.highlights',
      h('div.hl-top', UI.icon(m.name, 44),
        h('div.hl-name', h('div.eyebrow', m.label), h('h1', DB.name(id) || '(no name)')),
        h('div.grow'),
        h('div.hl-actions',
          h('button.btn.ai', { onclick: () => Shell.togglePanel(true), title: 'Agentforce sees this record' }, '✨ Ask Agentforce'),
          acts.map((a) => h(`button.btn${a.primary ? '.primary' : ''}${a.ai ? '.ai' : ''}`, { onclick: a.run }, a.icon ? a.icon + ' ' : '', a.label)),
          h('button.btn', { onclick: (e) => UI.menu(e.currentTarget, more), title: 'More actions' }, '▾'))),
      h('div.hl-fields', (m.highlights || m.list.slice(1, 6)).map((f) => {
        const fd = m.field[f];
        if (!fd) return null;
        return h('div.hl-f', h('label', fd.label), h('div', Field.view(m.name, fd, rec) || h('span.muted', '—')));
      })));
  }

  // ---------- Path ----------

  function path(rec, m) {
    const p = m.path;
    const f = p && m.field[p.field];
    if (!f) return null;
    const open = f.options.filter((o) => !p.closed.includes(o));
    const cur = rec[p.field];
    const closedNow = p.closed.includes(cur);
    const won = ['Closed Won', 'Closed - Converted', 'Completed', 'Delivered'].includes(cur);
    const closedLabel = closedNow ? cur : p.closed.length > 1 ? 'Closed' : p.closed[0];
    const steps = [...open.map((o) => ({ key: o, label: o })), { key: '__closed', label: closedLabel, closed: true }];
    const curIdx = closedNow ? steps.length - 1 : Math.max(0, open.indexOf(cur));
    const selKey = pathSel[rec.Id] && steps.some((s) => s.key === pathSel[rec.Id]) ? pathSel[rec.Id] : steps[curIdx].key;
    const selIdx = steps.findIndex((s) => s.key === selKey);
    const sel = steps[selIdx];

    let btn;
    if (closedNow && selIdx === curIdx) btn = h('button.btn', { onclick: () => pick(steps[Math.max(0, open.length - 1)].key) }, 'Reopen…');
    else if (selIdx === curIdx) btn = h('button.btn.primary', { onclick: () => advance(steps[curIdx + 1]) }, `✓ Mark ${f.label} as Complete`);
    else if (sel.closed) btn = h('button.btn.primary', { onclick: () => closeDialog(rec, m, p) }, `Select Closed ${f.label}`);
    else btn = h('button.btn.primary', { onclick: () => save(sel.key) }, `Mark as Current ${f.label}`);

    function pick(k) { pathSel[rec.Id] = k; Shell.render(); }
    function save(v) {
      try { DB.update(rec.Id, { [p.field]: v }); delete pathSel[rec.Id]; UI.toast(`${f.label} changed to ${v}`); } catch (e) { UI.toast(e.message, 'err'); }
    }
    function advance(next) {
      if (!next) return;
      if (next.closed) closeDialog(rec, m, p); else save(next.key);
    }

    const guideLabel = sel.closed ? closedLabel : sel.label;
    return h('section.path-wrap',
      h('div.path', steps.map((s, i) => h(`button.step${i < curIdx ? '.done' : ''}${i === curIdx ? '.cur' : ''}${i === selIdx ? '.sel' : ''}${s.closed && closedNow ? (won ? '.won' : '.lost') : ''}`,
        { onclick: () => pick(s.key), title: s.label }, i < curIdx ? h('span.tickmark', '✓') : null, h('span', s.label))),
      btn),
      h('div.path-foot',
        h('button.link', { onclick: () => { guideOpen.has(rec.Id) ? guideOpen.delete(rec.Id) : guideOpen.add(rec.Id); Shell.render(); } },
          guideOpen.has(rec.Id) ? '▾ ' : '▸ ', `✨ Guidance for ${guideLabel}`)),
      guideOpen.has(rec.Id) ? Einstein.card({
        key: `guide:${rec.Id}:${guideLabel}`, title: `Guidance for success · ${guideLabel}`, label: 'Coach me', auto: true,
        intro: `${Einstein.word()} looks at this ${m.label.toLowerCase()} and tells you what good looks like at this step.`,
        ask: () => ({ task: 'path-guidance', prompt: `${m.label} ${f.label}: "${guideLabel}" (currently "${cur}").\nGive "guidance for success" for this step, specific to this record: 3–5 bullets on what to do and check, and the one risk to watch. Under 120 words.\n\n${Einstein.recordContext(rec.Id)}` }),
      }) : null);
  }

  function closeDialog(rec, m, p) {
    const f = m.field[p.field];
    if (m.name === 'Lead') { convertOrClose(rec); return; }
    const sel = h('select', p.closed.map((o) => h('option', { value: o }, o)));
    const lossBox = h('div');
    let loss = null;
    const drawLoss = () => {
      if (m.name === 'Opportunity' && sel.value === 'Closed Lost') {
        loss = h('select', h('option', { value: '' }, '--None--'), m.field.LossReason.options.map((o) => h('option', { value: o, selected: rec.LossReason === o }, o)));
        lossBox.replaceChildren(h('label', 'Loss Reason', loss));
      } else { loss = null; lossBox.replaceChildren(); }
    };
    sel.addEventListener('change', drawLoss);
    drawLoss();
    UI.modal({ title: `Close this ${m.label}`, body: h('div.filter-ed', h('label', f.label, sel), lossBox),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Save', primary: true, run: () => {
        const patch = { [p.field]: sel.value };
        if (loss) { if (!loss.value) { UI.toast('Pick a loss reason', 'err'); return false; } patch.LossReason = loss.value; }
        try { DB.update(rec.Id, patch); } catch (e) { UI.toast(e.message, 'err'); return false; }
        delete pathSel[rec.Id];
        UI.toast(sel.value === 'Closed Won' ? '🎉 Closed Won — nice work!' : `${f.label} changed to ${sel.value}`);
        return true;
      } }] });
  }
  function convertOrClose(rec) {
    const sel = h('select', h('option', { value: 'convert' }, 'Converted — convert this lead'), h('option', { value: 'Closed - Not Converted' }, 'Closed - Not Converted'));
    UI.modal({ title: 'Close this Lead', body: h('div.filter-ed', h('label', 'Lead Status', sel)), actions: [{ label: 'Cancel', run: () => {} }, { label: 'Next', primary: true, run: () => {
      if (sel.value === 'convert') setTimeout(() => convert(rec.Id), 0);
      else { DB.update(rec.Id, { Status: sel.value }); delete pathSel[rec.Id]; }
    } }] });
  }

  // ---------- Lead conversion ----------

  function convert(leadId) {
    const l = DB.get(leadId);
    const match = DB.all('Account').find((a) => a.Name.toLowerCase() === String(l.Company || '').toLowerCase());
    let mode = match ? 'existing' : 'new';
    const acctW = Field.input('Contact', DB.meta('Contact').field.AccountId, match ? match.Id : null);
    const newName = h('input', { type: 'text', value: l.Company || '' });
    const acctBox = h('div');
    const drawAcct = () => acctBox.replaceChildren(mode === 'new' ? h('label', 'Account Name', newName) : h('label', 'Existing account', acctW.el));
    const radio = (v, label) => h('label.radio', h('input', { type: 'radio', name: 'cv-acct', checked: mode === v, onchange: () => { mode = v; drawAcct(); } }), label);
    const mkOpp = h('input', { type: 'checkbox', checked: true });
    const oppName = h('input', { type: 'text', value: `${l.Company || l.LastName} – New Business` });
    drawAcct();
    UI.modal({ title: `Convert ${DB.name(leadId)}`, wide: true,
      body: h('div.convert',
        h('div.cv-sec', h('h4', '🏢 Account'), h('div.cv-radios', radio('new', 'Create new'), radio('existing', 'Choose existing')), acctBox,
          match ? h('p.muted', `Einstein found a matching account: ${match.Name}.`) : null),
        h('div.cv-sec', h('h4', '📇 Contact'), h('p', `Creates ${[l.FirstName, l.LastName].filter(Boolean).join(' ')}${l.Title ? ', ' + l.Title : ''}.`)),
        h('div.cv-sec', h('h4', '👑 Opportunity'), h('label.check', mkOpp, h('span', 'Create an opportunity')), h('label', 'Opportunity Name', oppName))),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Convert', primary: true, run: () => {
        try {
          const out = DB.convertLead(leadId, { accountId: mode === 'existing' ? acctW.get() : null, createOpp: mkOpp.checked, oppName: oppName.value.trim() || null });
          if (mode === 'new' && newName.value.trim() && newName.value.trim() !== out.account.Name) DB.update(out.account.Id, { Name: newName.value.trim() });
          delete pathSel[leadId];
          converted(out);
        } catch (e) { UI.toast(e.message, 'err'); return false; }
      } }] });
  }
  function converted(out) {
    const row = (rec) => rec && h('a.cv-done', { href: '#/r/' + rec.Id, onclick: () => dlg.close() }, UI.icon(DB.objectOf(rec.Id), 28), h('div', h('small', DB.meta(DB.objectOf(rec.Id)).label), h('b', DB.name(rec.Id))));
    const dlg = UI.modal({ title: '🎉 Your lead has been converted', body: h('div.cv-result', row(out.account), row(out.contact), row(out.opportunity)),
      actions: [{ label: 'Go to Leads', run: () => Shell.go(Shell.objUrl('Lead')) }, out.opportunity ? { label: 'Open Opportunity', primary: true, run: () => Shell.go('#/r/' + out.opportunity.Id) } : null].filter(Boolean) });
  }

  // ---------- Details (with inline edit) ----------

  function details(rec, m) {
    const isEdit = editing && editing.id === rec.Id;
    const main = m.fields.filter((f) => !f.system && f.type !== 'json' && !f.hidden);
    if (isEdit) editing.widgets = {};
    const cell = (f) => {
      if (isEdit && Field.editable(f)) {
        const w = Field.input(m.name, f, rec[f.name]);
        editing.widgets[f.name] = w;
        return h(`div.fld${f.type === 'textarea' ? '.wide' : ''}`, { dataset: { f: f.name } }, h('label', f.required ? h('abbr', '*') : null, f.label), w.el);
      }
      const v = Field.view(m.name, f, rec);
      return h(`div.dfield${f.type === 'textarea' ? '.wide' : ''}${Field.editable(f) ? '.can' : ''}`, {
        ondblclick: Field.editable(f) ? () => startEdit(rec.Id, f.name) : null,
      }, h('label', f.label, f.help ? h('span.help', { title: f.help }, ' ⓘ') : null), h('div.dv', v || h('span.muted', ' ')),
      Field.editable(f) ? h('button.pencil', { onclick: () => startEdit(rec.Id, f.name), title: `Edit ${f.label}` }, '✎') : null);
    };
    const sys = h('div.dgrid.sys',
      h('div.dfield', h('label', 'Created By'), h('div.dv', Field.link(rec.CreatedById), ', ', fmt.datetime(rec.CreatedDate))),
      h('div.dfield', h('label', 'Last Modified By'), h('div.dv', Field.link(rec.LastModifiedById), ', ', fmt.datetime(rec.LastModifiedDate))));
    const err = h('div.form-err');
    return h(`div.details${isEdit ? '.inline-edit' : ''}`,
      h('div.dgrid', main.map(cell)),
      h('h4.dsec', 'System Information'), sys,
      isEdit ? h('div.editbar', err, h('button.btn', { onclick: () => { editing = null; Shell.render(); } }, 'Cancel'),
        h('button.btn.primary', { onclick: () => {
          const patch = {};
          for (const [k, w] of Object.entries(editing.widgets)) patch[k] = w.get();
          try { DB.update(rec.Id, patch); editing = null; UI.toast(`${m.label} saved`); Shell.render(); } catch (e) { err.replaceChildren(e.message); }
        } }, 'Save')) : null);
  }
  function startEdit(id, focus) {
    editing = { id, widgets: {} };
    Shell.render();
    setTimeout(() => { if (editing && editing.widgets[focus]) editing.widgets[focus].focus(); }, 30);
  }

  // ---------- Related ----------

  function relatedLists(rec, m) {
    const lists = DB.related(rec.Id);
    // Custom lookups to this object get a related list automatically, like in Salesforce.
    for (const o of DB.objects()) {
      const om = DB.meta(o);
      for (const f of om.fields) {
        if (f.type !== 'lookup' || Array.isArray(f.ref) || f.ref !== m.name || !(om.custom || f.custom)) continue;
        if (lists.some((l) => l.object === o && l.field === f.name)) continue;
        lists.push({ object: o, field: f.name, label: om.plural, rows: DB.all(o).filter((r) => r[f.name] === rec.Id) });
      }
    }
    return lists;
  }

  function related(rec, m) {
    const lists = relatedLists(rec, m);
    if (!lists.length) return UI.empty('🔗', 'No related lists', `${m.plural} don't have related records.`);
    return h('div.related', lists.map((rl) => {
      const cm = DB.meta(rl.object);
      const cols = (cm.list || [cm.nameField]).filter((c) => c !== rl.field).slice(0, 5);
      const key = rec.Id + rl.object + rl.field;
      const rows = showAll.has(key) ? rl.rows : rl.rows.slice(0, 6);
      const actions = h('div.row-acts',
        rl.object === 'OpportunityLineItem' ? h('button.btn.sm', { onclick: () => addProducts(rec) }, 'Add Products') : null,
        h('button.btn.sm', { onclick: () => Form.open(rl.object, { defaults: { [rl.field]: rec.Id }, onSave: () => Shell.render() }) }, 'New'));
      const table = rl.rows.length ? h('table.grid.compact', h('thead', h('tr', cols.map((c) => h('th', cm.field[c] ? cm.field[c].label : c)), h('th.act'))),
        h('tbody', rows.map((r) => h('tr', cols.map((c, i) => {
          const f = cm.field[c];
          if (i === 0) return h('td.namecell', cm.hidden ? h('span', f && f.type === 'lookup' ? Field.view(rl.object, f, r) : DB.name(r.Id)) : h('a.reclink', { href: '#/r/' + r.Id }, DB.name(r.Id)));
          return h('td', f ? Field.view(rl.object, f, r) : '');
        }), h('td.act', h('button.iconbtn.sm', { onclick: (e) => UI.menu(e.currentTarget, [
          { label: 'Edit', icon: '✏️', run: () => Form.open(rl.object, { record: r }) },
          { label: 'Delete', icon: '🗑', danger: true, run: () => Form.remove(r.Id) },
        ]) }, '▾')))))) : h('p.muted.pad', `No ${cm.plural.toLowerCase()} yet.`);
      return UI.card(rl.label, h('div', table, rl.rows.length > 6 ? h('button.link.pad', { onclick: () => { showAll.has(key) ? showAll.delete(key) : showAll.add(key); Shell.render(); } }, showAll.has(key) ? 'Show less' : `View all (${rl.rows.length})`) : null),
        { icon: cm.icon, count: rl.rows.length, actions });
    }));
  }

  function addProducts(opp) {
    const prods = DB.query('Product2', { filters: [['IsActive', 'eq', true]], sort: 'Family' });
    const qty = {};
    const q = h('input', { type: 'search', placeholder: 'Search products…' });
    const list = h('div.prodpick');
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      list.replaceChildren(...prods.filter((p) => !t || (p.Name + ' ' + (p.Family || '')).toLowerCase().includes(t)).map((p) => {
        const n = h('input.qty', { type: 'number', min: 0, value: qty[p.Id] || 0, oninput: (e) => { qty[p.Id] = Number(e.target.value) || 0; } });
        return h('div.prodrow', h('span.pimg', p.Image || '📦'), h('div.grow', h('b', p.Name), h('small', `${p.Family || ''} · ${fmt.money(p.ListPrice)}`)), n);
      }));
    };
    q.addEventListener('input', draw);
    draw();
    UI.modal({ title: `Add Products to ${DB.name(opp.Id)}`, wide: true, body: h('div', q, list), actions: [{ label: 'Cancel', run: () => {} }, { label: 'Add', primary: true, run: () => {
      const picked = Object.entries(qty).filter(([, n]) => n > 0);
      if (!picked.length) { UI.toast('Set a quantity on at least one product', 'err'); return false; }
      for (const [pid, n] of picked) DB.insert('OpportunityLineItem', { OpportunityId: opp.Id, Product2Id: pid, Quantity: n, UnitPrice: DB.get(pid).ListPrice });
      const total = sum(DB.all('OpportunityLineItem').filter((x) => x.OpportunityId === opp.Id), (x) => x.TotalPrice);
      DB.update(opp.Id, { Amount: total });
      UI.toast(`Added ${picked.length} product${picked.length > 1 ? 's' : ''} · Amount is now ${fmt.money(total)}`);
    } }] });
  }

  // ---------- History ----------

  function history(rec, m) {
    const rows = DB.history(rec.Id);
    if (!rows.length) return UI.empty('🕓', 'No field history yet', 'Changes to this record show up here.');
    const val = (f, v) => {
      if (v == null || v === '') return h('span.muted', 'blank');
      if (!f) return String(v);
      return f.type === 'lookup' ? (DB.name(v) || v) : DB.display(m.name, f, v);
    };
    return h('table.grid.compact', h('thead', h('tr', h('th', 'Date'), h('th', 'Field'), h('th', 'User'), h('th', 'Original Value'), h('th', 'New Value'))),
      h('tbody', rows.slice(0, 200).map((x) => {
        const f = m.field[x.f];
        return h('tr', h('td', fmt.datetime(x.at)), h('td', f ? f.label : x.f), h('td', String(x.by || '').startsWith('bot:') ? '⚡ ' + x.by.slice(4) : Field.link(x.by)), h('td', val(f, x.o)), h('td', val(f, x.n)));
      })));
  }

  // ---------- Activity ----------

  const composerTab = {}; // record id → 'task' | 'call' | 'event' | 'email'

  function activity(rec, m) {
    const id = rec.Id;
    const tab = composerTab[id] || 'task';
    const set = (t) => { composerTab[id] = t; Shell.render(); };
    const seg = h('div.seg.wide', [['task', '✅ New Task'], ['call', '📞 Log a Call'], ['event', '📅 New Event'], ['email', '✉️ Email']].map(([k, l]) => h(`button${tab === k ? '.on' : ''}`, { onclick: () => set(k) }, l)));
    let body;
    if (tab === 'task') {
      const subj = h('input', { type: 'text', placeholder: 'Subject, e.g. "Send the revised quote"' });
      const due = h('input', { type: 'date', value: addDays(today(), 2) });
      const pr = h('select', ['Normal', 'High', 'Low'].map((p) => h('option', p)));
      body = h('div.composer', subj, h('div.row', h('label', 'Due', due), h('label', 'Priority', pr), h('div.grow'),
        h('button.btn.primary', { onclick: () => {
          if (!subj.value.trim()) { subj.focus(); return; }
          const l = links(id);
          DB.insert('Task', { Subject: subj.value.trim(), ActivityDate: due.value || null, Priority: pr.value, Type: 'To Do', WhatId: l.WhatId || null, WhoId: l.WhoId || null });
          UI.toast('Task created');
        } }, 'Save')));
    } else if (tab === 'call') {
      const subj = h('input', { type: 'text', value: `Call with ${(recipient(id) && DB.name(recipient(id).Id)) || DB.name(id)}` });
      const notes = h('textarea', { rows: 4, placeholder: 'Rough notes are fine — ✨ Tidy turns them into a clean summary with next steps.' });
      body = h('div.composer', subj, notes, h('div.row',
        Einstein.button('Tidy notes', () => {
          if (!notes.value.trim()) throw new Error('Write some notes first.');
          return { task: 'call-notes', prompt: `Rewrite these call notes about ${m.label} "${DB.name(id)}" as: a 1–2 sentence summary, then "Next steps:" bullets with owners where clear. Keep every fact; add nothing.\n\nNotes:\n${notes.value}` };
        }, (r) => { notes.value = r.text; }, 'sm'),
        h('div.grow'),
        h('button.btn.primary', { onclick: () => {
          const l = links(id);
          DB.insert('Task', { Subject: subj.value.trim() || 'Call', Type: 'Call', Status: 'Completed', ActivityDate: today(), Description: notes.value, WhatId: l.WhatId || null, WhoId: l.WhoId || null });
          UI.toast('Call logged');
        } }, 'Log Call')));
    } else if (tab === 'event') {
      const subj = h('input', { type: 'text', placeholder: 'Subject, e.g. "Site survey"' });
      const start = h('input', { type: 'datetime-local', value: Field.toLocal(new Date(Date.now() + DAY).setHours(10, 0, 0, 0)) });
      const len = h('select', [[30, '30 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']].map(([v, l]) => h('option', { value: v, selected: v === 60 }, l)));
      const loc = h('input', { type: 'text', placeholder: 'Location' });
      body = h('div.composer', subj, h('div.row', h('label', 'Start', start), h('label', 'Length', len)), loc, h('div.row', h('div.grow'),
        h('button.btn.primary', { onclick: () => {
          if (!subj.value.trim() || !start.value) { subj.focus(); return; }
          const s = Field.fromLocal(start.value);
          const l = links(id);
          const whatOk = [].concat(DB.meta('Event').field.WhatId.ref).includes(DB.objectOf(l.WhatId));
          DB.insert('Event', { Subject: subj.value.trim(), StartDateTime: s, EndDateTime: new Date(new Date(s).getTime() + Number(len.value) * 60000).toISOString(), Location: loc.value, WhatId: whatOk ? l.WhatId : null, WhoId: l.WhoId || null });
          UI.toast('Event created');
        } }, 'Save')));
    } else {
      body = h('div.composer', h('p.muted', `Write an email to ${recipient(id) ? DB.name(recipient(id).Id) : 'someone'} — ✨ can draft it from this record's history.`),
        h('div.row', h('button.btn.primary', { onclick: () => email(id) }, '✉️ Compose email…')));
    }

    const items = DB.activity(id);
    const open = items.filter((a) => DB.objectOf(a.Id) === 'Task' && a.Status !== 'Completed');
    const upcoming = items.filter((a) => DB.objectOf(a.Id) === 'Event' && a.StartDateTime >= new Date().toISOString());
    const past = items.filter((a) => !open.includes(a) && !upcoming.includes(a));
    const group = (title, list) => list.length ? h('div.tl-group', h('h4', title, h('span.count', list.length)), list.slice(0, 30).map(tlItem)) : null;
    return h('div.activity', seg, body,
      h('div.timeline', items.length ? [group('Upcoming & Overdue', [...open.sort((a, b) => String(a.ActivityDate).localeCompare(String(b.ActivityDate))), ...upcoming]), group('Past Activity', past)]
        : h('p.muted.pad', 'No activities yet. Get started by sending an email, scheduling a task, and more.')));
  }

  function tlItem(a) {
    const obj = DB.objectOf(a.Id);
    const m = DB.meta(obj);
    const when = a.ActivityDate || a.StartDateTime || a.MessageDate || a.CreatedDate;
    const overdue = obj === 'Task' && a.Status !== 'Completed' && a.ActivityDate && a.ActivityDate < today();
    const icon = obj === 'Task' ? (a.Type === 'Call' ? '📞' : a.Type === 'Email' ? '✉️' : '✅') : m.icon;
    const title = obj === 'EmailMessage'
      ? h('a.reclink', { href: '#', onclick: (e) => { e.preventDefault(); showEmail(a); } }, a.Subject)
      : h('a.reclink', { href: '#/r/' + a.Id }, a.Subject);
    return h(`div.tl-item.${obj.toLowerCase()}`,
      h('span.tl-ic', icon),
      h('div.tl-body',
        h('div.tl-head',
          obj === 'Task' ? h('input', { type: 'checkbox', checked: a.Status === 'Completed', title: 'Mark complete', onchange: (e) => DB.update(a.Id, { Status: e.target.checked ? 'Completed' : 'Not Started' }) }) : null,
          title, h('div.grow'), h(`span.tl-when${overdue ? '.overdue' : ''}`, obj === 'Event' ? fmt.datetime(when) : fmt.date(when))),
        h('div.tl-sub', [
          obj === 'EmailMessage' ? (a.Incoming ? `From ${a.FromName || a.ToAddress}` : `To ${a.ToAddress || '—'}`) : null,
          a.WhoId ? DB.name(a.WhoId) : null,
          obj === 'Task' && a.Type ? a.Type : null,
          a.Location || null,
        ].filter(Boolean).join(' · ')),
        a.Description || a.TextBody ? h('div.tl-text', String(a.Description || a.TextBody).slice(0, 280)) : null));
  }
  function showEmail(e) {
    UI.modal({ title: e.Subject, wide: true, body: h('div.emailview',
      h('div.muted', `${e.Incoming ? 'From' : 'To'}: ${e.Incoming ? e.FromName || e.ToAddress : e.ToAddress} · ${fmt.datetime(e.MessageDate)}`),
      h('div.pre', e.TextBody || '')),
    actions: e.Incoming && e.RelatedToId ? [{ label: '✨ Reply', primary: true, run: () => { setTimeout(() => email(e.RelatedToId, { subject: 'Re: ' + e.Subject, replyTo: e }), 0); } }] : [] });
  }

  // ---------- Email composer (shared) ----------

  function email(id, { subject, body, replyTo, to } = {}) {
    const who = recipient(id);
    const toI = h('input', { type: 'text', value: to || (who && who.Email) || '' });
    const subj = h('input', { type: 'text', value: subject || '' });
    const text = h('textarea', { rows: 12 });
    text.value = body || '';
    const intent = h('input', { type: 'text', placeholder: replyTo ? 'Anything to say in the reply? (optional)' : 'What is it about? e.g. "follow up on the battery quote, offer a call Thursday"' });
    const templates = DB.all('EmailTemplate');
    const tsel = templates.length ? h('select', { onchange: () => {
      const t = DB.get(tsel.value);
      if (!t) return;
      subj.value = DB.merge(t.Subject, DB.get(id));
      text.value = DB.merge(t.Body, DB.get(id));
    } }, h('option', { value: '' }, 'Insert a template…'), templates.map((t) => h('option', { value: t.Id }, t.Name))) : null;
    const draft = Einstein.button(replyTo ? 'Draft reply' : 'Draft with AI', () => ({
      task: 'email-draft',
      system: 'You write short, warm, specific business emails. No placeholders like [Name] — use the real names given. Sign off as the user.',
      prompt: `${replyTo ? `Reply to this email:\nSubject: ${replyTo.Subject}\n${replyTo.TextBody}\n\n` : ''}Write an email${who ? ` to ${DB.name(who.Id)}${who.Title ? ' (' + who.Title + ')' : ''}` : ''} about ${DB.meta(DB.objectOf(id)).label} "${DB.name(id)}".\n${intent.value ? 'It should: ' + intent.value + '\n' : ''}Use the record and its history:\n${Einstein.recordContext(id)}`,
      schema: Einstein.S.obj({ subject: Einstein.S.str('subject line'), body: Einstein.S.str('plain-text body with line breaks') }),
    }), (r) => { if (!subj.value || !replyTo) subj.value = r.subject || subj.value; text.value = r.body || ''; }, 'sm');
    const tone = (how) => Einstein.button(how, () => {
      if (!text.value.trim()) throw new Error('Write or draft the email first.');
      return { task: 'email-tone', prompt: `Rewrite this email to be ${how.toLowerCase()}. Keep the facts, names and meaning. Reply with the body only.\n\n${text.value}` };
    }, (r) => { text.value = r.text; }, 'sm.ghost');
    UI.modal({ title: replyTo ? 'Reply' : 'New Email', wide: true, className: 'emailmodal',
      body: h('div.form', h('div.ai-fill-body.inline', h('span.aibar-ic', '✨'), intent, draft),
        h('label', 'To', toI), h('label', 'Subject', subj), tsel, text,
        h('div.row', h('span.muted', 'Make it: '), tone('Shorter'), tone('Friendlier'), tone('More formal'))),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Send', primary: true, run: () => {
        if (!subj.value.trim() || !text.value.trim()) { UI.toast('Add a subject and a message', 'err'); return false; }
        const l = links(id);
        DB.insert('EmailMessage', { Subject: subj.value.trim(), TextBody: text.value, ToAddress: toI.value.trim(), FromName: (DB.me() || {}).Name, Incoming: false, Status: 'Sent',
          RelatedToId: l.RelatedToId, WhoId: who && WHO.includes(DB.objectOf(who.Id)) ? who.Id : null, MessageDate: new Date().toISOString() });
        UI.toast(`Email sent${toI.value ? ' to ' + toI.value : ''}`);
      } }] });
  }

  // ---------- Chatter ----------

  const author = (uid) => (String(uid || '').startsWith('bot:') ? '⚡ ' + uid.slice(4) : DB.name(uid) || 'Someone');
  function chatter(rec, m) {
    const box = h('textarea', { rows: 2, placeholder: 'Share an update…' });
    const posts = DB.feed(rec.Id);
    return h('div.chatter',
      h('div.composer', box, h('div.row',
        Einstein.button('Write an update', () => ({ task: 'chatter-update', prompt: `Write a short Chatter status update (2–3 sentences, plain, no hashtags) on ${m.label} "${DB.name(rec.Id)}" for the team: where it stands, what changed lately, what's next.\n\n${Einstein.recordContext(rec.Id)}` }),
          (r) => { const el = box.isConnected ? box : $('.chatter .composer textarea') || box; el.value = r.text; el.focus(); }, 'sm'),
        h('div.grow'),
        h('button.btn.primary', { onclick: () => { if (!box.value.trim()) return; DB.post(rec.Id, box.value.trim()); } }, 'Share'))),
      posts.length ? posts.map(postView) : h('p.muted.pad', 'No posts yet.'));
  }
  function postView(p) {
    const me = DB.org().me;
    const liked = p.likes.includes(me);
    const reply = h('input', { type: 'text', placeholder: 'Write a comment…', onkeydown: (e) => {
      if (e.key !== 'Enter' || !reply.value.trim()) return;
      p.comments.push({ userId: me, text: reply.value.trim(), at: new Date().toISOString() });
      DB.save(); DB.emit({ kind: 'feed', rec: p });
    } });
    return h('div.post',
      String(p.userId).startsWith('bot:') ? h('span.avatar.bot', '⚡') : UI.avatar(DB.name(p.userId), 34),
      h('div.post-body',
        h('div.post-head', h('b', author(p.userId)), h('span.muted', ' · ' + fmt.ago(p.at))),
        md(p.text),
        h('div.post-acts',
          h(`button.link${liked ? '.on' : ''}`, { onclick: () => { liked ? p.likes.splice(p.likes.indexOf(me), 1) : p.likes.push(me); DB.save(); DB.emit({ kind: 'feed', rec: p }); } }, liked ? '👍 Liked' : '👍 Like', p.likes.length ? ` · ${p.likes.length}` : '')),
        p.comments.map((c) => h('div.cmt', UI.avatar(DB.name(c.userId), 24), h('div', h('b', author(c.userId)), ' ', c.text, h('span.muted', ' · ' + fmt.ago(c.at))))),
        reply));
  }

  // ---------- Slack ----------

  function shareToSlack(id) {
    const chans = DB.org().slack.channels;
    const sel = h('select', chans.map((c) => h('option', { value: c.id, selected: c.recordId === id }, '#' + c.name)));
    const msg = h('textarea', { rows: 4 });
    msg.value = `Sharing ${DB.meta(DB.objectOf(id)).label}: [[${id}]]`;
    UI.modal({ title: 'Share to Slack', body: h('div.form', h('label', 'Channel', sel), msg,
      Einstein.button('Write a summary for the channel', () => ({ task: 'slack-share', prompt: `Write a short Slack message (2–4 lines, can use *bold* and bullets) sharing ${DB.meta(DB.objectOf(id)).label} [[${id}]] with the team: why it matters now and what help is needed. Include [[${id}]] once.\n\n${Einstein.recordContext(id)}` }), (r) => { msg.value = r.text; }, 'sm')),
    actions: [{ label: 'Cancel', run: () => {} }, { label: 'Share', primary: true, run: () => {
      DB.slackPost(sel.value, msg.value, null, { recordId: id });
      UI.toast(`Shared to #${DB.channel(sel.value).name}`, 'ok', { label: 'Open Slack', run: () => Shell.go(`#/app/slack/slack?ch=${sel.value}`) });
    } }] });
  }

  // ---------- Einstein side cards ----------

  function ring(score, color = scoreColor(score)) {
    const r = 26, c = 2 * Math.PI * r;
    return svg('svg', { viewBox: '0 0 64 64', width: 64, height: 64, class: 'ring' },
      svg('circle', { cx: 32, cy: 32, r, fill: 'none', 'stroke-width': 7, class: 'ring-bg' }),
      svg('circle', { cx: 32, cy: 32, r, fill: 'none', 'stroke-width': 7, stroke: color, 'stroke-dasharray': `${(c * score) / 100} ${c}`, 'stroke-linecap': 'round', transform: 'rotate(-90 32 32)' }),
      svg('text', { x: 32, y: 37, 'text-anchor': 'middle', class: 'ring-t' }, String(score)));
  }
  function scoreCard(rec, m) {
    const kind = { Lead: ['Einstein Lead Score', Predict.lead, 'How likely this lead is to convert'], Opportunity: ['Einstein Win Score', Predict.win, 'How likely this deal is to close won'],
      Case: ['Escalation Risk', Predict.caseRisk, 'How likely this case is to escalate'], Account: ['Account Health', Predict.health, 'From cases, CSAT, orders, wins and touches'] }[m.name];
    if (!kind) return null;
    const p = kind[1](rec);
    const s = m.name === 'Case' ? 100 - p.score : p.score; // risk: high is bad, so the ring shows how safe it is
    return UI.card(kind[0], h('div.scorecard',
      h('div.sc-top', ring(p.score, scoreColor(s)), h('div', h('p.muted', kind[2]), m.name === 'Case' ? h('b', { style: { color: scoreColor(s) } }, p.score >= 60 ? 'High risk' : p.score >= 35 ? 'Medium risk' : 'Low risk') : null)),
      h('ul.reasons', p.reasons.slice(0, 6).map((r) => h(`li.${r[0] === '+' ? (m.name === 'Case' ? 'neg' : 'pos') : (m.name === 'Case' ? 'pos' : 'neg')}`, r))),
      m.name === 'Account' && rec.HealthScore !== p.score ? h('button.btn.sm', { onclick: () => DB.update(rec.Id, { HealthScore: p.score }) }, `Save ${p.score} to Health Score`) : null),
    { icon: '📈' });
  }

  function summaryCard(rec, m) {
    return Einstein.card({
      key: `sum:${rec.Id}`, title: `${m.label} summary`, label: 'Summarize', icon: '✨',
      intro: `${Einstein.word()} reads this ${m.label.toLowerCase()}, its related records and activity, and sums it up.`,
      ask: () => ({ task: 'record-summary', prompt: `Summarize this ${m.label} for a busy ${(DB.me() || {}).Title || 'user'}: where it stands, what happened recently, risks, and what to do next. 4–6 short bullets. Link records with [[Id]].\n\n${Einstein.recordContext(rec.Id)}` }),
      actions: m.name === 'Case' ? (r) => [h('button.btn.sm', { onclick: () => { DB.update(rec.Id, { Summary: r.text }); UI.toast('Saved to the case'); } }, 'Save to case')] : null,
    });
  }

  const NBA_KINDS = { task: '✅', email: '✉️', update: '✏️', slack: '💬' };
  function nbaCard(rec, m) {
    const editable = m.fields.filter((f) => Field.editable(f) && ['picklist', 'date', 'text', 'number', 'currency', 'checkbox'].includes(f.type)).slice(0, 18);
    return Einstein.card({
      key: `nba:${rec.Id}`, title: 'Next best actions', label: 'Suggest actions', icon: '🎯',
      intro: 'Einstein suggests what to do next — and does it for you when you say so.',
      ask: () => ({
        task: 'next-best-action',
        system: 'You are a CRM coach. Suggest 3 concrete, high-impact next steps for this record. Each must be one of: a task to create, an email to send (write it), a field to update, or a Slack message to the team.',
        prompt: `Record:\n${Einstein.recordContext(rec.Id)}\n\nFields you may update (name: type / options):\n${editable.map((f) => `${f.name}: ${f.type}${f.options ? ' — ' + f.options.join(' | ') : ''}`).join('\n')}\nSlack channels: ${DB.org().slack.channels.slice(0, 12).map((c) => '#' + c.name).join(', ')}`,
        schema: Einstein.S.obj({ actions: Einstein.S.arr(Einstein.S.obj({
          kind: Einstein.S.oneOf(['task', 'email', 'update', 'slack']), title: Einstein.S.str('short imperative, e.g. "Call Dana about the install date"'), why: Einstein.S.str('one sentence: why this, why now'),
          subject: Einstein.S.str('task or email subject; empty otherwise'), body: Einstein.S.str('email body or Slack message; empty otherwise'),
          field: Einstein.S.str('field API name for update; empty otherwise'), value: Einstein.S.str('new value for update; empty otherwise'),
          channel: Einstein.S.str('Slack channel name for slack; empty otherwise'), days: Einstein.S.num('task due in this many days; 0 if not a task'),
        })) }),
      }),
      render: (r) => h('div.nba', (r.actions || []).map((a) => h(`div.nba-item${a.done ? '.done' : ''}`,
        h('span.nba-ic', NBA_KINDS[a.kind] || '•'),
        h('div.grow', h('b', a.title), h('p.muted', a.why)),
        a.done ? h('span.tick', '✓ Done') : h('button.btn.sm', { onclick: () => doAction(rec, m, a) }, a.kind === 'email' ? 'Review' : 'Do it')))),
    });
  }
  function doAction(rec, m, a) {
    const l = links(rec.Id);
    try {
      if (a.kind === 'task') {
        DB.insert('Task', { Subject: a.subject || a.title, ActivityDate: addDays(today(), Math.max(0, Math.round(a.days || 1))), Priority: 'High', WhatId: l.WhatId || null, WhoId: l.WhoId || null, Description: a.why });
        UI.toast('Task created');
      } else if (a.kind === 'email') {
        email(rec.Id, { subject: a.subject, body: a.body });
      } else if (a.kind === 'update') {
        const f = m.field[a.field];
        if (!f || !Field.editable(f)) throw new Error(`Can't update "${a.field}".`);
        const v = Filters.coerce(f, 'eq', a.value);
        DB.update(rec.Id, { [f.name]: v });
        UI.toast(`${f.label} set to ${DB.display(m.name, f, v) || v}`);
      } else if (a.kind === 'slack') {
        const ch = DB.channel(a.channel) ? a.channel : 'general';
        DB.slackPost(ch, a.body || a.title, null, { recordId: rec.Id });
        UI.toast(`Posted to #${DB.channel(ch).name}`);
      }
      if (a.kind !== 'email') a.done = true;
      Shell.render();
    } catch (e) { UI.toast(e.message, 'err'); }
  }

  // ---------- the page ----------

  function render(id, ctx) {
    const rec = DB.get(id);
    const obj = DB.objectOf(id);
    if (!rec || !obj) {
      const gone = DB.org().bin.find((b) => b.items.some((it) => it.rec && it.rec.Id === id));
      return UI.empty('🗑', 'This record isn’t available', gone ? `"${gone.name}" is in the Recycle Bin.` : 'It may have been deleted.',
        gone ? h('button.btn.primary', { onclick: () => { DB.restore(gone.id); UI.toast('Restored'); } }, 'Restore it') : null);
    }
    const m = DB.meta(obj);
    if (editing && editing.id !== id) editing = null;
    if (DB.org().recent[0] !== id) DB.touch(id);

    const tabs = [];
    if (hasActivity(obj)) tabs.push({ id: 'activity', label: 'Activity', render: () => activity(rec, m) });
    tabs.push({ id: 'details', label: 'Details', render: () => details(rec, m) });
    const rl = relatedLists(rec, m);
    if (rl.length) tabs.push({ id: 'related', label: 'Related', count: sum(rl, (x) => x.rows.length), render: () => related(rec, m) });
    tabs.push({ id: 'chatter', label: 'Chatter', count: DB.feed(id).length || null, render: () => chatter(rec, m) });
    tabs.push({ id: 'history', label: 'History', render: () => history(rec, m) });
    const extTabs = collect(obj, 'tabs', rec, m);
    for (const t of extTabs) { if (t.first) tabs.unshift(t); else tabs.push(t); }
    const active = editing && editing.id === id ? 'details' : null;

    return h('div.page.recordpage', { style: { '--obj': m.color } },
      highlights(rec, m),
      collect(obj, 'top', rec, m),
      path(rec, m),
      h('div.rec-cols',
        h('div.rec-main', UI.tabs(tabs, 'rec:' + obj, active)),
        h('aside.rec-side', collect(obj, 'side', rec, m), scoreCard(rec, m), summaryCard(rec, m), nbaCard(rec, m))));
  }

  return { extend, render, links, recipient, email, convert, shareToSlack, ring, tlItem };
})();

Views.record = (id, ctx) => Record.render(id, ctx);
