// service.js — the Service app's own screens and record add-ons:
//   Pages.console   Service Console: case queue | workspace (thread + reply) | customer 360 + Knowledge
//   Record.extend   Case: SLA / entitlement banner, "Create Knowledge article" from a closed case

(() => {
  const isOpen = (c) => c.Status !== 'Closed';
  const PRI = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const PRI_TONE = { Critical: 'bad', High: 'warn', Medium: 'accent', Low: 'muted' };
  const hoursLeft = (c) => (c.SlaDue ? (new Date(c.SlaDue) - Date.now()) / 3600000 : null);
  const span = (hh) => { const a = Math.abs(hh); return a >= 48 ? `${Math.round(a / 24)}d` : a >= 1 ? `${Math.floor(a)}h` : `${Math.max(1, Math.round(a * 60))}m`; };

  function sla(c) {
    if (!c.SlaDue) return { text: '—', tone: 'muted' };
    if (!isOpen(c)) {
      const met = c.ClosedDate ? c.ClosedDate <= c.SlaDue : true;
      return { text: met ? 'SLA met' : 'SLA missed', tone: met ? 'ok' : 'bad' };
    }
    const l = hoursLeft(c);
    if (l < 0) return { text: `breached ${span(l)} ago`, tone: 'bad' };
    return { text: `${span(l)} left`, tone: l < 8 ? 'warn' : 'ok' };
  }
  const riskTone = (n) => (n >= 60 ? 'bad' : n >= 35 ? 'warn' : 'ok');

  // Words worth matching on (drops filler), for Knowledge suggestions.
  const STOP = new Set('the a an and or of to in on for with is are was were it this that my our your we you i not no can cant cannot be have has had from at by as but if so do does did how what when why will would please hi hello thanks thank'.split(' '));
  const words = (t) => uniq(String(t || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));
  function suggest(c, n = 4) {
    const q = words(`${c.Subject} ${c.Description || ''} ${c.Reason || ''} ${c.Type || ''}`);
    if (!q.length) return [];
    return DB.all('Knowledge').filter((k) => k.PublishStatus !== 'Archived').map((k) => {
      const title = words(k.Title), rest = new Set(words(`${k.Summary || ''} ${k.Body || ''}`));
      let s = 0;
      for (const w of q) { if (title.includes(w)) s += 3; else if (rest.has(w)) s += 1; }
      if (k.PublishStatus === 'Published') s += 0.5;
      return { k, s };
    }).filter((x) => x.s >= 3).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.k);
  }

  // Thread: comments + emails, oldest first.
  function thread(c) {
    const cm = DB.all('CaseComment').filter((x) => x.ParentId === c.Id).map((x) => ({ id: x.Id, at: x.CreatedDate, kind: x.IsPublished === false ? 'note' : 'comment', cust: !!x.FromCustomer, who: x.FromCustomer ? DB.name(c.ContactId) || 'Customer' : DB.name(x.CreatedById) || 'Agent', text: x.CommentBody }));
    const em = DB.all('EmailMessage').filter((x) => x.RelatedToId === c.Id).map((x) => ({ id: x.Id, at: x.MessageDate, kind: 'email', cust: !!x.Incoming, who: x.Incoming ? x.FromName || DB.name(c.ContactId) || 'Customer' : x.FromName || 'Support', text: x.TextBody, subject: x.Subject }));
    return [...cm, ...em].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  const customerText = (c) => [c.Description, ...thread(c).filter((m) => m.cust).map((m) => m.text)].join(' ');

  // ============================ Console ============================

  const st = { draft: {}, mode: {}, after: {}, search: '' };

  Pages.console = {
    title: 'Console', icon: '🎧', live: true,
    render(ctx) {
      const P = ctx.params;
      const meId = DB.org().me;
      const f = ['mine', 'open', 'high', 'esc'].includes(P.f) ? P.f : 'mine';
      const all = DB.all('Case');
      const filters = {
        mine: (c) => isOpen(c) && c.OwnerId === meId,
        open: isOpen,
        high: (c) => isOpen(c) && ['High', 'Critical'].includes(c.Priority),
        esc: (c) => c.Status === 'Escalated',
      };
      const labels = { mine: 'My cases', open: 'All open', high: 'High priority', esc: 'Escalated' };
      const q = st.search.trim().toLowerCase();
      const list = all.filter(filters[f]).filter((c) => !q || `${c.CaseNumber} ${c.Subject} ${DB.name(c.AccountId)} ${DB.name(c.ContactId)}`.toLowerCase().includes(q))
        .sort((a, b) => (PRI[a.Priority] - PRI[b.Priority]) * 0 + String(a.SlaDue || '9').localeCompare(String(b.SlaDue || '9')));
      const sel = (P.id && DB.get(P.id) && DB.objectOf(P.id) === 'Case' && DB.get(P.id)) || list[0] || null;
      const pick = (id) => ctx.set({ id }, true);

      const head = h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '🎧'),
        h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Service Console')),
        h('div.grow'),
        h('span.muted', `${all.filter(isOpen).length} open · ${all.filter((c) => isOpen(c) && sla(c).tone === 'bad').length} past SLA`),
        h('button.btn.primary', { onclick: () => Form.open('Case', { defaults: { OwnerId: meId, Status: 'New', Priority: 'Medium', Origin: 'Phone' }, onSave: (r) => r && r.Id && pick(r.Id) }) }, '+ New Case'));

      // ---- queue ----
      const search = h('input.cs-search', { type: 'search', placeholder: 'Search the queue…', value: st.search,
        oninput: (e) => { st.search = e.target.value; const keep = e.target.selectionStart; Shell.render(); const n = $('.cs-search'); if (n) { n.focus(); n.setSelectionRange(keep, keep); } } });
      const chips = h('div.cs-chips', Object.keys(labels).map((k) => h(`button.cs-chip${f === k ? '.on' : ''}`, { onclick: () => ctx.set({ f: k === 'mine' ? null : k }) },
        labels[k], h('b', String(all.filter(filters[k]).length)))));
      const rowFor = (c) => {
        const s = sla(c), r = Predict.caseRisk(c);
        return h(`div.cs-row${sel && sel.Id === c.Id ? '.on' : ''}`, { onclick: () => pick(c.Id), tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter') pick(c.Id); } },
          h('div.cs-r1', h(`span.cs-pri.${PRI_TONE[c.Priority] || 'muted'}`, c.Priority), h('span.cs-num', c.CaseNumber), h('div.grow'),
            h(`span.cs-dot.${riskTone(r.score)}`, { title: `Escalation risk ${r.score}\n${r.reasons.join('\n')}` })),
          h('div.cs-subj', c.Subject),
          h('div.cs-r3', h('span', DB.name(c.AccountId) || '—'), h('span.dotsep', '·'), h('span', c.Status)),
          h('div.cs-r3', h(`span.cs-sla.${s.tone}`, s.text), h('div.grow'), h('span', 'opened ' + fmt.ago(c.CreatedDate))));
      };
      const queue = h('section.cs-queue', h('div.cs-qhead', chips, search),
        h('div.cs-qlist', { dataset: { scroll: 'cs-queue' } }, list.length ? list.slice(0, 120).map(rowFor) : UI.empty('🎉', 'Queue is clear', f === 'mine' ? 'No open cases are assigned to you.' : 'Nothing matches this filter.')));

      if (!sel) return h('div.page.cs-page', head, h('div.cs-grid', queue, h('section.cs-work', UI.empty('🎧', 'Pick a case', 'Choose one from the queue.'))));
      return h('div.page.cs-page', head, h('div.cs-grid', queue, workspace(sel, pick), side(sel, pick)));
    },
  };

  // ---- middle: workspace ----

  function workspace(c, pick) {
    const contact = DB.get(c.ContactId);
    const s = sla(c);
    const senti = c.Sentiment || Predict.sentiment(customerText(c));
    const sel = (field, opts) => h('select.cs-sel', { onchange: (e) => DB.update(c.Id, { [field]: e.target.value }) },
      opts.map((o) => h('option', { value: o, selected: o === c[field] }, o)));
    const opts = (field) => { const fd = DB.meta('Case').field[field]; return (fd && fd.options) || [c[field]].filter(Boolean); };
    const total = c.SlaDue && c.CreatedDate ? new Date(c.SlaDue) - new Date(c.CreatedDate) : 0;
    const used = total ? clamp(((isOpen(c) ? Date.now() : new Date(c.ClosedDate || Date.now()).getTime()) - new Date(c.CreatedDate)) / total, 0, 1) : 0;

    const header = h('div.cs-whead',
      h('div.cs-wtitle', h('span.cs-num', c.CaseNumber), h('h2', c.Subject), h('div.grow'),
        h(`span.cs-badge.${{ Angry: 'bad', Frustrated: 'warn', Positive: 'ok' }[senti] || 'muted'}`, { title: 'Sentiment read from what the customer wrote (rule-based)' }, { Angry: '😠', Frustrated: '😕', Positive: '🙂' }[senti] || '😐', ' ', senti),
        h('a.btn.sm', { href: '#/r/' + c.Id }, 'Open record')),
      h('div.cs-fields',
        h('label', 'Status', sel('Status', opts('Status'))), h('label', 'Priority', sel('Priority', opts('Priority'))),
        h('label', 'Type', sel('Type', ['', ...opts('Type')])), h('label', 'Reason', sel('Reason', ['', ...opts('Reason')])),
        h('label', 'Owner', h('span.cs-own', UI.avatar(DB.name(c.OwnerId), 20), DB.name(c.OwnerId) || 'Unassigned'))),
      c.SlaDue ? h('div.cs-slabar', h('div.cs-slatrack', h(`i.${s.tone}`, { style: { width: Math.round(used * 100) + '%' } })),
        h(`span.cs-sla.${s.tone}`, s.text), h('span.muted', `due ${fmt.datetime(c.SlaDue)}`)) : null);

    // thread
    const msgs = thread(c);
    const bubble = (m) => h(`div.cs-msg.${m.kind}${m.cust ? '.cust' : '.agent'}`,
      h('div.cs-mhead', UI.avatar(m.who, 22), h('b', m.who), m.kind === 'note' ? h('span.cs-tag', '🔒 Internal note') : m.kind === 'email' ? h('span.cs-tag', m.cust ? '✉️ Email in' : '✉️ Email out') : null,
        h('span.muted', fmt.ago(m.at))),
      m.subject ? h('div.cs-msubj', m.subject) : null, h('div.cs-mbody', m.text));
    const original = c.Description ? h('div.cs-msg.cust.comment', h('div.cs-mhead', UI.avatar(DB.name(c.ContactId) || 'Customer', 22), h('b', DB.name(c.ContactId) || 'Customer'), h('span.cs-tag', 'Original request'), h('span.muted', fmt.ago(c.CreatedDate))), h('div.cs-mbody', c.Description)) : null;
    const box = h('div.cs-thread', { dataset: { scroll: 'cs-thread-' + c.Id } }, original, msgs.map(bubble), !msgs.length && !original ? h('p.muted.pad', 'No messages yet.') : null);
    setTimeout(() => { const el = $(`[data-scroll="cs-thread-${c.Id}"]`); if (el && !el._seen) { el._seen = 1; el.scrollTop = el.scrollHeight; } }, 0);

    // composer
    const mode = st.mode[c.Id] || 'reply';
    const ta = h('textarea.cs-ta', { rows: 5, placeholder: mode === 'note' ? 'Write a note only your team can see…' : mode === 'email' ? 'Write the email…' : 'Write a reply the customer can see…', value: st.draft[c.Id] || '',
      oninput: (e) => { st.draft[c.Id] = e.target.value; } });
    ta.value = st.draft[c.Id] || '';
    const after = st.after[c.Id] || (isOpen(c) ? 'Waiting on Customer' : 'keep');
    const send = () => {
      const text = (st.draft[c.Id] || '').trim();
      if (!text) { UI.toast('Write something first', 'err'); return; }
      const me = DB.me() || {};
      if (mode === 'email') {
        const to = contact && contact.Email;
        if (!to) { UI.toast('This contact has no email address', 'err'); return; }
        DB.insert('EmailMessage', { Subject: `Re: ${c.Subject} [${c.CaseNumber}]`, ToAddress: to, FromName: me.Name, Incoming: false, Status: 'Sent', TextBody: text, RelatedToId: c.Id, WhoId: c.ContactId, MessageDate: new Date().toISOString() });
      } else {
        DB.insert('CaseComment', { ParentId: c.Id, CommentBody: text, IsPublished: mode !== 'note', FromCustomer: false, CreatedById: me.Id });
      }
      if (mode !== 'note' && after !== 'keep' && after !== c.Status) DB.update(c.Id, { Status: after });
      st.draft[c.Id] = '';
      UI.toast(mode === 'note' ? 'Note added' : mode === 'email' ? `Email sent to ${contact.Email}` : 'Reply sent');
    };
    const draftBtn = Einstein.button('Draft reply', () => {
      const kb = suggest(c, 3);
      return { task: 'case-reply',
        system: 'You are a friendly, precise support agent writing the next reply to a customer. Ground every claim in the case and the Knowledge articles given; if you do not know, say what you will check. No promises about refunds or dates not in the data. Do not include a subject line.',
        prompt: `${Einstein.recordContext(c.Id)}\n\nKnowledge articles that may help:\n${kb.length ? kb.map((k) => `### ${k.Title}\n${k.Summary || ''}\n${String(k.Body || '').slice(0, 900)}`).join('\n\n') : '(none matched)'}\n\nWrite the next reply to ${DB.name(c.ContactId) || 'the customer'} as ${(DB.me() || {}).Name || 'the agent'}. Sign off with that name.`,
        schema: Einstein.S.obj({ reply: Einstein.S.str('the reply text, plain, short paragraphs') }) };
    }, (r) => {
      // The console may have redrawn while the AI was thinking, so fill whichever box is on screen now.
      st.draft[c.Id] = r.reply;
      const live = $('.cs-composer textarea');
      if (live) live.value = r.reply; else Shell.render();
      UI.toast('Draft ready. Edit it, then send.');
    }, 'sm');
    const modeBtn = (k, l) => h(`button${mode === k ? '.on' : ''}`, { onclick: () => { st.mode[c.Id] = k; Shell.render(); } }, l);
    const composer = h('div.cs-composer',
      h('div.cs-ctop', h('div.seg', modeBtn('reply', 'Reply'), modeBtn('email', 'Email'), modeBtn('note', 'Internal note')), h('div.grow'),
        mode !== 'note' ? draftBtn : null,
        mode === 'email' ? h('span.muted', contact && contact.Email ? `To ${contact.Email}` : 'No email on contact') : null),
      ta,
      h('div.cs-cbot', mode !== 'note' ? h('label.muted', 'After sending ', h('select', { onchange: (e) => { st.after[c.Id] = e.target.value; } },
        [['keep', 'keep status'], ['Waiting on Customer', 'set Waiting on Customer'], ['Closed', 'close the case']].map(([v, l]) => h('option', { value: v, selected: v === after }, l)))) : null,
      h('div.grow'), h('button.btn.primary', { onclick: send }, mode === 'note' ? 'Add note' : mode === 'email' ? 'Send email' : 'Send reply')));

    return h('section.cs-work', header, box, composer);
  }

  // ---- right: customer 360, knowledge, ✨ ----

  function side(c, pick) {
    const contact = DB.get(c.ContactId), acct = DB.get(c.AccountId);
    const blocks = [];

    const cust = [];
    if (contact) cust.push(h('div.cs-person', UI.avatar(contact.Name || DB.name(contact.Id), 34), h('div', h('a.reclink', { href: '#/r/' + contact.Id }, DB.name(contact.Id)), h('small', contact.Title || ''),
      contact.Email ? h('small', contact.Email) : null, contact.Phone ? h('small', contact.Phone) : null)));
    if (acct) {
      const hl = Predict.health(acct);
      cust.push(h('div.cs-acct', Record.ring(hl.score, scoreColor(hl.score)), h('div.grow', h('a.reclink', { href: '#/r/' + acct.Id }, acct.Name), h('small', [acct.Type, acct.SLA ? acct.SLA + ' SLA' : null].filter(Boolean).join(' · ')),
        h('small', { title: hl.reasons.join('\n') }, `Health ${hl.score}${hl.reasons[0] ? ' · ' + hl.reasons[0].replace(/^[+−]\d+ /, '') : ''}`))));
      const others = DB.all('Case').filter((x) => x.AccountId === acct.Id && x.Id !== c.Id && isOpen(x));
      if (others.length) cust.push(h('div.cs-sub', h('b', `Other open cases (${others.length})`), others.slice(0, 4).map((x) => h('a.cs-mini', { href: '#', onclick: (e) => { e.preventDefault(); pick(x.Id); } }, h(`span.cs-pri.${PRI_TONE[x.Priority] || 'muted'}`, x.Priority), x.Subject))));
      const orders = DB.all('Order').filter((o) => o.AccountId === acct.Id).sort((a, b) => String(b.EffectiveDate).localeCompare(String(a.EffectiveDate))).slice(0, 3);
      if (orders.length) cust.push(h('div.cs-sub', h('b', 'Recent orders'), orders.map((o) => h('a.cs-mini', { href: '#/r/' + o.Id }, h('span', o.OrderNumber || DB.name(o.Id)), h('span.muted', `${o.Status} · ${fmt.money(o.TotalAmount)}`)))));
    }
    if (!cust.length) cust.push(h('p.muted.pad', 'No contact or account on this case.'));
    blocks.push(UI.card('Customer 360', h('div.cs-360', cust), { icon: '👤' }));

    // Knowledge
    const kb = suggest(c);
    const insert = (k) => {
      const ta = $('.cs-ta');
      const line = `${k.Summary || k.Title}`;
      st.draft[c.Id] = ((st.draft[c.Id] || '') + (st.draft[c.Id] ? '\n\n' : '') + line + (k.UrlName ? `\n(Article: ${k.Title})` : '')).trim();
      if (ta) ta.value = st.draft[c.Id];
      UI.toast('Added to your reply');
    };
    blocks.push(UI.card('Knowledge', kb.length ? h('div.cs-kb', kb.map((k) => h('div.cs-kbrow', h('a.reclink', { href: '#/r/' + k.Id }, k.Title), h('small', k.Summary || ''),
      h('div.row', h('span.chip', k.Category || 'Article'), h('span.muted', `${fmt.num(k.Views || 0)} views`), h('div.grow'), h('button.btn.sm', { onclick: () => insert(k) }, 'Insert in reply'))))) : h('p.muted.pad', 'No matching articles yet. Close this case and turn the answer into one.'),
    { icon: '📚', count: kb.length || null }));

    // ✨ cards
    blocks.push(Einstein.card({
      key: `cs-sum:${c.Id}`, title: 'Summary', icon: '✨', label: 'Summarize this case',
      intro: `${Einstein.word()} reads the whole conversation and gives you the story so far.`,
      ask: () => ({ task: 'case-summary', system: 'You summarise support cases for an agent picking one up cold. Short, factual, no fluff.',
        prompt: Einstein.recordContext(c.Id),
        schema: Einstein.S.obj({ summary: Einstein.S.str('2-3 sentence summary of the problem and where it stands'), asks: Einstein.S.arr(Einstein.S.str('what the customer wants'), 'up to 3'), next: Einstein.S.str('the single best next action') }) }),
      render: (r) => h('div', md(r.summary), (r.asks || []).length ? h('ul.cs-ul', r.asks.map((x) => h('li', x))) : null, h('p', h('b', 'Next: '), r.next)),
      actions: (r) => [h('button.btn.sm', { onclick: () => { DB.update(c.Id, { Summary: r.summary }); UI.toast('Saved to the case'); } }, 'Save to case')],
    }));

    blocks.push(Einstein.card({
      key: `cs-cls:${c.Id}:${c.Subject.length}`, title: 'Classify', icon: '🏷️', label: 'Suggest priority, type and reason',
      intro: `${Einstein.word()} suggests how to categorise this case. You click to apply.`,
      ask: () => ({ task: 'case-classify', system: 'You triage support cases. Choose only from the allowed values.',
        prompt: `${Einstein.recordContext(c.Id, { depth: 1 })}\n\nConversation:\n${thread(c).slice(-6).map((m) => `${m.cust ? 'Customer' : 'Agent'}: ${m.text}`).join('\n')}`,
        schema: Einstein.S.obj({ priority: Einstein.S.oneOf(['Low', 'Medium', 'High', 'Critical'], 'Priority'), type: Einstein.S.oneOf(['Question', 'Problem', 'Feature Request', 'Billing', 'Shipping', 'Returns'], 'Type'),
          reason: Einstein.S.oneOf(['Installation', 'Performance', 'Login', 'Access', 'Defect', 'How-to', 'Order Status', 'Damaged Item', 'Invoice', 'Other'], 'Reason'), why: Einstein.S.str('one sentence why') }) }),
      render: (r) => h('div', md(r.why), h('div.cs-apply', [['Priority', r.priority], ['Type', r.type], ['Reason', r.reason]].map(([f, v]) => {
        const same = c[f] === v;
        return h('div.cs-ar', h('span.muted', f), h('b', v), same ? h('span.tick', '✓ current') : h('button.btn.sm', { onclick: () => { DB.update(c.Id, { [f]: v }); UI.toast(`${f} set to ${v}`); } }, 'Apply'));
      }))),
    }));
    return h('aside.cs-side', blocks);
  }

  // ============================ Record: Case ============================

  Record.extend('Case', {
    top: (c) => {
      const ent = DB.all('Entitlement').filter((e) => e.AccountId === c.AccountId && e.Status === 'Active')[0] || DB.all('Entitlement').find((e) => e.AccountId === c.AccountId);
      const acct = DB.get(c.AccountId);
      const s = sla(c);
      const total = c.SlaDue && c.CreatedDate ? new Date(c.SlaDue) - new Date(c.CreatedDate) : 0;
      const end = isOpen(c) ? Date.now() : new Date(c.ClosedDate || Date.now()).getTime();
      const used = total ? clamp((end - new Date(c.CreatedDate)) / total, 0, 1) : 0;
      return h(`div.cs-banner.${s.tone}`,
        h('div.cs-bmain', h('b', c.SlaDue ? (isOpen(c) ? (s.tone === 'bad' ? '⏱ SLA breached' : '⏱ SLA clock running') : (s.tone === 'ok' ? '✓ Resolved within SLA' : '⚠ Resolved outside SLA')) : 'No SLA on this case'),
          h('span.cs-btxt', c.SlaDue ? `${isOpen(c) ? s.text + ' · ' : ''}due ${fmt.datetime(c.SlaDue)}` : 'Add an entitlement to the account to set one.')),
        c.SlaDue ? h('div.cs-slatrack', h(`i.${s.tone}`, { style: { width: Math.round(used * 100) + '%' } })) : null,
        h('div.cs-bsub', ent ? `Entitlement: ${ent.Name}${ent.ResponseHours ? ` · respond in ${ent.ResponseHours}h` : ''}${ent.ResolveHours ? ` · resolve in ${ent.ResolveHours}h` : ''}${ent.Status ? ` (${ent.Status})` : ''}` : `No entitlement found${acct && acct.SLA ? ` · ${acct.SLA} support tier` : ''}; the priority default applies.`));
    },
    actions: (c) => {
      const a = [{ label: 'Open in Console', icon: '🎧', run: () => Shell.go('#/app/service/console?id=' + c.Id) }];
      if (!isOpen(c)) a.push({ label: 'Create Knowledge article', icon: '📚', ai: true, run: () => articleModal(c) });
      return a;
    },
  });

  // Draft an article from a resolved case; the user edits and saves it as a Draft.
  function articleModal(c) {
    const exist = DB.all('Knowledge').find((k) => k.SourceCaseId === c.Id);
    const cats = (DB.meta('Knowledge').field.Category || {}).options || ['Troubleshooting'];
    const title = h('input', { type: 'text', value: c.Subject, placeholder: 'Article title' });
    const summary = h('textarea', { rows: 2, placeholder: 'One or two sentences customers will see in search' });
    const body = h('textarea', { rows: 10, placeholder: 'Problem, cause, and the steps that fixed it' });
    const cat = h('select', cats.map((x) => h('option', { value: x, selected: x === (c.Type === 'Billing' ? 'Billing' : c.Type === 'Shipping' ? 'Shipping & Returns' : 'Troubleshooting') }, x)));
    const ai = Einstein.button('Draft from this case', () => ({ task: 'kb-from-case',
      system: 'You write customer-facing Knowledge articles from solved support cases. Generalise: remove names, emails, order numbers and anything customer-specific. Clear numbered steps.',
      prompt: Einstein.recordContext(c.Id),
      schema: Einstein.S.obj({ title: Einstein.S.str('a searchable title phrased like the customer\'s problem'), summary: Einstein.S.str('1-2 sentences'), category: Einstein.S.oneOf(cats, 'best-fit category'), body: Einstein.S.str('markdown: Problem, Cause, Resolution steps') }) }),
    (r) => { title.value = r.title; summary.value = r.summary; body.value = r.body; if (cats.includes(r.category)) cat.value = r.category; UI.toast('Draft ready. Review and edit before saving.'); }, 'sm');
    UI.modal({ title: 'Create Knowledge article', wide: true, body: h('div.form.cs-kbform',
      exist ? h('p.cs-warn', 'An article from this case already exists: ', h('a.reclink', { href: '#/r/' + exist.Id }, exist.Title)) : null,
      h('p.muted', `From ${c.CaseNumber}. ${Einstein.ready() ? Einstein.word() + ' can draft it; you review and decide.' : 'AI is off, so write it yourself or turn AI on in Settings.'}`), h('div', ai),
      h('label', 'Title', title), h('label', 'Category', cat), h('label', 'Summary', summary), h('label', 'Body', body)),
    actions: [{ label: 'Cancel', run: () => {} }, { label: 'Save as Draft', primary: true, run: () => {
      if (!title.value.trim() || !body.value.trim()) { UI.toast('Title and body are required', 'err'); return false; }
      const rec = DB.insert('Knowledge', { Title: title.value.trim(), UrlName: title.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), Summary: summary.value.trim(), Body: body.value.trim(), Category: cat.value, PublishStatus: 'Draft', SourceCaseId: c.Id, OwnerId: DB.org().me });
      UI.toast('Draft article saved', 'ok', rec && rec.Id ? { label: 'Open', run: () => Shell.go('#/r/' + rec.Id) } : null);
    } }] });
  }
})();
