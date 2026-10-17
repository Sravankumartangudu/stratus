// home.js — the Home tab: a greeting, the quarter against quota, today's tasks, top deals, hot leads,
// rule-based Einstein insights (no AI needed) and a ✨ daily briefing written from all of it.

(() => {
  const mine = (scope) => (scope === 'team' ? [] : [['OwnerId', 'eq', '$me']]);
  const OPEN = ['StageName', 'notin', ['Closed Won', 'Closed Lost']];

  function greeting() {
    const h0 = new Date().getHours();
    return h0 < 12 ? 'Good morning' : h0 < 18 ? 'Good afternoon' : 'Good evening';
  }

  // Things worth knowing, found by plain rules over the data — Einstein Insights without a model.
  function insights(scope) {
    const out = [];
    const opps = DB.query('Opportunity', { filters: [OPEN, ...mine(scope)] });
    const late = opps.filter((o) => o.CloseDate && o.CloseDate < today());
    if (late.length) out.push({ icon: '⏰', tone: 'warn', text: `${late.length} open deal${late.length > 1 ? 's have' : ' has'} a close date in the past`, ids: late.slice(0, 4).map((o) => o.Id), fix: { label: 'Review', hash: Shell.objUrl('Opportunity', { view: 0 }) } });
    const stale = opps.filter((o) => !DB.activity(o.Id).some((a) => String(a.ActivityDate || a.StartDateTime || a.MessageDate || a.CreatedDate).slice(0, 10) >= addDays(today(), -14)));
    if (stale.length) out.push({ icon: '🧊', tone: 'warn', text: `${stale.length} deal${stale.length > 1 ? 's' : ''} with no activity in 14 days (${fmt.short(sum(stale, (o) => o.Amount))})`, ids: stale.sort((a, b) => (b.Amount || 0) - (a.Amount || 0)).slice(0, 4).map((o) => o.Id) });
    const risky = DB.query('Case', { filters: [['Status', 'ne', 'Closed'], ...mine(scope)] }).map((c) => ({ c, r: Predict.caseRisk(c) })).filter((x) => x.r.score >= 60).sort((a, b) => b.r.score - a.r.score);
    if (risky.length) out.push({ icon: '🔥', tone: 'bad', text: `${risky.length} case${risky.length > 1 ? 's are' : ' is'} likely to escalate`, ids: risky.slice(0, 4).map((x) => x.c.Id) });
    const weak = DB.query('Account', { filters: [['HealthScore', 'lt', 45], ['Type', 'starts', 'Customer'], ...mine(scope)] });
    if (weak.length) out.push({ icon: '💔', tone: 'bad', text: `${weak.length} customer account${weak.length > 1 ? 's' : ''} with poor health`, ids: weak.slice(0, 4).map((a) => a.Id) });
    const hot = DB.query('Lead', { filters: [['Status', 'in', ['Open - Not Contacted']], ['Score', 'ge', 70], ...mine(scope)] });
    if (hot.length) out.push({ icon: '🎯', tone: 'good', text: `${hot.length} high-scoring lead${hot.length > 1 ? 's' : ''} not contacted yet`, ids: hot.slice(0, 4).map((l) => l.Id) });
    const big = opps.filter((o) => (o.WinScore || 0) >= 70 && o.CloseDate && daysBetween(today(), o.CloseDate) <= 30);
    if (big.length) out.push({ icon: '🏁', tone: 'good', text: `${big.length} likely win${big.length > 1 ? 's' : ''} closing within 30 days (${fmt.short(sum(big, (o) => o.Amount))})`, ids: big.slice(0, 4).map((o) => o.Id) });
    return out;
  }

  function taskRow(t) {
    const overdue = t.ActivityDate && t.ActivityDate < today();
    return h('div.trow',
      h('input', { type: 'checkbox', checked: t.Status === 'Completed', onchange: (e) => DB.update(t.Id, { Status: e.target.checked ? 'Completed' : 'Not Started' }) }),
      h('div.grow', h('a.reclink', { href: '#/r/' + t.Id }, t.Subject), h('small', [t.WhoId ? DB.name(t.WhoId) : null, t.WhatId ? DB.name(t.WhatId) : null].filter(Boolean).join(' · '))),
      h(`span.tl-when${overdue ? '.overdue' : ''}`, t.ActivityDate ? fmt.dateShort(t.ActivityDate) : ''));
  }

  function recRow(obj, r, right) {
    const m = DB.meta(obj);
    return h('a.rrow', { href: '#/r/' + r.Id }, UI.icon(obj, 28),
      h('div.grow', h('b', DB.name(r.Id)), h('small', (m.compact || []).filter((c) => c !== m.nameField).slice(0, 2).map((c) => (m.field[c].type === 'lookup' ? DB.name(r[c]) : DB.display(obj, c, r[c]))).filter(Boolean).join(' · '))),
      right || null);
  }

  Views.home = (ctx) => {
    const me = DB.me() || {};
    const scope = ctx.params.scope === 'team' ? 'team' : 'me';
    const who = scope === 'team' ? 'the team' : 'you';
    const q = quarterOf(today());
    const won = DB.query('Opportunity', { filters: [['StageName', 'eq', 'Closed Won'], ['CloseDate', 'thisquarter'], ...mine(scope)] });
    const wonAmt = sum(won, (o) => o.Amount);
    const quota = scope === 'team' ? sum(DB.all('User').filter((u) => u.Quota), (u) => u.Quota) : me.Quota || 0;
    const open = DB.query('Opportunity', { filters: [OPEN, ...mine(scope)], sort: 'Amount', dir: 'desc' });
    const commit = sum(open.filter((o) => o.ForecastCategory === 'Commit' && quarterOf(o.CloseDate) === q), (o) => o.Amount);
    const tasks = DB.query('Task', { filters: [['Status', 'ne', 'Completed'], ...mine(scope)], sort: 'ActivityDate' }).filter((t) => !t.ActivityDate || t.ActivityDate <= addDays(today(), 7));
    const overdue = tasks.filter((t) => t.ActivityDate && t.ActivityDate < today()).length;
    const cases = DB.query('Case', { filters: [['Status', 'ne', 'Closed'], ...mine(scope)] });
    const leads = DB.query('Lead', { filters: [['Status', 'notin', ['Closed - Converted', 'Closed - Not Converted']], ...mine(scope)], sort: 'Score', dir: 'desc' });
    const recent = DB.org().recent.map(DB.get).filter(Boolean).slice(0, 8);
    const ins = insights(scope);

    const byStage = STAGES.filter((s) => !s.startsWith('Closed')).map((s) => ({ label: s, value: sum(open.filter((o) => o.StageName === s), (o) => o.Amount) }));

    const briefing = Einstein.card({
      key: `brief:${DB.org().me}:${scope}:${today()}`, title: 'Your daily briefing', label: 'Brief me', icon: '☀️', className: 'wide',
      intro: `${Einstein.word()} reads ${who === 'you' ? 'your' : "the team's"} pipeline, tasks, cases and leads and tells you what to focus on today.`,
      ask: () => ({ task: 'daily-briefing', prompt: `Write today's briefing for ${who === 'you' ? me.Name + ' (' + (me.Title || me.Role) + ')' : 'the whole team'}: the 3 things to focus on and why, then quick notes on anything at risk. Use bullets, under 170 words, link records.

Quarter ${q}: closed won ${fmt.money(wonAmt)} of ${fmt.money(quota)} quota; commit ${fmt.money(commit)}.
Insights: ${ins.map((i) => i.text + ' ' + i.ids.map((x) => `[[${x}]]`).join(' ')).join('; ') || 'none'}

Open deals (top 15 by amount):
${Einstein.listContext('Opportunity', open.slice(0, 15), ['Name', 'AccountId', 'StageName', 'Amount', 'CloseDate', 'WinScore', 'NextStep'])}

Tasks due (${overdue} overdue):
${Einstein.listContext('Task', tasks.slice(0, 12), ['Subject', 'ActivityDate', 'WhoId', 'WhatId'])}

Open cases (${cases.length}):
${Einstein.listContext('Case', cases.slice(0, 10), ['CaseNumber', 'Subject', 'Priority', 'Status', 'AccountId'])}

Top leads:
${Einstein.listContext('Lead', leads.slice(0, 8), ['Name', 'Company', 'Score', 'Status', 'Rating'])}` }),
    });

    return h('div.page.home',
      h('header.homehead',
        h('div', h('h1', `${greeting()}, ${String(me.Name || '').split(' ')[0] || 'there'}`), h('p.muted', `${fmt.date(today())} · ${q} · ${DB.org().company}`)),
        h('div.grow'),
        h('div.seg', h(`button${scope === 'me' ? '.on' : ''}`, { onclick: () => ctx.set({ scope: null }) }, 'Me'), h(`button${scope === 'team' ? '.on' : ''}`, { onclick: () => ctx.set({ scope: 'team' }) }, 'Team'))),
      h('div.kpis',
        h('div.kpi.gauge', h('div.kpi-l', `Quarter to date · ${q}`), Charts.draw('gauge', [{ label: 'Closed won', value: wonAmt }], { goal: quota || null, format: fmt.short }),
          h('div.kpi-s', quota ? `${fmt.short(wonAmt)} of ${fmt.short(quota)} quota · Commit ${fmt.short(commit)}` : `${fmt.short(wonAmt)} closed won`)),
        UI.stat('Open pipeline', fmt.short(sum(open, (o) => o.Amount)), `${open.length} deals`),
        UI.stat('Tasks this week', String(tasks.length), overdue ? `${overdue} overdue` : 'None overdue', overdue ? '#e5484d' : null),
        UI.stat('Open cases', String(cases.length), `${cases.filter((c) => ['High', 'Critical'].includes(c.Priority)).length} high priority`),
        UI.stat('Hot leads', String(leads.filter((l) => (l.Score || 0) >= 70).length), 'Score 70+')),
      briefing,
      h('div.homegrid',
        UI.card('Einstein insights', ins.length ? h('div.insights', ins.map((i) => h(`div.ins.${i.tone}`, h('span.ins-ic', i.icon),
          h('div.grow', h('b', i.text), h('div.ins-links', i.ids.map((x) => h('a.reclink', { href: '#/r/' + x }, DB.name(x))))),
          h('button.btn.sm.ai', { onclick: () => Shell.ask(`${i.text}: ${i.ids.map((x) => `[[${x}]]`).join(', ')}. What should I do about it?`), title: 'Ask Agentforce' }, '✨')))) : h('p.muted', 'Nothing needs attention right now. 🎉'), { icon: '💡' }),
        UI.card("Today's tasks", tasks.length ? h('div', tasks.slice(0, 8).map(taskRow), tasks.length > 8 ? h('a.link.pad', { href: Shell.objUrl('Task') }, `View all (${tasks.length})`) : null) : h('p.muted', 'No open tasks this week.'),
          { icon: '✅', count: tasks.length, actions: h('button.btn.sm', { onclick: () => Form.open('Task', { defaults: { ActivityDate: today() }, onSave: () => {} }) }, 'New') }),
        UI.card('Top deals', open.length ? h('div', open.slice(0, 6).map((o) => recRow('Opportunity', o, h('div.right', h('b', fmt.short(o.Amount)), o.WinScore != null ? h('span.score.sm', { style: { '--s': scoreColor(o.WinScore) } }, o.WinScore) : null)))) : h('p.muted', 'No open deals.'), { icon: '👑' }),
        UI.card('Pipeline by stage', Charts.draw('funnel', byStage.filter((d) => d.value), { format: fmt.short, onClick: (d) => Shell.go(Shell.objUrl('Opportunity')) }), { icon: '📊' }),
        UI.card('Hot leads', leads.length ? h('div', leads.slice(0, 6).map((l) => recRow('Lead', l, h('span.score.sm', { style: { '--s': scoreColor(l.Score || 0) } }, l.Score || 0)))) : h('p.muted', 'No open leads.'), { icon: '🎯' }),
        UI.card('Recent records', h('div', recent.map((r) => recRow(DB.objectOf(r.Id), r))), { icon: '🕓' })));
  };
})();
