// marketing.js — the Marketing app's own screens:
//   Pages.marketing  campaign performance: KPIs, funnel, ROI, leads by source, call-outs, ✨ campaign brief
//   Pages.journeys   Journey Builder: a canvas of steps you can edit, simulate and build from words
//   Pages.email      Email studio: templates, merge-field preview, ✨ write / subject lines / tone, send test
// Rule-based numbers and checks need no AI; every ✨ only drafts and the user clicks to apply.

(() => {
  const RESPONDED = ['Responded', 'Attended', 'Registered'];
  const CLOSED = ['Closed Won', 'Closed Lost'];
  const CAMPAIGN_TYPES = ['Email', 'Webinar', 'Conference', 'Advertisement', 'Social', 'Direct Mail', 'Partner'];
  const x1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const hash = (s) => [...String(s)].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
  const head = (ctx, icon, title, ...btns) => h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, icon),
    h('div', h('div.eyebrow', ctx.app.name), h('h1', title)), h('div.grow'), ...btns);

  // ---------- campaign numbers ----------

  function campaignStats() {
    const byCamp = groupBy(DB.all('CampaignMember'), (m) => m.CampaignId);
    const oppsBy = groupBy(DB.all('Opportunity').filter((o) => o.CampaignId), (o) => o.CampaignId);
    return DB.all('Campaign').map((c) => {
      const ms = byCamp[c.Id] || [];
      const os = oppsBy[c.Id] || [];
      const cost = c.ActualCost || 0;
      const won = sum(os.filter((o) => o.StageName === 'Closed Won'), (o) => o.Amount);
      const pipe = sum(os.filter((o) => !CLOSED.includes(o.StageName)), (o) => o.Amount);
      const resp = ms.filter((m) => RESPONDED.includes(m.Status)).length;
      return { c, members: ms.length, resp, rate: ms.length ? resp / ms.length : 0, won, pipe, cost, influenced: won + pipe,
        ret: cost ? (won + pipe) / cost : 0 };
    });
  }

  function leadsBySource(weeks = 9) {
    const leads = DB.all('Lead');
    const bySrc = groupBy(leads, (l) => l.LeadSource || 'Other');
    const top = Object.entries(bySrc).sort((a, b) => b[1].length - a[1].length).slice(0, 5).map((e) => e[0]);
    const keys = [];
    for (let k = weeks - 1; k >= 0; k--) keys.push(fmt.dateShort(addDays(today(), -7 * k)));
    const series = top.concat(['Other']).map((label) => ({ label, values: {} }));
    for (const l of leads) {
      const k = Math.floor(daysBetween(String(l.CreatedDate).slice(0, 10), today()) / 7);
      if (k < 0 || k >= weeks) continue;
      const key = keys[weeks - 1 - k];
      const s = series.find((x) => x.label === (top.includes(l.LeadSource) ? l.LeadSource : 'Other'));
      s.values[key] = (s.values[key] || 0) + 1;
    }
    return { keys, series: series.filter((s) => Object.keys(s.values).length) };
  }

  // Rule-based call-outs: plain facts from the data, no AI.
  function callouts(stats) {
    const out = [];
    const live = stats.filter((s) => s.members >= 5);
    const allRate = sum(live, (s) => s.resp) / (sum(live, (s) => s.members) || 1);
    const byType = groupBy(live, (s) => s.c.Type);
    let best = null;
    for (const [type, rows] of Object.entries(byType)) {
      const rate = sum(rows, (s) => s.resp) / (sum(rows, (s) => s.members) || 1);
      const rest = live.filter((s) => s.c.Type !== type);
      const restRate = sum(rest, (s) => s.resp) / (sum(rest, (s) => s.members) || 1);
      if (restRate > 0 && rate / restRate >= 1.3 && (!best || rate / restRate > best.x)) best = { type, rate, x: rate / restRate, restRate };
    }
    if (best) out.push({ icon: '🏆', tone: 'ok', text: `${best.type} campaigns convert ${x1(best.x)}× better than the rest`, sub: `${fmt.pct(best.rate * 100)} respond vs ${fmt.pct(best.restRate * 100)}. Shift budget there.` });
    const withCost = stats.filter((s) => s.cost > 0).sort((a, b) => b.ret - a.ret);
    if (withCost[0] && withCost[0].influenced) out.push({ icon: '💰', tone: 'ok', text: `${withCost[0].c.Name} returns ${x1(withCost[0].ret)}× its cost`, sub: `${fmt.short(withCost[0].influenced)} of pipeline and revenue on ${fmt.short(withCost[0].cost)} spent.` });
    const dead = withCost.filter((s) => !s.influenced && s.c.Status !== 'Planned');
    if (dead[0]) out.push({ icon: '⚠️', tone: 'warn', text: `${dead[0].c.Name} has spent ${fmt.short(dead[0].cost)} with no influenced opportunities`, sub: dead.length > 1 ? `${dead.length - 1} more campaigns are in the same spot. Tag opportunities with their campaign.` : 'Tag opportunities with their campaign so the spend can be measured.' });
    const burning = stats.filter((s) => s.c.Status === 'In Progress' && s.c.BudgetedCost && s.cost / s.c.BudgetedCost > 0.75 && s.c.EndDate > today());
    if (burning[0]) out.push({ icon: '🔥', tone: 'warn', text: `${burning[0].c.Name} has used ${fmt.pct((burning[0].cost / burning[0].c.BudgetedCost) * 100)} of its budget`, sub: `It runs until ${fmt.date(burning[0].c.EndDate)}.` });
    const hotWaiting = DB.all('Lead').filter((l) => l.CampaignId && l.Rating === 'Hot' && l.Status === 'Open - Not Contacted');
    if (hotWaiting.length) out.push({ icon: '🔔', tone: 'bad', text: `${hotWaiting.length} hot ${hotWaiting.length === 1 ? "lead" : "leads"} from campaigns ${hotWaiting.length === 1 ? "has" : "have"} not been contacted`, sub: 'Add a fast-track journey or assign them to a rep today.', go: Shell.objUrl('Lead') });
    const leads = DB.all('Lead');
    const untagged = leads.filter((l) => !l.CampaignId).length;
    if (leads.length && untagged / leads.length > 0.4) out.push({ icon: '🏷️', tone: 'info', text: `${fmt.pct((untagged / leads.length) * 100)} of leads have no campaign`, sub: 'Attribution is incomplete, so ROI is understated.' });
    const soon = stats.filter((s) => s.c.Status === 'Planned' && s.c.StartDate && daysBetween(today(), s.c.StartDate) <= 21 && daysBetween(today(), s.c.StartDate) >= 0);
    if (soon[0]) out.push({ icon: '📅', tone: 'info', text: `${soon[0].c.Name} starts in ${daysBetween(today(), soon[0].c.StartDate)} days`, sub: 'Check the audience, the email and the journey are ready.' });
    if (allRate && !out.length) out.push({ icon: '📈', tone: 'info', text: `Campaigns average a ${fmt.pct(allRate * 100)} response rate`, sub: '' });
    return out;
  }

  // ---------- Marketing home ----------

  const brief = { goal: '', loading: false, error: null, result: null, setup: false };

  Pages.marketing = {
    title: 'Marketing', icon: '📣',
    render: (ctx) => {
      const stats = campaignStats();
      const active = stats.filter((s) => s.c.Status === 'In Progress');
      const members = sum(stats, (s) => s.members);
      const resp = sum(stats, (s) => s.resp);
      const won = sum(stats, (s) => s.won), pipe = sum(stats, (s) => s.pipe), cost = sum(stats, (s) => s.cost);
      const roi = cost ? ((won + pipe - cost) / cost) * 100 : 0;
      const sent = sum(stats, (s) => s.c.NumberSent), opens = sum(stats, (s) => s.c.Opens), clicks = sum(stats, (s) => s.c.Clicks);
      const funnel = [{ label: 'Sent', value: sent }, { label: 'Opened', value: opens }, { label: 'Clicked', value: clicks }, { label: 'Converted', value: resp }].filter((d) => d.value > 0);
      const roiRows = stats.filter((s) => s.cost > 0).sort((a, b) => b.ret - a.ret).map((s) => ({ label: s.c.Name, value: Math.round(s.ret * 10) / 10, key: s.c.Id }));
      const src = leadsBySource();
      const notes = callouts(stats);

      const table = h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', ['Campaign', 'Type', 'Status', 'Members', 'Response', 'Cost', 'Won', 'Pipeline', 'Return'].map((t, i) => h('th' + (i > 2 ? '.num' : ''), t)))),
        h('tbody', stats.slice().sort((a, b) => b.influenced - a.influenced).map((s) => h('tr.mk-row', { onclick: () => Shell.go('#/r/' + s.c.Id) },
          h('td', h('a.reclink', { href: '#/r/' + s.c.Id, onclick: (e) => e.stopPropagation() }, s.c.Name)), h('td', s.c.Type), h('td', UI.badge(s.c.Status, STATUS_COLORS[s.c.Status] || '#5c7080')),
          h('td.num', fmt.num(s.members)), h('td.num', s.members ? fmt.pct(s.rate * 100) : '—'), h('td.num', s.cost ? fmt.short(s.cost) : '—'),
          h('td.num', s.won ? fmt.short(s.won) : '—'), h('td.num', s.pipe ? fmt.short(s.pipe) : '—'), h('td.num', s.cost ? x1(s.ret) + '×' : '—'))))));

      return h('div.page.mk-page',
        head(ctx, '📣', 'Marketing', h('a.btn', { href: '#/app/marketing/journeys' }, '🧭 Journeys'), h('a.btn', { href: '#/app/marketing/email' }, '📨 Email studio'), h('a.btn.primary', { href: Shell.objUrl('Campaign') }, 'All campaigns')),
        h('div.kpis',
          UI.stat('Active campaigns', fmt.num(active.length), `${stats.length} total`, 'var(--accent)'),
          UI.stat('Campaign members', fmt.num(members), `${fmt.num(sum(stats, (s) => s.c.NumberSent))} emails sent`, 'var(--ai)'),
          UI.stat('Responses', fmt.num(resp), members ? `${fmt.pct((resp / members) * 100)} response rate` : '', 'var(--ok)'),
          UI.stat('Pipeline influenced', fmt.short(pipe), 'open opportunities with a campaign', 'var(--warn)'),
          UI.stat('Won influenced', fmt.short(won), 'closed won with a campaign', 'var(--ok)'),
          UI.stat('ROI vs cost', cost ? `${roi >= 0 ? '+' : ''}${fmt.num(Math.round(roi))}%` : '—', `${fmt.short(cost)} actual spend`, roi >= 0 ? 'var(--ok)' : 'var(--bad)')),
        h('div.mk-top',
          briefCard(ctx),
          UI.card('Worth knowing', notes.length ? h('div.mk-calls', notes.map((n) => h(n.go ? 'a.mk-call.' + n.tone : 'div.mk-call.' + n.tone, n.go ? { href: n.go } : null,
            h('span.mk-call-ic', n.icon), h('div', h('b', n.text), n.sub ? h('small', n.sub) : null)))) : h('p.muted', 'Nothing unusual right now.'), { icon: '💡', count: notes.length })),
        h('div.homegrid.mk-charts',
          UI.card('Engagement funnel', Charts.draw('funnel', funnel, { format: fmt.num }), { icon: '🔻' }),
          UI.card('Return by campaign', Charts.draw('hbar', roiRows, { format: (v) => x1(v) + '×', onClick: (d) => Shell.go('#/r/' + d.key), single: true }), { icon: '💰' }),
          UI.card('Leads by source, per week', Charts.draw('stacked', src, { format: fmt.num }), { icon: '⭐', className: 'mk-wide' })),
        UI.card('Campaigns', table, { icon: '📣', count: stats.length }));
    },
  };

  // ✨ Campaign brief: a goal in words → a drafted campaign you can create with one click.
  function briefCard(ctx) {
    const body = h('div.mk-brief');
    const draw = () => {
      const r = brief.result;
      const goal = h('textarea', { rows: 3, placeholder: 'e.g. Get 50 school districts to book a solar site survey before summer break', oninput: (e) => { brief.goal = e.target.value; } }, brief.goal);
      const go = h('button.btn.ai', { disabled: brief.loading, onclick: async () => {
        if (!brief.goal.trim()) { UI.toast('Type a goal first', 'err'); return; }
        if (!Einstein.ready()) { brief.error = Einstein.state().problem; brief.setup = true; brief.result = null; draw(); return; }
        brief.loading = true; brief.error = null; brief.setup = false; draw();
        try {
          const stats = campaignStats().filter((s) => s.members >= 5);
          const perf = Object.entries(groupBy(stats, (s) => s.c.Type)).map(([t, rows]) => `${t}: ${fmt.pct((sum(rows, (s) => s.resp) / (sum(rows, (s) => s.members) || 1)) * 100)} respond`).join('; ');
          brief.result = await Einstein.ask({ task: 'campaign-brief', prompt: `Draft a marketing campaign for this goal: "${brief.goal}".\nPast results by type: ${perf}.\nOur segments: ${DB.all('Segment').map((s) => s.Name).join('; ')}.\nPick the best campaign type, a realistic budget, and a short timeline. Message = the core message in 1-2 sentences.`,
            schema: Einstein.S.obj({ name: Einstein.S.str('campaign name'), type: Einstein.S.oneOf(CAMPAIGN_TYPES), audience: Einstein.S.str('who we target'), channels: Einstein.S.arr(Einstein.S.str(), 'channels used'),
              message: Einstein.S.str('core message'), timeline: Einstein.S.str('week-by-week plan in one short paragraph'), budget: Einstein.S.num('budget in USD'), expectedRevenue: Einstein.S.num('expected revenue in USD'),
              startInDays: Einstein.S.num('days from today until launch'), durationDays: Einstein.S.num('campaign length in days') }) });
        } catch (e) { brief.error = e.message; brief.setup = !!e.setup; }
        brief.loading = false; draw();
      } }, '✨ Draft campaign');
      body.replaceChildren(
        h('p.muted', 'Say what you want to achieve. ', Einstein.word(), ' drafts the campaign and you create it with one click.'),
        goal, h('div.row', go, brief.loading ? UI.spinner(`${Einstein.word()} is planning…`) : null),
        brief.error ? h('div.ai-err', '⚠️ ', brief.error) : null, brief.setup ? Einstein.setupNote(brief.error) : null,
        r ? h('div.mk-draft',
          h('div.mk-draft-h', h('b', r.name), UI.badge(r.type, '#f49756')),
          h('dl.mk-dl', h('dt', 'Audience'), h('dd', r.audience), h('dt', 'Channels'), h('dd', (r.channels || []).join(' · ')), h('dt', 'Message'), h('dd', r.message),
            h('dt', 'Timeline'), h('dd', r.timeline), h('dt', 'Budget'), h('dd', `${fmt.money(r.budget)} · expects ${fmt.short(r.expectedRevenue)}`)),
          h('div.ai-row', Einstein.footnote(r.meta), h('div.grow'),
            h('button.btn.sm.ghost', { onclick: () => { brief.result = null; draw(); } }, 'Discard'),
            h('button.btn.primary.sm', { onclick: () => {
              const start = addDays(today(), Math.max(0, Math.round(r.startInDays || 7)));
              const rec = DB.insert('Campaign', { Name: r.name, Type: CAMPAIGN_TYPES.includes(r.type) ? r.type : 'Email', Status: 'Planned', StartDate: start, EndDate: addDays(start, Math.max(1, Math.round(r.durationDays || 30))),
                BudgetedCost: Math.round(r.budget || 0), ExpectedRevenue: Math.round(r.expectedRevenue || 0), IsActive: true,
                Description: `Goal: ${brief.goal}\nAudience: ${r.audience}\nChannels: ${(r.channels || []).join(', ')}\nMessage: ${r.message}\nTimeline: ${r.timeline}` });
              brief.result = null; brief.goal = '';
              UI.toast(`Campaign “${rec.Name}” created`, 'ok', { label: 'Open', run: () => Shell.go('#/r/' + rec.Id) });
            } }, 'Create campaign'))) : null);
    };
    // The card is rebuilt on redraw but keeps brief state; draw() runs against whichever body is on screen.
    draw();
    return UI.card('Campaign brief', body, { icon: '✨', className: 'ai-card mk-briefcard' });
  }

  // ---------- Journey Builder ----------

  const STEP = {
    email: { icon: '✉️', name: 'Send email', cls: 'act' }, wait: { icon: '⏳', name: 'Wait', cls: '' }, split: { icon: '🔀', name: 'Decision split', cls: 'cond' },
    update: { icon: '✏️', name: 'Update record', cls: 'act' }, slack: { icon: '💬', name: 'Slack alert', cls: 'act' }, sms: { icon: '📱', name: 'Send SMS', cls: 'act' }, task: { icon: '✅', name: 'Create task', cls: 'act' },
  };
  const SPLITS = [['opened', 'Opened the last email'], ['clicked', 'Clicked a link'], ['score', 'Lead score is 60 or more'], ['opp', 'Has an open opportunity'], ['coin', 'Random 50/50 test']];
  const stepId = () => 's' + Math.floor(Math.random() * 9e5 + 1e5);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const stepsOf = (j) => {
    let s = j.Steps;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch (e) { s = []; } }
    return Array.isArray(s) ? s : [];
  };
  const newStep = (type) => {
    const base = { id: stepId(), type, config: {} };
    if (type === 'email') return Object.assign(base, { label: 'Send an email', config: { template: '' } });
    if (type === 'wait') return Object.assign(base, { label: 'Wait 2 days', config: { days: 2 } });
    if (type === 'split') return Object.assign(base, { label: 'Opened the email?', config: { cond: 'opened', yes: 'Engaged', no: 'Not engaged' } });
    if (type === 'sms') return Object.assign(base, { label: 'Text reminder', config: { text: '' } });
    if (type === 'task') return Object.assign(base, { label: 'Call the contact', config: { owner: 'Record owner' } });
    if (type === 'slack') return Object.assign(base, { label: 'Alert the owner in #sales-team', config: { channel: 'sales-team', text: '' } });
    return Object.assign(base, { label: 'Update status', config: { field: 'Status', value: 'Nurturing' } });
  };
  const inferCond = (s) => (s.config && s.config.cond) || (/click/i.test(s.label) ? 'clicked' : /open/i.test(s.label) ? 'opened' : /score/i.test(s.label) ? 'score' : /opportunit/i.test(s.label) ? 'opp' : 'coin');

  // Who enters the journey: the segment's records (or all contacts when the segment is a Data Cloud one).
  function audience(j) {
    const seg = j.SegmentId && DB.get(j.SegmentId);
    let rows = [];
    if (seg && ['Contact', 'Lead'].includes(seg.Source)) {
      const crit = seg.Criteria && seg.Criteria.filters ? seg.Criteria.filters : [];
      const filters = crit;
      try { rows = DB.query(seg.Source, { filters }); } catch (e) { rows = []; }
    }
    if (!rows.length) rows = DB.all('Contact').slice(0, 120);
    return rows;
  }

  // Deterministic run of N people through the steps (seeded, so the same journey gives the same numbers).
  function simulate(j, steps, n) {
    const pool = audience(j);
    const R = rng(hash(j.Id + '|' + n + '|' + JSON.stringify(steps.map((s) => [s.type, s.config]))));
    const res = steps.map(() => ({ in: 0, lost: 0, a: 0, b: 0, c: 0 }));
    let finished = 0, converted = 0;
    for (let i = 0; i < n; i++) {
      const p = pool[i % pool.length];
      const eng = clamp(((p.Score != null ? p.Score : R.int(25, 85)) / 100) + (R() - 0.5) * 0.3, 0.02, 0.98);
      let alive = true, opened = false, clicked = false;
      for (let k = 0; k < steps.length && alive; k++) {
        const s = steps[k], r = res[k];
        r.in++;
        if (s.type === 'email') {
          if (R() < 0.03) { r.lost++; alive = false; break; }
          opened = R() < 0.2 + 0.45 * eng; if (opened) r.a++;
          clicked = opened && R() < 0.2 + 0.35 * eng; if (clicked) r.b++;
        } else if (s.type === 'sms') {
          if (R() < 0.04) { r.lost++; alive = false; break; }
          if (R() < 0.08 + 0.1 * eng) r.a++;
        } else if (s.type === 'wait') {
          if (R() < Math.min(0.12, 0.004 * (Number(s.config.days) || 1))) { r.lost++; alive = false; }
        } else if (s.type === 'split') {
          const c = inferCond(s);
          const yes = c === 'opened' ? opened : c === 'clicked' ? clicked : c === 'score' ? eng > 0.6 : c === 'opp' ? R() < 0.25 : R() < 0.5;
          if (yes) r.a++; else r.b++;
        } else r.a++;
      }
      if (alive) {
        finished++;
        if (R() < 0.02 + 0.1 * eng + (opened ? 0.03 : 0) + (clicked ? 0.06 : 0)) converted++;
      }
    }
    return { n, pool: pool.length, res, finished, converted };
  }

  const jst = {}; // per journey: { draft, sim, simN }
  const jai = { goal: '', loading: false, error: null, result: null, setup: false };

  Pages.journeys = {
    title: 'Journeys', icon: '🧭', live: false,
    render: (ctx) => {
      const root = h('div.page.jb-page');
      const draw = () => root.replaceChildren(...(ctx.params.id && DB.get(ctx.params.id) ? editor(ctx, draw) : [list(ctx, draw)]));
      draw();
      return root;
    },
  };

  function journeyAI(ctx, redraw, onUse, useLabel) {
    const body = h('div.jb-ai');
    const draw = () => {
      const goal = h('textarea', { rows: 2, placeholder: 'e.g. Welcome new battery buyers, send a setup guide after 2 days, alert the rep if they click the offer', oninput: (e) => { jai.goal = e.target.value; } }, jai.goal);
      const r = jai.result;
      body.replaceChildren(goal,
        h('div.row', h('button.btn.ai', { disabled: jai.loading, onclick: async () => {
          if (!jai.goal.trim()) { UI.toast('Describe the journey first', 'err'); return; }
          if (!Einstein.ready()) { jai.error = Einstein.state().problem; jai.setup = true; draw(); return; }
          jai.loading = true; jai.error = null; jai.setup = false; draw();
          try {
            jai.result = await Einstein.ask({ task: 'journey-builder', prompt: `Design a marketing journey: "${jai.goal}".\nAllowed step types: email (needs template name from: ${DB.all('EmailTemplate').map((t) => t.Name).join('; ')} or leave blank), wait (days), split (cond one of opened, clicked, score, opp, coin; yes and no are short branch names), sms (text), task (label), slack (channel and text), update (field and value on the Lead/Contact).\nUse 4 to 9 steps. Labels are short and specific.`,
              schema: Einstein.S.obj({ name: Einstein.S.str('journey name'), goal: Einstein.S.str('the goal in a few words'),
                steps: Einstein.S.arr(Einstein.S.obj({ type: Einstein.S.oneOf(Object.keys(STEP)), label: Einstein.S.str('short step label'), days: Einstein.S.num('wait days, else 0'), template: Einstein.S.str('email template name or empty'),
                  text: Einstein.S.str('sms/slack text or empty'), channel: Einstein.S.str('slack channel or empty'), cond: Einstein.S.str('split condition or empty'), yes: Einstein.S.str('yes branch name or empty'), no: Einstein.S.str('no branch name or empty'),
                  field: Einstein.S.str('field to update or empty'), value: Einstein.S.str('new value or empty') })) }) });
          } catch (e) { jai.error = e.message; jai.setup = !!e.setup; }
          jai.loading = false; draw();
        } }, '✨ Build journey'), jai.loading ? UI.spinner(`${Einstein.word()} is designing…`) : null),
        jai.error ? h('div.ai-err', '⚠️ ', jai.error) : null, jai.setup ? Einstein.setupNote(jai.error) : null,
        r ? h('div.mk-draft', h('div.mk-draft-h', h('b', r.name), h('span.muted', r.goal)),
          h('ol.jb-prev', (r.steps || []).map((s) => h('li', h('span', (STEP[s.type] || STEP.update).icon), ' ', h('b', s.label), s.type === 'wait' && s.days ? h('small.muted', ` ${s.days} days`) : null,
            s.type === 'split' ? h('small.muted', ` ${s.yes || 'yes'} / ${s.no || 'no'}`) : null))),
          h('div.ai-row', Einstein.footnote(r.meta), h('div.grow'), h('button.btn.sm.ghost', { onclick: () => { jai.result = null; draw(); } }, 'Discard'),
            h('button.btn.primary.sm', { onclick: () => { onUse(r, fromAI(r)); jai.result = null; } }, useLabel))) : null);
    };
    draw();
    return UI.card('Build a journey from words', body, { icon: '✨', className: 'ai-card' });
  }
  const fromAI = (r) => (r.steps || []).filter((s) => STEP[s.type]).map((s) => {
    const t = newStep(s.type);
    t.label = s.label || t.label;
    if (s.type === 'email') t.config.template = s.template || '';
    if (s.type === 'wait') t.config.days = Math.max(1, Math.round(s.days || 1));
    if (s.type === 'sms') t.config.text = s.text || '';
    if (s.type === 'slack') Object.assign(t.config, { channel: s.channel || 'sales-team', text: s.text || '' });
    if (s.type === 'split') Object.assign(t.config, { cond: SPLITS.some((c) => c[0] === s.cond) ? s.cond : 'coin', yes: s.yes || 'Yes', no: s.no || 'No' });
    if (s.type === 'update') Object.assign(t.config, { field: s.field || 'Status', value: s.value || '' });
    return t;
  });

  function list(ctx, redraw) {
    const rows = DB.all('Journey');
    const create = (data) => { const j = DB.insert('Journey', data); ctx.set({ id: j.Id }); };
    return h('div.jb-list',
      head(ctx, '🧭', 'Journeys', h('button.btn.primary', { onclick: () => create({ Name: 'New journey', Status: 'Draft', Steps: [newStep('email'), newStep('wait'), newStep('split')] }) }, '+ New journey')),
      h('div.kpis',
        UI.stat('Journeys', fmt.num(rows.length), `${rows.filter((j) => j.Status === 'Running').length} running`, 'var(--accent)'),
        UI.stat('People entered', fmt.num(sum(rows, (j) => j.Entered)), '', 'var(--ai)'),
        UI.stat('Converted', fmt.num(sum(rows, (j) => j.Converted)), fmt.pct((sum(rows, (j) => j.Converted) / (sum(rows, (j) => j.Entered) || 1)) * 100) + ' overall', 'var(--ok)')),
      h('div.flowlist', rows.map((j) => {
        const st = stepsOf(j);
        const seg = j.SegmentId && DB.get(j.SegmentId);
        return h('div.flowcard.jb-card', h('div.row', h('b.grow', j.Name), UI.badge(j.Status, STATUS_COLORS[j.Status] || '#5c7080')),
          h('p.muted', j.Description || j.Goal || ''),
          h('div.jb-mini', st.slice(0, 9).map((s) => h('span.jb-dot', { title: s.label }, (STEP[s.type] || STEP.update).icon)), st.length > 9 ? h('small.muted', `+${st.length - 9}`) : null),
          h('div.jb-meta', h('span', '🎯 ', seg ? seg.Name : 'No segment'), h('span', `${st.length} step${st.length === 1 ? '' : 's'}`), h('span', `${fmt.num(j.Entered || 0)} in`), h('span', j.Entered ? `${fmt.pct(((j.Converted || 0) / j.Entered) * 100)} converted` : 'not started')),
          h('div.fc-foot', h('button.btn.sm.primary', { onclick: () => ctx.set({ id: j.Id }) }, 'Open canvas'), h('div.grow'),
            h('button.btn.sm.ghost.danger', { onclick: async () => { if (await UI.confirm(`Delete ${j.Name}?`, 'The journey and its steps will be removed.')) { DB.remove(j.Id); redraw(); } } }, 'Delete')));
      })),
      journeyAI(ctx, redraw, (r, steps) => create({ Name: r.name || 'AI journey', Goal: r.goal, Status: 'Draft', Steps: steps }), 'Create journey'));
  }

  function editor(ctx, redraw) {
    const j = DB.get(ctx.params.id);
    const S = jst[j.Id] || (jst[j.Id] = { draft: null, sim: null, simN: 250 });
    if (!S.draft) S.draft = { Name: j.Name, Status: j.Status, SegmentId: j.SegmentId || '', CampaignId: j.CampaignId || '', Goal: j.Goal || '', steps: clone(stepsOf(j)) };
    const d = S.draft;
    const saved = () => JSON.stringify([j.Name, j.Status, j.SegmentId || '', j.CampaignId || '', j.Goal || '', stepsOf(j)]);
    const dirty = () => JSON.stringify([d.Name, d.Status, d.SegmentId, d.CampaignId, d.Goal, d.steps]) !== saved();
    const touch = () => { S.sim = null; const b = $('.jb-save'); if (b) b.disabled = false; };
    const names = DB.all('EmailTemplate').map((t) => t.Name);
    const channels = ((DB.org().slack || {}).channels || []).map((c) => c.name);
    const seg = d.SegmentId && DB.get(d.SegmentId);
    const camp = d.CampaignId && DB.get(d.CampaignId);

    const move = (i, by) => { const k = i + by; if (k < 0 || k >= d.steps.length) return; [d.steps[i], d.steps[k]] = [d.steps[k], d.steps[i]]; touch(); redraw(); };
    const insertMenu = (anchor, at) => UI.menu(anchor, Object.entries(STEP).map(([t, m]) => ({ icon: m.icon, label: m.name, run: () => { d.steps.splice(at, 0, newStep(t)); touch(); redraw(); } })));
    const inp = (v, on, o) => h('input', Object.assign({ value: v == null ? '' : v, oninput: (e) => { on(e.target.value); touch(); } }, o || {}));
    const sel = (opts, cur, on) => h('select', { onchange: (e) => { on(e.target.value); touch(); redraw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));

    function config(s) {
      const c = s.config || (s.config = {});
      if (s.type === 'email') return h('div.jb-cfg', h('label', 'Template', sel([['', '— write inline —']].concat(names.map((n) => [n, n])), c.template || '', (v) => { c.template = v; const t = DB.all('EmailTemplate').find((x) => x.Name === v); if (t && (!s.label || /^Send an email/.test(s.label))) s.label = t.Subject || t.Name; })));
      if (s.type === 'wait') return h('div.jb-cfg', h('label', 'Days', inp(c.days, (v) => { c.days = Math.max(1, Number(v) || 1); s.label = `Wait ${c.days} day${c.days > 1 ? 's' : ''}`; }, { type: 'number', min: 1, style: { width: '80px' } })));
      if (s.type === 'split') return h('div.jb-cfg', h('label', 'Condition', sel(SPLITS, inferCond(s), (v) => { c.cond = v; })), h('div.jb-yn', h('label.jb-yes', '✓ ', inp(c.yes, (v) => { c.yes = v; })), h('label.jb-no', '✗ ', inp(c.no, (v) => { c.no = v; }))));
      if (s.type === 'sms') return h('div.jb-cfg', h('label', 'Message', inp(c.text, (v) => { c.text = v; })));
      if (s.type === 'task') return h('div.jb-cfg', h('label', 'Assigned to', inp(c.owner, (v) => { c.owner = v; })));
      if (s.type === 'slack') return h('div.jb-cfg', h('label', 'Channel', channels.length ? sel(channels.map((n) => [n, '#' + n]), c.channel, (v) => { c.channel = v; }) : inp(c.channel, (v) => { c.channel = v; })), h('label', 'Message', inp(c.text, (v) => { c.text = v; })));
      return h('div.jb-cfg', h('label', 'Field', inp(c.field, (v) => { c.field = v; })), h('label', 'New value', inp(c.value, (v) => { c.value = v; })));
    }

    const sim = S.sim;
    const nodes = d.steps.map((s, i) => {
      const m = STEP[s.type] || STEP.update;
      const r = sim && sim.res[i];
      const stats = r ? h('div.jb-stats', h('b', `👥 ${fmt.num(r.in)}`), ' in',
        s.type === 'email' ? [h('span', ` · opened ${r.a}`), h('span', ` · clicked ${r.b}`), r.lost ? h('span.jb-bad', ` · lost ${r.lost}`) : null] : null,
        s.type === 'sms' ? [h('span', ` · replied ${r.a}`), r.lost ? h('span.jb-bad', ` · failed ${r.lost}`) : null] : null,
        s.type === 'wait' && r.lost ? h('span.jb-bad', ` · left ${r.lost}`) : null,
        s.type === 'split' ? [h('span.jb-yes', ` · ✓ ${r.a}`), h('span.jb-no', ` · ✗ ${r.b}`)] : null,
        ['task', 'slack', 'update'].includes(s.type) ? h('span', ` · ${r.a} done`) : null) : null;
      return [h('div.jb-gap', h('div.wire'), h('button.jb-ins', { title: 'Insert a step here', onclick: (e) => insertMenu(e.currentTarget, i) }, '+')),
        h(`div.node.jb-node.${m.cls || 'plain'}`,
          h('div.node-head', h('span.jb-ic', m.icon), h('small', m.name), h('div.grow'),
            h('button.iconbtn.sm', { title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'), h('button.iconbtn.sm', { title: 'Move down', disabled: i === d.steps.length - 1, onclick: () => move(i, 1) }, '↓'),
            h('button.iconbtn.sm', { title: 'Remove', onclick: () => { d.steps.splice(i, 1); touch(); redraw(); } }, '×')),
          inp(s.label, (v) => { s.label = v; }, { class: 'jb-label', placeholder: 'Step name' }), config(s), stats),
        s.type === 'split' ? h('div.jb-branch', h('span.jb-yes', '✓ ', s.config.yes || 'Yes'), h('span.jb-no', '✗ ', s.config.no || 'No')) : null];
    });

    const save = () => {
      try {
        DB.update(j.Id, { Name: d.Name, Status: d.Status, SegmentId: d.SegmentId || null, CampaignId: d.CampaignId || null, Goal: d.Goal, Steps: clone(d.steps) });
        UI.toast('Journey saved');
        redraw();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
    const picks = (obj, cur, on) => h('select', { onchange: (e) => { on(e.target.value); touch(); redraw(); } }, h('option', { value: '' }, '— none —'), DB.all(obj).map((r) => h('option', { value: r.Id, selected: r.Id === cur }, DB.name(r.Id))));

    return [
      head(ctx, '🧭', d.Name || 'Journey', h('a.btn', { href: '#/app/marketing/journeys' }, '← All journeys'), h('a.btn', { href: '#/r/' + j.Id }, 'Record'),
        h('button.btn', { disabled: !dirty(), onclick: () => { S.draft = null; S.sim = null; redraw(); } }, 'Discard changes'),
        h('button.btn.primary.jb-save', { disabled: !dirty(), onclick: save }, 'Save journey')),
      h('div.flowprops.form-grid.jb-props',
        h('label', 'Name', inp(d.Name, (v) => { d.Name = v; })), h('label', 'Status', sel(['Draft', 'Running', 'Paused', 'Completed'].map((x) => [x, x]), d.Status, (v) => { d.Status = v; })),
        h('label', 'Entry segment', picks('Segment', d.SegmentId, (v) => { d.SegmentId = v; })), h('label', 'Campaign', picks('Campaign', d.CampaignId, (v) => { d.CampaignId = v; })),
        h('label.jb-goal', 'Goal', inp(d.Goal, (v) => { d.Goal = v; }))),
      h('div.jb-cols',
        h('div.canvas.jb-canvas', { dataset: { scroll: 'jb-canvas' } },
          h('div.node.start.jb-entry', h('b', '▶ Journey starts'), h('small', seg ? `🎯 ${seg.Name}${seg.Population ? ' · ' + fmt.num(seg.Population) + ' people' : ''}` : 'Choose an entry segment above'), camp ? h('small', `📣 ${camp.Name}`) : null,
            sim ? h('div.jb-stats', h('b', `👥 ${fmt.num(sim.n)}`), ` entering (pool ${fmt.num(sim.pool)})`) : null),
          nodes,
          h('div.jb-gap', h('div.wire')),
          h('div.node.add', h('button.btn.sm', { onclick: (e) => insertMenu(e.currentTarget, d.steps.length) }, '+ Add step')),
          h('div.wire'),
          h('div.node.end', sim ? [h('b', `🏁 ${fmt.num(sim.finished)} finished`), h('small', `🎯 ${fmt.num(sim.converted)} reached the goal (${fmt.pct((sim.converted / sim.n) * 100)})`)] : '■ End')),
        h('div.jb-side',
          UI.card('Simulate', h('div.jb-sim', h('p.muted', 'Run people from the segment through the steps. Same journey, same numbers.'),
            h('div.row', h('label', 'People', h('select', { onchange: (e) => { S.simN = Number(e.target.value); S.sim = null; } }, [50, 100, 250, 500, 1000, 2500].map((n) => h('option', { value: n, selected: n === S.simN }, fmt.num(n))))),
              h('div.grow'), h('button.btn.primary', { disabled: !d.steps.length, onclick: () => { S.sim = simulate(Object.assign({ Id: j.Id }, { SegmentId: d.SegmentId }), d.steps, S.simN); redraw(); } }, '▶ Simulate')),
            sim ? h('div.jb-simsum', UI.stat('Entered', fmt.num(sim.n)), UI.stat('Finished', fmt.num(sim.finished), fmt.pct((sim.finished / sim.n) * 100)), UI.stat('Reached goal', fmt.num(sim.converted), fmt.pct((sim.converted / sim.n) * 100), 'var(--ok)')) : null,
            sim ? Charts.draw('funnel', d.steps.map((s, i) => ({ label: `${i + 1}. ${s.label}`.slice(0, 26), value: sim.res[i].in })).filter((x) => x.value > 0), { format: fmt.num }) : null),
            { icon: '🧪' }),
          journeyAI(ctx, redraw, (r, steps) => { d.steps = steps; if (r.name && !d.Name) d.Name = r.name; if (r.goal && !d.Goal) d.Goal = r.goal; S.sim = null; UI.toast('Steps replaced. Review them, then save.', 'ai'); redraw(); }, 'Replace the steps'))),
    ];
  }

  // ---------- Email studio ----------

  const est = {};   // per template: { name, subject, body, tone, recipient, device, ai }
  const WORDS = /\b(free|urgent|act now|winner|guarantee|buy now|limited time|click here|100%)\b/i;

  // Merge fields, also accepting {!Contact.FirstName} / {!Lead.Company}. Unknown fields stay visible as ⟨Field⟩.
  function mergeFor(text, rec) {
    return String(text || '').replace(/\{!\s*([$\w.]+)\s*\}/g, (tok, p) => {
      const q = p.replace(/^(Contact|Lead|Recipient)\./, '');
      const v = DB.merge(`{!${q}}`, rec);
      return v === '' ? `⟨${q}⟩` : v;
    });
  }
  function subjectCheck(subject) {
    const s = String(subject || '');
    const checks = [
      [s.length >= 25 && s.length <= 55, `${s.length} characters`, s.length < 25 ? 'A little short; 30–50 characters get opened most.' : 'Long subjects get cut off on phones; aim for 30–50.'],
      [/\{!/.test(s), 'Personalised', 'Add a merge field such as {!FirstName}.'],
      [!WORDS.test(s) && !/!{2,}/.test(s) && s.replace(/[^A-Z]/g, '').length < s.length * 0.4, 'No spam triggers', 'Words like “free” or “act now” and shouting hurt delivery.'],
      [/\?|\d/.test(s), 'Curiosity or a number', 'A question or a number gives people a reason to open.'],
    ];
    return { score: Math.round((checks.filter((c) => c[0]).length / checks.length) * 100), checks };
  }
  const people = () => DB.all('Lead').filter((l) => l.Email).slice(0, 30).concat(DB.all('Contact').filter((c) => c.Email).slice(0, 30));

  Pages.email = {
    title: 'Email studio', icon: '📨', live: false,
    render: (ctx) => {
      const root = h('div.page.em-page');
      const draw = () => root.replaceChildren(...view(ctx, draw));
      draw();
      return root;
    },
  };

  function view(ctx, redraw) {
    const all = DB.all('EmailTemplate');
    const id = ctx.params.id && DB.get(ctx.params.id) ? ctx.params.id : all[0] && all[0].Id;
    const rec = id && DB.get(id);
    const nav = h('nav.facets', all.map((t) => h('button' + (t.Id === id ? '.on' : ''), { onclick: () => ctx.set({ id: t.Id }) }, h('span', t.Name), h('small.muted', t.Folder || ''))),
      h('button.link', { onclick: () => { const t = DB.insert('EmailTemplate', { Name: 'New template', Folder: 'Marketing', Tone: 'Friendly', Subject: 'Hello {!FirstName}', Body: 'Hi {!FirstName},\n\n' }); ctx.set({ id: t.Id }); } }, '+ New template'));
    if (!rec) return [head(ctx, '📨', 'Email studio'), UI.empty('📨', 'No templates yet', 'Create one to start.', h('button.btn.primary', { onclick: () => { const t = DB.insert('EmailTemplate', { Name: 'New template', Folder: 'Marketing', Tone: 'Friendly', Subject: 'Hello {!FirstName}', Body: 'Hi {!FirstName},\n\n' }); ctx.set({ id: t.Id }); } }, '+ New template'))];
    const pp = people();
    const E = est[id] || (est[id] = { name: rec.Name, subject: rec.Subject || '', body: rec.Body || '', tone: rec.Tone || 'Friendly', recipient: pp[0] && pp[0].Id, device: 'desktop', brief: '', ai: null });
    const person = DB.get(E.recipient) || pp[0];
    const dirty = E.name !== rec.Name || E.subject !== (rec.Subject || '') || E.body !== (rec.Body || '') || E.tone !== (rec.Tone || 'Friendly');
    let subjIn, bodyIn;

    // live preview pieces are redrawn without rebuilding the inputs, so typing never loses focus
    const preview = h('div.em-previewbox');
    const check = h('div.em-check');
    const drawPreview = () => {
      const subj = mergeFor(E.subject, person), text = mergeFor(E.body, person);
      preview.replaceChildren(h(`div.em-mail${E.device === 'mobile' ? '.mobile' : ''}`,
        h('div.em-chrome', h('div.em-from', h('span.avatar.sm', '☀️'), h('div', h('b', (DB.me() || {}).Name || 'Brightwave'), h('small', `to ${person ? person.Email : '—'}`)))),
        h('div.em-subj', subj || '(no subject)'),
        h('div.em-brand', '☀️ Brightwave Energy'),
        h('div.em-text', text || h('span.muted', 'Write your email on the left.')),
        h('div.em-foot', 'You are receiving this because you asked to hear from Brightwave. Unsubscribe')));
      const c = subjectCheck(E.subject);
      check.replaceChildren(h('div.em-score', { class: c.score >= 75 ? 'good' : c.score >= 50 ? 'mid' : 'low' }, `Subject ${c.score}`),
        h('div.em-checks', c.checks.map(([ok, label, tip]) => h('span.em-chk' + (ok ? '.ok' : ''), { title: ok ? '' : tip }, ok ? '✓ ' : '• ', label))));
    };

    const fieldSel = h('select', { onchange: (e) => {
      if (!e.target.value) return;
      const t = `{!${e.target.value}}`;
      const at = bodyIn.selectionStart == null ? bodyIn.value.length : bodyIn.selectionStart;
      bodyIn.setRangeText(t, at, bodyIn.selectionEnd == null ? at : bodyIn.selectionEnd, 'end');
      E.body = bodyIn.value; drawPreview(); e.target.value = ''; bodyIn.focus();
    } }, h('option', { value: '' }, '+ Insert merge field'), ['FirstName', 'LastName', 'Name', 'Company', 'Title', 'Email', 'City', '$User.Name', '$Today'].map((f) => h('option', { value: f }, f)));
    subjIn = h('input', { value: E.subject, placeholder: 'Subject line', oninput: (e) => { E.subject = e.target.value; drawPreview(); markDirty(); } });
    bodyIn = h('textarea', { rows: 12, oninput: (e) => { E.body = e.target.value; drawPreview(); markDirty(); } }, E.body);
    const saveBtn = h('button.btn.primary', { disabled: !dirty, onclick: () => { try { DB.update(id, { Name: E.name, Subject: E.subject, Body: E.body, Tone: E.tone }); UI.toast('Template saved'); redraw(); } catch (e) { UI.toast(e.message, 'err'); } } }, 'Save');
    function markDirty() { saveBtn.disabled = !(E.name !== rec.Name || E.subject !== (rec.Subject || '') || E.body !== (rec.Body || '') || E.tone !== (rec.Tone || 'Friendly')); }

    const recipient = h('select', { onchange: (e) => { E.recipient = e.target.value; drawPreview(); } },
      h('optgroup', { label: 'Leads' }, pp.filter((p) => p.Id.startsWith('00Q')).map((p) => h('option', { value: p.Id, selected: p.Id === E.recipient }, `${DB.name(p.Id)} · ${p.Company}`))),
      h('optgroup', { label: 'Contacts' }, pp.filter((p) => !p.Id.startsWith('00Q')).map((p) => h('option', { value: p.Id, selected: p.Id === E.recipient }, `${DB.name(p.Id)}${p.AccountId ? ' · ' + DB.name(p.AccountId) : ''}`))));
    const device = h('div.seg', ['desktop', 'mobile'].map((dv) => h('button' + (E.device === dv ? '.on' : ''), { onclick: () => { E.device = dv; redraw(); } }, dv === 'desktop' ? '🖥 Desktop' : '📱 Mobile')));

    const sendTest = () => {
      if (!person) { UI.toast('Pick a recipient', 'err'); return; }
      if (!person.Email) { UI.toast(`${DB.name(person.Id)} has no email address`, 'err'); return; }
      const em = DB.insert('EmailMessage', { Subject: '[Test] ' + mergeFor(E.subject, person), TextBody: mergeFor(E.body, person), ToAddress: person.Email, FromName: (DB.me() || {}).Name, Incoming: false, Status: 'Sent',
        RelatedToId: person.AccountId || person.Id, WhoId: person.Id, MessageDate: new Date().toISOString() });
      UI.toast(`Test email sent to ${person.Email}`, 'ok', { label: 'View', run: () => Shell.go('#/r/' + em.Id) });
    };

    return [
      head(ctx, '📨', 'Email studio', h('button.btn', { disabled: !dirty, onclick: () => { delete est[id]; redraw(); } }, 'Revert'),
        h('button.btn', { onclick: () => { const t = DB.insert('EmailTemplate', { Name: E.name + ' (copy)', Folder: rec.Folder, Tone: E.tone, Subject: E.subject, Body: E.body }); ctx.set({ id: t.Id }); } }, 'Duplicate'),
        h('button.btn.danger', { onclick: async () => { if (await UI.confirm(`Delete ${rec.Name}?`, 'The template will be removed.')) { delete est[id]; DB.remove(id); ctx.set({ id: null }); } } }, 'Delete'), saveBtn),
      h('div.search-cols', nav, h('div.search-res',
        h('div.em-grid',
          UI.card('Compose', h('div.em-compose',
            h('div.form-grid', h('label', 'Template name', h('input', { value: E.name, oninput: (e) => { E.name = e.target.value; markDirty(); } })),
              h('label', 'Tone', h('select', { onchange: (e) => { E.tone = e.target.value; markDirty(); } }, ['Friendly', 'Professional', 'Playful', 'Urgent'].map((t) => h('option', { selected: t === E.tone }, t))))),
            h('label', 'Subject', subjIn), check, h('label', 'Body', bodyIn),
            h('div.row', fieldSel, h('small.muted', 'Merge fields fill in from the person you pick.'))), { icon: '✏️' }),
          UI.card('Preview', h('div.em-prev', h('div.row', h('label.em-who', 'Preview as', recipient), h('div.grow'), device), preview,
            h('div.row', h('small.muted', '⟨Field⟩ means that value is empty for this person.'), h('div.grow'), h('button.btn', { onclick: sendTest }, '📤 Send test'))), { icon: '👁' })),
        assistant(E, rec, redraw, drawPreview, () => { subjIn.value = E.subject; bodyIn.value = E.body; markDirty(); }))),
    ].concat([(drawPreview(), null)]);
  }

  // ✨ Email assistant: write from a brief, three subject lines, improve tone. Each result waits for a click.
  function assistant(E, rec, redraw, drawPreview, syncInputs) {
    const out = h('div.em-aiout');
    const apply = (patch) => { Object.assign(E, patch); E.ai = null; syncInputs(); drawPreview(); redraw(); };
    const show = () => {
      const a = E.ai;
      if (!a) { out.replaceChildren(); return; }
      if (a.loading) { out.replaceChildren(UI.spinner(`${Einstein.word()} is writing…`)); return; }
      if (a.error) { out.replaceChildren(h('div.ai-err', '⚠️ ', a.error), a.setup ? Einstein.setupNote(a.error) : null); return; }
      const r = a.result;
      const foot = h('div.ai-row', Einstein.footnote(r.meta), h('div.grow'), h('button.btn.sm.ghost', { onclick: () => { E.ai = null; show(); } }, 'Discard'));
      if (a.kind === 'subjects') {
        out.replaceChildren(h('div.em-variants', (r.variants || []).slice(0, 3).map((v) => h('div.em-var',
          h('div.grow', h('b', v.subject), h('small', v.why)), h('span.em-open', { title: 'Estimated by the AI from the wording alone, not measured' }, `~${fmt.pct(v.openRate)} open`),
          h('button.btn.sm', { onclick: () => apply({ subject: v.subject }) }, 'Use')))), foot);
        return;
      }
      out.replaceChildren(h('div.em-draft', h('div.em-draft-s', h('b', 'Subject: '), r.subject), h('div.em-draft-b', r.body)),
        h('div.ai-row', Einstein.footnote(r.meta), h('div.grow'), h('button.btn.sm.ghost', { onclick: () => { E.ai = null; show(); } }, 'Discard'),
          h('button.btn.sm', { onclick: () => apply({ body: r.body }) }, 'Use body only'), h('button.btn.primary.sm', { onclick: () => apply({ subject: r.subject || E.subject, body: r.body }) }, 'Use subject + body')));
    };
    const run = async (kind, ask) => {
      if (!Einstein.ready()) { E.ai = { error: Einstein.state().problem, setup: true }; show(); return; }
      E.ai = { loading: true, kind }; show();
      try { E.ai = { kind, result: await Einstein.ask(ask()) }; } catch (e) { E.ai = { error: e.message, setup: !!e.setup }; }
      show();
    };
    const brief = h('input', { value: E.brief || '', placeholder: 'e.g. Announce free site surveys for schools in March, friendly, one clear button', oninput: (e) => { E.brief = e.target.value; } });
    const toneSel = h('select', ['Friendlier', 'More professional', 'More playful', 'More urgent', 'Shorter', 'Clearer'].map((t) => h('option', t)));
    const mergeNote = 'Keep merge fields like {!FirstName} exactly as written.';
    const body = h('div.em-ai',
      h('div.row', brief, h('button.btn.ai', { onclick: () => {
        if (!E.brief.trim()) { UI.toast('Type a short brief first', 'err'); return; }
        run('write', () => ({ task: 'email-write', prompt: `Write a marketing email for ${DB.org().company}. Brief: ${E.brief}\nTone: ${E.tone}. Under 120 words, one clear call to action. ${mergeNote} Sign off as the Brightwave team.`,
          schema: Einstein.S.obj({ subject: Einstein.S.str('subject line'), body: Einstein.S.str('plain-text body') }) }));
      } }, '✨ Write from brief')),
      h('div.row', h('button.btn.ai', { onclick: () => {
        if (!E.body.trim() && !E.subject.trim()) { UI.toast('Write the email first', 'err'); return; }
        run('subjects', () => ({ task: 'email-subjects', prompt: `Write 3 different subject lines for this email, each under 55 characters. For each, estimate the open rate (percent, 10 to 60) a marketer could expect and say why in one short line. Keep merge fields like {!FirstName} where they help.\n\nCurrent subject: ${E.subject}\nBody:\n${E.body}`,
          schema: Einstein.S.obj({ variants: Einstein.S.arr(Einstein.S.obj({ subject: Einstein.S.str(), openRate: Einstein.S.num('estimated open rate, percent'), why: Einstein.S.str('one short reason') })) }) }));
      } }, '✨ 3 subject lines'), h('div.grow'), toneSel, h('button.btn.ai', { onclick: () => {
        if (!E.body.trim()) { UI.toast('Write the email first', 'err'); return; }
        run('tone', () => ({ task: 'email-tone', prompt: `Rewrite this email to be ${toneSel.value.toLowerCase()}. Keep the facts, offer and meaning. ${mergeNote}\n\nSubject: ${E.subject}\nBody:\n${E.body}`,
          schema: Einstein.S.obj({ subject: Einstein.S.str('subject line'), body: Einstein.S.str('plain-text body') }) }));
      } }, '✨ Improve tone')),
      out);
    show();
    return UI.card('Email assistant', body, { icon: '✨', className: 'ai-card' });
  }
})();
