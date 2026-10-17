// form.js — field widgets (one input per field type, a typeahead for lookups, read-only display) and
// the New / Edit record dialog. "✨ Fill from text" reads a pasted email signature, note or message and
// fills the fields for you.
//
//   Field.input(obj, field, value) → { el, get(), set(v), focus() }
//   Field.view(obj, field, rec)    → a node showing the value (links for lookups, pills for scores…)
//   Form.open('Contact', { record?, defaults?, title?, onSave(rec) })

const SCORE_FIELDS = new Set(['Score', 'WinScore', 'HealthScore']);
const scoreColor = (n) => (n >= 70 ? '#2e844a' : n >= 45 ? '#dd7a01' : '#c23934');

const Field = (() => {
  const toLocal = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fromLocal = (v) => (v ? new Date(v).toISOString() : null);
  const editable = (f) => !(f.readonly || f.system || ['formula', 'rollup', 'autonumber', 'json', 'id'].includes(f.type) || f.hidden);

  function lookup(f, value, onChange) {
    const refs = [].concat(f.ref);
    let cur = value || null;
    let obj = (cur && DB.objectOf(cur)) || refs[0];
    const wrap = h('div.lookup');
    const drop = h('div.ldrop');
    const input = h('input', { type: 'text', autocomplete: 'off' });
    const picker = refs.length > 1 ? h('select.lk-obj', { onchange: () => { obj = picker.value; input.placeholder = `Search ${DB.meta(obj).plural}…`; input.focus(); } },
      refs.map((r) => h('option', { value: r, selected: r === obj }, DB.meta(r).label))) : null;
    let rows = [], sel = 0;
    const set = (id) => { cur = id || null; if (cur) obj = DB.objectOf(cur) || obj; draw(); onChange && onChange(cur); };
    function results() {
      const q = input.value.trim();
      if (q) return DB.search(q, { objectsOnly: [obj], limit: 8 }).map((r) => r.rec);
      const recent = DB.org().recent.filter((id) => DB.objectOf(id) === obj).map(DB.get).filter(Boolean);
      const more = DB.query(obj, { sort: DB.meta(obj).nameField, limit: 8 });
      return uniq([...recent, ...more]).slice(0, 8);
    }
    function list() {
      rows = results();
      sel = clamp(sel, 0, rows.length);
      const m = DB.meta(obj);
      drop.replaceChildren(...rows.map((r, i) => h(`button.lrow${i === sel ? '.sel' : ''}`, { type: 'button', onmousedown: (e) => { e.preventDefault(); set(r.Id); } },
        UI.icon(obj, 20), h('span', DB.name(r.Id)), h('small', (m.compact || []).slice(0, 2).map((c) => (m.field[c] && m.field[c].type === 'lookup' ? DB.name(r[c]) : DB.display(obj, c, r[c]))).filter(Boolean).join(' · ')))),
      obj !== 'User' ? h(`button.lrow.new${sel === rows.length ? '.sel' : ''}`, { type: 'button', onmousedown: (e) => { e.preventDefault(); createNew(); } }, '＋ New ', m.label, input.value.trim() ? ` “${input.value.trim()}”` : '') : null);
      drop.classList.add('open');
    }
    function createNew() {
      const m = DB.meta(obj);
      const q = input.value.trim();
      const defaults = {};
      if (q) {
        if (m.field.LastName) { const parts = q.split(/\s+/); defaults.LastName = parts.pop(); defaults.FirstName = parts.join(' '); }
        else defaults[m.nameField] = q;
      }
      drop.classList.remove('open');
      Form.open(obj, { defaults, onSave: (r) => set(r.Id) });
    }
    function draw() {
      if (cur && DB.get(cur)) {
        wrap.replaceChildren(h('div.lk-pill', UI.icon(DB.objectOf(cur), 20), h('span', DB.name(cur)),
          h('button.x', { type: 'button', title: 'Clear', onclick: () => { set(null); setTimeout(() => input.focus(), 0); } }, '×')));
      } else {
        input.value = '';
        input.placeholder = `Search ${DB.meta(obj).plural}…`;
        wrap.replaceChildren(picker || '', input, drop);
      }
    }
    input.addEventListener('focus', () => { sel = 0; list(); });
    input.addEventListener('input', () => { sel = 0; list(); });
    input.addEventListener('blur', () => setTimeout(() => drop.classList.remove('open'), 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, rows.length); list(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); list(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (sel < rows.length) set(rows[sel].Id); else createNew(); }
    });
    draw();
    return { el: wrap, get: () => cur, set, focus: () => input.focus() };
  }

  function input(obj, f, value, opts = {}) {
    const change = opts.onChange;
    const type = f.type;
    if (type === 'lookup') return lookup(f, value, change);
    if (type === 'checkbox') {
      const el = h('input', { type: 'checkbox', checked: !!value, onchange: () => change && change(el.checked) });
      return { el: h('label.check', el, h('span', opts.label || '')), get: () => el.checked, set: (v) => { el.checked = !!v && v !== 'false'; }, focus: () => el.focus() };
    }
    if (type === 'picklist') {
      const el = h('select', { onchange: () => change && change(el.value || null) }, h('option', { value: '' }, '--None--'),
        (f.options || []).map((o) => h('option', { value: o, selected: o === value }, o)));
      if (value && !(f.options || []).includes(value)) el.appendChild(h('option', { value, selected: true }, value));
      return { el, get: () => el.value || null, set: (v) => { if (v && ![...el.options].some((o) => o.value === v)) el.appendChild(h('option', { value: v }, v)); el.value = v || ''; }, focus: () => el.focus() };
    }
    if (type === 'multipicklist') {
      let cur = [].concat(value || []);
      const el = h('div.multi');
      const draw = () => el.replaceChildren(...(f.options || []).map((o) => h(`button.chip${cur.includes(o) ? '.on' : ''}`, { type: 'button',
        onclick: () => { cur = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]; draw(); change && change(cur); } }, o)));
      draw();
      return { el, get: () => cur.slice(), set: (v) => { cur = [].concat(v || []).filter((x) => (f.options || []).includes(x)); draw(); }, focus: () => {} };
    }
    if (type === 'textarea') {
      const el = h('textarea', { rows: opts.rows || 3, oninput: () => change && change(el.value) });
      el.value = value || '';
      return { el, get: () => el.value, set: (v) => { el.value = v == null ? '' : v; }, focus: () => el.focus() };
    }
    const map = { email: 'email', phone: 'tel', url: 'url', number: 'number', currency: 'number', percent: 'number', date: 'date', datetime: 'datetime-local' };
    const el = h('input', { type: map[type] || 'text', step: ['number', 'currency', 'percent'].includes(type) ? 'any' : null, oninput: () => change && change(read()) });
    const read = () => (type === 'datetime' ? fromLocal(el.value) : ['number', 'currency', 'percent'].includes(type) ? (el.value === '' ? null : Number(el.value)) : el.value);
    const write = (v) => { el.value = v == null ? '' : type === 'datetime' ? toLocal(v) : type === 'date' ? String(v).slice(0, 10) : v; };
    write(value);
    const wrapped = type === 'currency' ? h('div.affix', h('span', '$'), el) : type === 'percent' ? h('div.affix.after', el, h('span', '%')) : el;
    return { el: wrapped, get: read, set: write, focus: () => el.focus() };
  }

  const link = (id) => (id && DB.get(id) ? h('a.reclink', { href: '#/r/' + id }, DB.name(id)) : id ? h('span.muted', 'Deleted record') : '');

  function view(obj, f, rec) {
    if (typeof f === 'string') f = DB.meta(obj).field[f];
    if (!f) return '';
    const v = rec[f.name];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
    if (SCORE_FIELDS.has(f.name) && typeof v === 'number') return h('span.score', { style: { '--s': scoreColor(v) } }, String(v));
    switch (f.type) {
      case 'lookup': return String(v).startsWith('bot:') ? h('span', '⚡ ' + v.slice(4)) : link(v);
      case 'url': return h('a', { href: /^https?:/.test(v) ? v : 'https://' + v, target: '_blank' }, String(v).replace(/^https?:\/\//, ''));
      case 'email': return h('a.email', { href: '#', onclick: (e) => { e.preventDefault(); UI.copy(v); }, title: 'Copy' }, v);
      case 'checkbox': return h('span.tick', v ? '✓' : '');
      case 'picklist': return STATUS_COLORS[v] ? h('span.pill', { style: { '--c': STATUS_COLORS[v] } }, v) : String(v);
      case 'multipicklist': return h('span', [].concat(v).map((x) => h('span.chip.sm', x)));
      case 'textarea': return h('span.pre', String(v));
      default: return DB.display(obj, f, v);
    }
  }

  return { input, view, link, editable, toLocal, fromLocal };
})();

