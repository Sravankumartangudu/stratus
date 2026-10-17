// db.js — the org. Records, metadata, queries, the built-in "before save" automation, record-triggered
// Flows, field history, Chatter, Slack messages, reports and the Recycle Bin — all in memory, saved as
// one JSON file by the main process (a short debounce after every change).
//
// Records are plain objects keyed by API field names (Name, AccountId, StageName…) with Salesforce-style
// 15-character Ids whose first 3 characters say which object they belong to.

const DB = (() => {
  const VERSION = 1;
  let org = null;
  let index = new Map();          // Id -> record
  let metaCache = {};
  const listeners = [];
  let saveTimer = null;

  const SYS = [
    { name: 'Id', label: 'Record ID', type: 'id', readonly: true, system: true },
    { name: 'CreatedDate', label: 'Created Date', type: 'datetime', readonly: true, system: true },
    { name: 'CreatedById', label: 'Created By', type: 'lookup', ref: 'User', readonly: true, system: true },
    { name: 'LastModifiedDate', label: 'Last Modified Date', type: 'datetime', readonly: true, system: true },
    { name: 'LastModifiedById', label: 'Last Modified By', type: 'lookup', ref: 'User', readonly: true, system: true },
  ];
  const TRACK_SKIP = new Set(['LastModifiedDate', 'LastModifiedById', 'Score', 'ScoreReason', 'WinScore', 'Probability', 'ForecastCategory', 'SlaDue']);

  const label = (name) => name.replace(/__c$/, '').replace(/Id$/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

  function emptyOrg() {
    return {
      v: VERSION, createdAt: new Date().toISOString(), company: 'Brightwave Energy', me: null,
      records: {}, seq: {}, an: {},
      custom: { objects: {}, fields: {} },
      reports: [], dashboards: [], flows: [], flowRuns: [], prompts: [], agents: [], agentLog: [],
      slack: { channels: [], messages: [] }, feed: [], history: [], bin: [], recent: [],
      events: [], sources: [], insights: [], streams: [], apis: [], runs: [], workbooks: [], metrics: [],
      cart: [], prefs: {},
    };
  }

  // ---------- metadata ----------

  function meta(obj) {
    if (!obj) return null;
    if (metaCache[obj]) return metaCache[obj];
    const base = SCHEMA[obj] || (org && org.custom.objects[obj]);
    if (!base) return null;
    const extra = (org && org.custom.fields[obj]) || [];
    const fields = [...base.fields, ...extra, ...SYS].map((f) => Object.assign({ label: label(f.name) }, f));
    const nameField = base.nameField || 'Name';
    const m = Object.assign({ name: obj, custom: !SCHEMA[obj], related: [], list: [nameField, 'CreatedDate'] }, base, { fields, field: {}, nameField });
    if (!m.views) m.views = [{ name: `All ${m.plural}`, filters: [] }];
    for (const f of fields) m.field[f.name] = f;
    metaCache[obj] = m;
    return m;
  }
  const objects = () => [...Object.keys(SCHEMA), ...Object.keys((org && org.custom.objects) || {})];
  let prefixMap = null;
  function objectOf(id) {
    if (!id || typeof id !== 'string') return null;
    if (!prefixMap) { prefixMap = {}; for (const o of objects()) prefixMap[meta(o).prefix] = o; }
    return prefixMap[id.slice(0, 3)] || null;
  }
  const invalidate = () => { metaCache = {}; prefixMap = null; };

  const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  function newId(obj) {
    const n = (org.seq[obj] = (org.seq[obj] || 0) + 1);
    let s = '', x = n;
    do { s = B62[x % 62] + s; x = Math.floor(x / 62); } while (x);
    return meta(obj).prefix + 'Sw' + s.padStart(10, '0');
  }

  // ---------- reading ----------

  const all = (obj) => (org.records[obj] = org.records[obj] || []);
  const get = (id) => (id ? index.get(id) || null : null);
  function name(id) {
    const r = get(id);
    if (!r) return '';
    const m = meta(objectOf(id));
    return String(r[m.nameField] || r.Name || r.Subject || r.Id);
  }

  // 'Account.Owner.Name' or 'AccountId.Industry' from a record.
  function path(rec, p) {
    let cur = rec, obj = rec && objectOf(rec.Id);
    const parts = String(p).split('.');
    for (let i = 0; i < parts.length; i++) {
      if (!cur) return null;
      let k = parts[i];
      const m = meta(obj);
      const last = i === parts.length - 1;
      if (m && !m.field[k] && m.field[k + 'Id']) {
        if (last) return name(cur[k + 'Id']);
        k += 'Id';
      }
      if (last) return cur[k];
      const next = cur[k];
      cur = next ? get(next) : null;
      obj = cur ? objectOf(next) : null;
    }
    return null;
  }

  // A field value as people read it: $1,200 · Mar 4, 2027 · Acme Corp · ✓
  function display(obj, field, value) {
    const f = typeof field === 'string' ? (meta(obj) && meta(obj).field[field]) : field;
    if (value == null || value === '') return '';
    if (!f) return String(value);
    const type = f.format || f.type;
    switch (type) {
      case 'currency': return fmt.money(value);
      case 'percent': return fmt.pct(value);
      case 'number': return fmt.num(value);
      case 'date': return fmt.date(value);
      case 'datetime': return fmt.datetime(value);
      case 'checkbox': return value ? '✓' : '';
      case 'lookup': return name(value) || value;
      case 'multipicklist': return [].concat(value).join(', ');
      case 'json': return '';
      default: return String(value);
    }
  }

  // Fills {!Field}, {!Account.Name} and {!$User.Name} in text from a record.
  function merge(text, rec) {
    return String(text || '').replace(/\{!\s*([$\w.]+)\s*\}/g, (_, p) => {
      if (p.startsWith('$User.')) return String(path(me(), p.slice(6)) || '');
      if (p === '$Today') return fmt.date(today());
      if (!rec) return '';
      const obj = objectOf(rec.Id);
      const v = path(rec, p);
      const m = meta(obj);
      const f = m && m.field[p];
      return f ? display(obj, f, v) : String(v == null ? '' : v);
    });
  }

  function resolve(v) {
    if (v === '$me') return org.me;
    if (v === '$today') return today();
    return v;
  }
  function test(rec, [field, op, raw]) {
    const v = field.includes('.') ? path(rec, field) : rec[field];
    const want = Array.isArray(raw) ? raw.map(resolve) : resolve(raw);
    const s = (x) => String(x == null ? '' : x).toLowerCase();
    const n = (x) => (typeof x === 'number' ? x : isNaN(x) || x === '' || x == null ? x : Number(x));
    switch (op || 'eq') {
      case 'eq': return Array.isArray(v) ? v.includes(want) : (typeof want === 'boolean' ? !!v === want : s(v) === s(want));
      case 'ne': return s(v) !== s(want);
      case 'gt': return v != null && v !== '' && n(v) > n(want);
      case 'lt': return v != null && v !== '' && n(v) < n(want);
      case 'ge': return v != null && v !== '' && n(v) >= n(want);
      case 'le': return v != null && v !== '' && n(v) <= n(want);
      case 'contains': return s(v).includes(s(want));
      case 'starts': return s(v).startsWith(s(want));
      case 'in': return [].concat(want).some((w) => s(w) === s(v) || (Array.isArray(v) && v.includes(w)));
      case 'notin': return ![].concat(want).some((w) => s(w) === s(v));
      case 'isnull': return v == null || v === '' || (Array.isArray(v) && !v.length);
      case 'notnull': return !(v == null || v === '' || (Array.isArray(v) && !v.length));
      case 'thisquarter': return !!v && quarterOf(v) === quarterOf(today());
      case 'nextquarter': return !!v && quarterOf(v) === quarterOf(addDays(today(), 92)) && String(v).slice(0, 10) > today();
      case 'thismonth': return !!v && monthOf(v) === monthOf(today());
      case 'today': return !!v && String(v).slice(0, 10) === today();
      case 'lastn': return !!v && String(v).slice(0, 10) >= addDays(today(), -Number(want || 30)) && String(v).slice(0, 10) <= today();
      case 'nextn': return !!v && String(v).slice(0, 10) >= today() && String(v).slice(0, 10) <= addDays(today(), Number(want || 30));
      default: return true;
    }
  }
  const matches = (rec, filters) => (filters || []).every((f) => test(rec, f));

  function textOf(obj, r) {
    const m = meta(obj);
    return m.fields.filter((f) => ['text', 'email', 'phone', 'url', 'picklist', 'autonumber', 'textarea', 'formula'].includes(f.type) && !f.system)
      .map((f) => r[f.name]).filter((x) => typeof x === 'string').join(' ').toLowerCase();
  }

  // query('Opportunity', { filters: [['StageName','eq','Closed Won']], sort: 'Amount', dir: 'desc', limit: 10, q: 'solar' })
  function query(obj, { filters = [], sort, dir = 'asc', limit, q } = {}) {
    let rows = all(obj).filter((r) => matches(r, filters));
    if (q) { const t = String(q).toLowerCase(); rows = rows.filter((r) => textOf(obj, r).includes(t)); }
    if (sort) {
      const f = meta(obj).field[sort];
      const val = (r) => (f && f.type === 'lookup' ? name(r[sort]).toLowerCase() : sort.includes('.') ? path(r, sort) : r[sort]);
      const k = dir === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * k;
      });
    }
    return limit ? rows.slice(0, limit) : rows;
  }

  // Records from every object that match `q`, best first (name matches lead).
  function search(q, { limit = 40, objectsOnly } = {}) {
    const t = String(q || '').trim().toLowerCase();
    if (!t) return [];
    const out = [];
    for (const obj of objectsOnly || objects()) {
      const m = meta(obj);
      if (m.hidden && !objectsOnly) continue;
      for (const r of all(obj)) {
        const nm = String(r[m.nameField] || '').toLowerCase();
        let score = 0;
        if (nm === t) score = 100; else if (nm.startsWith(t)) score = 80; else if (nm.includes(t)) score = 60; else if (textOf(obj, r).includes(t)) score = 30;
        if (score) out.push({ obj, rec: r, score });
      }
    }
    return out.sort((a, b) => b.score - a.score || name(a.rec.Id).localeCompare(name(b.rec.Id))).slice(0, limit);
  }

  // Related lists for a record page: [{ object, field, label, rows }]
  function related(id) {
    const m = meta(objectOf(id));
    return (m.related || []).map(([child, field, lbl]) => ({
      object: child, field, label: lbl || meta(child).plural,
      rows: all(child).filter((r) => r[field] === id),
    }));
  }

  // Tasks, events and emails about a record — for an Account, its contacts' and opportunities' too.
  function activity(id) {
    const ids = new Set([id]);
    if (objectOf(id) === 'Account') {
      for (const c of all('Contact')) if (c.AccountId === id) ids.add(c.Id);
      for (const o of all('Opportunity')) if (o.AccountId === id) ids.add(o.Id);
      for (const c of all('Case')) if (c.AccountId === id) ids.add(c.Id);
    }
    const hit = (r) => ids.has(r.WhatId) || ids.has(r.WhoId) || ids.has(r.RelatedToId);
    return [...all('Task').filter(hit), ...all('Event').filter(hit), ...all('EmailMessage').filter(hit)]
      .sort((a, b) => String(b.ActivityDate || b.StartDateTime || b.MessageDate || b.CreatedDate).localeCompare(String(a.ActivityDate || a.StartDateTime || a.MessageDate || a.CreatedDate)));
  }

  // ---------- computed fields ----------

  function rollupValue(rec, f) {
    const r = f.rollup;
    const kids = all(r.object).filter((x) => x[r.field] === rec.Id);
    if (r.count) return kids.length;
    if (r.max) return kids.reduce((m, x) => Math.max(m, Number(x[r.max]) || 0), 0);
    return Math.round(sum(kids, (x) => x[r.sum]) * 100) / 100;
  }
  function materialize(obj, rec) {
    for (const f of meta(obj).fields) {
      if (f.type === 'formula') {
        try { rec[f.name] = f.calc ? f.calc(rec) : Formula.evaluate(f.expr, rec, obj); } catch (_) { rec[f.name] = null; }
      } else if (f.type === 'rollup' && rec.Id) rec[f.name] = rollupValue(rec, f);
    }
    return rec;
  }
  // When a child changes, its parents' roll-up summaries change too.
  function touchParents(obj, rec) {
    for (const o of objects()) {
      const m = meta(o);
      for (const f of m.fields) {
        if (f.type !== 'rollup' || f.rollup.object !== obj) continue;
        const parent = get(rec[f.rollup.field]);
        if (parent) { parent[f.name] = rollupValue(parent, f); materialize(o, parent); }
      }
    }
  }

  // ---------- built-in automation (what Salesforce does before a record saves) ----------

  const FORECAST = { 'Closed Won': 'Closed', 'Closed Lost': 'Omitted', 'Negotiation/Review': 'Commit', 'Proposal/Price Quote': 'Best Case' };
  function beforeSave(obj, rec, old) {
    if (obj === 'Opportunity') {
      if (!old || old.StageName !== rec.StageName) {
        if (!old || old.Probability === rec.Probability) rec.Probability = STAGE_PROB[rec.StageName] != null ? STAGE_PROB[rec.StageName] : rec.Probability;
        rec.ForecastCategory = FORECAST[rec.StageName] || 'Pipeline';
      }
      rec.WinScore = Predict.win(rec).score;
    }
    if (obj === 'Lead') {
      const p = Predict.lead(rec);
      rec.Score = p.score;
      rec.ScoreReason = p.reasons.slice(0, 4).join('\n');
    }
    if (obj === 'Case') {
      if (rec.Status === 'Closed' && (!old || old.Status !== 'Closed')) rec.ClosedDate = new Date().toISOString();
      if (rec.Status !== 'Closed' && old && old.Status === 'Closed') rec.ClosedDate = null;
      if (!old && !rec.SlaDue) {
        const ent = all('Entitlement').find((e) => e.AccountId === rec.AccountId && e.Status === 'Active');
        const hours = ent ? ent.ResolveHours : { Critical: 8, High: 24, Medium: 72, Low: 120 }[rec.Priority] || 72;
        rec.SlaDue = new Date(new Date(rec.CreatedDate || Date.now()).getTime() + hours * 3600000).toISOString();
      }
      if (!rec.Sentiment && rec.Description) rec.Sentiment = Predict.sentiment(rec.Description);
    }
    if (obj === 'Task' && rec.Status === 'Completed' && !rec.CompletedDate) rec.CompletedDate = new Date().toISOString();
  }

  function validate(obj, rec) {
    for (const f of meta(obj).fields) {
      if (!f.required || f.type === 'autonumber' || f.type === 'formula') continue;
      if (rec[f.name] == null || rec[f.name] === '') throw new Error(`${f.label} is required.`);
    }
    for (const f of meta(obj).fields) {
      const v = rec[f.name];
      if (v == null || v === '') continue;
      if (f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error(`${f.label} isn't a valid email address.`);
      if (['number', 'currency', 'percent'].includes(f.type) && isNaN(Number(v))) throw new Error(`${f.label} must be a number.`);
      if (f.type === 'lookup' && !get(v)) throw new Error(`${f.label} points to a record that doesn't exist.`);
    }
  }

  function coerce(obj, rec) {
    for (const f of meta(obj).fields) {
      const v = rec[f.name];
      if (v === '' && f.type !== 'text' && f.type !== 'textarea') rec[f.name] = null;
      else if (v != null && v !== '' && ['number', 'currency', 'percent'].includes(f.type) && typeof v !== 'number' && !isNaN(Number(v))) rec[f.name] = Number(v);
      else if (f.type === 'checkbox' && v != null) rec[f.name] = !!v && v !== 'false';
      else if (f.type === 'date' && v) rec[f.name] = String(v).slice(0, 10);
    }
  }

  // ---------- writing ----------

  // insert('Account', { Name: 'Acme' }) → the saved record. opts.raw skips checks, Flows and saving (seed data).
  function insert(obj, data, opts = {}) {
    const m = meta(obj);
    if (!m) throw new Error(`There's no ${obj} object.`);
    const now = opts.at || new Date().toISOString();
    const rec = {};
    for (const f of m.fields) if (f.default !== undefined) rec[f.name] = f.default;
    Object.assign(rec, data);
    rec.Id = rec.Id && !index.has(rec.Id) ? rec.Id : newId(obj);
    rec.CreatedDate = rec.CreatedDate || now;
    rec.LastModifiedDate = rec.LastModifiedDate || rec.CreatedDate;
    rec.CreatedById = rec.CreatedById || org.me;
    rec.LastModifiedById = rec.LastModifiedById || rec.CreatedById;
    if (m.field.OwnerId && !rec.OwnerId) rec.OwnerId = org.me;
    for (const f of m.fields) {
      if (f.type === 'autonumber' && !rec[f.name]) {
        const n = (org.an[obj + '.' + f.name] = (org.an[obj + '.' + f.name] || (f.start || 1) - 1) + 1);
        rec[f.name] = (f.format || '{n}').replace('{n}', n);
      }
    }
    coerce(obj, rec);
    if (!opts.raw) beforeSave(obj, rec, null);
    materialize(obj, rec);
    if (!opts.raw) validate(obj, rec);
    all(obj).push(rec);
    index.set(rec.Id, rec);
    if (!opts.raw) {
      touchParents(obj, rec);
      emit({ kind: 'insert', obj, rec });
      runFlows(obj, rec, null, opts.depth || 0);
      save();
    }
    return rec;
  }

  // update(id, { StageName: 'Closed Won' }) → the record. Throws if a check fails (nothing changes).
  function update(id, patch, opts = {}) {
    const rec = get(id);
    if (!rec) throw new Error("That record doesn't exist any more.");
    const obj = objectOf(id);
    const old = Object.assign({}, rec);
    const next = Object.assign({}, rec, patch);
    coerce(obj, next);
    if (!opts.raw) beforeSave(obj, next, old);
    materialize(obj, next);
    if (!opts.raw) validate(obj, next);
    next.LastModifiedDate = new Date().toISOString();
    next.LastModifiedById = org.me;
    Object.assign(rec, next);
    if (!opts.raw) {
      const m = meta(obj);
      for (const f of m.fields) {
        if (f.system || f.type === 'formula' || f.type === 'rollup' || f.type === 'json' || TRACK_SKIP.has(f.name)) continue;
        if (JSON.stringify(old[f.name] ?? null) !== JSON.stringify(rec[f.name] ?? null)) {
          org.history.unshift({ id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), rid: id, f: f.name, o: old[f.name] ?? null, n: rec[f.name] ?? null, at: rec.LastModifiedDate, by: org.me });
        }
      }
      if (org.history.length > 4000) org.history.length = 4000;
      touchParents(obj, rec);
      if (old[Object.keys(patch).find((k) => meta(obj).field[k] && meta(obj).field[k].master)]) touchParents(obj, old);
      emit({ kind: 'update', obj, rec, old });
      runFlows(obj, rec, old, opts.depth || 0);
      save();
    }
    return rec;
  }

  // Deletes a record and its master-detail children, clears lookups to it, and keeps it all in the
  // Recycle Bin so it can be restored.
  function remove(id) {
    const root = get(id);
    if (!root) return null;
    const gone = [];
    const drop = (rid) => {
      const r = get(rid);
      if (!r) return;
      const obj = objectOf(rid);
      for (const o of objects()) {
        for (const f of meta(o).fields) {
          if (f.type !== 'lookup') continue;
          const refs = [].concat(f.ref);
          if (!refs.includes(obj)) continue;
          for (const kid of all(o).filter((x) => x[f.name] === rid)) {
            if (f.master || (['Task', 'Event', 'EmailMessage'].includes(o) && f.name !== 'WhoId')) drop(kid.Id);
            else { gone.push({ clear: true, id: kid.Id, field: f.name, value: rid }); kid[f.name] = null; }
          }
        }
      }
      const list = all(obj);
      const i = list.indexOf(r);
      if (i >= 0) list.splice(i, 1);
      index.delete(rid);
      gone.push({ obj, rec: r });
      touchParents(obj, r);
    };
    drop(id);
    const entry = { id: 'b' + Date.now().toString(36), at: new Date().toISOString(), by: org.me, name: name(id) || root[meta(objectOf(id)).nameField] || id, obj: objectOf(id), items: gone };
    entry.name = String(root[meta(entry.obj).nameField] || root.Name || id);
    org.bin.unshift(entry);
    if (org.bin.length > 60) org.bin.length = 60;
    org.recent = org.recent.filter((x) => index.has(x));
    emit({ kind: 'delete', obj: entry.obj, rec: root });
    save();
    return entry;
  }

  function restore(binId) {
    const i = org.bin.findIndex((b) => b.id === binId);
    if (i < 0) return null;
    const entry = org.bin[i];
    for (const it of entry.items.slice().reverse()) {
      if (it.clear) { const r = get(it.id); if (r) r[it.field] = it.value; continue; }
      if (!index.has(it.rec.Id)) { all(it.obj).push(it.rec); index.set(it.rec.Id, it.rec); }
    }
    for (const it of entry.items) if (!it.clear) touchParents(it.obj, it.rec);
    org.bin.splice(i, 1);
    emit({ kind: 'restore', obj: entry.obj });
    save();
    return entry;
  }

  // ---------- Flows (record-triggered automation) ----------

  function runFlows(obj, rec, old, depth) {
    if (depth > 3) return;
    for (const fl of org.flows) {
      if (!fl.active || fl.object !== obj) continue;
      if (fl.trigger === 'create' && old) continue;
      if (fl.trigger === 'update' && !old) continue;
      if (!matches(rec, fl.conditions)) continue;
      // Like "only when a record is updated to meet the condition requirements".
      if (old && matches(old, fl.conditions) && !(fl.changed && old[fl.changed] !== rec[fl.changed])) continue;
      if (fl.changed && old && old[fl.changed] === rec[fl.changed]) continue;
      const log = { id: 'fr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), flowId: fl.id, flow: fl.name, recordId: rec.Id, at: new Date().toISOString(), steps: [], ok: true };
      org.flowRuns.unshift(log);
      if (org.flowRuns.length > 300) org.flowRuns.length = 300;
      for (const a of fl.actions || []) {
        try { log.steps.push(runAction(a, rec, depth, log)); } catch (e) { log.ok = false; log.steps.push('✗ ' + e.message); }
      }
    }
  }

  function runAction(a, rec, depth, log) {
    const obj = objectOf(rec.Id);
    const m = meta(obj);
    switch (a.type) {
      case 'update': {
        const value = typeof a.value === 'string' ? merge(a.value, rec) : a.value;
        update(rec.Id, { [a.field]: value }, { depth: depth + 1 });
        return `Set ${m.field[a.field] ? m.field[a.field].label : a.field} to "${value}"`;
      }
      case 'task': {
        const what = [].concat(meta('Task').field.WhatId.ref).includes(obj);
        const t = insert('Task', {
          Subject: merge(a.subject || 'Follow up on {!Name}', rec), Priority: a.priority || 'Normal', Type: a.taskType || 'Follow Up',
          ActivityDate: addDays(today(), Number(a.days) || 1), OwnerId: rec.OwnerId || org.me,
          WhatId: what ? rec.Id : null, WhoId: what ? (rec.ContactId || null) : rec.Id,
        }, { depth: depth + 1 });
        return `Created task "${t.Subject}"`;
      }
      case 'slack': {
        const msg = slackPost(a.channel || 'general', merge(a.text, rec), 'bot:Flow', { recordId: rec.Id });
        return `Posted to #${channel(msg.ch).name}`;
      }
      case 'chatter': { post(rec.Id, merge(a.text, rec), 'bot:Flow'); return 'Posted to Chatter'; }
      case 'email': {
        const who = get(rec[a.toField || 'ContactId']) || (rec.Email ? rec : null);
        const e = insert('EmailMessage', {
          Subject: merge(a.subject, rec), TextBody: merge(a.body, rec), Status: 'Sent', Incoming: false,
          ToAddress: who ? who.Email : '', FromName: org.company, RelatedToId: rec.Id, WhoId: who && who.Id !== rec.Id ? who.Id : null, MessageDate: new Date().toISOString(),
        }, { depth: depth + 1 });
        return `Sent email "${e.Subject}"${e.ToAddress ? ' to ' + e.ToAddress : ''}`;
      }
      case 'create': {
        const vals = {};
        for (const [k, v] of Object.entries(a.values || {})) vals[k] = typeof v === 'string' ? merge(v, rec) : v;
        const r = insert(a.object, vals, { depth: depth + 1 });
        return `Created ${meta(a.object).label} "${name(r.Id)}"`;
      }
      case 'ai': {
        // Generative step: runs in the background and writes the answer into a field.
        Einstein.ask({ task: 'flow', prompt: `${merge(a.prompt, rec)}\n\nRecord:\n${Einstein.recordContext(rec.Id, { depth: 1 })}` })
          .then((r) => { if (get(rec.Id)) update(rec.Id, { [a.field]: r.text }, { depth: depth + 1 }); log.steps.push(`✨ Wrote ${a.field} with ${r.meta.word}`); save(); })
          .catch((e) => { log.ok = false; log.steps.push('✗ ✨ ' + e.message); save(); });
        return `✨ Asked AI to write ${m.field[a.field] ? m.field[a.field].label : a.field}`;
      }
      default: return `Skipped unknown action ${a.type}`;
    }
  }

  // ---------- Chatter, Slack, history, recent ----------

  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function post(parentId, text, userId, opts = {}) {
    const p = { id: uid('f'), parentId, userId: userId || org.me, text, at: opts.at || new Date().toISOString(), likes: [], comments: [] };
    org.feed.unshift(p);
    if (!opts.raw) { emit({ kind: 'feed', rec: p }); save(); }
    return p;
  }
  const feed = (parentId) => org.feed.filter((p) => !parentId || p.parentId === parentId);

  function channel(idOrName) {
    const n = String(idOrName || '').replace(/^#/, '').toLowerCase();
    return org.slack.channels.find((c) => c.id === idOrName || c.name === n) || null;
  }
  function slackChannel(nameOrRec, opts = {}) {
    const n = String(nameOrRec).replace(/^#/, '').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'channel';
    let c = channel(n);
    if (c) return c;
    c = { id: uid('C'), name: n, topic: opts.topic || '', recordId: opts.recordId || null, members: opts.members || [org.me], created: new Date().toISOString(), lastRead: {} };
    org.slack.channels.push(c);
    if (!opts.raw) { emit({ kind: 'slack', rec: c }); save(); }
    return c;
  }
  function slackPost(ch, text, user, opts = {}) {
    const c = channel(ch) || slackChannel(ch, { raw: opts.raw });
    const msg = { id: uid('M'), ch: c.id, user: user || org.me, text: String(text || ''), at: opts.at || new Date().toISOString(), thread: opts.thread || null, recordId: opts.recordId || null, reactions: opts.reactions || {} };
    org.slack.messages.push(msg);
    if (!opts.raw) { emit({ kind: 'slack', rec: msg }); save(); }
    return msg;
  }
  const history = (id) => org.history.filter((x) => x.rid === id);
  function touch(id) {
    org.recent = [id, ...org.recent.filter((x) => x !== id)].slice(0, 40);
    save();
  }

  // ---------- users ----------

  const me = () => get(org.me);
  function setMe(id) { if (get(id)) { org.me = id; emit({ kind: 'user' }); save(); } }

  // ---------- custom metadata (Setup › Object Manager) ----------

  function addField(obj, def) {
    const m = meta(obj);
    const api = def.name || (label(def.label).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '__c');
    if (m.field[api]) throw new Error(`${obj} already has a field called ${api}.`);
    const f = Object.assign({}, def, { name: api, custom: true });
    if (f.type === 'formula' && f.expr) { const c = Formula.check(f.expr, obj); if (!c.ok) throw new Error(c.error); }
    (org.custom.fields[obj] = org.custom.fields[obj] || []).push(f);
    invalidate();
    for (const r of all(obj)) materialize(obj, r);
    emit({ kind: 'meta', obj });
    save();
    return f;
  }
  function removeField(obj, api) {
    const list = org.custom.fields[obj] || [];
    const i = list.findIndex((f) => f.name === api);
    if (i < 0) return false;
    list.splice(i, 1);
    for (const r of all(obj)) delete r[api];
    invalidate();
    emit({ kind: 'meta', obj });
    save();
    return true;
  }
  function addObject(def) {
    const api = def.name || (label(def.label).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '__c');
    if (meta(api)) throw new Error(`There's already an object called ${api}.`);
    const n = Object.keys(org.custom.objects).length + 1;
    const prefix = 'a' + B62[(10 + Math.floor(n / 62)) % 62] + B62[n % 62];
    org.custom.objects[api] = {
      label: def.label, plural: def.plural || def.label + 's', prefix, icon: def.icon || '🧩', color: def.color || '#3ba4a4',
      nameField: 'Name', apps: def.apps || [], description: def.description || '',
      fields: [{ name: 'Name', label: `${def.label} Name`, type: 'text', required: true }, ...(def.fields || []).map((f) => Object.assign({ custom: true }, f)),
        { name: 'OwnerId', label: 'Owner', type: 'lookup', ref: 'User' }],
      list: def.list || ['Name', ...(def.fields || []).slice(0, 4).map((f) => f.name)],
    };
    invalidate();
    emit({ kind: 'meta', obj: api });
    save();
    return api;
  }
  function removeObject(api) {
    if (!org.custom.objects[api]) return false;
    delete org.custom.objects[api];
    for (const r of all(api)) index.delete(r.Id);
    delete org.records[api];
    invalidate();
    emit({ kind: 'meta', obj: api });
    save();
    return true;
  }

  // ---------- business processes ----------

  // Lead → Account + Contact (+ Opportunity), the way Convert works.
  function convertLead(leadId, { accountId, createOpp = true, oppName } = {}) {
    const l = get(leadId);
    if (!l) throw new Error('Lead not found.');
    if (l.Status === 'Closed - Converted') throw new Error('This lead is already converted.');
    let acct = accountId ? get(accountId) : all('Account').find((a) => a.Name.toLowerCase() === String(l.Company).toLowerCase());
    if (!acct) acct = insert('Account', { Name: l.Company, Industry: l.Industry, AnnualRevenue: l.AnnualRevenue, NumberOfEmployees: l.NumberOfEmployees, BillingCity: l.City, BillingCountry: l.Country, Phone: l.Phone, Type: 'Prospect', Rating: l.Rating, OwnerId: l.OwnerId });
    const con = insert('Contact', { FirstName: l.FirstName, LastName: l.LastName, Salutation: l.Salutation, Title: l.Title, Email: l.Email, Phone: l.Phone, AccountId: acct.Id, LeadSource: l.LeadSource, MailingCity: l.City, MailingCountry: l.Country, OwnerId: l.OwnerId });
    let opp = null;
    if (createOpp) opp = insert('Opportunity', { Name: oppName || `${acct.Name} – New Business`, AccountId: acct.Id, ContactId: con.Id, StageName: 'Qualification', CloseDate: addDays(today(), 45), LeadSource: l.LeadSource, Type: 'New Business', CampaignId: l.CampaignId, OwnerId: l.OwnerId, Amount: l.AnnualRevenue ? Math.round(Math.min(l.AnnualRevenue * 0.002, 400000) / 1000) * 1000 : 25000 });
    for (const t of all('Task').filter((x) => x.WhoId === leadId)) { t.WhoId = con.Id; if (opp) t.WhatId = opp.Id; }
    for (const cm of all('CampaignMember').filter((x) => x.LeadId === leadId)) cm.ContactId = con.Id;
    update(leadId, { Status: 'Closed - Converted', ConvertedAccountId: acct.Id, ConvertedContactId: con.Id, ConvertedOpportunityId: opp ? opp.Id : null });
    return { account: acct, contact: con, opportunity: opp };
  }

  // ---------- reports ----------

  function groupKey(m, rec, g) {
    const [f, gran] = String(g).split(':');
    let v = f.includes('.') ? path(rec, f) : rec[f];
    const fd = m.field[f];
    if (v == null || v === '') return '(blank)';
    if (gran === 'month') return monthOf(v);
    if (gran === 'quarter') return quarterOf(v);
    if (gran === 'year') return String(v).slice(0, 4);
    if (fd && fd.type === 'lookup') return name(v) || '(blank)';
    if (fd && fd.type === 'checkbox') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  }
  function groupOrder(m, g, keys) {
    const [f, gran] = String(g).split(':');
    const fd = m.field[f];
    if (gran || (fd && ['date', 'datetime'].includes(fd.type))) return keys.sort();
    if (fd && fd.options) return keys.sort((a, b) => (fd.options.indexOf(a) + 1 || 999) - (fd.options.indexOf(b) + 1 || 999));
    return null; // caller sorts by value
  }
  function aggregate(rows, agg) {
    if (!agg || agg.fn === 'count' || !agg.field) return rows.length;
    const vals = rows.map((r) => Number(r[agg.field])).filter((x) => !isNaN(x));
    if (agg.fn === 'sum') return Math.round(sum(vals) * 100) / 100;
    if (agg.fn === 'avg') return vals.length ? Math.round((sum(vals) / vals.length) * 100) / 100 : 0;
    if (agg.fn === 'max') return vals.length ? Math.max(...vals) : 0;
    if (agg.fn === 'min') return vals.length ? Math.min(...vals) : 0;
    return rows.length;
  }
  // runReport({ object, filters, groupBy, groupBy2, aggregate: {fn, field}, sort }) → { rows, groups, total }
  function runReport(r) {
    const m = meta(r.object);
    if (!m) throw new Error(`This report's object (${r.object}) no longer exists.`);
    const rows = query(r.object, { filters: r.filters || [], sort: r.sort, dir: r.dir });
    const agg = r.aggregate || { fn: 'count' };
    const out = { rows, total: aggregate(rows, agg), agg, meta: m, groups: [] };
    if (!r.groupBy) return out;
    const byKey = groupBy(rows, (x) => groupKey(m, x, r.groupBy));
    let keys = Object.keys(byKey);
    const ordered = groupOrder(m, r.groupBy, keys);
    out.groups = (ordered || keys).map((k) => {
      const g = { key: k, rows: byKey[k], value: aggregate(byKey[k], agg) };
      if (r.groupBy2) {
        const sub = groupBy(byKey[k], (x) => groupKey(m, x, r.groupBy2));
        g.sub = Object.entries(sub).map(([k2, rs]) => ({ key: k2, rows: rs, value: aggregate(rs, agg) }));
      }
      return g;
    });
    if (!ordered) out.groups.sort((a, b) => b.value - a.value);
    if (r.groupBy2) out.keys2 = uniq(rows.map((x) => groupKey(m, x, r.groupBy2))).sort((a, b) => {
      const o = groupOrder(m, r.groupBy2, [a, b]);
      return o ? (o[0] === a ? -1 : 1) : a.localeCompare(b);
    });
    return out;
  }

  // ---------- config lists (reports, dashboards, flows, prompts, agents…) ----------

  const cfg = {
    list: (kind) => org[kind] || [],
    get: (kind, id) => (org[kind] || []).find((x) => x.id === id) || null,
    add(kind, item) {
      const it = Object.assign({ id: uid(kind.slice(0, 2)) }, item, { createdAt: new Date().toISOString() });
      (org[kind] = org[kind] || []).push(it);
      emit({ kind: 'cfg', what: kind, rec: it });
      save();
      return it;
    },
    update(kind, id, patch) {
      const it = cfg.get(kind, id);
      if (!it) return null;
      Object.assign(it, patch, { updatedAt: new Date().toISOString() });
      emit({ kind: 'cfg', what: kind, rec: it });
      save();
      return it;
    },
    remove(kind, id) {
      const list = org[kind] || [];
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
      emit({ kind: 'cfg', what: kind });
      save();
    },
  };

  // ---------- events, saving, loading ----------

  function on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  function emit(e) { for (const fn of listeners.slice()) { try { fn(e); } catch (err) { console.error(err); } } }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  }
  async function flush() {
    clearTimeout(saveTimer);
    if (org && window.host) await window.host.saveOrg(org);
  }

  function reindex() {
    index = new Map();
    for (const list of Object.values(org.records)) for (const r of list) index.set(r.Id, r);
  }

  // Loads the saved org, or builds the demo org when there isn't one (first run or after a reset).
  function boot(saved) {
    invalidate();
    if (saved && saved.v === VERSION && saved.records) {
      org = Object.assign(emptyOrg(), saved);
      reindex();
      for (const obj of Object.keys(org.records)) if (meta(obj)) for (const r of org.records[obj]) materialize(obj, r);
      return { fresh: false };
    }
    org = emptyOrg();
    index = new Map();
    Seed.build(DB);
    reindex();
    for (const obj of Object.keys(org.records)) for (const r of org.records[obj]) materialize(obj, r);
    for (const obj of ['Opportunity', 'Lead']) for (const r of all(obj)) beforeSave(obj, r, null);
    for (const a of all('Account')) a.HealthScore = Predict.health(a).score;
    flush();
    return { fresh: true };
  }

  return {
    boot, flush, save, on, emit,
    org: () => org, meta, objects, objectOf, newId, label,
    all, get, name, path, display, merge, matches, query, search, related, activity,
    insert, update, remove, restore, materialize, beforeSave,
    post, feed, channel, slackChannel, slackPost, history, touch,
    me, setMe, addField, removeField, addObject, removeObject, convertLead,
    runReport, groupKey, aggregate, cfg, uid,
  };
})();
