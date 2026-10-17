// agentforce.js — Agentforce: AI agents that act on the data, not just talk about it.
//
//   Agentforce.panel(close) → the side panel (opened from the header button or Shell.ask)
//   Agentforce.send(text)   → ask the current agent something
//
// The agent loop: each turn the model picks ONE action (search, query, get, update, log a task…) and
// gets the result back, up to MAX_STEPS times, then answers. Every change it makes is listed under the
// answer with an Undo. Agents (role, instructions, tone, allowed actions, topics) are edited in Agent
// Builder; Prompt Builder holds reusable prompt templates; Agent Log shows what AI did across the app.

const Agentforce = (() => {
  const MAX_STEPS = 6;
  const chat = { msgs: [], busy: false, agentId: null };
  const listeners = new Set();
  const changed = () => listeners.forEach((f) => f());

  // ---------- the actions an agent can take ----------

  const asList = (rows, obj) => (rows.length ? Einstein.listContext(obj, rows) : '(no records)');
  const parseVals = (obj, vals) => {
    const out = {};
    const m = DB.meta(obj);
    for (const [k, v] of Object.entries(vals || {})) {
      const f = m.field[k] || m.fields.find((x) => x.label.toLowerCase() === String(k).toLowerCase());
      if (!f || f.readonly || f.system) continue;
      out[f.name] = Filters.coerce(f, 'eq', v);
    }
    return out;
  };
  const objOk = (o) => { if (!DB.meta(o)) throw new Error(`There's no object called ${o}. Objects: ${DB.objects().join(', ')}`); return o; };

  const ACTIONS = {
    search: { label: 'Search records', args: '{ "q": "words" }', run: ({ q }) => DB.search(q, { limit: 12 }).map((x) => `- [[${x.rec.Id}]] ${DB.meta(x.obj).label}: ${DB.name(x.rec.Id)}`).join('\n') || 'No matches.' },
    query: { label: 'List records', args: '{ "object": "Opportunity", "filters": [["StageName","ne","Closed Won"]], "sort": "Amount", "dir": "desc", "limit": 10 } — filter ops: eq ne gt lt ge le contains starts in notin isnull notnull thisquarter nextquarter thismonth today lastn nextn; "$me" = current user',
      run: ({ object, filters, sort, dir, limit }) => {
        objOk(object);
        const fl = (filters || []).map((x) => { const f = Filters.fieldOf(object, x[0]); return f ? [x[0], x[1], Filters.coerce(f, x[1], x[2])] : null; }).filter(Boolean);
        const rows = DB.query(object, { filters: fl, sort, dir, limit: Math.min(Number(limit) || 10, 25) });
        const total = DB.query(object, { filters: fl }).length;
        return `${total} ${DB.meta(object).plural} match${rows.length < total ? ` (showing ${rows.length})` : ''}:\n${asList(rows, object)}`;
      } },
    get: { label: 'Read a record', args: '{ "id": "record Id" }', run: ({ id }) => Einstein.recordContext(id, { depth: 2, rows: 6 }) },
    create: { label: 'Create a record', change: true, args: '{ "object": "Task", "values": { "Field": "value" } }',
      run: ({ object, values }, undo) => { objOk(object); const r = DB.insert(object, parseVals(object, values)); undo.push({ label: `Created ${DB.meta(object).label} “${DB.name(r.Id)}”`, id: r.Id, run: () => DB.remove(r.Id) }); return `Created [[${r.Id}]]`; } },
    update: { label: 'Update a record', change: true, args: '{ "id": "record Id", "values": { "Field": "value" } }',
      run: ({ id, values }, undo) => {
        const rec = DB.get(id); if (!rec) throw new Error(`No record ${id}. Look it up first.`);
        const obj = DB.objectOf(id);
        const patch = parseVals(obj, values);
        if (!Object.keys(patch).length) throw new Error(`None of those fields can be set on ${obj}. Fields: ${DB.meta(obj).fields.filter((f) => !f.readonly && !f.system).map((f) => f.name).join(', ')}`);
        const old = Object.fromEntries(Object.keys(patch).map((k) => [k, rec[k] == null ? null : rec[k]]));
        DB.update(id, patch);
        undo.push({ label: `Updated ${DB.name(id)}: ${Object.keys(patch).map((k) => `${DB.meta(obj).field[k].label} → ${DB.display(obj, k, patch[k]) || (DB.meta(obj).field[k].type === 'lookup' ? DB.name(patch[k]) : patch[k])}`).join(', ')}`, id, run: () => DB.update(id, old) });
        return `Updated [[${id}]]: ${JSON.stringify(patch)}`;
      } },
    log_task: { label: 'Log a task', change: true, args: '{ "subject": "…", "relatedId": "record Id", "days": 1, "priority": "Normal" }',
      run: ({ subject, relatedId, days, priority }, undo) => {
        const rel = relatedId && DB.get(relatedId) ? relatedId : null;
        const ro = rel && DB.objectOf(rel);
        const who = ['Contact', 'Lead'].includes(ro);
        const t = DB.insert('Task', { Subject: subject || 'Follow up', ActivityDate: addDays(today(), Number(days) || 0), Priority: priority || 'Normal', Status: 'Not Started', OwnerId: DB.org().me, WhoId: who ? rel : null, WhatId: who ? null : rel });
        undo.push({ label: `Task “${t.Subject}” due ${fmt.dateShort(t.ActivityDate)}`, id: t.Id, run: () => DB.remove(t.Id) });
        return `Created task [[${t.Id}]]`;
      } },
    draft_email: { label: 'Draft an email', args: '{ "to": "Contact/Lead Id", "about": "related record Id", "subject": "…", "body": "…" }',
      run: ({ to, about, subject, body }, undo, out) => { out.drafts.push({ to, about, subject, body }); return 'Draft shown to the user with a button to open it in the email composer. Do not claim it was sent.'; } },
    post_slack: { label: 'Post to Slack', change: true, args: '{ "channel": "channel name", "text": "…", "recordId": "optional" }',
      run: ({ channel, text, recordId }, undo) => {
        const msg = DB.slackPost(String(channel || 'general').replace(/^#/, ''), text, DB.org().me, { recordId: DB.get(recordId) ? recordId : null });
        const name = DB.channel(msg.ch).name;
        undo.push({ label: `Posted in #${name}`, run: () => { const a = DB.org().slack.messages; const i = a.indexOf(msg); if (i >= 0) a.splice(i, 1); DB.save(); DB.emit({ kind: 'slack' }); }, href: `#/app/slack/slack?ch=${name}` });
        return `Posted to #${name}`;
      } },
    report: { label: 'Run numbers', args: '{ "object": "Opportunity", "filters": [], "groupBy": "StageName | CloseDate:month | Account.Industry", "fn": "count|sum|avg", "field": "Amount" }',
      run: ({ object, filters, groupBy, fn, field }) => {
        objOk(object);
        const fl = (filters || []).map((x) => { const f = Filters.fieldOf(object, x[0]); return f ? [x[0], x[1], Filters.coerce(f, x[1], x[2])] : null; }).filter(Boolean);
        const res = DB.runReport({ object, filters: fl, groupBy: groupBy || null, aggregate: fn && fn !== 'count' && field ? { fn, field } : { fn: 'count' } });
        const f = Charts.formatterFor(res.meta, res.agg);
        return `Total: ${f(res.total)} over ${res.rows.length} rows.` + (res.groups.length ? '\n' + res.groups.slice(0, 20).map((g) => `- ${g.key}: ${f(g.value)} (${g.rows.length})`).join('\n') : '');
      } },
    navigate: { label: 'Open a page', args: '{ "id": "record Id" } or { "hash": "#/app/sales/Opportunity" }',
      run: ({ id, hash }, undo, out) => { out.go = id ? '#/r/' + id : hash; return 'Opening it for the user.'; } },
    knowledge: { label: 'Search Knowledge', args: '{ "q": "words" }',
      run: ({ q }) => {
        const words = String(q || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
        const arts = DB.all('Knowledge').filter((k) => k.PublishStatus !== 'Archived').map((k) => ({ k, s: words.filter((w) => `${k.Title} ${k.Summary} ${k.Body}`.toLowerCase().includes(w)).length })).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 3);
        return arts.length ? arts.map(({ k }) => `[[${k.Id}]] ${k.Title}\n${String(k.Body || k.Summary || '').slice(0, 900)}`).join('\n\n') : 'No articles match.';
      } },
    order_status: { label: 'Check an order', args: '{ "orderNumber": "00001234" or "accountId": "…" }',
      run: ({ orderNumber, accountId }) => {
        const rows = DB.all('Order').filter((o) => (orderNumber && String(o.OrderNumber).includes(String(orderNumber).replace(/\D/g, ''))) || (accountId && o.AccountId === accountId)).slice(0, 5);
        return rows.length ? asList(rows, 'Order') : 'No order found with that number.';
      } },
    create_case: { label: 'Open a case', change: true, args: '{ "subject": "…", "description": "…", "contactId": "optional", "priority": "Medium" }',
      run: ({ subject, description, contactId, priority }, undo) => {
        const con = DB.get(contactId);
        const c = DB.insert('Case', { Subject: subject, Description: description, Origin: 'Chat', Priority: priority || 'Medium', Status: 'New', ContactId: con ? con.Id : null, AccountId: con ? con.AccountId : null });
        undo.push({ label: `Opened case ${DB.name(c.Id)}`, id: c.Id, run: () => DB.remove(c.Id) });
        return `Opened case [[${c.Id}]] (${DB.name(c.Id)})`;
      } },
  };

  // ---------- agents ----------

  const agents = () => DB.cfg.list('agents');
  const employeeAgents = () => agents().filter((a) => a.active && a.kind !== 'customer');
  function agent() {
    const list = employeeAgents();
    return list.find((a) => a.id === chat.agentId) || list[0] || agents()[0];
  }

  function context() {
    const c = Shell.current();
    if (c.recordId && DB.get(c.recordId)) return { label: DB.name(c.recordId), text: `The user is looking at this record:\n${Einstein.recordContext(c.recordId, { depth: 2, rows: 5 })}`, id: c.recordId };
    if (c.obj) return { label: DB.meta(c.obj).plural, text: `The user is on the ${DB.meta(c.obj).plural} list.` };
    if (c.reportId) { const r = DB.cfg.get('reports', c.reportId); return r ? { label: r.name, text: `The user is looking at the report "${r.name}" on ${r.object}${r.groupBy ? ' grouped by ' + r.groupBy : ''}.` } : null; }
    if (c.dashboardId) { const d = DB.cfg.get('dashboards', c.dashboardId); return d ? { label: d.name, text: `The user is looking at the dashboard "${d.name}".` } : null; }
    return null;
  }

  function systemFor(ag) {
    const allowed = (ag.actions || []).filter((a) => ACTIONS[a]);
    return [
      `You are ${ag.name}, an Agentforce agent. Role: ${ag.role}`,
      `Instructions: ${ag.instructions}`,
      `Tone: ${ag.tone || 'clear and friendly'}.`,
      ag.topics && ag.topics.length ? `Topics you handle: ${ag.topics.map((t) => `${t.name} (${t.desc})`).join('; ')}. Politely decline anything else.` : '',
      'Work in steps. Each reply picks ONE action and its JSON args, or action "answer" with your final answer for the user.',
      'Actions:\n' + allowed.map((a) => `- ${a}: ${ACTIONS[a].label}. args ${ACTIONS[a].args}`).join('\n') + '\n- answer: finish. Put the reply in "answer".',
      `Objects: ${DB.objects().join(', ')}. Use exact field API names (call get on a record to see them).`,
      'Never make up record Ids — find them with search/query first. After changing something, say exactly what you changed.',
    ].filter(Boolean).join('\n');
  }

  // run(text) uses the panel's agent, conversation and page context. Other surfaces (the Storefront's
  // customer chat) pass their own: run(text, { agentId, msgs: [{ role: 'user'|'agent', text }], context: { text } | null }).
  async function run(text, opts = {}) {
    const ag = opts.agentId ? agents().find((a) => a.id === opts.agentId && a.active) : agent();
    if (!ag) throw new Error('No active agent. Turn one on in Agent Builder.');
    const ctx = 'context' in opts ? opts.context : context();
    const history = (opts.msgs || chat.msgs).filter((m) => m.role === 'user' || m.role === 'agent').slice(-9, -1).map((m) => `${m.role === 'user' ? 'User' : ag.name}: ${m.text}`).join('\n');
    const steps = [];
    const undo = [];
    const out = { drafts: [], go: null };
    const allowed = (ag.actions || []).filter((a) => ACTIONS[a]);
    for (let i = 0; i < MAX_STEPS; i++) {
      const last = i === MAX_STEPS - 1;
      const r = await Einstein.ask({ task: 'agent', system: systemFor(ag),
        prompt: `${ctx ? ctx.text + '\n\n' : ''}${history ? 'Conversation so far:\n' + history + '\n\n' : ''}User: ${text}\n\n${steps.length ? 'Steps so far:\n' + steps.map((s, n) => `${n + 1}. ${s.action} ${JSON.stringify(s.args)} →\n${String(s.result).slice(0, 2500)}`).join('\n') + '\n\n' : ''}${last ? 'This is the last step: answer now.' : 'Pick the next action.'}`,
        schema: Einstein.S.obj({ thought: Einstein.S.str('one short line: what you are doing and why'), action: Einstein.S.oneOf(allowed.concat(['answer'])), args: Einstein.S.str('the action args as a JSON object, or {}'), answer: Einstein.S.str('final answer when action is answer, else empty') }) });
      if (r.action === 'answer' || !ACTIONS[r.action] || last) return { text: r.answer || r.thought || 'Done.', steps, undo, out, meta: r.meta, agent: ag };
      let args = {};
      try { args = typeof r.args === 'string' ? JSON.parse(r.args || '{}') : r.args || {}; } catch (e) { steps.push({ action: r.action, args: r.args, thought: r.thought, result: 'Error: args were not valid JSON. Send a JSON object.' }); continue; }
      let result;
      try { result = await ACTIONS[r.action].run(args, undo, out); } catch (e) { result = 'Error: ' + e.message; }
      steps.push({ action: r.action, args, thought: r.thought, result });
      const log = DB.org().agentLog;
      log.unshift({ id: DB.uid('al'), at: new Date().toISOString(), user: DB.org().me, task: 'agent-action', agent: ag.name, action: r.action, args, ok: !String(result).startsWith('Error'), prompt: `${r.action} ${JSON.stringify(args)}\n→ ${String(result).slice(0, 600)}` });
      if (log.length > 400) log.length = 400;
    }
    return { text: 'I ran out of steps.', steps, undo, out, agent: ag };
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || chat.busy) return;
    chat.msgs.push({ role: 'user', text, at: Date.now() });
    if (!Einstein.ready()) {
      chat.msgs.push({ role: 'agent', text: Einstein.state().problem || 'Pick an AI in Settings first.', setup: true });
      changed();
      return;
    }
    chat.busy = true;
    changed();
    try {
      const r = await run(text);
      chat.msgs.push({ role: 'agent', text: r.text, steps: r.steps, undo: r.undo, drafts: r.out.drafts, meta: r.meta, agent: r.agent.name, icon: r.agent.icon });
      DB.save();
      if (r.out.go) Shell.go(r.out.go);
    } catch (e) {
      chat.msgs.push({ role: 'agent', text: e.message, error: true });
    }
    chat.busy = false;
    changed();
  }

  // ---------- the chat UI (used by the side panel and the Agentforce page) ----------

  function suggestions() {
    const c = Shell.current();
    const obj = c.recordId ? DB.objectOf(c.recordId) : c.obj;
    const by = {
      Opportunity: ['Summarize this deal and its risks', 'What should I do next to win this?', 'Log a follow-up call for Friday', 'Post an update to #deals'],
      Account: ['Brief me on this account', 'Which open deals and cases does it have?', 'Who are the key contacts?'],
      Case: ['Summarize this case', 'Find a Knowledge article that solves it', 'Draft a reply to the customer', 'Escalate it to High priority'],
      Lead: ['Qualify this lead', 'Draft a first-touch email', 'Create a follow-up task for tomorrow'],
      Contact: ['What do we know about this person?', 'Draft a check-in email'],
    };
    return by[obj] || ['What are my top deals this quarter?', 'Which cases are at risk of escalating?', 'Show my overdue tasks', 'How many leads came from Web this month?'];
  }

  function message(m) {
    if (m.role === 'user') return h('div.msg.user', h('div.bubble', m.text));
    const body = h('div.bubble', md(m.text));
    if (m.setup) body.append(h('a.btn.sm', { href: '#/settings' }, 'Open Settings'));
    const extra = [];
    for (const d of m.drafts || []) {
      const to = DB.get(d.to) ? d.to : null;
      extra.push(h('div.draft', h('div.draft-h', '✉️ Draft email', to ? ` to ${DB.name(to)}` : ''), h('b', d.subject || ''), h('p.pre', d.body || ''),
        h('button.btn.sm', { onclick: () => Record.email(d.about && DB.get(d.about) ? d.about : to, { to: to ? (DB.get(to).Email || '') : '', subject: d.subject, body: d.body }) }, 'Open in composer')));
    }
    if (m.undo && m.undo.length) {
      extra.push(h('div.changes', h('div.ch-h', `✅ ${m.undo.length} change${m.undo.length > 1 ? 's' : ''}`), m.undo.map((u) => h('div.change',
        h('span.grow', u.id && DB.get(u.id) ? h('a.reclink', { href: '#/r/' + u.id }, u.label) : u.href ? h('a.reclink', { href: u.href }, u.label) : u.label),
        u.undone ? h('span.muted.sm', 'undone') : h('button.link', { onclick: () => { try { u.run(); u.undone = true; UI.toast('Undone'); changed(); } catch (e) { UI.toast(e.message, 'err'); } } }, 'Undo')))));
    }
    if (m.steps && m.steps.length) {
      extra.push(h('details.steps', h('summary', `${m.steps.length} step${m.steps.length > 1 ? 's' : ''}`), m.steps.map((s) => h('div.step-row',
        h('code', s.action), h('span.muted', s.thought || ''), h('pre', String(s.result).slice(0, 600))))));
    }
    return h(`div.msg.agent${m.error ? '.err' : ''}`, h('span.avatar.bot', m.icon || '🤖'), h('div.grow', body, extra, m.meta ? h('div.ai-foot', `${m.agent || ''} · ${m.meta.model || ''}`) : null));
  }

  function chatUI({ wide, close } = {}) {
    const root = h(`div.agentchat${wide ? '.big' : ''}`);
    const list = h('div.msgs');
    const input = h('textarea', { rows: 2, placeholder: 'Ask Agentforce to find, update, log, draft or post…', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } } });
    const go = () => { const t = input.value; input.value = ''; send(t); };
    const pick = h('select.agentpick', { onchange: (e) => { chat.agentId = e.target.value; draw(); } });
    const ctxLine = h('div.ctxline');
    function draw() {
      const ag = agent();
      pick.replaceChildren(...employeeAgents().map((a) => h('option', { value: a.id, selected: ag && a.id === ag.id }, `${a.icon} ${a.name}`)));
      const c = context();
      ctxLine.replaceChildren(c ? h('span', '📎 ', c.label) : h('span.muted', 'No record in view'));
      list.replaceChildren(...(chat.msgs.length ? chat.msgs.map(message) : [h('div.hello', h('div.hello-ic', ag ? ag.icon : '🤖'), h('h3', `Hi, I'm ${ag ? ag.name : 'Agentforce'}`), h('p.muted', ag ? ag.role : ''))]), chat.busy ? h('div.msg.agent', h('span.avatar.bot', ag ? ag.icon : '🤖'), h('div.bubble', h('span.typing', h('i'), h('i'), h('i')))) : '');
      if (!chat.busy) list.append(h('div.suggest', suggestions().map((s) => h('button.chip', { onclick: () => send(s) }, s))));
      list.scrollTop = list.scrollHeight;
    }
    const sendBtn = h('button.btn.primary.ai', { onclick: go, title: 'Send' }, '➤');
    root.append(
      h('header.agenthead', h('span.af-logo', '🤖'), h('b', 'Agentforce'), pick, h('div.grow'),
        h('button.iconbtn.sm', { title: 'New conversation', onclick: () => { chat.msgs = []; draw(); } }, '↺'),
        close ? h('button.iconbtn.sm', { title: 'Close', onclick: close }, '×') : null),
      list, h('div.composer', ctxLine, h('div.row', input, sendBtn)));
    const l = () => { if (root.isConnected) draw(); else listeners.delete(l); };
    listeners.add(l);
    window.addEventListener('hashchange', () => setTimeout(l, 0));
    draw();
    return root;
  }

  function panel(close) { return chatUI({ close }); }

  // ---------- Pages: Agentforce home, Agent Builder, Prompt Builder, Agent Log ----------

  Pages.agent = { title: 'Agentforce', icon: '🤖', live: false, render: () => h('div.page.agentpage',
    h('header.pagehead', h('span.objicon', { style: { width: '40px', height: '40px', background: '#0d9dda' } }, '🤖'), h('div', h('div.eyebrow', 'Agentforce'), h('h1', 'Your agents')), h('div.grow'),
      h('a.btn', { href: '#/app/agentforce/agent-builder' }, 'Agent Builder')),
    h('div.agent-cols', chatUI({ wide: true }),
      h('aside.agent-side', UI.card('Agents', h('div', agents().map((a) => h(`button.agentrow${agent() && agent().id === a.id ? '.on' : ''}`, { disabled: !a.active || a.kind === 'customer', onclick: () => { chat.agentId = a.id; changed(); Shell.render(); } },
        h('span.ag-ic', a.icon), h('div.grow', h('b', a.name), h('small', a.kind === 'customer' ? 'Customer-facing · try it on the Storefront' : a.active ? (a.actions || []).length + ' actions' : 'Inactive'))))), { icon: '🧑‍🚀' }),
      UI.card('What agents can do', h('ul.plain', Object.entries(ACTIONS).map(([k, a]) => h('li', h('code', k), ' ', a.label, a.change ? h('span.muted', ' · changes data, undoable') : null))), { icon: '🧰' })))) };

  // Agent Builder
  const adrafts = {};
  Pages['agent-builder'] = { title: 'Agent Builder', icon: '🛠️', render: (ctx) => {
    const id = ctx.params.id;
    if (id) return agentEditor(id);
    return h('div.page',
      h('header.pagehead', h('div', h('div.eyebrow', 'Agentforce'), h('h1', 'Agent Builder')), h('div.grow'),
        h('button.btn.ai', { onclick: () => agentFromWords() }, '✨ Describe an agent'),
        h('button.btn.primary', { onclick: () => { const a = DB.cfg.add('agents', { name: 'New Agent', kind: 'employee', active: false, icon: '🤖', tone: 'Clear and friendly', role: '', instructions: '', actions: ['search', 'query', 'get'], topics: [] }); ctx.set({ id: a.id }); } }, 'New agent')),
      h('div.cardgrid', agents().map((a) => h('a.agentcard', { href: `#/app/agentforce/agent-builder?id=${a.id}` },
        h('div.ac-top', h('span.ag-ic.big', a.icon), h('div.grow', h('b', a.name), h('small', a.kind === 'customer' ? 'Customer-facing' : 'Employee')), a.active ? UI.badge('Active', '#2e844a') : UI.badge('Inactive', '#888')),
        h('p', a.role), h('div.chips', (a.topics || []).map((t) => h('span.chip.sm', t.name)))))));
  } };

  async function agentFromWords() {
    const words = h('textarea', { rows: 3, placeholder: 'e.g. “an agent that keeps renewals on track: finds accounts renewing in 60 days, checks health, logs a task for the owner and posts a summary to #renewals”' });
    UI.modal({ title: '✨ Describe an agent', body: h('div', words), actions: [{ label: 'Cancel', run: () => {} }, { label: '✨ Build agent', primary: true, run: async () => {
      if (!words.value.trim()) return false;
      try {
        const r = await Einstein.ask({ task: 'agent-design', prompt: `Design an Agentforce agent for ${DB.org().company} from this description: ${words.value.trim()}\nAvailable actions: ${Object.keys(ACTIONS).map((k) => `${k} (${ACTIONS[k].label})`).join(', ')}`,
          schema: Einstein.S.obj({ name: Einstein.S.str(), icon: Einstein.S.str('one emoji'), kind: Einstein.S.oneOf(['employee', 'customer']), tone: Einstein.S.str(), role: Einstein.S.str('one or two sentences'), instructions: Einstein.S.str('3-6 clear rules'),
            actions: Einstein.S.arr(Einstein.S.oneOf(Object.keys(ACTIONS))), topics: Einstein.S.arr(Einstein.S.obj({ name: Einstein.S.str(), desc: Einstein.S.str() })) }) });
        const a = DB.cfg.add('agents', { name: r.name, icon: r.icon || '🤖', kind: r.kind, tone: r.tone, role: r.role, instructions: r.instructions, actions: (r.actions || []).filter((x) => ACTIONS[x]), topics: r.topics || [], active: false, ai: words.value.trim() });
        UI.toast(`${a.name} drafted — review and activate`, 'ai');
        Shell.go(`#/app/agentforce/agent-builder?id=${a.id}`);
      } catch (e) { UI.toast(e.message, 'err'); return false; }
    } }] });
  }

  function agentEditor(id) {
    const src = DB.cfg.get('agents', id);
    if (!src) return UI.empty('🤖', 'Agent not found');
    const d = adrafts[id] || (adrafts[id] = JSON.parse(JSON.stringify(src)));
    const inp = (k, ph) => h('input', { value: d[k] || '', placeholder: ph, oninput: (e) => { d[k] = e.target.value; } });
    const ta = (k, rows, ph) => h('textarea', { rows, placeholder: ph, oninput: (e) => { d[k] = e.target.value; } }, d[k] || '');
    const instr = ta('instructions', 5, 'Rules the agent always follows');
    const topics = h('div.topics');
    const drawTopics = () => topics.replaceChildren(...d.topics.map((t, i) => h('div.row', h('input', { value: t.name, placeholder: 'Topic', oninput: (e) => { t.name = e.target.value; } }), h('input.grow', { value: t.desc, placeholder: 'What it covers', oninput: (e) => { t.desc = e.target.value; } }),
      h('button.iconbtn.sm', { onclick: () => { d.topics.splice(i, 1); drawTopics(); } }, '×'))), h('button.link', { onclick: () => { d.topics.push({ name: '', desc: '' }); drawTopics(); } }, '+ Add topic'));
    d.topics = d.topics || [];
    drawTopics();
    const save = () => { DB.cfg.update('agents', id, d); delete adrafts[id]; UI.toast('Agent saved'); };
    return h('div.page',
      h('header.pagehead', h('span.ag-ic.big', d.icon), h('div', h('div.eyebrow', 'Agent Builder'), h('h1', d.name)), h('div.grow'),
        h('label.switch', { title: 'Active' }, h('input', { type: 'checkbox', checked: !!d.active, onchange: (e) => { d.active = e.target.checked; } }), h('span.slider')),
        h('button.btn', { onclick: () => { delete adrafts[id]; Shell.go('#/app/agentforce/agent-builder'); } }, 'Back'),
        h('button.btn', { onclick: () => { save(); chat.agentId = id; chat.msgs = []; Shell.togglePanel(true); changed(); } }, 'Test in panel'),
        h('button.btn.danger', { onclick: async () => { if (await UI.confirm(`Delete ${d.name}?`, 'This agent will be gone.')) { DB.cfg.remove('agents', id); Shell.go('#/app/agentforce/agent-builder'); } } }, 'Delete'),
        h('button.btn.primary', { onclick: save }, 'Save')),
      h('div.homegrid',
        UI.card('Profile', h('div.form-grid', h('label', 'Name', inp('name')), h('label', 'Icon', inp('icon', '🤖')),
          h('label', 'Who it talks to', h('select', { onchange: (e) => { d.kind = e.target.value; } }, [['employee', 'Employees (in Stratus)'], ['customer', 'Customers (Storefront chat)']].map(([v, l]) => h('option', { value: v, selected: d.kind === v }, l)))),
          h('label', 'Tone', inp('tone', 'e.g. Warm and brief')), h('label.wide', 'Role', ta('role', 2, 'What this agent is for'))), { icon: '🪪' }),
        UI.card('Instructions', h('div', instr,
          h('button.btn.sm.ai', { onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true;
            try {
              const r = await Einstein.ask({ task: 'agent-instructions', prompt: `Improve the instructions for an Agentforce agent.\nRole: ${d.role}\nTone: ${d.tone}\nActions it can take: ${(d.actions || []).join(', ')}\nCurrent instructions: ${d.instructions || '(none)'}\n\nWrite 4-7 clear numbered rules covering when to act, what to check first, guardrails, and how to confirm changes. Return only the rules.` });
              d.instructions = r.text.trim(); instr.value = d.instructions; UI.toast('Instructions improved', 'ai');
            } catch (err) { UI.toast(err.message, 'err'); }
            b.disabled = false;
          } }, '✨ Improve instructions')), { icon: '📋' }),
        UI.card('Actions', h('div.checks', Object.entries(ACTIONS).map(([k, a]) => h('label.check', h('input', { type: 'checkbox', checked: (d.actions || []).includes(k), onchange: (e) => { d.actions = e.target.checked ? uniq((d.actions || []).concat([k])) : d.actions.filter((x) => x !== k); } }),
          h('span', h('code', k), ' ', a.label, a.change ? h('small.muted', ' · changes data') : null)))), { icon: '🧰' }),
        UI.card('Topics', topics, { icon: '🗂' })));
  }

  // Prompt Builder
  const pstate = {};
  Pages['prompt-builder'] = { title: 'Prompt Builder', icon: '🧪', render: (ctx) => {
    const list = DB.cfg.list('prompts');
    const id = ctx.params.id || (list[0] && list[0].id);
    const p = DB.cfg.get('prompts', id);
    const side = h('nav.facets', list.map((x) => h('button' + (x.id === id ? '.on' : ''), { onclick: () => ctx.set({ id: x.id }) }, h('span', x.name), h('small.muted', ` ${x.type}`))),
      h('button.link', { onclick: () => { const n = DB.cfg.add('prompts', { name: 'New prompt', type: 'Flex', object: 'Account', template: 'Write a short note about {!Name}.' }); ctx.set({ id: n.id }); } }, '+ New template'));
    if (!p) return h('div.page', h('h1', 'Prompt Builder'), side);
    const st = pstate[id] || (pstate[id] = { recordId: (DB.all(p.object)[0] || {}).Id, out: null });
    const tpl = h('textarea.code', { rows: 7, oninput: debounce((e) => { p.template = e.target.value; DB.cfg.update('prompts', id, { template: p.template }); drawPreview(); }, 400) }, p.template);
    const m = DB.meta(p.object);
    const mergeSel = h('select', { onchange: (e) => { if (!e.target.value) return; const at = tpl.selectionStart || tpl.value.length; tpl.setRangeText(`{!${e.target.value}}`, at, at, 'end'); tpl.dispatchEvent(new Event('input')); e.target.value = ''; tpl.focus(); } },
      h('option', { value: '' }, '+ Insert merge field'), m.fields.filter((f) => !f.hidden && f.type !== 'json').map((f) => h('option', { value: f.type === 'lookup' && f.name.endsWith('Id') ? f.name.slice(0, -2) + '.Name' : f.name }, f.label)), h('option', { value: '$User.Name' }, 'Current user name'));
    const recSel = h('select', { onchange: (e) => { st.recordId = e.target.value; st.out = null; drawPreview(); } }, DB.all(p.object).slice(0, 60).map((r) => h('option', { value: r.Id, selected: r.Id === st.recordId }, DB.name(r.Id))));
    const resolved = h('pre.prompt');
    const outBox = h('div.pb-out');
    function drawPreview() {
      const rec = DB.get(st.recordId);
      resolved.textContent = DB.merge(p.template, rec);
      outBox.replaceChildren(st.out ? h('div', md(st.out.text), st.out.meta ? h('div.ai-foot', `✨ ${st.out.meta.word} · ${st.out.meta.model} · ${(st.out.meta.ms / 1000).toFixed(1)}s`) : null,
        p.type === 'Field Generation' && p.field ? h('button.btn.sm', { onclick: () => { DB.update(st.recordId, { [p.field]: st.out.text.trim() }); UI.toast(`Saved to ${m.field[p.field] ? m.field[p.field].label : p.field}`); } }, `Save to ${m.field[p.field] ? m.field[p.field].label : p.field}`) : null) : h('p.muted', 'Run the prompt to see what the AI writes for this record.'));
    }
    drawPreview();
    const runBtn = h('button.btn.ai', { onclick: async () => {
      runBtn.disabled = true; outBox.replaceChildren(UI.spinner(`${Einstein.word()} is writing…`));
      try { st.out = await Einstein.ask({ task: 'prompt-builder', prompt: `${resolved.textContent}\n\nRecord details:\n${Einstein.recordContext(st.recordId, { depth: 1 })}` }); }
      catch (e) { st.out = { text: '⚠️ ' + e.message }; }
      runBtn.disabled = false; drawPreview();
    } }, '✨ Run prompt');
    const improve = h('button.btn.sm', { onclick: async () => {
      improve.disabled = true;
      try {
        const r = await Einstein.ask({ task: 'prompt-improve', prompt: `Improve this prompt template for a CRM. Keep every {!Merge.Field} that is useful, add clear constraints (length, tone, format), and return only the new template.\n\nType: ${p.type}\nObject: ${p.object}\nTemplate:\n${p.template}` });
        p.template = r.text.trim(); tpl.value = p.template; DB.cfg.update('prompts', id, { template: p.template }); drawPreview(); UI.toast('Template improved', 'ai');
      } catch (e) { UI.toast(e.message, 'err'); }
      improve.disabled = false;
    } }, '✨ Improve template');
    return h('div.page.promptpage',
      h('header.pagehead', h('div', h('div.eyebrow', 'Agentforce · Prompt Builder'), h('h1', p.name)), h('div.grow'),
        h('button.btn.danger', { onclick: async () => { if (await UI.confirm(`Delete ${p.name}?`, 'The template will be gone.')) { DB.cfg.remove('prompts', id); ctx.set({ id: null }); } } }, 'Delete')),
      h('div.search-cols', side, h('div.search-res',
        UI.card('Template', h('div', h('div.form-grid',
          h('label', 'Name', h('input', { value: p.name, onchange: (e) => DB.cfg.update('prompts', id, { name: e.target.value }) })),
          h('label', 'Type', h('select', { onchange: (e) => DB.cfg.update('prompts', id, { type: e.target.value }) }, ['Sales Email', 'Service Reply', 'Record Summary', 'Field Generation', 'Flex'].map((t) => h('option', { selected: p.type === t }, t)))),
          h('label', 'Object', h('select', { onchange: (e) => { DB.cfg.update('prompts', id, { object: e.target.value }); delete pstate[id]; } }, DB.objects().filter((o) => !DB.meta(o).hidden).map((o) => h('option', { value: o, selected: p.object === o }, DB.meta(o).label)))),
          p.type === 'Field Generation' ? h('label', 'Writes into', h('select', { onchange: (e) => DB.cfg.update('prompts', id, { field: e.target.value }) }, m.fields.filter((f) => ['text', 'textarea'].includes(f.type) && !f.system).map((f) => h('option', { value: f.name, selected: p.field === f.name }, f.label)))) : null),
          tpl, h('div.row', mergeSel, h('div.grow'), improve)), { icon: '🧪' }),
        UI.card('Preview', h('div', h('div.row', h('span.muted', 'Record:'), recSel, h('div.grow'), runBtn), h('div.eyebrow', 'Resolved prompt'), resolved, h('div.eyebrow', 'Response'), outBox), { icon: '👁' }))));
  } };

  // Agent Log
  Pages['agent-log'] = { title: 'Agent Log', icon: '📜', render: (ctx) => {
    const log = DB.org().agentLog;
    const feature = ctx.params.f || null;
    const calls = log.filter((e) => e.task !== 'agent-action');
    const acts = log.filter((e) => e.task === 'agent-action');
    const byTask = groupBy(calls, (e) => e.task);
    const ok = calls.filter((e) => e.ok).length;
    const ms = calls.filter((e) => e.ms);
    const rows = (feature ? log.filter((e) => e.task === feature) : log).slice(0, 150);
    return h('div.page',
      h('header.pagehead', h('div', h('div.eyebrow', 'Agentforce'), h('h1', 'Agent Log')), h('div.grow'), h('a.btn', { href: '#/setup/trust' }, '🛡 Trust Layer')),
      h('div.kpis', UI.stat('AI calls', fmt.num(calls.length)), UI.stat('Success rate', calls.length ? fmt.pct((ok / calls.length) * 100) : '—'),
        UI.stat('Avg response', ms.length ? (sum(ms, (e) => e.ms) / ms.length / 1000).toFixed(1) + 's' : '—'), UI.stat('Agent actions', fmt.num(acts.length)), UI.stat('Items masked', fmt.num(sum(calls, (e) => e.masked || 0)))),
      h('div.homegrid',
        UI.card('Calls by feature', Charts.draw('hbar', Object.entries(byTask).map(([k, v]) => ({ label: k, value: v.length, key: k })).sort((a, b) => b.value - a.value).slice(0, 12), { onClick: (d) => ctx.set({ f: d.key }) }), { icon: '📊' }),
        UI.card('Actions agents took', acts.length ? h('div', acts.slice(0, 12).map((e) => h('div.trow', h('code', e.action), h('div.grow', h('small', `${e.agent} · ${fmt.ago(e.at)}`)), e.ok ? h('span.ok', '✓') : h('span.err', '✗')))) : h('p.muted', 'No agent actions yet.'), { icon: '🧰' })),
      UI.card(feature ? `Log · ${feature}` : 'Log', h('div', feature ? h('div.chips', h('span.fchip', feature, h('button.x', { onclick: () => ctx.set({ f: null }) }, '×'))) : null,
        rows.length ? h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', ['When', 'Feature', 'Who', 'Model', 'Result', ''].map((x) => h('th', x)))),
          h('tbody', rows.map((e) => h('tr', h('td', fmt.ago(e.at)), h('td', h('code', e.task === 'agent-action' ? `${e.action}` : e.task)), h('td', e.agent || DB.name(e.user) || ''),
            h('td.muted', e.model ? `${e.word || ''} · ${e.model}` : ''), h('td', e.ok ? h('span.ok', '✓') : h('span.err', '✗ ' + String(e.error || '').slice(0, 60))),
            h('td.act', h('button.link', { onclick: () => UI.modal({ title: e.task, wide: true, body: h('pre.prompt', e.prompt || '') }) }, 'Details'))))))) : UI.empty('📜', 'Nothing logged yet', 'Use any ✨ feature or chat with an agent.')), { icon: '📜' }));
  } };

  return { panel, send, run, chatUI, ACTIONS, agents, onChange: (f) => listeners.add(f) };
})();
