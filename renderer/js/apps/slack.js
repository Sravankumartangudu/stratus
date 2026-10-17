// slack.js — Slack: channels and DMs, threads, reactions, record unfurls, slash commands, and Agentforce
// answering inside the conversation. Messages live in DB.org().slack ({ channels, messages }).
//
//   message  { id, ch, user, text, at, thread (parent message id), recordId, reactions: { '👍': [userId] } }
//   channel  { id, name, topic, recordId, members, lastRead: { userId: iso }, dm? }
//
// The page redraws its own parts when Slack data changes (live: false), so a half-typed message is never lost.

Pages.slack = (() => {
  const REACTS = ['👍', '❤️', '🎉', '👀', '🙌', '✅', '🔥', '😂'];
  const BOTS = { Flow: { name: 'Flow', icon: '⚡' }, Agentforce: { name: 'Agentforce', icon: '🤖' }, Stratus: { name: 'Stratus', icon: '☁️' } };
  const RANGES = { yesterday: 'since yesterday', '3d': 'last 3 days', week: 'this week', all: 'everything' };
  const CMDS = [['/case', '<subject>', 'Open a Case from this channel'], ['/opp', '<name>', 'Find an opportunity and unfurl it'], ['/remind', 'in 2h <what>', 'Create a task and a reminder'], ['/help', '', 'List the commands']];

  const st = { thread: null, threadCh: null, typing: {}, recap: null, range: 'yesterday' };
  let view = null; // the parts of the page on screen

  const isBot = (u) => String(u || '').startsWith('bot:');
  const botOf = (u) => BOTS[String(u).slice(4)] || { name: String(u).slice(4) || 'App', icon: '🤖' };
  const who = (u) => (isBot(u) ? botOf(u).name : DB.name(u) || 'Someone');
  const me = () => DB.org().me;
  const slack = () => DB.org().slack;
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const msgsOf = (c) => slack().messages.filter((m) => m.ch === c.id).sort((a, b) => a.at.localeCompare(b.at));
  const repliesOf = (m) => slack().messages.filter((x) => x.thread === m.id).sort((a, b) => a.at.localeCompare(b.at));
  const lastRead = (c) => (c.lastRead && c.lastRead[me()]) || '';
  const unread = (c) => slack().messages.some((m) => m.ch === c.id && m.user !== me() && m.at > lastRead(c));
  const presence = (id) => [...String(id)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 3 !== 0;
  const changed = () => DB.emit({ kind: 'slack' });
  const first = (n) => String(n || '').split(' ')[0];
  const dmName = (c) => (c.dm === 'bot:Agentforce' ? 'Agentforce' : DB.name(c.dm) || c.name);

  function current(ctx) {
    return DB.channel(ctx.params.ch) || DB.channel('general') || slack().channels[0];
  }

  // ---------- demo touches: a thread, a few reactions and a mention (once per org) ----------

  function seedDemo() {
    const s = slack();
    if (s.demo || !s.messages.length) return;
    s.demo = true;
    const user = (n) => (DB.all('User').find((u) => u.Name === n) || {}).Id;
    const [alex, priya, jordan, maya, sam, nora, diego] = ['Alex Morgan', 'Priya Raman', 'Jordan Lee', 'Maya Chen', 'Sam Carter', 'Nora Patel', 'Diego Alvarez'].map(user);
    const find = (re, ch) => s.messages.find((m) => re.test(m.text) && (!ch || (DB.channel(ch) || {}).id === m.ch));
    const q = find(/good case study/, 'sales-team');
    const a = find(/Riverbend Farms one-pager/, 'sales-team');
    if (q && a) {
      a.thread = q.id;
      DB.slackPost(q.ch, 'Also attach the Atlas ROI sheet. Cold storage buyers love the payback chart.', priya, { raw: true, thread: q.id, at: new Date(new Date(a.at).getTime() + 25 * 60000).toISOString() });
      DB.slackPost(q.ch, 'Perfect, sending both this afternoon 🙏', jordan, { raw: true, thread: q.id, at: new Date(new Date(a.at).getTime() + 40 * 60000).toISOString() });
    }
    const react = (re, ch, map) => { const m = find(re, ch); if (m) for (const [e, ids] of Object.entries(map)) m.reactions[e] = ids.filter(Boolean); };
    react(/Welcome to Stratus/, 'general', { '🎉': [alex, maya, sam, diego], '👋': [jordan, nora] });
    react(/Big week/, 'sales-team', { '🔥': [alex, jordan], '👀': [maya] });
    react(/E-21 inverter faults/, 'support-escalations', { '👀': [alex, sam] });
    react(/rooftop survey done/, 'field-ops', { '🙌': [alex, nora], '👍': [nora] });
    react(/Subject line B/, 'marketing', { '🎉': [priya, alex] });
    const sales = DB.channel('sales-team');
    if (sales && alex) DB.slackPost(sales.id, '@Alex Morgan can you own the Summit Ridge pricing sheet before Friday’s forecast call?', priya, { raw: true, at: new Date(Date.now() - 50 * 60000).toISOString() });
    DB.save();
  }

  // ---------- text: mentions, record links, bold/code, #channels ----------

  function tokenRe() {
    const names = DB.all('User').flatMap((u) => [u.Name, first(u.Name)]).filter(Boolean);
    const alt = uniq(['Agentforce', 'channel', 'here', ...names]).sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return new RegExp('\\[\\[([a-zA-Z0-9]{15,18})\\]\\]|(?:stratus:\\/\\/r\\/|#\\/r\\/)([a-zA-Z0-9]{15,18})|\\*\\*(.+?)\\*\\*|\\*([^*\\n]+)\\*|`([^`\\n]+)`|@(' + alt + ')\\b|#([a-z][a-z0-9_-]{2,})', 'g');
  }
  const mentionsMe = (text) => {
    const n = DB.name(me());
    return new RegExp('@(' + [n, first(n), 'channel', 'here'].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i').test(text);
  };

  function lineNodes(line, ids) {
    const bullet = line.match(/^\s*[-•]\s+(.*)/);
    const text = bullet ? bullet[1] : line;
    const kids = bullet ? [h('span.sk-dot', '•')] : [];
    let last = 0;
    for (const m of text.matchAll(tokenRe())) {
      if (m.index > last) kids.push(text.slice(last, m.index));
      const [all, rid, rid2, b1, b2, code, men, chan] = m;
      const id = rid || rid2;
      if (id) {
        if (DB.get(id)) { ids.push(id); kids.push(h('a.sk-rec', { href: '#/r/' + id }, h('span.sk-rec-ic', DB.meta(DB.objectOf(id)).icon), DB.name(id))); } else kids.push(all);
      } else if (b1 || b2) kids.push(h('b', b1 || b2));
      else if (code) kids.push(h('code', code));
      else if (men) kids.push(h('span.sk-mention' + (mentionsMe('@' + men) ? '.me' : ''), '@' + men));
      else if (chan) kids.push(DB.channel(chan) ? h('a.sk-chan', { href: '#/app/slack/slack?ch=' + chan }, '#' + chan) : all);
      last = m.index + all.length;
    }
    if (last < text.length) kids.push(text.slice(last));
    return h('div.sk-line' + (bullet ? '.bul' : ''), kids.length ? kids : h('br'));
  }
  function rich(text) {
    const ids = [];
    const nodes = String(text || '').split('\n').map((l) => lineNodes(l, ids));
    return { nodes, ids: uniq(ids) };
  }

  // A compact record card for a message that links to a record.
  function unfurl(id) {
    const rec = DB.get(id);
    if (!rec) return null;
    const obj = DB.objectOf(id);
    const m = DB.meta(obj);
    const fields = (m.highlights || m.list || []).filter((f) => f !== m.nameField && m.field[f] && rec[f] != null && rec[f] !== '').slice(0, 4);
    return h('a.sk-unfurl', { href: '#/r/' + id, style: { '--c': m.color } },
      h('div.sk-uf-head', h('span.sk-uf-ic', m.icon), h('b', DB.name(id)), h('span.sk-uf-obj', m.label)),
      h('div.sk-uf-fields', fields.map((f) => {
        const fd = m.field[f];
        const v = fd.type === 'lookup' ? DB.name(rec[f]) : DB.display(obj, fd, rec[f]);
        return h('div', h('small', fd.label), h('span', v));
      })));
  }

  // ---------- messages ----------

  const dayLabel = (iso) => {
    const d = isoDay(iso);
    if (d === today()) return 'Today';
    if (d === addDays(today(), -1)) return 'Yesterday';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  function react(m, e) {
    m.reactions = m.reactions || {};
    const a = Array.isArray(m.reactions[e]) ? m.reactions[e] : (m.reactions[e] = []);
    const i = a.indexOf(me());
    if (i >= 0) a.splice(i, 1); else a.push(me());
    if (!a.length) delete m.reactions[e];
    DB.save();
    changed();
  }
  function removeMsg(m) {
    const s = slack();
    s.messages = s.messages.filter((x) => x.id !== m.id && x.thread !== m.id);
    if (st.thread === m.id) st.thread = null;
    DB.save();
    changed();
    if (view) view.drawThread();
  }
  function caseFromMessage(m) {
    const c = DB.get(m.ch) || DB.channel(m.ch);
    const subj = String(m.text).replace(/\[\[[^\]]+\]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'From Slack';
    try {
      const rec = DB.insert('Case', Object.assign({ Subject: subj, Origin: 'Slack', Description: `From Slack #${(c && c.name) || ''}, ${who(m.user)}:\n${m.text}` }, linkedAccount(DB.channel(m.ch))));
      DB.slackPost(m.ch, `📝 Case [[${rec.Id}]] opened from this message.`, 'bot:Stratus', { thread: m.thread || m.id, recordId: rec.Id });
      UI.toast('Case opened', 'ok', { label: 'Open', run: () => Shell.go('#/r/' + rec.Id) });
    } catch (e) { UI.toast(e.message, 'err'); }
  }
  function linkedAccount(c) {
    const rec = c && c.recordId && DB.get(c.recordId);
    if (!rec) return {};
    return DB.objectOf(rec.Id) === 'Account' ? { AccountId: rec.Id } : rec.AccountId ? { AccountId: rec.AccountId, ContactId: rec.ContactId || null } : {};
  }

  function msgTools(m, inThread) {
    const more = [
      { label: 'Copy text', icon: '⧉', run: () => UI.copy(m.text) },
      { label: 'Create a case from this', icon: '💼', run: () => caseFromMessage(m) },
      m.user === me() ? '-' : null,
      m.user === me() ? { label: 'Delete message', icon: '🗑', danger: true, run: async () => { if (await UI.confirm('Delete this message?', 'It will be removed for everyone.')) removeMsg(m); } } : null,
    ].filter(Boolean);
    return h('div.sk-tools',
      h('button', { title: 'Add reaction', onclick: (e) => UI.menu(e.currentTarget, REACTS.map((x) => ({ label: x, run: () => react(m, x) }))) }, '☺'),
      inThread ? null : h('button', { title: 'Reply in thread', onclick: () => openThread(m) }, '💬'),
      h('button', { title: 'More', onclick: (e) => UI.menu(e.currentTarget, more) }, '⋯'));
  }

  function msgNode(m, prev, inThread) {
    const bot = isBot(m.user);
    const compact = prev && prev.user === m.user && isoDay(prev.at) === isoDay(m.at) && new Date(m.at) - new Date(prev.at) < 5 * 60000;
    const { nodes, ids } = rich(m.text);
    if (m.recordId && DB.get(m.recordId) && !ids.includes(m.recordId)) ids.push(m.recordId);
    const reps = inThread ? [] : repliesOf(m);
    const rx = Object.entries(m.reactions || {}).filter(([, a]) => Array.isArray(a) && a.length);
    const av = bot ? h('span.sk-botav', botOf(m.user).icon) : UI.avatar(who(m.user), 36);
    return h('div.sk-msg' + (compact ? '.compact' : '') + (!bot && m.user !== me() && mentionsMe(m.text) ? '.mention' : ''), { dataset: { id: m.id } },
      h('div.sk-av', compact ? h('span.sk-t', fmt.time(m.at).replace(/ ?[AP]M/, '')) : av),
      h('div.sk-body',
        compact ? null : h('div.sk-meta', h('b.sk-name', who(m.user)), bot ? h('span.sk-app', 'APP') : null, h('span.sk-time', fmt.time(m.at))),
        h('div.sk-text', nodes),
        ids.slice(0, 3).map(unfurl),
        rx.length ? h('div.sk-reacts', rx.map(([e, a]) => h('button.sk-react' + (a.includes(me()) ? '.me' : ''), { title: a.map(who).join(', '), onclick: () => react(m, e) }, e, h('span', a.length))),
          h('button.sk-react.add', { title: 'Add reaction', onclick: (e) => UI.menu(e.currentTarget, REACTS.map((x) => ({ label: x, run: () => react(m, x) }))) }, '☺+')) : null,
        reps.length ? h('button.sk-replies', { onclick: () => openThread(m) },
          h('span.sk-rav', uniq(reps.map((r) => r.user)).slice(0, 3).map((u) => (isBot(u) ? h('span.sk-botav.xs', botOf(u).icon) : UI.avatar(who(u), 20)))),
          h('b', `${reps.length} ${reps.length === 1 ? 'reply' : 'replies'}`), h('span.muted', `Last reply ${fmt.ago(reps[reps.length - 1].at)}`), h('span.sk-view', 'View thread ›')) : null),
      msgTools(m, inThread));
  }

  function listNodes(msgs, inThread) {
    const out = [];
    let prev = null;
    for (const m of msgs) {
      if (!prev || isoDay(prev.at) !== isoDay(m.at)) { out.push(h('div.sk-day', h('span', dayLabel(m.at)))); prev = null; }
      out.push(msgNode(m, prev, inThread));
      prev = m;
    }
    return out;
  }

  // ---------- sending, slash commands and Agentforce ----------

  function openThread(m) { st.thread = m.id; st.threadCh = m.ch; view && view.drawThread(); }

  function bot(c, text, thread, recordId) { return DB.slackPost(c.id, text, 'bot:Stratus', { thread: thread || null, recordId: recordId || null }); }

  function parseWhen(s) {
    const now = Date.now();
    let m = s.match(/^(?:me\s+)?(?:to\s+)?in\s+(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)\b\s*(?:to\s+)?(.*)$/i);
    if (m) {
      const n = Number(m[1]);
      const unit = m[2][0].toLowerCase();
      return { ms: n * (unit === 'm' ? 60000 : unit === 'h' ? 3600000 : DAY), label: `in ${n} ${unit === 'm' ? 'min' : unit === 'h' ? (n === 1 ? 'hour' : 'hours') : (n === 1 ? 'day' : 'days')}`, text: m[3] };
    }
    m = s.match(/^(?:me\s+)?(?:to\s+)?(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday)\b\s*(?:to\s+)?(.*)$/i);
    if (m) {
      const w = m[1].toLowerCase();
      const d = new Date();
      d.setHours(w === 'today' || w === 'tonight' ? 17 : 9, 0, 0, 0);
      if (w === 'tomorrow') d.setDate(d.getDate() + 1);
      else if (!['today', 'tonight'].includes(w)) { const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(w); do d.setDate(d.getDate() + 1); while (d.getDay() !== target); }
      return { ms: Math.max(60000, d - now), label: w === 'tomorrow' ? 'tomorrow at 9:00 AM' : w === 'today' || w === 'tonight' ? 'today at 5:00 PM' : `${w[0].toUpperCase() + w.slice(1)} at 9:00 AM`, text: m[2] };
    }
    return { ms: DAY, label: 'tomorrow at 9:00 AM', text: s.replace(/^me\s+(to\s+)?/i, '') };
  }

  async function slash(c, text, thread) {
    const sp = text.indexOf(' ');
    const cmd = (sp < 0 ? text : text.slice(0, sp)).toLowerCase();
    const arg = sp < 0 ? '' : text.slice(sp + 1).trim();
    try {
      if (cmd === '/case') {
        if (!arg) { UI.toast('Say what the case is about: /case Inverter keeps tripping at Harborview', 'info'); return false; }
        const rec = DB.insert('Case', Object.assign({ Subject: arg, Origin: 'Slack', Description: `Opened from Slack #${c.name} by ${who(me())}.` }, linkedAccount(c)));
        bot(c, `📝 ${who(me())} opened case [[${rec.Id}]]: ${arg}`, thread, rec.Id);
      } else if (cmd === '/opp') {
        if (!arg) { UI.toast('Which opportunity? /opp Summit Ridge', 'info'); return false; }
        const rows = DB.query('Opportunity', { q: arg, limit: 3 });
        bot(c, rows.length ? `🔎 ${rows.length === 1 ? 'Found 1 opportunity' : `Found ${rows.length} opportunities`} matching “${arg}”: ${rows.map((r) => `[[${r.Id}]]`).join(' ')}` : `🔎 No opportunity matches “${arg}”.`, thread, rows[0] && rows[0].Id);
      } else if (cmd === '/remind') {
        if (!arg) { UI.toast('Try: /remind in 2h call the Harborview facilities lead', 'info'); return false; }
        const w = parseWhen(arg);
        const what = w.text.trim() || 'Reminder from Slack';
        const link = c.recordId && DB.get(c.recordId) && [].concat(DB.meta('Task').field.WhatId.ref).includes(DB.objectOf(c.recordId)) ? c.recordId : null;
        const task = DB.insert('Task', { Subject: what, Type: 'To Do', ActivityDate: isoDay(Date.now() + w.ms), WhatId: link, OwnerId: me(), Description: `Reminder set in Slack #${c.name}.` });
        if (w.ms < 6 * 3600000) setTimeout(() => UI.toast(`⏰ Reminder: ${what}`, 'info', link ? { label: 'Open', run: () => Shell.go('#/r/' + link) } : null), w.ms);
        bot(c, `⏰ Okay ${first(who(me()))}, I’ll remind you ${w.label}: “${what}”. Added to your tasks: [[${task.Id}]]`, thread);
      } else if (cmd === '/help') {
        bot(c, '*Slash commands*\n' + CMDS.map(([k, a, d]) => `- \`${k}${a ? ' ' + a : ''}\` ${d}`).join('\n') + '\n- Mention *@Agentforce* in any message to ask it to find, update or draft something.', thread);
      } else { UI.toast(`There's no ${cmd} command. Try /help.`, 'err'); return false; }
    } catch (e) { UI.toast(e.message, 'err'); return false; }
    return true;
  }

  async function send(c, raw, thread) {
    const text = raw.trim();
    if (!text) return false;
    if (text.startsWith('/')) return slash(c, text, thread);
    const msg = DB.slackPost(c.id, text, null, { thread: thread || null });
    if (/@agentforce\b/i.test(text) || c.dm === 'bot:Agentforce') askAgent(c, msg, thread);
    return true;
  }

  async function askAgent(c, msg, thread) {
    const clean = msg.text.replace(/@agentforce\b[,:]?/gi, '').trim() || 'Hello';
    st.typing[c.id] = (st.typing[c.id] || 0) + 1;
    view && view.drawList();
    const post = (t) => DB.slackPost(c.id, t, 'bot:Agentforce', { thread: thread || null });
    try {
      if (!Einstein.ready()) { post(`I can't answer yet. ${Einstein.state().problem || 'Pick an AI in Settings › AI.'}`); return; }
      const hist = msgsOf(c).filter((m) => (thread ? m.thread === thread || m.id === thread : !m.thread)).filter((m) => m.id !== msg.id).slice(-10)
        .map((m) => ({ role: m.user === 'bot:Agentforce' ? 'agent' : 'user', text: `${who(m.user)}: ${m.text}` }));
      hist.push({ role: 'user', text: clean });
      const r = await Agentforce.run(`${who(msg.user)} wrote in #${c.name}: ${clean}`, { msgs: hist, context: null });
      post(r.text + (r.undo && r.undo.length ? '\n' + r.undo.map((u) => `- ✅ ${u.label}`).join('\n') : ''));
    } catch (e) {
      post(`⚠️ ${e.message}`);
    } finally {
      st.typing[c.id] = Math.max(0, (st.typing[c.id] || 1) - 1);
      view && view.drawList();
    }
  }

  // Context for ✨ drafts and recaps.
  const lines = (msgs) => msgs.slice(-60).map((m) => `[${fmt.dateShort(m.at)} ${fmt.time(m.at)}] ${who(m.user)}: ${m.text}`).join('\n');

  function composer(c, thread) {
    const ta = h('textarea', { rows: 1, placeholder: thread ? 'Reply…' : c.dm ? `Message ${dmName(c)}` : `Message #${c.name}   (try /case, /opp, /remind or @Agentforce)`,
      onkeydown: async (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); }
      },
      oninput: () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; hints(); } });
    const hintBox = h('div.sk-hints');
    function hints() {
      const v = ta.value;
      const hit = v.startsWith('/') && !v.includes(' ') ? CMDS.filter(([k]) => k.startsWith(v.toLowerCase())) : [];
      hintBox.replaceChildren(...hit.map(([k, a, d]) => h('button', { onclick: () => { ta.value = k + ' '; ta.focus(); hints(); } }, h('b', k), h('span', a), h('small', d))));
    }
    async function go() {
      const v = ta.value;
      if (!v.trim()) return;
      ta.value = ''; ta.style.height = 'auto'; hints();
      const ok = await send(c, v, thread);
      if (ok === false) { ta.value = v; ta.focus(); }
    }
    const ins = (t) => { const at = ta.selectionStart || ta.value.length; ta.setRangeText(t, at, at, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); };
    const context = () => (thread ? msgsOf(c).filter((m) => m.id === thread || m.thread === thread) : msgsOf(c).filter((m) => !m.thread));
    return h('div.sk-composer', hintBox,
      h('div.sk-box', ta,
        h('div.sk-bar',
          h('button', { title: 'Mention', onclick: () => ins('@') }, '@'),
          h('button', { title: 'Emoji', onclick: (e) => UI.menu(e.currentTarget, REACTS.concat(['😊', '🤝', '⚡', '☀️']).map((x) => ({ label: x, run: () => ins(x) }))) }, '☺'),
          h('button', { title: 'Ask Agentforce', onclick: () => ins('@Agentforce ') }, '🤖'),
          Einstein.button('Draft reply', () => ({ task: 'slack-draft-reply', prompt: `Write the next message I (${who(me())}) should post in ${c.dm ? 'this DM' : '#' + c.name}${thread ? ' (in this thread)' : ''}. One to three short sentences, plain and friendly, no greeting fluff. Answer the latest open question if there is one.\n\nTopic: ${c.topic || ''}\n${c.recordId ? Einstein.recordContext(c.recordId, { depth: 1 }) + '\n' : ''}\nConversation:\n${lines(context())}`,
            schema: Einstein.S.obj({ reply: Einstein.S.str('the message to post') }) }), (r) => {
            // The page may have redrawn while the AI was thinking (a new message came in); fill the box on screen.
            const el = ta.isConnected ? ta : $(`${thread ? '.sk-thread' : '.sk-main'} .sk-composer textarea`) || ta;
            el.value = r.reply; el.focus(); el.dispatchEvent(new Event('input'));
          }, 'sm'),
          h('div.grow'),
          h('small.sk-hintline', 'Enter sends · Shift+Enter new line'),
          h('button.sk-send', { title: 'Send', onclick: go }, '➤'))));
  }

  // ---------- recap and thread summary (✨) ----------

  const sinceOf = (k) => ({ yesterday: addDays(today(), -1), '3d': addDays(today(), -3), week: addDays(today(), -7), all: '0000' }[k]);
  // Until someone picks a range, start on the shortest one that has messages, so ✨ Summarize has something to read.
  const autoRange = (c) => (st.rangePicked ? st.range : Object.keys(RANGES).find((k) => msgsOf(c).some((m) => isoDay(m.at) >= sinceOf(k))) || 'all');

  function recapCard(c) {
    const rows = msgsOf(c).filter((m) => isoDay(m.at) >= sinceOf(st.range));
    return Einstein.card({
      key: `sk-recap:${c.id}:${st.range}`, title: `Catch me up on ${c.dm ? dmName(c) : '#' + c.name}`, icon: '✨', className: 'sk-ai',
      intro: `${rows.length} message${rows.length === 1 ? '' : 's'} ${RANGES[st.range]}.`, label: 'Summarize',
      ask: () => {
        if (!rows.length) throw new Error(`No messages ${RANGES[st.range]} in this channel.`);
        return { task: 'slack-recap', prompt: `Catch me up on the Slack channel #${c.name}${c.topic ? ` (${c.topic})` : ''} ${RANGES[st.range]}. Be brief, name people, and only use what is below.\n${c.recordId ? Einstein.recordContext(c.recordId, { depth: 1 }) + '\n' : ''}\nMessages:\n${lines(rows)}`,
          schema: Einstein.S.obj({ summary: Einstein.S.str('2-4 sentences'), decisions: Einstein.S.arr(Einstein.S.str(), 'decisions made'), actions: Einstein.S.arr(Einstein.S.obj({ who: Einstein.S.str(), task: Einstein.S.str() }), 'open action items'), questions: Einstein.S.arr(Einstein.S.str(), 'open questions') }) };
      },
      render: (r) => h('div.sk-recap', md(r.summary),
        r.decisions && r.decisions.length ? h('div', h('h4', 'Decisions'), h('ul', r.decisions.map((x) => h('li', x)))) : null,
        r.actions && r.actions.length ? h('div', h('h4', 'Action items'), h('ul', r.actions.map((x) => h('li', h('b', x.who + ': '), x.task)))) : null,
        r.questions && r.questions.length ? h('div', h('h4', 'Open questions'), h('ul', r.questions.map((x) => h('li', x)))) : null),
    });
  }
  function threadCard(parent, reps) {
    const c = DB.channel(parent.ch);
    return Einstein.card({
      key: `sk-thread:${parent.id}:${reps.length}`, title: 'Thread summary', icon: '✨', className: 'sk-ai', intro: `${reps.length + 1} messages in this thread.`, label: 'Summarize thread',
      ask: () => ({ task: 'slack-thread-summary', prompt: `Summarize this Slack thread from #${c.name} in two or three sentences, then list decisions and next steps.\n\n${lines([parent, ...reps])}`,
        schema: Einstein.S.obj({ summary: Einstein.S.str(), decisions: Einstein.S.arr(Einstein.S.str()), nextSteps: Einstein.S.arr(Einstein.S.str()) }) }),
      render: (r) => h('div.sk-recap', md(r.summary), r.decisions && r.decisions.length ? h('ul', r.decisions.map((x) => h('li', '✔ ' + x))) : null, r.nextSteps && r.nextSteps.length ? h('ul', r.nextSteps.map((x) => h('li', '→ ' + x))) : null),
    });
  }

  // ---------- sidebar ----------

  function newChannel(ctx) {
    const name = h('input', { placeholder: 'e.g. install-crews' });
    const topic = h('input', { placeholder: 'What is this channel for?' });
    const rec = h('input', { placeholder: 'Optional: a record name, e.g. Summit Ridge' });
    UI.modal({ title: 'Create a channel', body: h('div.form', h('label', 'Name', name), h('label', 'Topic', topic), h('label', 'Link a record', rec)),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Create', primary: true, run: () => {
        if (!name.value.trim()) return false;
        const hit = rec.value.trim() ? DB.search(rec.value.trim(), { limit: 1 })[0] : null;
        const c = DB.slackChannel(name.value, { topic: topic.value.trim(), recordId: hit ? hit.rec.Id : null });
        DB.slackPost(c.id, `${who(me())} created this channel. ${hit ? 'It is linked to [[' + hit.rec.Id + ']].' : ''}`, 'bot:Stratus', { recordId: hit ? hit.rec.Id : null });
        ctx.set({ ch: c.name });
      } }] });
  }
  function openDm(ctx, userId) {
    const nm = 'dm-' + (userId ? slug(DB.name(userId)) : 'agentforce');
    let c = DB.channel(nm);
    if (!c) {
      c = DB.slackChannel(nm, { topic: 'Direct message', members: [me(), userId].filter(Boolean) });
      c.dm = userId || 'bot:Agentforce';
      DB.save();
    }
    ctx.set({ ch: nm });
  }

  function sideNode(ctx, c) {
    const chans = slack().channels;
    const item = (ch) => {
      const un = unread(ch) && ch.id !== c.id;
      return h('button.sk-item' + (ch.id === c.id ? '.on' : '') + (un ? '.unread' : ''), { onclick: () => ctx.set({ ch: ch.name }) },
        h('span.sk-hash', ch.recordId ? '🔒' : '#'), h('span.sk-iname', ch.name), un ? h('span.sk-badge') : null);
    };
    const dmItem = (label, key, userId, ch) => {
      const un = ch && unread(ch) && ch.id !== c.id;
      return h('button.sk-item' + (ch && ch.id === c.id ? '.on' : '') + (un ? '.unread' : ''), { onclick: () => openDm(ctx, userId) },
        userId ? h('span.sk-pres' + (presence(userId) ? '.on' : ''), UI.avatar(label, 22)) : h('span.sk-botav.xs', '🤖'), h('span.sk-iname', label), un ? h('span.sk-badge') : null);
    };
    const team = DB.all('User').filter((u) => u.Id !== me() && u.IsActive !== false);
    const dm = (id) => chans.find((x) => x.dm === id);
    return [
      h('div.sk-ws', h('div', h('b', DB.org().company), h('small', h('span.sk-live'), ' ', who(me()))), h('div.grow'), h('button.sk-new', { title: 'Create a channel', onclick: () => newChannel(ctx) }, '＋')),
      h('div.sk-scroll', { dataset: { scroll: 'sk-side' } },
        h('div.sk-sec', h('span', 'Channels'), h('button', { title: 'Create a channel', onclick: () => newChannel(ctx) }, '＋')),
        chans.filter((x) => !x.dm).map(item),
        h('button.sk-item.add', { onclick: () => newChannel(ctx) }, h('span.sk-hash', '＋'), h('span.sk-iname', 'Add channel')),
        h('div.sk-sec', h('span', 'Direct messages')),
        dmItem('Agentforce', 'bot', null, dm('bot:Agentforce')),
        team.map((u) => dmItem(u.Name, u.Id, u.Id, dm(u.Id)))),
    ];
  }

  // ---------- the page ----------

  function render(ctx) {
    seedDemo();
    const c = current(ctx);
    if (!c) return UI.empty('💬', 'No channels yet', 'Create one to get started.');
    if (st.threadCh !== c.id) { st.thread = null; st.threadCh = c.id; }
    const sideEl = h('aside.sk-side');
    const mainEl = h('section.sk-main');
    const threadEl = h('aside.sk-thread');
    const root = h('div.sk-root', { style: { '--sk-aub': ctx.app.color } }, sideEl, mainEl, threadEl);
    const listEl = h('div.sk-list', { dataset: { scroll: 'sk-list-' + c.id } });
    const headEl = h('header.sk-head');
    const recapEl = h('div.sk-recapwrap');
    let threadList = null;
    const parts = { root };

    const drawSide = () => sideEl.replaceChildren(...sideNode(ctx, c));
    function drawHead() {
      const linked = c.recordId && DB.get(c.recordId);
      const members = (c.members || []).filter((id) => DB.get(id));
      headEl.replaceChildren(
        h('div.sk-title', h('h2', c.dm ? dmName(c) : (linked ? '🔒 ' : '# ') + c.name), c.topic ? h('small', c.topic) : null),
        linked ? h('a.sk-linked', { href: '#/r/' + linked.Id }, h('span', DB.meta(DB.objectOf(linked.Id)).icon), DB.name(linked.Id)) : null,
        h('div.grow'),
        c.dm ? null : h('button.sk-members', { title: 'Members', onclick: () => UI.modal({ title: `#${c.name} members`, body: h('div.sk-memlist', members.map((id) => h('div', UI.avatar(DB.name(id), 28), h('b', DB.name(id)), h('small', DB.get(id).Title || '')))) }) },
          members.slice(0, 4).map((id) => UI.avatar(DB.name(id), 22)), h('span', members.length)),
        h('button.btn.ai.sm' + (st.recap === c.id ? '.on' : ''), { onclick: () => { st.recap = st.recap === c.id ? null : c.id; st.range = autoRange(c); drawRecap(); drawHead(); } }, '✨ Catch me up'));
    }
    function drawRecap() {
      if (st.recap !== c.id) { recapEl.replaceChildren(); return; }
      recapEl.replaceChildren(
        h('div.sk-range', h('span.muted', 'Catch me up on'), h('div.seg', Object.entries(RANGES).map(([k, l]) => h('button' + (st.range === k ? '.on' : ''), { onclick: () => { st.range = k; st.rangePicked = true; drawRecap(); } }, l))),
          h('div.grow'), h('button.iconbtn.sm', { title: 'Close', onclick: () => { st.recap = null; drawRecap(); drawHead(); } }, '×')),
        recapCard(c));
    }
    function drawList() {
      const near = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80 || !listEl.scrollTop;
      const keep = listEl.scrollTop;
      const all = msgsOf(c);
      const top = all.filter((m) => !m.thread);
      const latest = all.length ? all[all.length - 1].at : '';
      if (latest && latest > lastRead(c)) { c.lastRead = c.lastRead || {}; c.lastRead[me()] = latest; DB.save(); drawSide(); }
      listEl.replaceChildren(
        h('div.sk-intro', h('div.sk-intro-ic', c.dm ? (c.dm === 'bot:Agentforce' ? '🤖' : '👤') : '#'),
          h('h3', c.dm ? dmName(c) : '#' + c.name), h('p', c.dm === 'bot:Agentforce' ? 'Ask me to find records, update them, log tasks or post to a channel. I answer every message here.' : c.dm ? 'This is the start of your conversation. Teammates here are part of the demo and will not reply, but Agentforce will.' : (c.topic || 'Welcome to the channel.'))),
        top.length ? listNodes(top, false) : null,
        st.typing[c.id] ? h('div.sk-msg', h('div.sk-av', h('span.sk-botav', '🤖')), h('div.sk-body', h('div.sk-meta', h('b.sk-name', 'Agentforce'), h('span.sk-app', 'APP')), h('span.typing', h('i'), h('i'), h('i')))) : null);
      listEl.scrollTop = near ? listEl.scrollHeight : keep;
      if (view === parts && st.thread) drawThreadList();
    }
    function drawThread() {
      const parent = st.thread && slack().messages.find((m) => m.id === st.thread);
      root.classList.toggle('thread-on', !!parent);
      if (!parent) { threadEl.replaceChildren(); threadList = null; return; }
      threadList = h('div.sk-tlist', { dataset: { scroll: 'sk-thread' } });
      threadEl.replaceChildren(
        h('header.sk-thead', h('div', h('b', 'Thread'), h('small', c.dm ? dmName(c) : '#' + c.name)), h('div.grow'), h('button.iconbtn', { title: 'Close', onclick: () => { st.thread = null; drawThread(); } }, '×')),
        threadList, composer(c, parent.id));
      drawThreadList();
    }
    function drawThreadList() {
      const parent = st.thread && slack().messages.find((m) => m.id === st.thread);
      if (!parent || !threadList) return;
      const reps = repliesOf(parent);
      const near = threadList.scrollHeight - threadList.scrollTop - threadList.clientHeight < 80;
      threadList.replaceChildren(msgNode(parent, null, true), h('div.sk-rdiv', h('span', `${reps.length} ${reps.length === 1 ? 'reply' : 'replies'}`)),
        reps.length ? threadCard(parent, reps) : null, listNodes(reps, true));
      if (near) threadList.scrollTop = threadList.scrollHeight;
    }
    Object.assign(parts, { drawSide, drawList, drawThread, drawThreadList, redraw: () => { drawSide(); drawHead(); drawList(); } });
    view = parts;

    mainEl.append(headEl, recapEl, listEl, composer(c, null));
    drawSide(); drawHead(); drawRecap(); drawThread();
    drawList();
    setTimeout(() => { listEl.scrollTop = listEl.scrollHeight; }, 0);
    return root;
  }

  // Slack data changed (a new message, a reaction, an agent reply): redraw the parts of this page.
  DB.on((e) => { if (e.kind === 'slack' && view && view.root.isConnected) view.redraw(); });

  return { title: 'Slack', icon: '💬', live: false, render };
})();
