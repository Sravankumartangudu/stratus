// einstein.js — the generative side of Einstein: every "✨" in the app goes through here.
//   Einstein.ask({ task, prompt, schema }) → { …reply, meta: { provider, word, model, ms } }
// It adds the shared system prompt (who the user is, today's date, how to link records), masks emails
// and phone numbers first when the Trust Layer is on, and writes every call to the audit trail
// (Agentforce › Agent Log). Whichever AI is picked in Settings answers — Claude, ChatGPT, Gemini, a local
// model… The predictive side (scores) is predict.js and needs no AI at all.

const Einstein = (() => {
  let state = { current: 'off', word: 'AI', label: 'AI off', problem: 'Pick an AI in Settings › AI to turn on Einstein and Agentforce.' };
  const results = new Map(); // card key → { result, meta } so a re-render keeps what was generated
  const listeners = [];

  // JSON-schema shorthands so features can say what shape they want back.
  const S = {
    str: (description) => ({ type: 'string', description }),
    num: (description) => ({ type: 'number', description }),
    bool: (description) => ({ type: 'boolean', description }),
    oneOf: (values, description) => ({ type: 'string', enum: values, description }),
    arr: (items, description) => ({ type: 'array', items, description }),
    obj: (properties, required) => ({ type: 'object', properties, required: required || Object.keys(properties) }),
  };

  function setState(s) {
    if (s) state = s;
    for (const fn of listeners.slice()) fn(state);
  }
  const onState = (fn) => listeners.push(fn);
  const ready = () => !state.problem;
  const word = () => state.word || 'AI';

  function system(extra) {
    const me = DB.me() || {};
    const org = DB.org();
    return [
      `You are Einstein, the AI built into Stratus, a CRM that works the way Salesforce does. The company using it is ${org.company} (solar panels, batteries, EV chargers, smart-home devices, energy software, and installation/maintenance services).`,
      `The user is ${me.Name || 'a user'}${me.Title ? `, ${me.Title}` : ''}. Today is ${fmt.date(today())} (${today()}).`,
      'Write plainly and briefly, like a sharp colleague. Use short paragraphs or bullets. Use real numbers from the data you are given; never invent facts, people, numbers or record Ids.',
      'To mention a record, write its Id in double square brackets, e.g. [[006Sw00000000A1]] — the app turns that into a link. Only use Ids that appear in the data.',
      extra || '',
    ].filter(Boolean).join('\n');
  }

  // ---------- Trust Layer: mask emails and phone numbers before they leave the app ----------

  function mask(text) {
    const map = {};
    let n = 0;
    const swap = (kind) => (m) => {
      const hit = Object.entries(map).find(([, v]) => v === m);
      if (hit) return hit[0];
      const k = `<${kind}_${++n}>`;
      map[k] = m;
      return k;
    };
    const out = String(text)
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, swap('EMAIL'))
      .replace(/\(?\b\d{3}\)?[ .-]?\d{3}[ .-]\d{4}\b/g, swap('PHONE'));
    return { text: out, map };
  }
  function unmask(v, map) {
    if (!map || !Object.keys(map).length) return v;
    if (typeof v === 'string') return v.replace(/<(EMAIL|PHONE)_\d+>/g, (k) => map[k] || k);
    if (Array.isArray(v)) return v.map((x) => unmask(x, map));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unmask(x, map)]));
    return v;
  }
  const trust = () => Object.assign({ mask: true, audit: true }, DB.org().prefs.trust || {});

  function audit(entry) {
    if (!trust().audit) return;
    const log = DB.org().agentLog;
    log.unshift(Object.assign({ id: DB.uid('al'), at: new Date().toISOString(), user: DB.org().me }, entry));
    if (log.length > 400) log.length = 400;
    DB.save();
  }

  // ---------- the call ----------

  async function ask({ task = 'ask', system: extra, prompt, schema, raw }) {
    if (!window.host) throw new Error('AI needs the Stratus app.');
    if (state.problem) { const e = new Error(state.problem); e.setup = true; throw e; }
    const t = trust();
    let sys = raw ? extra : system(extra);
    let body = String(prompt);
    let map = {};
    if (t.mask) {
      const a = mask(body); body = a.text; map = a.map;
      const b = mask(sys); sys = b.text; Object.assign(map, b.map);
    }
    const started = Date.now();
    const r = await window.host.aiAsk({ system: sys, prompt: body, schema });
    if (!r || !r.ok) {
      audit({ task, ok: false, error: (r && r.error) || 'No reply', prompt: body.slice(0, 1200), ms: Date.now() - started, masked: Object.keys(map).length });
      const e = new Error((r && r.error) || 'The AI did not reply.');
      if (/Settings/.test(e.message)) e.setup = true;
      throw e;
    }
    const result = unmask(r.result || {}, map);
    audit({ task, ok: true, provider: r.meta.provider, model: r.meta.model, word: r.meta.word, ms: r.meta.ms, prompt: body.slice(0, 1200),
      reply: JSON.stringify(r.result).slice(0, 1200), masked: Object.keys(map).length });
    return Object.assign({}, result, { meta: r.meta });
  }

  // ---------- context: records and the org, as text the model can read ----------

  const SKIP = new Set(['Id', 'CreatedById', 'LastModifiedById', 'LastModifiedDate']);
  function fieldsText(obj, rec, limit = 40) {
    const m = DB.meta(obj);
    const out = [];
    for (const f of m.fields) {
      if (SKIP.has(f.name) || f.type === 'json' || f.hidden) continue;
      const v = rec[f.name];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      let d = DB.display(obj, f.name, v);
      if (f.type === 'lookup') d = `${DB.name(v) || v} [[${v}]]`;
      out.push(`${f.label}: ${String(d).slice(0, 600)}`);
      if (out.length >= limit) break;
    }
    return out.join('\n');
  }
  function rowText(obj, rec) {
    const m = DB.meta(obj);
    const cols = (m.list || []).slice(0, 6).filter((c) => c !== m.nameField);
    const bits = cols.map((c) => { const v = rec[c]; if (v == null || v === '') return null; const f = m.field[c]; return `${f ? f.label : c} ${f && f.type === 'lookup' ? DB.name(v) : DB.display(obj, c, v)}`; }).filter(Boolean);
    return `- ${DB.name(rec.Id)} [[${rec.Id}]]${bits.length ? ' — ' + bits.join(', ') : ''}`;
  }
  function recordContext(id, { depth = 2, rows = 8 } = {}) {
    const rec = DB.get(id);
    if (!rec) return '(record not found)';
    const obj = DB.objectOf(id);
    const m = DB.meta(obj);
    const parts = [`${m.label}: ${DB.name(id)} [[${id}]]`, fieldsText(obj, rec)];
    if (depth > 1) {
      for (const rl of DB.related(id)) {
        if (!rl.rows.length) continue;
        parts.push(`\n${rl.label} (${rl.rows.length}):\n` + rl.rows.slice(0, rows).map((r) => rowText(rl.object, r)).join('\n') + (rl.rows.length > rows ? `\n…and ${rl.rows.length - rows} more` : ''));
      }
      if (obj === 'Case') {
        const cc = DB.all('CaseComment').filter((c) => c.ParentId === id).sort((a, b) => a.CreatedDate.localeCompare(b.CreatedDate));
        if (cc.length) parts.push('\nConversation:\n' + cc.map((c) => `- ${fmt.datetime(c.CreatedDate)} ${c.FromCustomer ? 'Customer' : DB.name(c.CreatedById) || 'Agent'}: ${c.CommentBody}`).join('\n'));
      }
      const acts = DB.activity(id).slice(0, rows);
      if (acts.length) parts.push('\nActivity:\n' + acts.map((a) => {
        const o = DB.objectOf(a.Id);
        const when = a.ActivityDate || a.StartDateTime || a.MessageDate || a.CreatedDate;
        return `- ${fmt.date(when)} ${DB.meta(o).label}: ${a.Subject}${a.Status ? ` (${a.Status})` : ''}${a.TextBody ? ' — ' + a.TextBody.slice(0, 160) : ''}`;
      }).join('\n'));
      const posts = DB.feed(id).slice(0, 5);
      if (posts.length) parts.push('\nChatter:\n' + posts.map((p) => `- ${fmt.date(p.at)} ${DB.name(p.userId) || 'Flow'}: ${p.text}`).join('\n'));
    }
    return parts.join('\n');
  }
  // Many records as a compact list (for "summarise my pipeline" style prompts).
  function listContext(obj, rows, fields) {
    const m = DB.meta(obj);
    const cols = fields || (m.list || []).slice(0, 7);
    return rows.map((r) => `- [[${r.Id}]] ` + cols.map((c) => {
      const v = r[c]; if (v == null || v === '') return null;
      const f = m.field[c];
      return `${f ? f.label : c}: ${f && f.type === 'lookup' ? DB.name(v) : DB.display(obj, c, v)}`;
    }).filter(Boolean).join('; ')).join('\n');
  }
  function orgContext() {
    const counts = ['Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Order', 'WorkOrder', 'Product2'].map((o) => `${DB.meta(o).plural}: ${DB.all(o).length}`).join(', ');
    return `Org: ${DB.org().company}. ${counts}.`;
  }

  // ---------- UI: the ✨ card and button ----------

  const footnote = (meta) => h('div.ai-foot', h('span.ai-badge', '✨ ' + (meta.word || 'AI')), ` ${meta.model || ''} · ${(meta.ms / 1000).toFixed(1)}s`,
    trust().mask ? h('span.ai-trust', { title: 'Emails and phone numbers were masked before sending (Settings › Trust Layer)' }, ' · 🛡 masked') : null);

  function setupNote(msg) {
    return h('div.ai-setup', h('span', msg || state.problem), h('a.link', { href: '#/settings' }, 'Open Settings › AI'));
  }

  // Einstein.card({ key, title, intro, label, ask: () => askArgs, render: (result) => node, auto, actions })
  // A card with a Generate button; the result stays put across re-renders (keyed by `key`).
  function card(o) {
    const body = h('div.ai-body');
    const head = h('div.grow');
    const draw = () => {
      const got = results.get(o.key);
      if (got && got.loading) { body.replaceChildren(UI.spinner(`${word()} is thinking…`)); return; }
      if (got && got.error) {
        body.replaceChildren(h('div.ai-err', '⚠️ ', got.error), got.setup ? setupNote(got.error) : h('button.btn.sm', { onclick: run }, 'Try again'));
        return;
      }
      if (got && got.result) {
        const view = o.render ? o.render(got.result, rerun) : md(got.result.text || '');
        body.replaceChildren(view, h('div.ai-row', footnote(got.meta), h('div.grow'),
          (o.actions ? o.actions(got.result) : []),
          got.result.text ? h('button.btn.sm.ghost', { onclick: () => UI.copy(got.result.text), title: 'Copy' }, '⧉ Copy') : null,
          h('button.btn.sm.ghost', { onclick: run, title: 'Generate again' }, '↻')));
        return;
      }
      if (!ready()) { body.replaceChildren(o.intro ? h('p.muted', o.intro) : null, setupNote()); return; }
      body.replaceChildren(o.intro ? h('p.muted', o.intro) : null, h('button.btn.ai', { onclick: run }, '✨ ', o.label || 'Generate'));
    };
    async function run() {
      results.set(o.key, { loading: true });
      draw();
      try {
        const r = await ask(o.ask());
        results.set(o.key, { result: r, meta: r.meta });
        if (o.onResult) o.onResult(r);
      } catch (e) {
        results.set(o.key, { error: e.message, setup: e.setup });
      }
      // The page may have re-rendered while we waited, so draw every live copy of this card.
      draw();
      for (const c of $$('.ai-card')) if (c !== el && c.dataset.aikey === o.key && c._draw) c._draw();
    }
    function rerun() { run(); }
    const el = UI.card(o.title || 'Einstein', body, { icon: o.icon || '✨', className: 'ai-card ' + (o.className || ''), actions: head });
    el.dataset.aikey = o.key;
    el._draw = draw;
    draw();
    if (o.auto && ready() && !results.has(o.key)) run();
    return el;
  }

  // A one-off ✨ button: runs ask(), hands the reply to onDone, shows a spinner meanwhile.
  function button(label, getAsk, onDone, cls) {
    const b = h(`button.btn.ai${cls ? '.' + cls : ''}`, {
      onclick: async () => {
        if (!ready()) { UI.toast(state.problem, 'err', { label: 'Settings', run: () => { location.hash = '#/settings'; } }); return; }
        const was = [...b.childNodes];
        b.disabled = true;
        b.replaceChildren(h('span.spinner.sm'), ' ', `${word()}…`);
        try { const r = await ask(getAsk()); await onDone(r); } catch (e) {
          UI.toast(e.message, 'err', e.setup ? { label: 'Settings', run: () => { location.hash = '#/settings'; } } : null);
        } finally { b.disabled = false; b.replaceChildren(...was); }
      },
    }, '✨ ', label);
    return b;
  }

  const forget = (key) => { for (const k of [...results.keys()]) if (k === key || k.startsWith(key + ':')) results.delete(k); };

  return { S, setState, onState, ready, word, state: () => state, system, ask, mask, unmask, trust,
    recordContext, listContext, orgContext, fieldsText, card, button, setupNote, footnote, forget, results };
})();
