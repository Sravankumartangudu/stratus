// setup.js — Setup, the admin side: Object Manager (custom objects, fields, formulas), Flow Builder and
// flow runs, Users (log in as), the Einstein Trust Layer and its audit trail, the Recycle Bin, and data.
// AI where admins want it: ✨ design an object from a sentence, ✨ write a formula from words (checked
// by the formula engine before it's saved), and ✨ describe a flow and get it built.

(() => {
  const FIELD_TYPES = [['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['currency', 'Currency'], ['percent', 'Percent'], ['date', 'Date'], ['datetime', 'Date/Time'],
    ['checkbox', 'Checkbox'], ['picklist', 'Picklist'], ['multipicklist', 'Multi-select picklist'], ['email', 'Email'], ['phone', 'Phone'], ['url', 'URL'], ['lookup', 'Lookup'], ['formula', 'Formula']];
  const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.concat([['autonumber', 'Auto number'], ['rollup', 'Roll-up summary'], ['json', 'Data'], ['id', 'Id']]));
  const ACTIONS = [['update', '✏️ Update a field'], ['task', '✅ Create a task'], ['slack', '💬 Post to Slack'], ['chatter', '🗨 Post to Chatter'], ['email', '✉️ Send an email'], ['ai', '✨ AI writes a field']];
  const FUNCS = 'IF, CASE, AND, OR, NOT, ISBLANK, BLANKVALUE, TODAY, NOW, ROUND, ABS, MAX, MIN, LEN, UPPER, LOWER, TEXT, VALUE, CONTAINS, BEGINS, ADDDAYS, DATEVALUE, YEAR, MONTH';
  const NAV = [
    ['home', '🏠', 'Setup Home'], ['objects', '🧱', 'Object Manager'], ['flows', '⚡', 'Flows'], ['runs', '📜', 'Flow Runs'], ['users', '👥', 'Users'],
    ['trust', '🛡', 'Einstein Trust Layer'], ['audit', '🔎', 'AI Audit Trail'], ['bin', '🗑', 'Recycle Bin'], ['data', '💾', 'Data'],
  ];
  const fdrafts = {};

  const lab = (t, el, hint) => h('label', t, el, hint ? h('small.muted', hint) : null);
  const sel = (value, options, onchange) => h('select', { onchange: onchange ? (e) => onchange(e.target.value) : null }, options.map(([v, l]) => h('option', { value: v, selected: String(value == null ? '' : value) === String(v) }, l)));
  const fieldsBrief = (obj) => DB.meta(obj).fields.filter((f) => !f.hidden && f.type !== 'json').map((f) => `${f.name} (${f.type === 'formula' ? 'formula ' + (f.format || 'text') : f.type}${f.options ? ': ' + f.options.slice(0, 8).join('|') : ''}${f.type === 'lookup' ? ' → ' + [].concat(f.ref).join('/') : ''})`).join(', ');

  // ---------- ✨ helpers ----------

  async function aiFormula(obj, words, format) {
    let last = null;
    for (let tries = 0; tries < 2; tries++) {
      const r = await Einstein.ask({ task: 'formula',
        system: `You write Salesforce-style formulas. Functions available: ${FUNCS}. Operators: + - * / & (text join) = <> < > <= >= && ||. Strings in double quotes. Refer to fields by API name; parent fields as Lookup.Field without the Id suffix (e.g. Account.Industry). Date - date gives days.`,
        prompt: `Object ${obj} fields: ${fieldsBrief(obj)}\n\nWrite a formula returning ${format || 'a value'} for: ${words}${last ? `\n\nYour last try "${last.expr}" failed: ${last.error}. Fix it.` : ''}`,
        schema: Einstein.S.obj({ expr: Einstein.S.str('the formula'), format: Einstein.S.oneOf(['text', 'number', 'currency', 'percent', 'date', 'checkbox']), label: Einstein.S.str('a short field label'), explain: Einstein.S.str('one sentence on how it works') }) });
      const c = Formula.check(r.expr, obj);
      if (c.ok) return Object.assign(r, { sample: c.sample, sampleId: c.sampleId });
      last = { expr: r.expr, error: c.error };
    }
    throw new Error(`${Einstein.word()}'s formula didn't check out: ${last.error}`);
  }

  async function aiObject(words) {
    const r = await Einstein.ask({ task: 'object-design',
      prompt: `Design a custom object for a CRM (company: ${DB.org().company}) from this request: ${words}\nExisting objects: ${DB.objects().join(', ')}\nGive 4–9 useful fields (not Name or Owner; those are automatic). Lookups may point to an existing object. Picklists need options.`,
      schema: Einstein.S.obj({ label: Einstein.S.str('singular label'), plural: Einstein.S.str(), icon: Einstein.S.str('one emoji'), description: Einstein.S.str(),
        fields: Einstein.S.arr(Einstein.S.obj({ label: Einstein.S.str(), type: Einstein.S.oneOf(FIELD_TYPES.filter((t) => t[0] !== 'formula').map((t) => t[0])), options: Einstein.S.arr(Einstein.S.str()), ref: Einstein.S.str('object for lookups, else empty'), help: Einstein.S.str() })),
        sample: Einstein.S.arr(Einstein.S.obj({ Name: Einstein.S.str(), values: Einstein.S.str('JSON object of field label → value') }), 'up to 5 sample records') }) });
    return r;
  }

  async function aiFlow(words) {
    const objs = DB.objects().filter((o) => !DB.meta(o).hidden);
    const r = await Einstein.ask({ task: 'flow-design',
      system: 'You design record-triggered automation flows for a CRM. Merge fields look like {!FieldName} or {!Account.Name}. Use only fields listed for the chosen object.',
      prompt: `Objects: ${objs.join(', ')}\nFilter operators: ${Filters.OPS.map((o) => o[0]).join(', ')}\nAction types: update (field, value), task (subject, days, priority), slack (channel name without #, text), chatter (text), email (subject, body), ai (prompt, field — AI writes the field).\nSlack channels: ${DB.org().slack.channels.map((c) => c.name).join(', ')}\n\nFields by object:\n${objs.slice(0, 30).map((o) => `${o}: ${fieldsBrief(o)}`).join('\n')}\n\nBuild a flow for: ${words}`,
      schema: Einstein.S.obj({ name: Einstein.S.str(), object: Einstein.S.str(), trigger: Einstein.S.oneOf(['create', 'update', 'both']), description: Einstein.S.str('one sentence'),
        conditions: Einstein.S.arr(Einstein.S.obj({ field: Einstein.S.str(), op: Einstein.S.str(), value: Einstein.S.str() })),
        actions: Einstein.S.arr(Einstein.S.obj({ type: Einstein.S.oneOf(ACTIONS.map((a) => a[0])), field: Einstein.S.str(), value: Einstein.S.str(), subject: Einstein.S.str(), body: Einstein.S.str(), text: Einstein.S.str(), channel: Einstein.S.str(), days: Einstein.S.num(), priority: Einstein.S.str(), prompt: Einstein.S.str() })) }) });
    if (!DB.meta(r.object)) throw new Error(`${Einstein.word()} picked an object that doesn't exist (${r.object}).`);
    const conditions = (r.conditions || []).map((c) => { const f = Filters.fieldOf(r.object, c.field); return f ? [c.field, c.op, Filters.coerce(f, c.op, c.value)] : null; }).filter(Boolean);
    const actions = (r.actions || []).map((a) => {
      const m = DB.meta(r.object);
      switch (a.type) {
        case 'update': return m.field[a.field] ? { type: 'update', field: a.field, value: Filters.coerce(m.field[a.field], 'eq', a.value) } : null;
        case 'task': return { type: 'task', subject: a.subject || a.text, days: a.days || 1, priority: a.priority || 'Normal' };
        case 'slack': return { type: 'slack', channel: String(a.channel || 'general').replace(/^#/, ''), text: a.text };
        case 'chatter': return { type: 'chatter', text: a.text };
        case 'email': return { type: 'email', subject: a.subject, body: a.body || a.text };
        case 'ai': return m.field[a.field] ? { type: 'ai', prompt: a.prompt || a.text, field: a.field } : null;
        default: return null;
      }
    }).filter(Boolean);
    return { name: r.name, object: r.object, trigger: r.trigger, description: r.description, conditions, actions, active: false, ai: words };
  }

  // ---------- pages ----------

  function home() {
    const o = DB.org();
    const tile = (id, icon, title, sub) => h('a.setuptile', { href: '#/setup/' + id }, h('span.st-ic', icon), h('b', title), h('small', sub));
    return h('div',
      h('h1', 'Setup Home'), h('p.muted', `Everything about how ${o.company}'s Stratus org works — objects, automation, people, AI and data.`),
      h('div.setuptiles',
        tile('objects', '🧱', 'Object Manager', `${DB.objects().length} objects · ${Object.values(o.custom.fields).reduce((n, l) => n + l.length, 0)} custom fields`),
        tile('flows', '⚡', 'Flows', `${o.flows.filter((f) => f.active).length} active of ${o.flows.length}`),
        tile('runs', '📜', 'Flow Runs', `${o.flowRuns.length} recent runs`),
        tile('users', '👥', 'Users', `${DB.all('User').length} users · you are ${(DB.me() || {}).Name}`),
        tile('trust', '🛡', 'Einstein Trust Layer', Einstein.trust().mask ? 'Masking on' : 'Masking off'),
        tile('audit', '🔎', 'AI Audit Trail', `${o.agentLog.length} AI calls logged`),
        tile('bin', '🗑', 'Recycle Bin', `${o.bin.length} deleted items`),
        tile('data', '💾', 'Data', `${Object.values(o.records).reduce((n, r) => n + r.length, 0)} records`)),
      UI.card('Setup Assistant', h('div',
        h('p.muted', 'Tell Einstein what you need. It builds the object or flow as a draft for you to check.'),
        h('div.btnrow',
          h('button.btn.ai', { onclick: () => newObject(true) }, '✨ Design a custom object'),
          h('button.btn.ai', { onclick: () => Shell.go('#/setup/flows/new?ai=1') }, '✨ Describe a flow'),
          h('button.btn.ai', { onclick: () => Shell.go('#/setup/objects/Opportunity?ai=1') }, '✨ Write a formula field'))), { icon: '✨' }));
  }

  // Object Manager
  function objects() {
    const list = DB.objects().map(DB.meta);
    return h('div',
      h('div.pagehead', h('h1', 'Object Manager'), h('div.grow'), h('button.btn.ai', { onclick: () => newObject(true) }, '✨ Design with AI'), h('button.btn.primary', { onclick: () => newObject(false) }, 'New custom object')),
      h('div.tablewrap', h('table.grid', h('thead', h('tr', ['Object', 'API name', 'Type', 'Fields', 'Records', 'Apps'].map((x) => h('th', x)))),
        h('tbody', list.map((m) => h('tr', h('td.namecell', UI.icon(m.name, 22), ' ', h('a.reclink', { href: '#/setup/objects/' + m.name }, m.label)), h('td', h('code', m.name)),
          h('td', m.custom ? UI.badge('Custom', '#3ba4a4') : 'Standard'), h('td', m.fields.length), h('td', DB.all(m.name).length), h('td.muted', (m.apps || []).join(', ')))))))) ;
  }

  function newObject(withAi) {
    const label = h('input', { placeholder: 'e.g. Site Survey' });
    const plural = h('input', { placeholder: 'e.g. Site Surveys' });
    const icon = h('input', { value: '🧩', maxLength: 4, style: { width: '64px' } });
    const desc = h('textarea', { rows: 2 });
    const words = h('input.aiq', { placeholder: 'e.g. “track solar site surveys: roof type, shading, panels that fit, surveyor, survey date”' });
    let fields = [], sample = [];
    const fieldBox = h('div.fieldpreview');
    const drawFields = () => fieldBox.replaceChildren(fields.length ? h('table.grid.compact', h('tbody', fields.map((f, i) => h('tr', h('td', h('b', f.label)), h('td', TYPE_LABEL[f.type] || f.type),
      h('td.muted', f.options ? f.options.join(', ') : f.ref || ''), h('td.act', h('button.iconbtn.sm', { onclick: () => { fields.splice(i, 1); drawFields(); } }, '×')))))) : h('p.muted.sm', 'Fields can be added after the object is made.'));
    const go = h('button.btn.ai', { onclick: async () => {
      if (!words.value.trim()) return words.focus();
      go.disabled = true; go.replaceChildren(h('span.spinner.sm'), ` ${Einstein.word()}…`);
      try {
        const r = await aiObject(words.value.trim());
        label.value = r.label; plural.value = r.plural; icon.value = r.icon || '🧩'; desc.value = r.description || '';
        fields = (r.fields || []).map((f) => ({ label: f.label, type: f.type, options: ['picklist', 'multipicklist'].includes(f.type) ? (f.options || []).filter(Boolean) : undefined, ref: f.type === 'lookup' && DB.meta(f.ref) ? f.ref : undefined, help: f.help || undefined }))
          .filter((f) => f.type !== 'lookup' || f.ref);
        sample = r.sample || [];
        drawFields();
      } catch (e) { UI.toast(e.message, 'err'); }
      go.disabled = false; go.replaceChildren('✨ Design');
    } }, '✨ Design');
    drawFields();
    UI.modal({ title: 'New custom object', wide: true,
      body: h('div', withAi ? h('div.aibar', h('span.aibar-ic', '✨'), words, go) : null,
        h('div.form-grid', lab('Label', label), lab('Plural label', plural), lab('Icon', icon), lab('Description', desc)), h('h4', 'Fields'), fieldBox),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Create object', primary: true, run: () => {
        if (!label.value.trim()) { UI.toast('Give it a label', 'err'); return false; }
        try {
          const defs = fields;
          const api = DB.addObject({ label: label.value.trim(), plural: plural.value.trim() || undefined, icon: icon.value.trim() || '🧩', description: desc.value.trim(), apps: ['sales'], fields: [] });
          for (const f of defs) { try { DB.addField(api, f); } catch (e) { /* duplicate label — skip */ } }
          const m = DB.meta(api);
          for (const s of sample.slice(0, 5)) {
            let vals = {};
            try { vals = JSON.parse(s.values || '{}'); } catch (e) { vals = {}; }
            const rec = { Name: s.Name };
            for (const [k, v] of Object.entries(vals)) { const f = m.fields.find((x) => x.label.toLowerCase() === k.toLowerCase() || x.name === k); if (f && f.type !== 'lookup') rec[f.name] = Filters.coerce(f, 'eq', v); }
            try { DB.insert(api, rec); } catch (e) { /* sample didn't validate — skip */ }
          }
          UI.toast(`${m.label} created${sample.length ? ' with sample records' : ''}`, 'ok', { label: 'Open tab', run: () => Shell.go(Shell.objUrl(api)) });
          Shell.go('#/setup/objects/' + api);
        } catch (e) { UI.toast(e.message, 'err'); return false; }
      } }] });
  }

  function objectPage(obj, ctx) {
    const m = DB.meta(obj);
    if (!m) return UI.empty('🧱', 'Object not found');
    if (ctx.params.ai && !fdrafts.opened) { fdrafts.opened = true; setTimeout(() => fieldDialog(obj, true), 50); }
    const custom = (DB.org().custom.fields[obj] || []).map((f) => f.name);
    return h('div',
      h('div.pagehead', UI.icon(obj, 40), h('div', h('div.eyebrow', 'Object Manager'), h('h1', m.label), h('code.muted', m.name)), h('div.grow'),
        h('a.btn', { href: Shell.objUrl(obj) }, 'Open tab'),
        h('button.btn.ai', { onclick: () => fieldDialog(obj, true) }, '✨ Formula from words'),
        h('button.btn.primary', { onclick: () => fieldDialog(obj, false) }, 'New field'),
        m.custom ? h('button.btn.danger', { onclick: async () => { if (await UI.confirm(`Delete ${m.label}?`, `This removes the object and all ${DB.all(obj).length} of its records. It can't be undone.`)) { DB.removeObject(obj); Shell.go('#/setup/objects'); } } }, 'Delete object') : null),
      m.description ? h('p.muted', m.description) : null,
      h('div.tablewrap', h('table.grid', h('thead', h('tr', ['Field label', 'API name', 'Type', 'Details', ''].map((x) => h('th', x)))),
        h('tbody', m.fields.filter((f) => !f.hidden).map((f) => h('tr',
          h('td', h('b', f.label), f.required ? h('span.req', ' *') : null, custom.includes(f.name) ? ' ' : null, custom.includes(f.name) ? UI.badge('Custom', '#3ba4a4') : null),
          h('td', h('code', f.name)),
          h('td', TYPE_LABEL[f.type] || f.type, f.type === 'formula' && f.format ? ` (${f.format})` : '', f.type === 'lookup' ? ` → ${[].concat(f.ref).join(', ')}` : ''),
          h('td.muted', f.type === 'formula' ? h('code', f.expr || 'built in') : f.options ? f.options.join(', ') : f.help || ''),
          h('td.act', custom.includes(f.name) ? h('button.iconbtn.sm', { title: 'Delete field', onclick: async () => { if (await UI.confirm(`Delete ${f.label}?`, 'Its values are removed from every record.')) DB.removeField(obj, f.name); } }, '🗑') : null))))))) ;
  }

  function fieldDialog(obj, ai) {
    const label = h('input', { placeholder: 'e.g. Days to Close' });
    const help = h('input', { placeholder: 'Optional hover text' });
    const opts = h('textarea', { rows: 3, placeholder: 'One option per line' });
    const refSel = sel('Account', DB.objects().map((o) => [o, DB.meta(o).label]));
    const fmtSel = sel('number', [['text', 'Text'], ['number', 'Number'], ['currency', 'Currency'], ['percent', 'Percent'], ['date', 'Date'], ['checkbox', 'Checkbox']]);
    const expr = h('textarea.code', { rows: 3, placeholder: 'e.g. CloseDate - TODAY()' });
    const out = h('div.formula-out');
    const required = h('input', { type: 'checkbox' });
    const extra = h('div');
    const typeSel = sel(ai ? 'formula' : 'text', FIELD_TYPES, () => drawExtra());
    const check = () => {
      if (!expr.value.trim()) { out.replaceChildren(); return null; }
      const c = Formula.check(expr.value.trim(), obj);
      out.replaceChildren(c.ok ? h('span.ok', '✓ No syntax errors', c.sampleId ? ` · on ${DB.name(c.sampleId)} it gives “${c.sample == null ? 'blank' : c.sample}”` : '') : h('span.err', '✗ ' + c.error));
      return c;
    };
    const words = h('input.aiq', { placeholder: 'Describe it — e.g. “days until close, negative when overdue”' });
    const go = h('button.btn.ai', { onclick: async () => {
      if (!words.value.trim()) return words.focus();
      go.disabled = true; go.replaceChildren(h('span.spinner.sm'), ` ${Einstein.word()}…`);
      try {
        const r = await aiFormula(obj, words.value.trim(), typeSel.value === 'formula' ? fmtSel.value : null);
        typeSel.value = 'formula'; drawExtra();
        expr.value = r.expr; fmtSel.value = r.format || 'text';
        if (!label.value) label.value = r.label || '';
        check();
        out.append(h('div.muted.sm', '✨ ' + (r.explain || '')));
      } catch (e) { UI.toast(e.message, 'err'); }
      go.disabled = false; go.replaceChildren('✨ Write it');
    } }, '✨ Write it');
    expr.addEventListener('input', debounce(check, 300));
    function drawExtra() {
      const t = typeSel.value;
      extra.replaceChildren(
        ['picklist', 'multipicklist'].includes(t) ? lab('Options', opts) : null,
        t === 'lookup' ? lab('Related to', refSel) : null,
        t === 'formula' ? h('div', lab('Returns', fmtSel), lab('Formula', expr, `Fields by API name; parent fields like Account.Industry. Functions: ${FUNCS}.`), out) : null);
    }
    drawExtra();
    UI.modal({ title: `New field on ${DB.meta(obj).label}`, wide: true,
      body: h('div', h('div.aibar', h('span.aibar-ic', '✨'), words, go),
        h('div.form-grid', lab('Field label', label), lab('Type', typeSel), lab('Help text', help), h('label.check', required, 'Required')), extra),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Save field', primary: true, run: () => {
        const t = typeSel.value;
        if (!label.value.trim()) { UI.toast('Give the field a label', 'err'); return false; }
        const def = { label: label.value.trim(), type: t, help: help.value.trim() || undefined, required: required.checked || undefined };
        if (['picklist', 'multipicklist'].includes(t)) { def.options = opts.value.split('\n').map((x) => x.trim()).filter(Boolean); if (!def.options.length) { UI.toast('Add at least one option', 'err'); return false; } }
        if (t === 'lookup') def.ref = refSel.value;
        if (t === 'formula') { const c = check(); if (!c || !c.ok) { UI.toast('Fix the formula first', 'err'); return false; } def.expr = expr.value.trim(); def.format = fmtSel.value; def.readonly = true; }
        try { DB.addField(obj, def); UI.toast(`${def.label} added`); } catch (e) { UI.toast(e.message, 'err'); return false; }
      } }] });
  }

  // Flows
  function flows() {
    const list = DB.cfg.list('flows');
    const runs = DB.org().flowRuns;
    return h('div',
      h('div.pagehead', h('h1', 'Flows'), h('div.grow'), h('button.btn.ai', { onclick: () => Shell.go('#/setup/flows/new?ai=1') }, '✨ Describe a flow'), h('button.btn.primary', { onclick: () => Shell.go('#/setup/flows/new') }, 'New flow')),
      h('p.muted', 'Record-triggered flows run when a record is created or updated and meets the conditions.'),
      h('div.flowlist', list.map((f) => h('div.flowcard',
        h('div.fc-top', h('span.fc-ic', f.actions.some((a) => a.type === 'ai') ? '✨' : '⚡'), h('div.grow', h('a.reclink', { href: '#/setup/flows/' + f.id }, h('b', f.name)), h('small', `${DB.meta(f.object) ? DB.meta(f.object).label : f.object} · ${f.trigger === 'both' ? 'created or updated' : f.trigger === 'create' ? 'created' : 'updated'}`)),
          h('label.switch', { title: f.active ? 'Active' : 'Inactive' }, h('input', { type: 'checkbox', checked: !!f.active, onchange: (e) => { DB.cfg.update('flows', f.id, { active: e.target.checked }); UI.toast(`${f.name} ${e.target.checked ? 'activated' : 'deactivated'}`); } }), h('span.slider'))),
        h('p', f.description || ''),
        h('div.fc-foot', h('span.muted.sm', `${f.actions.length} action${f.actions.length === 1 ? '' : 's'} · ${runs.filter((r) => r.flowId === f.id).length} runs`), h('div.grow'),
          h('button.iconbtn.sm', { title: 'Delete', onclick: async () => { if (await UI.confirm(`Delete ${f.name}?`, 'Its run history stays.')) DB.cfg.remove('flows', f.id); } }, '🗑'))))));
  }

  function flowEditor(id, ctx) {
    const isNew = id === 'new';
    const src = isNew ? null : DB.cfg.get('flows', id);
    if (!isNew && !src) return UI.empty('⚡', 'Flow not found');
    const d = fdrafts[id] || (fdrafts[id] = src ? JSON.parse(JSON.stringify(src)) : { name: 'New flow', object: 'Opportunity', trigger: 'both', conditions: [], actions: [], active: false, description: '' });
    const root = h('div.flowedit');
    const draw = () => {
      const m = DB.meta(d.object);
      const fieldOpts = m.fields.filter((f) => !f.readonly && !f.system && f.type !== 'formula').map((f) => [f.name, f.label]);
      const actionBody = (a, i) => {
        const set = (k) => (e) => { a[k] = e.target.type === 'number' ? Number(e.target.value) : e.target.value; };
        const inp = (k, ph, type) => h('input', { value: a[k] == null ? '' : a[k], placeholder: ph, type: type || 'text', oninput: set(k) });
        const ta = (k, ph) => h('textarea', { rows: 2, placeholder: ph, oninput: set(k) }, a[k] || '');
        switch (a.type) {
          case 'update': return [lab('Field', sel(a.field, fieldOpts, (v) => { a.field = v; })), lab('New value', inp('value', 'Value or {!Merge.Field}'))];
          case 'task': return [lab('Subject', inp('subject', 'Call {!Name}')), lab('Due in (days)', inp('days', '1', 'number')), lab('Priority', sel(a.priority || 'Normal', [['Low', 'Low'], ['Normal', 'Normal'], ['High', 'High']], (v) => { a.priority = v; }))];
          case 'slack': return [lab('Channel', sel(a.channel || 'general', DB.org().slack.channels.map((c) => [c.name, '#' + c.name]), (v) => { a.channel = v; })), lab('Message', ta('text', '🎉 {!Name} …'))];
          case 'chatter': return [lab('Post', ta('text', 'Posted on the record feed'))];
          case 'email': return [lab('Subject', inp('subject', 'About {!Name}')), lab('Body', ta('body', 'Hi {!Contact.Name}, …'))];
          case 'ai': return [lab('Instruction', ta('prompt', 'Summarize this record in two sentences…')), lab('Write into', sel(a.field, m.fields.filter((f) => ['text', 'textarea'].includes(f.type) && !f.system).map((f) => [f.name, f.label]), (v) => { a.field = v; }))];
          default: return [];
        }
      };
      root.replaceChildren(
        h('div.form-grid.flowprops', lab('Flow name', h('input', { value: d.name, oninput: (e) => { d.name = e.target.value; } })),
          lab('Object', sel(d.object, DB.objects().filter((o) => !DB.meta(o).hidden).map((o) => [o, DB.meta(o).label]), (v) => { d.object = v; d.conditions = []; d.actions = d.actions.filter((a) => !['update', 'ai'].includes(a.type)); draw(); })),
          lab('Runs when a record is', sel(d.trigger, [['create', 'Created'], ['update', 'Updated'], ['both', 'Created or updated']], (v) => { d.trigger = v; })),
          lab('Description', h('input', { value: d.description || '', oninput: (e) => { d.description = e.target.value; } }))),
        h('div.canvas',
          h('div.node.start', h('b', '▶ Start'), h('small', `When a ${m.label} is ${d.trigger === 'both' ? 'created or updated' : d.trigger + 'd'}`)),
          h('div.wire'),
          h('div.node.cond', h('b', '◆ Conditions'),
            d.conditions.length ? h('div.chips', d.conditions.map((c, i) => h('span.fchip', Filters.text(d.object, c), h('button.x', { onclick: () => { d.conditions.splice(i, 1); draw(); } }, '×')))) : h('small.muted', 'Every record'),
            h('button.link', { onclick: () => Filters.editor(d.object, (c) => { d.conditions.push(c); draw(); }) }, '+ Add condition')),
          d.actions.map((a, i) => [h('div.wire'), h(`div.node.act${a.type === 'ai' ? '.ai' : ''}`,
            h('div.node-head', h('b', (ACTIONS.find((x) => x[0] === a.type) || [0, a.type])[1]), h('div.grow'),
              h('button.iconbtn.sm', { disabled: i === 0, onclick: () => { d.actions.splice(i - 1, 0, d.actions.splice(i, 1)[0]); draw(); }, title: 'Move up' }, '↑'),
              h('button.iconbtn.sm', { onclick: () => { d.actions.splice(i, 1); draw(); }, title: 'Remove' }, '×')),
            h('div.form-grid', actionBody(a, i)))]),
          h('div.wire'),
          h('div.node.add', h('button.btn.sm', { onclick: (e) => UI.menu(e.currentTarget, ACTIONS.map(([t, l]) => ({ label: l, run: () => { d.actions.push({ type: t, field: t === 'update' ? fieldOpts[0] && fieldOpts[0][0] : t === 'ai' ? 'Description' : undefined, days: t === 'task' ? 1 : undefined }); draw(); } }))) }, '+ Add action')),
          h('div.wire'), h('div.node.end', '■ End')),
        h('p.muted.sm', 'Merge fields: {!FieldName}, {!Account.Name}, {!Owner.Name}, {!$User.Name}.'));
    };
    draw();
    const ask = h('input.aiq', { placeholder: 'Describe the automation — e.g. “when a case is escalated, tell #support-escalations and give the owner a task due today”' });
    const go = h('button.btn.ai', { onclick: async () => {
      if (!ask.value.trim()) return ask.focus();
      go.disabled = true; go.replaceChildren(h('span.spinner.sm'), ` ${Einstein.word()}…`);
      try { Object.assign(d, await aiFlow(ask.value.trim())); draw(); UI.toast('Flow drafted — check it, then save and activate', 'ai'); }
      catch (e) { UI.toast(e.message, 'err'); }
      go.disabled = false; go.replaceChildren('✨ Build');
    } }, '✨ Build');
    if (ctx.params.ai) setTimeout(() => ask.focus(), 50);
    const save = (activate) => {
      if (!d.name.trim()) { UI.toast('Give the flow a name', 'err'); return; }
      if (!d.actions.length) { UI.toast('Add at least one action', 'err'); return; }
      const clean = Object.assign({}, d, { active: activate == null ? !!d.active : activate });
      const f = isNew ? DB.cfg.add('flows', clean) : DB.cfg.update('flows', id, clean);
      delete fdrafts[id];
      UI.toast(clean.active ? 'Flow saved and active' : 'Flow saved (inactive)');
      Shell.go('#/setup/flows/' + f.id);
    };
    return h('div',
      h('div.pagehead', h('div', h('div.eyebrow', 'Flow Builder'), h('h1', isNew ? 'New flow' : d.name)), h('div.grow'),
        h('button.btn', { onclick: () => { delete fdrafts[id]; Shell.go('#/setup/flows'); } }, 'Cancel'),
        d.active ? h('button.btn', { onclick: () => save(false) }, 'Deactivate') : h('button.btn', { onclick: () => save(null) }, 'Save'),
        h('button.btn.primary', { onclick: () => save(true) }, d.active ? 'Save' : 'Save & Activate')),
      h('div.aibar', h('span.aibar-ic', '✨'), ask, go),
      root,
      !isNew ? UI.card('Recent runs', runsTable(DB.org().flowRuns.filter((r) => r.flowId === id).slice(0, 15)), { icon: '📜' }) : null);
  }

  function runsTable(runs) {
    if (!runs.length) return h('p.muted.pad', 'No runs yet. Flows run when records change.');
    return h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', ['When', 'Flow', 'Record', 'Result', 'Steps'].map((x) => h('th', x)))),
      h('tbody', runs.map((r) => h('tr', h('td', fmt.ago(r.at)), h('td', h('a.reclink', { href: '#/setup/flows/' + r.flowId }, r.flow)),
        h('td', DB.get(r.recordId) ? h('a.reclink', { href: '#/r/' + r.recordId }, DB.name(r.recordId)) : h('span.muted', 'deleted')),
        h('td', r.ok ? h('span.ok', '✓ Done') : h('span.err', '✗ Error')), h('td.muted', r.steps.join(' · ')))))));
  }

  function users() {
    const me = DB.org().me;
    return h('div', h('div.pagehead', h('h1', 'Users'), h('div.grow'), h('button.btn.primary', { onclick: () => Form.open('User', {}) }, 'New user')),
      h('p.muted', 'Log in as someone else to see Stratus the way they do — their home page, their records, their quota.'),
      h('div.tablewrap', h('table.grid', h('thead', h('tr', ['Name', 'Title', 'Role', 'Email', 'Quota', ''].map((x) => h('th', x)))),
        h('tbody', DB.all('User').map((u) => h(`tr${u.Id === me ? '.selected' : ''}`, h('td.namecell', UI.avatar(u.Name, 24), ' ', h('a.reclink', { href: '#/r/' + u.Id }, u.Name)),
          h('td', u.Title || ''), h('td', u.Role || ''), h('td.muted', u.Email || ''), h('td', u.Quota ? fmt.short(u.Quota) : ''),
          h('td.act', u.Id === me ? UI.badge('You') : h('button.btn.sm', { onclick: () => { DB.setMe(u.Id); UI.toast(`Logged in as ${u.Name}`); Shell.go('#/home'); } }, 'Log in as'))))))));
  }

  function trust() {
    const t = Einstein.trust();
    const set = (k) => (e) => { DB.org().prefs.trust = Object.assign({}, t, { [k]: e.target.checked }); DB.save(); Shell.render(); };
    const toggle = (k, title, detail) => h('div.trustrow', h('label.switch', h('input', { type: 'checkbox', checked: !!t[k], onchange: set(k) }), h('span.slider')), h('div', h('b', title), h('p.muted', detail)));
    const sample = Einstein.mask('Email maria.lopez@example.com or call (415) 555-0134 about the install.');
    return h('div', h('h1', 'Einstein Trust Layer'),
      h('p.muted', `What happens to your data on the way to ${Einstein.state().label}. Stratus has no servers — prompts go straight from this Mac to the AI you picked in Settings.`),
      UI.card('Controls', h('div',
        toggle('mask', 'Mask personal data', 'Emails and phone numbers are swapped for placeholders before a prompt leaves the app, and swapped back in the answer.'),
        toggle('audit', 'Keep an audit trail', 'Every AI call is logged with its task, model, time and the masked prompt. See AI Audit Trail.')), { icon: '🛡' }),
      UI.card('How masking looks', h('div', h('p', h('b', 'You write: '), 'Email maria.lopez@example.com or call (415) 555-0134 about the install.'), h('p', h('b', 'The AI sees: '), h('code', sample.text))), { icon: '🙈' }),
      UI.card('Grounding', h('p.muted', 'Einstein only sees the records a feature needs (the record you are on, the rows in a list, the numbers in a report), and every answer that names a record links to it so you can check.'), { icon: '⚓' }));
  }

  function audit() {
    const log = DB.org().agentLog;
    return h('div', h('div.pagehead', h('h1', 'AI Audit Trail'), h('div.grow'),
      log.length ? h('button.btn', { onclick: () => window.host.exportFile('stratus-ai-audit.json', JSON.stringify(log, null, 2)) }, 'Export') : null,
      log.length ? h('button.btn.danger', { onclick: async () => { if (await UI.confirm('Clear the audit trail?', `${log.length} entries will be removed.`, 'Clear')) { log.length = 0; DB.save(); Shell.render(); } } }, 'Clear') : null),
    h('p.muted', Einstein.trust().audit ? 'Every AI call, newest first.' : 'The audit trail is off — turn it on in Einstein Trust Layer.'),
    log.length ? h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', ['When', 'Feature', 'Model', 'Time', 'Masked', 'Result', ''].map((x) => h('th', x)))),
      h('tbody', log.slice(0, 200).map((e) => h('tr', h('td', fmt.ago(e.at)), h('td', h('code', e.task)), h('td', e.model ? `${e.word || ''} · ${e.model}` : '—'), h('td', e.ms ? (e.ms / 1000).toFixed(1) + 's' : ''),
        h('td', e.masked ? `${e.masked} item${e.masked > 1 ? 's' : ''}` : '—'), h('td', e.ok ? h('span.ok', '✓') : h('span.err', '✗ ' + (e.error || '').slice(0, 80))),
        h('td.act', h('button.link', { onclick: () => UI.modal({ title: `AI call · ${e.task}`, wide: true, body: h('pre.prompt', e.prompt || '(no prompt saved)') }) }, 'Prompt'))))))) : UI.empty('🔎', 'No AI calls yet', 'Use any ✨ button and it shows up here.'));
  }

  function bin() {
    const items = DB.org().bin;
    return h('div', h('div.pagehead', h('h1', 'Recycle Bin'), h('div.grow'),
      items.length ? h('button.btn.danger', { onclick: async () => { if (await UI.confirm('Empty the Recycle Bin?', "Deleted records can't come back after this.", 'Empty')) { items.length = 0; DB.save(); Shell.render(); } } }, 'Empty bin') : null),
    items.length ? h('div.tablewrap', h('table.grid', h('thead', h('tr', ['Record', 'Type', 'Deleted', 'By', 'Includes', ''].map((x) => h('th', x)))),
      h('tbody', items.map((b) => h('tr', h('td', h('b', b.name)), h('td', (DB.meta(b.obj) || {}).label || b.obj), h('td', fmt.ago(b.at)), h('td', DB.name(b.by)),
        h('td.muted', b.items.filter((x) => !x.clear).length > 1 ? `${b.items.filter((x) => !x.clear).length - 1} related records` : ''),
        h('td.act', h('button.btn.sm', { onclick: () => { if (DB.restore(b.id)) UI.toast(`Restored ${b.name}`); } }, 'Restore'))))))) : UI.empty('🗑', 'The Recycle Bin is empty'));
  }

  function data() {
    const o = DB.org();
    const counts = DB.objects().map((x) => [x, DB.all(x).length]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]);
    return h('div', h('h1', 'Data'),
      h('div.homegrid',
        UI.card('Records', h('table.grid.compact', h('tbody', counts.map(([x, n]) => h('tr', h('td', UI.icon(x, 18), ' ', DB.meta(x).plural), h('td.num', fmt.num(n)))))), { icon: '🗂' }),
        UI.card('Backup and reset', h('div',
          h('p.muted', `Your org lives in one file on this Mac. ${o.company} is made-up demo data — play freely.`),
          h('div.btnrow',
            h('button.btn', { onclick: () => window.host.exportFile('stratus-org.json', JSON.stringify(o)).then((ok) => ok && UI.toast('Org exported')) }, '⬇️ Export everything (JSON)'),
            h('button.btn.danger', { onclick: async () => { if (await window.host.resetOrg()) { DB.boot(null); UI.toast('Demo org reset'); Shell.go('#/home'); } } }, '↺ Reset demo data'))), { icon: '💾' })));
  }

  Views.setup = (parts, ctx) => {
    const page = parts[0] || 'home';
    let body;
    switch (page) {
      case 'objects': body = parts[1] ? objectPage(parts[1], ctx) : objects(); break;
      case 'flows': body = parts[1] ? flowEditor(parts[1], ctx) : flows(); break;
      case 'runs': body = h('div', h('h1', 'Flow Runs'), runsTable(DB.org().flowRuns.slice(0, 150))); break;
      case 'users': body = users(); break;
      case 'trust': body = trust(); break;
      case 'audit': body = audit(); break;
      case 'bin': body = bin(); break;
      case 'data': body = data(); break;
      default: body = home();
    }
    if (!(page === 'objects' && ctx.params.ai)) fdrafts.opened = false;
    return h('div.page.setuppage',
      h('nav.setupnav', h('div.eyebrow', '⚙︎ Setup'), NAV.map(([id, ic, l]) => h(`a${page === id ? '.on' : ''}`, { href: '#/setup/' + id }, h('span', ic), l))),
      h('div.setupbody', { dataset: { scroll: 'setup-' + page } }, body));
  };
})();