const Form = (() => {
  // The fields a form shows: editable ones in schema order, address-ish ones kept together.
  function fieldsFor(m, rec) {
    return m.fields.filter((f) => Field.editable(f) || (rec && ['autonumber', 'formula', 'rollup'].includes(f.type) && !f.hidden && rec[f.name] != null && f.type !== 'json'));
  }

  function open(obj, { record, defaults, title, onSave, focus } = {}) {
    const m = DB.meta(obj);
    const editing = !!record;
    const rec = Object.assign({}, defaults || {}, record || {});
    const widgets = {};
    const err = h('div.form-err');
    const grid = h('div.form-grid');
    for (const f of fieldsFor(m, record)) {
      if (!Field.editable(f)) {
        grid.appendChild(h('div.fld.ro', h('label', f.label), h('div.ro-v', Field.view(obj, f, rec) || '—')));
        continue;
      }
      const w = Field.input(obj, f, rec[f.name] !== undefined ? rec[f.name] : f.default, { label: '' });
      widgets[f.name] = w;
      grid.appendChild(h(`div.fld${f.type === 'textarea' ? '.wide' : ''}`, { dataset: { f: f.name } },
        h('label', f.required ? h('abbr', { title: 'required' }, '*') : null, f.label, f.help ? h('span.help', { title: f.help }, 'ⓘ') : null), w.el));
    }

    // ✨ Fill from text: paste a signature, email or note and the AI maps it onto these fields.
    const paste = h('textarea', { rows: 3, placeholder: `Paste an email signature, a message or notes about this ${m.label.toLowerCase()}…` });
    const fill = h('details.ai-fill', h('summary', '✨ Fill from text'),
      h('div.ai-fill-body', paste, Einstein.button('Fill the form', () => {
        const fields = Object.keys(widgets).map((n) => {
          const f = m.field[n];
          return `${n} (${f.label}, ${f.type}${f.options ? ': ' + f.options.join(' | ') : ''}${f.type === 'lookup' ? ', give the name of the ' + [].concat(f.ref).map((r) => DB.meta(r).label).join('/') : ''})`;
        });
        return {
          task: 'form-fill',
          system: 'You extract CRM field values from text. Only fill fields the text clearly supports; leave others out. Dates as YYYY-MM-DD.',
          prompt: `Object: ${m.label}\nFields:\n${fields.join('\n')}\n\nText:\n${paste.value}\n\nReply with "values": a list of {field, value} pairs using the field API names above.`,
          schema: Einstein.S.obj({ values: Einstein.S.arr(Einstein.S.obj({ field: Einstein.S.str('field API name'), value: Einstein.S.str('value as text') })) }),
        };
      }, (r) => {
        let n = 0;
        for (const { field, value } of r.values || []) {
          const w = widgets[field];
          const f = m.field[field];
          if (!w || value == null || value === '') continue;
          let v = value;
          if (f.type === 'lookup') {
            const hit = [].concat(f.ref).map((ref) => DB.search(String(value), { objectsOnly: [ref], limit: 1 })[0]).find(Boolean);
            if (!hit) continue;
            v = hit.rec.Id;
          } else if (['number', 'currency', 'percent'].includes(f.type)) { v = Number(String(value).replace(/[^0-9.-]/g, '')); if (isNaN(v)) continue; }
          else if (f.type === 'checkbox') v = /^(true|yes|1)$/i.test(value);
          else if (f.type === 'picklist') { v = (f.options || []).find((o) => o.toLowerCase() === String(value).toLowerCase()); if (!v) continue; }
          else if (f.type === 'multipicklist') v = String(value).split(/[;,]/).map((x) => x.trim());
          w.set(v);
          const box = $(`[data-f="${field}"]`, grid);
          if (box) { box.classList.add('filled'); setTimeout(() => box.classList.remove('filled'), 2400); }
          n++;
        }
        UI.toast(n ? `${Einstein.word()} filled ${n} field${n > 1 ? 's' : ''} — check them before saving` : 'Nothing in the text matched these fields', n ? 'ai' : 'info');
      })));

    function collect() {
      const data = {};
      for (const [n, w] of Object.entries(widgets)) data[n] = w.get();
      return data;
    }
    function save() {
      err.replaceChildren();
      $$('.fld.bad', grid).forEach((x) => x.classList.remove('bad'));
      const data = collect();
      try {
        const saved = editing ? DB.update(record.Id, data) : DB.insert(obj, Object.assign({}, defaults || {}, data));
        UI.toast(`${m.label} "${DB.name(saved.Id)}" was ${editing ? 'saved' : 'created'}.`);
        if (onSave) onSave(saved);
        return saved;
      } catch (e) {
        err.replaceChildren(h('b', 'Review the errors on this page. '), e.message);
        const bad = m.fields.find((f) => e.message.startsWith(f.label));
        if (bad) { const box = $(`[data-f="${bad.name}"]`, grid); if (box) { box.classList.add('bad'); box.scrollIntoView({ block: 'center' }); } }
        return null;
      }
    }
    const actions = [{ label: 'Cancel', run: () => {} }];
    if (!editing) actions.push({ label: 'Save & New', run: () => { if (save()) { dlg.close(); open(obj, { defaults, onSave }); } return false; } });
    actions.push({ label: 'Save', primary: true, run: () => {
      const s = save();
      if (!s) return false;
      if (!editing && !onSave) Shell.go('#/r/' + s.Id);
      return true;
    } });
    const dlg = UI.modal({ title: title || (editing ? `Edit ${DB.name(record.Id)}` : `New ${m.label}`), wide: true, body: h('div.form', err, fill, grid), actions });
    if (focus && widgets[focus]) setTimeout(() => widgets[focus].focus(), 50);
    return dlg;
  }

  // Edit / Delete / Clone, shared by list rows and record pages.
  async function remove(id, after) {
    const obj = DB.objectOf(id);
    const m = DB.meta(obj);
    const ok = await UI.confirm(`Delete ${m.label}?`, `"${DB.name(id)}" and anything that belongs only to it go to the Recycle Bin, where you can restore them.`);
    if (!ok) return;
    const entry = DB.remove(id);
    UI.toast(`${m.label} "${entry.name}" was deleted.`, 'ok', { label: 'Undo', run: () => { DB.restore(entry.id); UI.toast('Restored'); } });
    if (after) after();
  }
  function clone(id) {
    const obj = DB.objectOf(id);
    const m = DB.meta(obj);
    const src = DB.get(id);
    const copy = {};
    for (const f of m.fields) if (Field.editable(f) && src[f.name] != null) copy[f.name] = Array.isArray(src[f.name]) ? src[f.name].slice() : src[f.name];
    if (m.field[m.nameField] && Field.editable(m.field[m.nameField])) copy[m.nameField] = `${src[m.nameField]} (copy)`;
    open(obj, { defaults: copy, title: `Clone ${m.label}` });
  }

  return { open, remove, clone, fieldsFor };
})();
