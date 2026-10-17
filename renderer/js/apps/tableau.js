// tableau.js — Tableau: ask a question in words, follow the numbers that matter, build charts by hand.
//
//   Pages['tableau-ask']  Ask Data: a question becomes a report spec (✨ AI, or keyword rules when AI is off),
//                         runs on the real data and is drawn as a chart, a table and a short read-out
//   Pages.pulse           metric cards with period-over-period change, a sparkline and a goal; follow what matters
//   Pages.workbooks       saved workbooks of sheets; a viz editor with Columns / Rows / Color shelves
//
// Every spec goes through DB.runReport, so what you see here is what a saved report would show.
// ✨ only drafts: the question → spec, the insight text, the digest, the "better chart" idea. The user clicks to apply.

const Tableau = (() => {
  const FNS = [['count', 'Count'], ['sum', 'Sum'], ['avg', 'Average'], ['min', 'Min'], ['max', 'Max']];
  const MARKS = [['bar', 'Bar'], ['hbar', 'Horizontal bar'], ['line', 'Line'], ['area', 'Area'], ['donut', 'Donut'], ['table', 'Table']];
  const CHART_NAMES = { bar: 'bar', hbar: 'bar', line: 'line', area: 'area', donut: 'donut', stacked: 'stacked bar', funnel: 'funnel' };
  const lc = (s) => String(s == null ? '' : s).toLowerCase();
  const isNum = (f) => !!f && (['number', 'currency', 'percent', 'rollup'].includes(f.type) || (f.type === 'formula' && ['currency', 'number', 'percent'].includes(f.format)));
  const objList = () => DB.objects().map(DB.meta).filter((m) => m && !m.hidden && m.name !== 'User');
  const DATE_FIELD = { Opportunity: 'CloseDate', Case: 'CreatedDate', Order: 'EffectiveDate', Lead: 'CreatedDate', WorkOrder: 'ScheduledStart', Account: 'CreatedDate', Contact: 'CreatedDate', Campaign: 'StartDate', Task: 'ActivityDate' };
  const dateFieldOf = (obj) => {
    const want = DATE_FIELD[obj];
    if (want && Filters.fieldOf(obj, want)) return want;
    const f = Filters.fields(obj).find((x) => ['date', 'datetime'].includes(x.type) && !x.system);
    return f ? f.name : 'CreatedDate';
  };

  // Things you can group by on an object (dates by month/quarter/year, picklists, lookups, one hop through a lookup).
  function groupables(obj) {
    const out = [];
    for (const f of Filters.fields(obj)) {
      if (['date', 'datetime'].includes(f.type)) for (const g of ['month', 'quarter', 'year']) out.push({ name: `${f.name}:${g}`, label: `${f.label} (${g})`, time: true });
      else if (['picklist', 'lookup', 'checkbox'].includes(f.type) || (f.type === 'text' && !f.system && f.name.includes('.'))) out.push({ name: f.name, label: f.label });
    }
    return out;
  }
  const numerics = (obj) => Filters.fields(obj).filter((f) => isNum(f) && !f.system);
  const groupLabel = (obj, g) => {
    if (!g) return '';
    const [f, gran] = String(g).split(':');
    const fd = Filters.fieldOf(obj, f);
    return (fd ? fd.label : f) + (gran ? ` by ${gran}` : '');
  };
  function measureLabel(obj, agg) {
    if (!agg || agg.fn === 'count' || !agg.field) return 'Record count';
    const fd = Filters.fieldOf(obj, agg.field);
    return `${(FNS.find((x) => x[0] === agg.fn) || ['', agg.fn])[1]} of ${fd ? fd.label : agg.field}`;
  }
  const isTime = (g) => !!g && /:(month|quarter|year)$/.test(g);

  // ---------- spec: validate, run, describe ----------

  // The AI may write Account.Industry where the field path is AccountId.Industry.
  function fixPath(obj, g) {
    if (!g) return null;
    g = String(g);
    const [path, gran] = g.split(':');
    if (!path.includes('.') || Filters.fieldOf(obj, path)) return g;
    const [a, b] = path.split('.');
    return Filters.fieldOf(obj, `${a}Id.${b}`) ? `${a}Id.${b}${gran ? ':' + gran : ''}` : g;
  }

  // Bring any spec (from the AI, the keyword rules or a saved workbook) down to things that really exist.
  function validate(raw) {
    const m = DB.meta(raw.object);
    if (!m) throw new Error(`There is no object called “${raw.object}”.`);
    const okGroup = (g) => { const n = fixPath(m.name, g); return n && Filters.fieldOf(m.name, n.split(':')[0]) ? n : null; };
    const filters = (raw.filters || []).map((x) => {
      const t = Array.isArray(x) ? x : [x.field, x.op, x.value];
      const f = Filters.fieldOf(m.name, t[0]);
      return f && Filters.OPS.some((o) => o[0] === t[1]) ? [t[0], t[1], Array.isArray(t[2]) ? t[2] : Filters.coerce(f, t[1], t[2])] : null;
    }).filter(Boolean);
    const agg = raw.aggregate || raw.agg || {};
    const af = agg.field ? Filters.fieldOf(m.name, agg.field) : null;
    const aggregate = agg.fn && agg.fn !== 'count' && isNum(af) ? { fn: agg.fn, field: agg.field } : { fn: 'count' };
    const groupBy = okGroup(raw.groupBy);
    const groupBy2 = groupBy ? okGroup(raw.groupBy2) : null;
    let chart = ['bar', 'hbar', 'line', 'area', 'donut', 'stacked', 'funnel', 'table'].includes(raw.chart) ? raw.chart : null;
    if (!chart) chart = isTime(groupBy) ? 'line' : 'bar';
    if (chart === 'stacked' && !groupBy2) chart = 'bar';
    if (!groupBy) chart = 'table';
    return { object: m.name, filters, groupBy, groupBy2, aggregate, chart };
  }
  const toReport = (spec) => ({ object: spec.object, filters: spec.filters, groupBy: spec.groupBy, groupBy2: spec.groupBy2 || null, aggregate: spec.aggregate, sort: null });
  function run(spec) {
    const res = DB.runReport(toReport(spec));
    // dates in time order, everything else biggest first (what a reader expects)
    if (spec.groupBy && !isTime(spec.groupBy)) res.groups.sort((a, b) => b.value - a.value);
    return res;
  }
  function titleOf(spec) {
    const m = DB.meta(spec.object);
    const bits = [measureLabel(spec.object, spec.aggregate)];
    if (spec.groupBy) bits.push('by ' + groupLabel(spec.object, spec.groupBy));
    if (spec.groupBy2) bits.push('and ' + groupLabel(spec.object, spec.groupBy2));
    return `${bits.join(' ')} · ${m.plural}`;
  }
  const filterText = (spec) => spec.filters.map((f) => Filters.text(spec.object, f));

  // ---------- no AI: keyword rules for a question ----------

  const OBJECT_WORDS = [
    ['Opportunity', /pipeline|opportunit|deal|forecast|bookings|closed won|win rate/],
    ['Case', /\bcases?\b|ticket|support|csat|escalat/],
    ['Order', /\borders?\b|revenue|storefront|shipments?|checkout/],
    ['Lead', /\bleads?\b|prospect/],
    ['Account', /account|customers?\b|compan/],
    ['Contact', /contact|people/],
    ['Campaign', /campaign/],
    ['WorkOrder', /work ?orders?|field service|technician/],
    ['Product2', /product(?!\s*family)/],
  ];
  const DIM_WORDS = [
    [/\bstage/, 'StageName'], [/priorit/, 'Priority'], [/status/, 'Status'], [/\b(owner|rep|reps|agent|agents|seller|salesperson)\b/, 'OwnerId'],
    [/industr/, 'AccountId.Industry'], [/lead ?source|source/, 'LeadSource'], [/origin/, 'Origin'], [/channel/, 'Channel'], [/reason/, 'Reason'],
    [/product famil|family/, 'Product2Id.Family'], [/product/, 'ProductId'], [/\btype/, 'Type'], [/queue/, 'Queue'], [/sentiment/, 'Sentiment'],
    [/\bcity|cities/, 'City'], [/\baccount\b/, 'AccountId'], [/forecast/, 'ForecastCategory'], [/competitor/, 'Competitor'], [/loss reason/, 'LossReason'],
  ];
  function dimFor(obj, word) {
    const w = lc(word);
    for (const [re, name] of DIM_WORDS) {
      if (!w.match(re)) continue;
      const cand = [name, name === 'AccountId.Industry' && obj === 'Account' ? 'Industry' : null, name === 'ProductId' && obj === 'OrderItem' ? 'Product2Id' : null, name === 'Product2Id.Family' ? 'ProductId.Family' : null, name === 'City' ? 'BillingCity' : null].filter(Boolean);
      for (const c of cand) if (Filters.fieldOf(obj, c)) return c;
    }
    const f = Filters.fields(obj).find((x) => !x.system && ['picklist', 'lookup'].includes(x.type) && (lc(x.label) === w || lc(x.name) === w || w.includes(lc(x.label))));
    return f ? f.name : null;
  }
  function keywordSpec(q) {
    const t = lc(q).replace(/[?.!]/g, ' ');
    let object = null;
    for (const [o, re] of OBJECT_WORDS) if (t.match(re) && DB.meta(o)) { object = o; break; }
    if (!object) return null;
    if (object === 'Order' && t.match(/pipeline|deal|opportunit|won|forecast|bookings/)) object = 'Opportunity';
    const spec = { object, filters: [], groupBy: null, groupBy2: null, aggregate: { fn: 'count' }, chart: null };
    const df = dateFieldOf(object);
    const nums = numerics(object);
    const main = { Opportunity: 'Amount', Order: 'TotalAmount', Case: 'CSAT', WorkOrder: null }[object];
    const wantsMoney = t.match(/pipeline|revenue|amount|sales|value|bookings|worth|spend|total/);
    const avgWord = t.match(/\baverage|\bavg|\bmean\b/);
    const sumWord = t.match(/\btotal|\bsum\b|revenue|pipeline|bookings|how much/);
    const countWord = t.match(/how many|number of|\bcount\b/);
    if (object === 'Case' && t.match(/csat|satisfaction/)) spec.aggregate = { fn: 'avg', field: 'CSAT' };
    else if (main && (wantsMoney || avgWord || sumWord) && !countWord && nums.some((f) => f.name === main)) spec.aggregate = { fn: avgWord ? 'avg' : 'sum', field: main };
    else if (!countWord) { const nf = nums.find((f) => t.includes(lc(f.label))); if (nf) spec.aggregate = { fn: avgWord ? 'avg' : 'sum', field: nf.name }; }
    // grouping: "by x", "per x", "split by y", or a time word
    const by = t.match(/\b(?:by|per|across|for each|each)\s+([a-z ]+?)(?=\s+(?:and|split|in|for|this|last|over|where|with|that|who)\b|$)/);
    const split = t.match(/\b(?:split|broken down|segmented|colou?red|stacked)\s+(?:by|into)\s+([a-z ]+?)(?=\s+(?:in|for|this|last|over|where|with)\b|$)/);
    const tg = t.replace(/\b(this|last|past|current|next)\s+(month|quarter|year)\b/g, ' ');
    const gran = (tg.match(/\b(month|monthly|quarter|quarterly|year|yearly|annual)/) || [])[1];
    const granKey = gran ? gran.replace(/ly$/, '').replace('annual', 'year').replace('month', 'month') : null;
    const timeRe = /^(month|quarter|year|week|time|date|day)/;
    const wordsBy = by ? by[1].trim() : '';
    if (granKey || (by && timeRe.test(wordsBy)) || tg.match(/\btrend|over time|monthly|quarterly|by month/)) {
      const g = granKey && ['month', 'quarter', 'year'].includes(granKey) ? granKey : (wordsBy.match(/^(quarter|year)/) || [, 'month'])[1];
      spec.groupBy = `${df}:${g}`;
      if (by && !timeRe.test(wordsBy)) spec.groupBy2 = dimFor(object, wordsBy);
    } else if (by) {
      spec.groupBy = dimFor(object, wordsBy);
      if (!spec.groupBy) { const parts = wordsBy.split(/\s+and\s+/); spec.groupBy = dimFor(object, parts[0]); if (parts[1]) spec.groupBy2 = dimFor(object, parts[1]); }
    } else {
      // "pipeline stage", "cases priority": look for a dimension word anywhere
      for (const [re, name] of DIM_WORDS) if (t.match(re) && dimFor(object, name === 'AccountId.Industry' ? 'industry' : t.match(re)[0])) { spec.groupBy = dimFor(object, t.match(re)[0]); break; }
    }
    if (split) spec.groupBy2 = dimFor(object, split[1]) || spec.groupBy2;
    if (spec.groupBy2 === spec.groupBy) spec.groupBy2 = null;
    // filters
    const add = (f, op, v) => { if (Filters.fieldOf(object, f)) spec.filters.push([f, op, v]); };
    if (object === 'Opportunity') {
      if (t.match(/closed won|\bwon\b|\bwins?\b/)) add('StageName', 'eq', 'Closed Won');
      else if (t.match(/\blost\b|closed lost/)) add('StageName', 'eq', 'Closed Lost');
      else if (t.match(/\bopen\b|pipeline|forecast/)) add('StageName', 'notin', ['Closed Won', 'Closed Lost']);
    }
    if (object === 'Case') {
      if (t.match(/\bopen\b|unresolved|backlog/)) add('Status', 'ne', 'Closed');
      else if (t.match(/\bclosed\b|resolved/)) add('Status', 'eq', 'Closed');
      if (t.match(/high priority|urgent|critical/)) add('Priority', 'in', ['High', 'Critical']);
      if (t.match(/escalated/)) add('Status', 'eq', 'Escalated');
    }
    if (object === 'Lead' && t.match(/\bnew\b|unqualified|not contacted/)) add('Status', 'eq', 'Open - Not Contacted');
    const days = t.match(/(?:last|past)\s+(\d+)\s+days?/);
    if (days) add(df, 'lastn', Number(days[1]));
    else if (t.match(/this quarter|current quarter/)) add(df, 'thisquarter', '');
    else if (t.match(/this month/)) add(df, 'thismonth', '');
    else if (t.match(/last 30|past month|last month/)) add(df, 'lastn', 30);
    else if (t.match(/last quarter|past quarter|last 90/)) add(df, 'lastn', 90);
    spec.chart = isTime(spec.groupBy) ? 'line' : t.match(/share|mix|breakdown|proportion|percent|split of/) && !spec.groupBy2 ? 'donut' : spec.groupBy2 ? 'stacked' : null;
    return spec;
  }

  // ---------- ✨ question → spec ----------

  async function aiSpec(q) {
    const describe = objList().map((m) => `## ${m.name} (${m.plural})\n` + Filters.fields(m.name).filter((f) => !f.system || ['CreatedDate', 'OwnerId'].includes(f.name))
      .map((f) => `${f.name}:${f.type === 'formula' || f.type === 'rollup' ? f.format || 'text' : f.type}${f.options ? '[' + f.options.slice(0, 10).join('|') + ']' : ''}`).join(', ')).join('\n');
    const S = Einstein.S;
    const r = await Einstein.ask({
      task: 'tableau-ask-data',
      system: 'You turn a business question into a chart spec over a CRM. Use only the objects and fields listed. Group dates with a suffix :month, :quarter or :year (e.g. CloseDate:month). To group by a field of a related record use a dotted path like Account.Industry. Use "$me" for the current user and "$today" for today. Money is plain numbers.',
      prompt: `Today: ${today()}\nFilter operators: ${Filters.OPS.map((o) => o[0]).join(', ')} (in/notin values comma-separated; lastn/nextn take days; no value for isnull, notnull, thisquarter, nextquarter, thismonth, today)\nAggregate functions: count, sum, avg, min, max (sum/avg/min/max need a numeric field).\nCharts: bar, hbar, line (best for time), area, donut (shares), stacked (needs groupBy2), table.\n\n${describe}\n\nQuestion: ${q}`,
      schema: S.obj({
        object: S.str('object API name'),
        groupBy: S.str('field to group by, or empty'),
        groupBy2: S.str('second grouping, or empty'),
        fn: S.oneOf(FNS.map((x) => x[0]), 'aggregate function'),
        field: S.str('numeric field to aggregate, empty for count'),
        filters: S.arr(S.obj({ field: S.str(), op: S.str(), value: S.str() })),
        chart: S.str('chart type'),
      }),
    });
    const spec = validate({ object: r.object, groupBy: r.groupBy, groupBy2: r.groupBy2, aggregate: { fn: r.fn, field: r.field }, filters: r.filters, chart: r.chart });
    spec.meta = r.meta;
    return spec;
  }

  // ---------- read-outs without AI ----------

  function readOut(spec, res) {
    const f = Charts.formatterFor(res.meta, res.agg);
    const lines = [];
    const g = res.groups;
    const label = measureLabel(spec.object, spec.aggregate).toLowerCase();
    if (!spec.groupBy) { lines.push(`${res.rows.length} ${res.meta.plural.toLowerCase()} match. ${spec.aggregate.fn === 'count' ? '' : `The ${label} is ${f(res.total)}.`}`); return lines; }
    if (!g.length) return ['Nothing matches, so there is nothing to chart. Loosen a filter.'];
    const total = sum(g, (x) => x.value);
    const time = isTime(spec.groupBy);
    if (time) {
      const first = g[0], last = g[g.length - 1];
      const peak = g.reduce((a, b) => (b.value > a.value ? b : a), g[0]);
      lines.push(`Across ${g.length} periods, the peak was ${peak.key} at ${f(peak.value)}.`);
      if (g.length > 1 && first.value) { const ch = ((last.value - first.value) / Math.abs(first.value)) * 100; lines.push(`From ${first.key} to ${last.key} it moved ${ch >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(ch))}% (${f(first.value)} to ${f(last.value)}).`); }
    } else {
      const top = g[0];
      lines.push(`${top.key} leads with ${f(top.value)}${['count', 'sum'].includes(spec.aggregate.fn) && total ? `, ${Math.round((top.value / total) * 100)}% of the total` : ''}.`);
      if (g.length > 2) lines.push(`${g[g.length - 1].key} is lowest at ${f(g[g.length - 1].value)}.`);
      if (['count', 'sum'].includes(spec.aggregate.fn) && g.length > 3) { const t3 = sum(g.slice(0, 3), (x) => x.value); lines.push(`The top 3 of ${g.length} groups make up ${Math.round((t3 / total) * 100)}%.`); }
    }
    return lines;
  }

  // ---------- drawing a spec (used by Ask Data and Workbooks) ----------

  function resultTable(spec, res) {
    const f = Charts.formatterFor(res.meta, res.agg);
    const k2 = res.keys2 || [];
    const head = [h('th', groupLabel(spec.object, spec.groupBy) || 'All records'), ...(spec.groupBy2 ? k2.map((k) => h('th.num', k)) : []), h('th.num', spec.groupBy2 ? 'Total' : measureLabel(spec.object, spec.aggregate))];
    return h('div.tablewrap', h('table.grid.compact',
      h('thead', h('tr', head)),
      h('tbody', (res.groups.length ? res.groups : [{ key: 'All', value: res.total, sub: [] }]).slice(0, 60).map((g) => h('tr', h('td', g.key == null || g.key === '' ? '(blank)' : g.key),
        spec.groupBy2 ? k2.map((k) => { const s = (g.sub || []).find((x) => x.key === k); return h('td.num', s ? f(s.value) : ''); }) : null, h('td.num', h('b', f(g.value))))))));
  }
  function drawViz(spec, res, opts = {}) {
    const mark = spec.chart;
    if (!res.groups.length && spec.groupBy) return UI.empty('📭', 'No data', 'Nothing matches those filters.');
    if (mark === 'table' || !spec.groupBy) return resultTable(spec, res);
    const f = Charts.formatterFor(res.meta, res.agg);
    const type = mark === 'bar' && spec.groupBy2 ? 'stacked' : mark;
    const data = Charts.fromReport(res, type, opts.limit || 14);
    return Charts.draw(type, data, { format: f, height: opts.height || 300, single: !spec.groupBy2 && ['bar', 'hbar'].includes(type) });
  }

  // ---------- Ask Data ----------

  const ASK_CHIPS = ['Pipeline by stage', 'Cases by priority', 'Revenue by month', 'Open cases by origin', 'Closed won revenue by industry', 'Average CSAT by agent', 'Leads by source this quarter', 'Orders by channel split by status'];
  const ask = { q: '', spec: null, how: null, error: '', busy: false, ver: 0 };

  // A starter question as a card with a small live preview, worked out by the keyword rules (no AI).
  function starter(q, onPick) {
    let preview = null;
    try {
      const spec = validate(keywordSpec(q));
      const res = run(spec);
      const f = Charts.formatterFor(res.meta, res.agg);
      if (res.groups.length) preview = Charts.draw('bar', res.groups.slice(0, 6).map((g) => ({ label: g.key, value: g.value })), { height: 150, format: f });
    } catch (e) { preview = null; }
    return h('button.card.tb-starter', { onclick: onPick, title: 'Ask this' }, h('b', q), preview || h('small.muted', 'Ask to see the chart'));
  }

  function saveAsReport(spec, q) {
    const m = DB.meta(spec.object);
    const rep = DB.cfg.add('reports', { name: (q || '').length > 3 && q.length < 60 ? q.charAt(0).toUpperCase() + q.slice(1) : titleOf(spec), folder: 'Tableau', object: spec.object, filters: spec.filters, columns: m.list.slice(0, 6), groupBy: spec.groupBy, groupBy2: spec.groupBy2 || null,
      aggregate: spec.aggregate, chart: spec.chart === 'table' ? '' : spec.chart, sort: null, dir: 'desc' });
    UI.toast(`Saved report “${rep.name}”`, 'ok', { label: 'Open', run: () => Shell.go('#/report/' + rep.id) });
    return rep;
  }
  function addToDashboard(e, spec, q) {
    const ds = DB.cfg.list('dashboards');
    if (!ds.length) { UI.toast('No dashboards yet. Create one in Analytics.', 'err'); return; }
    UI.menu(e.currentTarget, ds.map((d) => ({ label: d.name, icon: '📊', run: () => {
      const rep = saveAsReport(spec, q);
      DB.cfg.update('dashboards', d.id, { components: d.components.concat([{ reportId: rep.id, title: rep.name }]) });
      UI.toast(`Added to ${d.name}`, 'ok', { label: 'Open', run: () => Shell.go('#/dashboard/' + d.id) });
    } })));
  }
  function openAsWorkbook(spec, q) {
    const wb = DB.cfg.add('workbooks', { name: q && q.length < 60 ? q.charAt(0).toUpperCase() + q.slice(1) : titleOf(spec), question: q || '', spec: { object: spec.object, filters: spec.filters, groupBy: spec.groupBy, groupBy2: spec.groupBy2 || null, aggregate: spec.aggregate, chart: spec.chart } });
    Shell.go('#/app/tableau/workbooks?id=' + wb.id);
  }

  async function doAsk(q, redraw) {
    q = q.trim();
    if (!q) return;
    const ver = ++ask.ver;
    ask.q = q; ask.busy = true; ask.error = ''; redraw();
    try {
      let spec = null;
      let how = 'rules';
      if (Einstein.ready()) {
        try { spec = await aiSpec(q); how = 'ai'; } catch (e) { if (e.setup) spec = null; else { ask.note = `${Einstein.word()} couldn't read that (${e.message}), so keyword rules answered instead.`; spec = null; } }
      }
      if (!spec) { const k = keywordSpec(q); if (k) spec = validate(k); }
      if (ver !== ask.ver) return;
      if (!spec) throw new Error('I could not tell what to chart. Name a thing (pipeline, cases, orders, leads) and how to slice it, like “cases by priority”.');
      ask.spec = spec; ask.how = how;
      if (how === 'ai') ask.note = '';
    } catch (e) { ask.error = e.message; ask.spec = null; }
    ask.busy = false;
    redraw();
  }

  Pages['tableau-ask'] = { title: 'Ask Data', icon: '💬', render: (ctx) => {
    const out = h('div.tb-out');
    const input = h('textarea', { rows: 2, placeholder: 'Ask a question about your data, like “pipeline by stage” or “cases by priority this quarter”', value: ask.q,
      oninput: (e) => { ask.q = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } } });
    input.value = ask.q;
    const go = () => doAsk(input.value, draw);
    const goBtn = h('button.btn.primary', { onclick: go }, '▶ Ask');
    function draw() {
      goBtn.disabled = ask.busy;
      if (ask.busy) { out.replaceChildren(h('div.tb-busy', UI.spinner(Einstein.ready() ? `${Einstein.word()} is reading your question…` : 'Working…'))); return; }
      if (ask.error) { out.replaceChildren(UI.empty('🤔', 'Not sure what you mean', ask.error)); return; }
      if (!ask.spec) { out.replaceChildren(h('div.tb-hint',
        h('div.row', h('b', 'Start from one of these'), h('div.grow'),
          Einstein.ready() ? h('small.muted', `${Einstein.word()} turns your words into a chart spec; you see the spec and can change the chart.`) : h('small.muted', 'AI is off, so keyword rules read your question. Turn AI on in Settings for freer wording.')),
        h('div.tb-starters', ASK_CHIPS.map((c) => starter(c, () => { input.value = c; doAsk(c, draw); }))))); return; }
      out.replaceChildren(resultView(ask.spec));
    }
    function resultView(spec) {
      let res;
      try { res = run(spec); } catch (e) { return UI.empty('⚠️', "That can't run", e.message); }
      const f = Charts.formatterFor(res.meta, res.agg);
      const chartTypes = spec.groupBy ? (spec.groupBy2 ? ['bar', 'hbar', 'line', 'area', 'table'] : ['bar', 'hbar', 'line', 'area', 'donut', 'table']) : [];
      const pills = h('div.seg', chartTypes.map((t) => h(`button${(spec.chart === t || (t === 'bar' && spec.chart === 'stacked')) ? '.on' : ''}`, { onclick: () => { spec.chart = t === 'bar' && spec.groupBy2 ? 'stacked' : t; draw(); } }, (MARKS.find((x) => x[0] === t) || [0, t])[1])));
      const specLine = h('div.tb-spec',
        h('span.chip', `📦 ${res.meta.plural}`), h('span.chip', `📏 ${measureLabel(spec.object, spec.aggregate)}`),
        spec.groupBy ? h('span.chip', `🧱 ${groupLabel(spec.object, spec.groupBy)}`) : null, spec.groupBy2 ? h('span.chip', `🎨 ${groupLabel(spec.object, spec.groupBy2)}`) : null,
        filterText(spec).map((t, i) => h('span.chip', { title: 'Filter' }, '🔎 ' + t)),
        h('small.muted', ask.how === 'ai' ? `✨ read by ${Einstein.word()}` : 'read by keyword rules'));
      const hints = readOut(spec, res);
      return h('div.tb-result',
        ask.note ? h('div.ai-setup', ask.note) : null,
        h('div.card', h('header.card-head', h('span.card-ic', '📊'), h('h3', titleOf(spec)), h('div.grow'), pills),
          h('div.card-body', specLine, h('div.tb-viz', drawViz(spec, res, { height: 320 })),
            h('div.kpis.tb-kpis', UI.stat('Records', fmt.num(res.rows.length)), spec.aggregate.fn !== 'count' ? UI.stat(measureLabel(spec.object, spec.aggregate), f(res.total)) : null, spec.groupBy ? UI.stat('Groups', fmt.num(res.groups.length)) : null))),
        h('div.tb-cols',
          Einstein.card({ key: 'tb-ask:' + JSON.stringify(toReport(spec)), title: 'Insight', label: `Ask ${Einstein.word()} for the story`, icon: '✨', intro: h('div', h('ul.plain', hints.map((x) => h('li', x))), h('small.muted', 'Computed from the numbers, no AI.')),
            ask: () => ({ task: 'tableau-ask-insight', prompt: `The question was: "${ask.q}"\nChart: ${titleOf(spec)}${filterText(spec).length ? ' · filters: ' + filterText(spec).join('; ') : ''}\n\nData:\n${res.groups.slice(0, 24).map((g) => `${g.key}: ${f(g.value)}`).join('\n') || `Total ${f(res.total)} over ${res.rows.length} records`}\n\nAnswer the question in one short paragraph, then name one thing worth a closer look. Use only these numbers.`,
              schema: Einstein.S.obj({ answer: Einstein.S.str('one paragraph answering the question'), lookCloser: Einstein.S.str('one thing worth checking') }) }),
            render: (r) => h('div', md(r.answer), h('p', h('b', 'Look closer: '), r.lookCloser)) }),
          h('div.card', h('header.card-head', h('span.card-ic', '💾'), h('h3', 'Keep this')),
            h('div.card-body.tb-keep',
              h('button.btn.primary', { onclick: () => saveAsReport(spec, ask.q) }, 'Save as report'),
              h('button.btn', { onclick: (e) => addToDashboard(e, spec, ask.q) }, 'Add to dashboard'),
              h('button.btn', { onclick: () => openAsWorkbook(spec, ask.q) }, 'Open as workbook'),
              h('small.muted', 'Reports show up in Analytics. Workbooks let you tweak the chart here.')))),
        spec.groupBy ? UI.card('Data', resultTable(spec, res), { icon: '🗂️', count: res.groups.length }) : null);
    }
    draw();
    if (ctx.params.q && ctx.params.q !== ask.lastParam) { ask.lastParam = ctx.params.q; input.value = ctx.params.q; setTimeout(go, 0); }
    return h('div.page.tb-page',
      h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '💬'), h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Ask Data')), h('div.grow'),
        h('small.muted', Einstein.ready() ? `Tableau Agent · ${Einstein.word()}` : 'Keyword mode')),
      h('div.card.tb-ask', h('div.card-body', input, h('div.row', ask.spec ? h('div.chips', ASK_CHIPS.slice(0, 5).map((c) => h('button.chip', { onclick: () => { input.value = c; go(); } }, c))) : h('small.muted', 'Enter asks · Shift+Enter for a new line'), h('div.grow'), goBtn))),
      out);
  } };

  // ---------- Pulse ----------

  const PERIODS = { week: { days: 7, label: 'week', prev: 'last week' }, month: { days: 30, label: 'month', prev: 'last month' } };
  const BUCKETS = 12;
  const dayOf = (v) => String(v || '').slice(0, 10);

  function allMetrics() {
    const org = DB.org();
    if (org.metrics.length) return org.metrics;
    // none defined: derive a few from saved reports that have a date
    const out = [];
    for (const r of DB.cfg.list('reports')) {
      if (out.length >= 6) break;
      const df = dateFieldOf(r.object);
      if (!DB.meta(r.object) || !Filters.fieldOf(r.object, df)) continue;
      out.push({ id: 'rep_' + r.id, name: r.name, object: r.object, filters: r.filters || [], dateField: df, agg: r.aggregate || { fn: 'count' }, format: r.aggregate && r.aggregate.field ? 'currency' : 'number', good: 'up', derived: true });
    }
    return out;
  }
  const followed = () => { const p = DB.org().pulseFollow; return Array.isArray(p) ? p : allMetrics().slice(0, 3).map((m) => m.id); };
  function setFollow(id, on) {
    const org = DB.org();
    const cur = followed().filter((x) => x !== id);
    org.pulseFollow = on ? cur.concat([id]) : cur;
    DB.save();
    Shell.render();
  }
  const fmtMetric = (m, v) => (v == null ? '—' : m.format === 'currency' ? fmt.short(v) : m.agg && m.agg.fn === 'avg' ? (Math.round(v * 100) / 100).toLocaleString() : fmt.num(Math.round(v)));

  const mcache = new Map();
  DB.on(() => mcache.clear());
  function rowsOf(m, extra) {
    try { return DB.query(m.object, { filters: (m.filters || []).concat(extra || []) }); } catch (e) { return []; }
  }
  // 12 buckets, newest last. A bucket with no records is 0 for count/sum and blank for average.
  function series(m, period) {
    const key = m.id + '|' + period;
    if (mcache.has(key)) return mcache.get(key);
    const P = PERIODS[period];
    const rows = rowsOf(m);
    const end = today();
    const buckets = Array.from({ length: BUCKETS }, (_, i) => { const e = addDays(end, -(BUCKETS - 1 - i) * P.days); return { from: addDays(e, -(P.days - 1)), to: e, rows: [] }; });
    for (const r of rows) {
      const d = dayOf(r[m.dateField]);
      if (!d) continue;
      const age = daysBetween(d, end);
      if (age < 0 || age >= BUCKETS * P.days) continue;
      buckets[BUCKETS - 1 - Math.floor(age / P.days)].rows.push(r);
    }
    const fnAgg = m.agg || { fn: 'count' };
    const vals = buckets.map((b) => (fnAgg.fn === 'avg' && !b.rows.length ? null : DB.aggregate(b.rows, fnAgg)));
    const s = { vals, buckets, cur: vals[BUCKETS - 1], prev: vals[BUCKETS - 2] };
    mcache.set(key, s);
    return s;
  }
  function delta(m, s) {
    const { cur, prev } = s;
    if (cur == null || prev == null) return { text: 'no prior data', cls: 'flat', pct: null };
    if (!prev) return cur ? { text: 'new this period', cls: 'up good', pct: null } : { text: 'no change', cls: 'flat', pct: 0 };
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    if (Math.abs(pct) < 0.5) return { text: 'flat', cls: 'flat', pct };
    const up = pct > 0;
    const good = (m.good || 'up') === 'up' ? up : !up;
    return { text: `${up ? '▲' : '▼'} ${Math.abs(Math.round(pct))}%`, cls: `${up ? 'up' : 'down'} ${good ? 'good' : 'bad'}`, pct };
  }
  const sparkData = (s) => { const first = s.vals.findIndex((v) => v != null && v !== 0); const from = first < 0 ? 0 : first; return s.vals.slice(from).map((v) => ({ value: v == null ? 0 : v })); };

  function metricCard(m, period, ctx) {
    const s = series(m, period);
    const d = delta(m, s);
    const on = followed().includes(m.id);
    const sd = sparkData(s);
    return h('div.card.tb-metric', { onclick: () => ctx.set({ id: m.id }) },
      h('div.row', h('b.tb-m-name', m.name), h('div.grow'), h(`button.iconbtn.sm${on ? '.on' : ''}`, { title: on ? 'Unfollow' : 'Follow', onclick: (e) => { e.stopPropagation(); setFollow(m.id, !on); } }, on ? '★' : '☆')),
      h('div.tb-m-val', fmtMetric(m, s.cur)),
      h('div.row', h(`span.tb-delta.${d.cls.split(' ').join('.')}`, d.text), h('small.muted', `vs ${PERIODS[period].prev}${s.prev != null ? ': ' + fmtMetric(m, s.prev) : ''}`)),
      sd.length > 1 ? Charts.draw('spark', sd, { color: d.cls.includes('bad') ? 'var(--bad)' : d.cls.includes('good') ? 'var(--ok)' : undefined }) : h('div.tb-nospark', 'Not enough history yet'),
      m.goal ? h('div.tb-goal', h('div.tb-goal-bar', h('i', { style: { width: clamp(Math.round(((s.cur || 0) / m.goal) * 100), 0, 100) + '%' } })), h('small.muted', `Target ${fmtMetric(m, m.goal)} · ${Math.round(((s.cur || 0) / m.goal) * 100)}%`)) : null);
  }

  function pulseFacts(ms, period) {
    return ms.map((m) => { const s = series(m, period); const d = delta(m, s); return `- ${m.name}: ${fmtMetric(m, s.cur)} this ${PERIODS[period].label}, ${d.text} vs ${PERIODS[period].prev} (${fmtMetric(m, s.prev)})${m.goal ? `, target ${fmtMetric(m, m.goal)}` : ''}${(m.good || 'up') === 'down' ? ' (lower is better)' : ''}`; }).join('\n');
  }

  // Which dimension values moved the most between the last two periods.
  function breakdown(m, period, dim) {
    const P = PERIODS[period];
    const end = today();
    const rows = rowsOf(m);
    const inWin = (r, lo, hi) => { const d = dayOf(r[m.dateField]); return d && d >= lo && d <= hi; };
    const cs = addDays(end, -(P.days - 1)), pe = addDays(cs, -1), ps = addDays(pe, -(P.days - 1));
    const meta = DB.meta(m.object);
    const agg = m.agg || { fn: 'count' };
    const keyOf = (r) => { const k = DB.groupKey(meta, r, dim); return k == null || k === '' ? '(blank)' : k; };
    const cur = groupBy(rows.filter((r) => inWin(r, cs, end)), keyOf);
    const prv = groupBy(rows.filter((r) => inWin(r, ps, pe)), keyOf);
    const keys = uniq(Object.keys(cur).concat(Object.keys(prv)));
    return keys.map((k) => { const c = cur[k] ? DB.aggregate(cur[k], agg) : 0, p = prv[k] ? DB.aggregate(prv[k], agg) : 0; return { key: k, cur: c || 0, prev: p || 0, change: (c || 0) - (p || 0) }; }).sort((a, b) => b.cur - a.cur);
  }
  function metricInsights(m, period, s, bd) {
    const out = [];
    const P = PERIODS[period];
    const d = delta(m, s);
    if (s.cur != null) out.push(`${m.name} is ${fmtMetric(m, s.cur)} this ${P.label}, ${d.text === 'flat' ? 'flat' : d.text} compared with ${P.prev}.`);
    const hist = s.vals.slice(0, -1).filter((v) => v != null);
    if (hist.length >= 4 && s.cur != null) {
      const mean = sum(hist, (v) => v) / hist.length;
      const sd = Math.sqrt(sum(hist, (v) => (v - mean) ** 2) / hist.length);
      if (sd > 0) { const z = (s.cur - mean) / sd; if (Math.abs(z) >= 1.5) out.push(`Unusual: this ${P.label} is ${Math.abs(z).toFixed(1)} standard deviations ${z > 0 ? 'above' : 'below'} the usual ${fmtMetric(m, mean)}.`); }
    }
    const filled = s.vals.map((v, i) => [v, i]).filter(([v]) => v != null);
    if (filled.length > 2) { const best = filled.reduce((a, b) => (b[0] > a[0] ? b : a)); const idx = best[1]; if (idx === BUCKETS - 1) out.push(`This is the highest ${P.label} in the last ${BUCKETS}.`); }
    if (bd && bd.length) {
      const drv = bd.slice().sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
      if (drv && drv.change) out.push(`Biggest driver: ${drv.key}, ${drv.change > 0 ? 'up' : 'down'} ${fmtMetric(m, Math.abs(drv.change))} (${fmtMetric(m, drv.prev)} to ${fmtMetric(m, drv.cur)}).`);
    }
    if (m.goal && s.cur != null) { const pc = Math.round((s.cur / m.goal) * 100); out.push(pc >= 100 ? `Target of ${fmtMetric(m, m.goal)} reached (${pc}%).` : `${pc}% of the ${fmtMetric(m, m.goal)} target.`); }
    return out;
  }

  const pdim = {};
  function pulseDetail(m, period, ctx) {
    const s = series(m, period);
    const d = delta(m, s);
    const P = PERIODS[period];
    const dims = groupables(m.object).filter((g) => !g.time);
    const pref = ['StageName', 'Status', 'Priority', 'OwnerId', 'LeadSource', 'Channel', 'Origin', 'Type'];
    const def = (pref.find((p) => dims.some((x) => x.name === p)) || (dims[0] || {}).name);
    const dim = pdim[m.id] || def;
    const bdBox = h('div.tb-bd');
    const insBox = h('div');
    const drawBd = () => {
      if (!dim) { bdBox.replaceChildren(h('p.muted', 'Nothing to break down by.')); return; }
      const bd = dim ? breakdown(m, period, dim) : [];
      const max = Math.max(1, ...bd.map((x) => Math.max(x.cur, x.prev)));
      bdBox.replaceChildren(bd.length ? h('div.tablewrap', h('table.grid.compact', h('thead', h('tr', h('th', groupLabel(m.object, dim)), h('th', ''), h('th.num', 'This ' + P.label), h('th.num', 'Before'), h('th.num', 'Change'))),
        h('tbody', bd.slice(0, 12).map((x) => {
          const good = (m.good || 'up') === 'up' ? x.change >= 0 : x.change <= 0;
          return h('tr', h('td', x.key), h('td.tb-bd-bar', h('i', { style: { width: Math.round((x.cur / max) * 100) + '%' } })), h('td.num', fmtMetric(m, x.cur)), h('td.num.muted', fmtMetric(m, x.prev)),
            h(`td.num.${x.change === 0 ? 'muted' : good ? 'ok' : 'err'}`, `${x.change > 0 ? '+' : x.change < 0 ? '-' : ''}${fmtMetric(m, Math.abs(x.change))}`));
        })))) : h('p.muted', 'No records in the last two periods.'));
      insBox.replaceChildren(h('ul.plain', metricInsights(m, period, s, bd).map((x) => h('li', x))));
    };
    drawBd();
    const dimSel = h('select', { onchange: (e) => { pdim[m.id] = e.target.value; Shell.render(); } }, dims.map((g) => h('option', { value: g.name, selected: g.name === dim }, g.label)));
    const labels = s.buckets.map((b) => dateShort(b.to));
    const line = s.vals.map((v, i) => ({ label: labels[i], value: v == null ? 0 : v }));
    const on = followed().includes(m.id);
    return h('div.page.tb-page',
      h('header.pagehead', h('button.iconbtn', { title: 'Back', onclick: () => ctx.set({ id: null }) }, '←'), h('span.objicon', { style: { background: ctx.app.color } }, '📈'),
        h('div', h('div.eyebrow', 'Pulse'), h('h1', m.name), h('small.muted', `${m.object}${m.dateField ? ' by ' + groupLabel(m.object, m.dateField) : ''}`)), h('div.grow'),
        periodSeg(period, ctx), h(`button.btn${on ? '' : '.primary'}`, { onclick: () => setFollow(m.id, !on) }, on ? '★ Following' : '☆ Follow')),
      h('div.kpis', UI.stat(`This ${P.label}`, fmtMetric(m, s.cur), `${P.days} days to today`), UI.stat(`vs ${P.prev}`, d.text, fmtMetric(m, s.prev), d.cls.includes('bad') ? 'var(--bad)' : d.cls.includes('good') ? 'var(--ok)' : undefined),
        m.goal ? UI.stat('Target', fmtMetric(m, m.goal), `${Math.round(((s.cur || 0) / m.goal) * 100)}% there`) : null),
      h('div.tb-cols',
        UI.card(`Trend, last ${BUCKETS} ${P.label}s`, Charts.draw('line', line, { format: (v) => fmtMetric(m, v), goal: m.goal || undefined, height: 250 }), { icon: '📈' }),
        h('div.tb-side', UI.card('What stands out', insBox, { icon: '💡' }),
          Einstein.card({ key: `tb-pulse:${m.id}:${period}:${s.cur}`, title: 'Explain this movement', label: `Ask ${Einstein.word()} why`, icon: '✨', intro: 'A plain-language read of the trend and what to check next.',
            ask: () => ({ task: 'tableau-pulse-explain', prompt: `Metric "${m.name}" (${m.object}). Last ${BUCKETS} ${P.label}s, oldest to newest: ${s.vals.map((v) => fmtMetric(m, v)).join(', ')}.\nLatest vs previous: ${d.text}.${m.goal ? ` Target ${fmtMetric(m, m.goal)}.` : ''}\nBiggest movers by ${dim ? groupLabel(m.object, dim) : 'n/a'}: ${(dim ? breakdown(m, period, dim) : []).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5).map((x) => `${x.key} ${x.prev} to ${x.cur}`).join('; ') || 'none'}.\nExplain in 3 sentences what is happening and name one thing to check. Use only these numbers.`,
              schema: Einstein.S.obj({ explanation: Einstein.S.str('3 sentences'), check: Einstein.S.str('one thing to check next') }) }),
            render: (r) => h('div', md(r.explanation), h('p', h('b', 'Check: '), r.check)) }))),
      UI.card('Breakdown', h('div', h('div.row', h('small.muted', 'Split by '), dimSel), bdBox), { icon: '🧱' }));
  }
  const dateShort = (d) => fmt.dateShort(d);
  const periodSeg = (period, ctx) => h('div.seg', Object.entries(PERIODS).map(([k, v]) => h(`button${period === k ? '.on' : ''}`, { onclick: () => ctx.set({ p: k }) }, v.label[0].toUpperCase() + v.label.slice(1))));

  Pages.pulse = { title: 'Pulse', icon: '📈', render: (ctx) => {
    const period = PERIODS[ctx.params.p] ? ctx.params.p : 'month';
    const ms = allMetrics();
    const open = ms.find((m) => m.id === ctx.params.id);
    if (open) return pulseDetail(open, period, ctx);
    const fol = followed();
    const mine = ms.filter((m) => fol.includes(m.id));
    return h('div.page.tb-page',
      h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '📈'), h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Pulse')), h('div.grow'), periodSeg(period, ctx)),
      Einstein.card({ key: `tb-digest:${period}:${fol.join(',')}:${mine.map((m) => series(m, period).cur).join(',')}`, title: 'Pulse digest', label: `Write my digest with ${Einstein.word()}`, icon: '☀️',
        intro: mine.length ? h('div', h('ul.plain', mine.slice(0, 4).map((m) => { const s = series(m, period); const d = delta(m, s); return h('li', h('b', m.name + ': '), fmtMetric(m, s.cur), ' ', h(`span.tb-delta.${d.cls.split(' ').join('.')}`, d.text)); })), h('small.muted', 'Computed from the numbers you follow.')) : 'Follow a metric below to get a digest.',
        ask: () => ({ task: 'tableau-pulse-digest', prompt: `Write a short morning digest for someone who follows these metrics. This ${PERIODS[period].label} vs ${PERIODS[period].prev}:\n${pulseFacts(mine.length ? mine : ms.slice(0, 4), period)}\n\nStart with the one thing that matters most, then mention what is going well and what needs attention. Under 120 words. Use only these numbers.`,
          schema: Einstein.S.obj({ headline: Einstein.S.str('one sentence'), good: Einstein.S.arr(Einstein.S.str('a thing going well'), 'up to 2'), watch: Einstein.S.arr(Einstein.S.str('a thing to watch'), 'up to 2') }) }),
        render: (r) => h('div', h('p', h('b', r.headline)), (r.good || []).length ? h('ul', r.good.map((x) => h('li', '🟢 ' + x))) : null, (r.watch || []).length ? h('ul', r.watch.map((x) => h('li', '🟠 ' + x))) : null) }),
      mine.length ? h('div', h('h3.tb-sec', 'Following ', h('span.count', mine.length)), h('div.tb-metrics', mine.map((m) => metricCard(m, period, ctx)))) : null,
      ms.length > mine.length ? h('div', h('h3.tb-sec', mine.length ? 'More metrics' : 'Metrics'), h('div.tb-metrics', ms.filter((m) => !fol.includes(m.id)).map((m) => metricCard(m, period, ctx)))) : null,
      ms.length ? null : UI.empty('📈', 'No metrics yet', 'Metrics appear here once your org defines them or you save reports with a date.'));
  } };

  // ---------- Workbooks ----------

  // A workbook keeps its sheets in wb.sheets; wb.spec stays equal to the first sheet so older readers still work.
  function sheetsOf(wb) {
    if (!wb.sheets || !wb.sheets.length) wb.sheets = [{ id: 'sh1', name: 'Sheet 1', spec: wb.spec }];
    return wb.sheets;
  }
  const cloneSpec = (s) => JSON.parse(JSON.stringify(s));
  function saveWorkbook(wb, sheets) {
    DB.cfg.update('workbooks', wb.id, { sheets, spec: sheets[0].spec });
  }
  const ve = { id: null, sheet: null, draft: null, dirty: false, tip: null };
  const specSummary = (spec) => `${DB.meta(spec.object).plural}: ${measureLabel(spec.object, spec.aggregate)}${spec.groupBy ? ' by ' + groupLabel(spec.object, spec.groupBy) : ''}${spec.groupBy2 ? ' colored by ' + groupLabel(spec.object, spec.groupBy2) : ''}${filterText(spec).length ? ' where ' + filterText(spec).join(' and ') : ''}`;
  function safeValidate(spec) { try { return validate(spec); } catch (e) { return null; } }

  function tile(wb, sh, ctx) {
    const spec = safeValidate(sh.spec);
    let body;
    if (!spec) body = h('p.muted', 'This sheet can’t run.');
    else { try { body = drawViz(spec, run(spec), { height: 200, limit: 8 }); } catch (e) { body = h('p.muted', e.message); } }
    return h('div.card.tb-tile', h('header.card-head', h('h3', sh.name), h('div.grow'), h('button.btn.sm', { onclick: () => ctx.set({ sheet: sh.id }) }, 'Edit')), h('div.card-body', body, spec ? h('small.muted', specSummary(spec)) : null));
  }

  function editor(wb, sh, ctx) {
    if (ve.id !== wb.id + '/' + sh.id) { ve.id = wb.id + '/' + sh.id; ve.draft = cloneSpec(safeValidate(sh.spec) || sh.spec); ve.dirty = false; ve.tip = null; }
    const spec = ve.draft;
    const out = h('div.tb-viz');
    const shelves = h('div.tb-shelves');
    const tips = h('div');
    function redraw() { draw(); drawShelves(); }
    function draw() {
      const v = safeValidate(spec);
      if (!v) { out.replaceChildren(UI.empty('⚠️', 'Pick a data source', 'The object is missing.')); return; }
      Object.assign(spec, v);
      try { const res = run(spec); out.replaceChildren(drawViz(spec, res, { height: 340 })); } catch (e) { out.replaceChildren(UI.empty('⚠️', "This can't run", e.message)); }
    }
    const sel = (opts, cur, on, extra) => h('select', { onchange: (e) => { on(e.target.value); ve.dirty = true; redraw(); }, ...(extra || {}) }, opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    function drawShelves() {
      const groups = groupables(spec.object);
      const nums = numerics(spec.object);
      const fn = spec.aggregate.fn;
      shelves.replaceChildren(
        h('div.tb-shelf', h('label', 'Data'), sel(objList().map((m) => [m.name, m.plural]), spec.object, (v) => { Object.assign(spec, { object: v, filters: [], groupBy: null, groupBy2: null, aggregate: { fn: 'count' }, chart: 'table' }); })),
        h('div.tb-shelf', h('label', 'Columns'), sel([['', '(none)'], ...groups.map((g) => [g.name, g.label])], spec.groupBy || '', (v) => { spec.groupBy = v || null; if (v && spec.chart === 'table') spec.chart = isTime(v) ? 'line' : 'bar'; })),
        h('div.tb-shelf', h('label', 'Rows'), h('div.row', sel(FNS.filter(([k]) => k === 'count' || nums.length).map(([k, l]) => [k, l]), fn, (v) => { spec.aggregate = v === 'count' ? { fn: 'count' } : { fn: v, field: (spec.aggregate.field || (nums[0] || {}).name) }; }),
          fn !== 'count' ? sel(nums.map((f) => [f.name, f.label]), spec.aggregate.field, (v) => { spec.aggregate.field = v; }) : null)),
        h('div.tb-shelf', h('label', 'Color'), sel([['', '(none)'], ...groups.filter((g) => !g.time).map((g) => [g.name, g.label])], spec.groupBy2 || '', (v) => { spec.groupBy2 = v || null; if (v && spec.chart === 'donut') spec.chart = 'bar'; if (!v && spec.chart === 'stacked') spec.chart = 'bar'; })),
        h('div.tb-shelf', h('label', 'Mark'), h('div.seg', MARKS.map(([k, l]) => h(`button${(spec.chart === k || (k === 'bar' && spec.chart === 'stacked')) ? '.on' : ''}`, { onclick: () => { spec.chart = k === 'bar' && spec.groupBy2 ? 'stacked' : k; ve.dirty = true; redraw(); } }, l)))),
        h('div.tb-shelf', h('label', 'Filters'), h('div.tb-filters', spec.filters.map((f, i) => h('span.fchip', Filters.text(spec.object, f), h('button.x', { title: 'Remove', onclick: () => { spec.filters.splice(i, 1); ve.dirty = true; redraw(); } }, '×'))),
          h('button.link', { onclick: () => Filters.editor(spec.object, (f) => { spec.filters.push(f); ve.dirty = true; redraw(); }) }, '＋ Add filter'))));
    }
    redraw();
    const sheets = sheetsOf(wb);
    const save = () => {
      const v = safeValidate(spec);
      if (!v) return;
      const next = sheets.map((s) => (s.id === sh.id ? Object.assign({}, s, { spec: { object: v.object, filters: v.filters, groupBy: v.groupBy, groupBy2: v.groupBy2, aggregate: v.aggregate, chart: v.chart } }) : s));
      saveWorkbook(wb, next);
      ve.dirty = false;
      UI.toast('Sheet saved');
    };
    const vizFacts = () => { const v = safeValidate(spec); const res = run(v); const f = Charts.formatterFor(res.meta, res.agg); return `${specSummary(v)}\nMark: ${v.chart}\nValues:\n${res.groups.slice(0, 24).map((g) => `${g.key}: ${f(g.value)}`).join('\n') || f(res.total)}`; };
    return h('div.tb-editor',
      h('div.card', h('header.card-head', h('span.card-ic', '🛠️'), h('h3', 'Shelves')), h('div.card-body', shelves)),
      h('div.tb-edright',
        h('div.card', h('header.card-head', h('span.card-ic', '📊'), h('h3', sh.name), h('div.grow'),
          h('button.btn.sm', { onclick: () => ctx.set({ sheet: null }) }, 'Back to dashboard'), h('button.btn.sm.primary', { onclick: save }, 'Save sheet')), h('div.card-body', out)),
        h('div.tb-cols',
          Einstein.card({ key: 'tb-explain:' + ve.id + JSON.stringify(spec), title: 'Explain this viz', label: `Explain with ${Einstein.word()}`, icon: '✨', intro: 'What the chart shows and what to look at first.',
            ask: () => ({ task: 'tableau-explain-viz', prompt: `Explain this chart to a business reader in 3 sentences and say what stands out.\n\n${vizFacts()}`, schema: Einstein.S.obj({ explanation: Einstein.S.str('3 sentences'), standsOut: Einstein.S.str('what stands out') }) }),
            render: (r) => h('div', md(r.explanation), h('p', h('b', 'Stands out: '), r.standsOut)) }),
          Einstein.card({ key: 'tb-better:' + ve.id + JSON.stringify(spec), title: 'Suggest a better chart', label: `Ask ${Einstein.word()}`, icon: '✨', intro: 'Is this the right chart for the question? Ask for a second opinion.',
            ask: () => ({ task: 'tableau-better-chart', prompt: `Is "${spec.chart}" the best chart for this? Pick the best mark from: bar, hbar, line, area, donut, table. Dates are best as line or area; shares of a whole as donut (few slices); many categories as hbar; stacked color needs bar.\n\n${vizFacts()}`,
              schema: Einstein.S.obj({ chart: Einstein.S.oneOf(MARKS.map((x) => x[0]), 'best mark'), reason: Einstein.S.str('one sentence') }) }),
            render: (r) => h('div', h('p', h('b', (MARKS.find((x) => x[0] === r.chart) || [0, r.chart])[1]), ' · ', r.reason)),
            actions: (r) => (r.chart && r.chart !== spec.chart ? [h('button.btn.sm.primary', { onclick: () => { spec.chart = r.chart === 'bar' && spec.groupBy2 ? 'stacked' : r.chart; ve.dirty = true; redraw(); } }, 'Use this chart')] : []) }))));
  }

  function workbookView(wb, ctx) {
    const sheets = sheetsOf(wb);
    const sid = ctx.params.sheet;
    const sh = sheets.find((s) => s.id === sid);
    const addSheet = () => {
      const base = sheets[sheets.length - 1].spec;
      const ns = { id: DB.uid('sh'), name: `Sheet ${sheets.length + 1}`, spec: cloneSpec(base) };
      saveWorkbook(wb, sheets.concat([ns]));
      ctx.set({ sheet: ns.id });
    };
    const tabs = h('div.tb-tabs', h(`button.chip${!sh ? '.on' : ''}`, { onclick: () => ctx.set({ sheet: null }) }, '🗂️ Dashboard'),
      sheets.map((s) => h(`button.chip${sh && s.id === sh.id ? '.on' : ''}`, { onclick: () => ctx.set({ sheet: s.id }) }, s.name)), h('button.chip', { onclick: addSheet }, '＋ Sheet'));
    return h('div.page.tb-page',
      h('header.pagehead', h('button.iconbtn', { title: 'All workbooks', onclick: () => ctx.set({ id: null, sheet: null }) }, '←'), h('span.objicon', { style: { background: ctx.app.color } }, '📓'),
        h('div', h('div.eyebrow', 'Workbook'), h('h1', wb.name), wb.question ? h('small.muted', `“${wb.question}”`) : null), h('div.grow'),
        sh && sheets.length > 1 ? h('button.btn', { onclick: async () => { if (await UI.confirm(`Delete “${sh.name}”?`, 'The sheet is removed from this workbook.')) { saveWorkbook(wb, sheets.filter((s) => s.id !== sh.id)); ctx.set({ sheet: null }); } } }, 'Delete sheet') : null,
        sh ? h('button.btn', { onclick: () => renameSheet(wb, sh, sheets) }, 'Rename sheet') : null,
        h('button.btn', { onclick: async () => { if (await UI.confirm(`Delete workbook “${wb.name}”?`, 'This cannot be undone.')) { DB.cfg.remove('workbooks', wb.id); ctx.set({ id: null, sheet: null }); } } }, 'Delete')),
      tabs,
      sh ? editor(wb, sh, ctx) : h('div.tb-tiles', sheets.map((s) => tile(wb, s, ctx))));
  }
  function renameSheet(wb, sh, sheets) {
    const inp = h('input', { value: sh.name });
    UI.modal({ title: 'Rename sheet', body: h('div.form', inp), actions: [{ label: 'Cancel', run: () => {} }, { label: 'Rename', primary: true, run: () => { if (inp.value.trim()) saveWorkbook(wb, sheets.map((s) => (s.id === sh.id ? Object.assign({}, s, { name: inp.value.trim() }) : s))); } }] });
  }

  function newWorkbook(ctx) {
    const f = { name: '', object: 'Opportunity' };
    const name = h('input', { placeholder: 'e.g. Pipeline health', oninput: (e) => { f.name = e.target.value; } });
    UI.modal({ title: 'New workbook', body: h('div.form', h('label', 'Name', name),
      h('label', 'Start from', h('select', { onchange: (e) => { f.object = e.target.value; } }, objList().map((m) => h('option', { value: m.name, selected: m.name === f.object }, m.plural))))),
      actions: [{ label: 'Cancel', run: () => {} }, { label: 'Create', primary: true, run: () => {
        if (!f.name.trim()) { UI.toast('Give it a name', 'err'); return false; }
        const spec = { object: f.object, filters: [], groupBy: null, groupBy2: null, aggregate: { fn: 'count' }, chart: 'table' };
        const dim = groupables(f.object).find((g) => !g.time);
        if (dim) { spec.groupBy = dim.name; spec.chart = 'bar'; }
        const wb = DB.cfg.add('workbooks', { name: f.name.trim(), question: '', spec });
        ctx.set({ id: wb.id, sheet: 'sh1' });
      } }] });
  }

  Pages.workbooks = { title: 'Workbooks', icon: '📓', render: (ctx) => {
    const list = DB.org().workbooks;
    const wb = list.find((w) => w.id === ctx.params.id);
    if (wb) return workbookView(wb, ctx);
    return h('div.page.tb-page',
      h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '📓'), h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Workbooks')), h('div.grow'), h('button.btn.primary', { onclick: () => newWorkbook(ctx) }, '＋ New workbook')),
      list.length ? h('div.tb-books', list.map((w) => {
        const sheets = sheetsOf(w);
        const spec = safeValidate(sheets[0].spec);
        let thumb = h('div.muted', '—');
        if (spec) { try { thumb = drawViz(spec, run(spec), { height: 150, limit: 6 }); } catch (e) { /* leave the dash */ } }
        return h('button.card.tb-book', { onclick: () => ctx.set({ id: w.id, sheet: null }) },
          h('div.tb-thumb', thumb), h('div.tb-book-body', h('b', w.name), w.question ? h('small.muted', `“${w.question}”`) : null, h('small.muted', `${sheets.length} sheet${sheets.length === 1 ? '' : 's'}${spec ? ' · ' + DB.meta(spec.object).plural : ''}`)));
      })) : UI.empty('📓', 'No workbooks yet', 'Ask a question and choose “Open as workbook”, or start a new one.'));
  } };

  return { keywordSpec, validate, run, series, delta, allMetrics, followed, sheetsOf, groupables, aiSpec, ask };
})();
