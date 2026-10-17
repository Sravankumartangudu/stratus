// search.js — global search results: every object at once, grouped, with a facet list on the left.
// When the search reads like a question ("which deals close this month?"), Einstein answers it from the
// matching records and the org, the way Einstein Search answers do.

(() => {
  const QUESTION = /\?\s*$|^(who|what|which|how|when|why|where|show|list|find|give|tell|summari[sz]e|compare|is|are|do|does|did|can)\b/i;

  Views.search = (q, ctx) => {
    q = String(q || '').trim();
    const hits = q ? DB.search(q, { limit: 400 }) : [];
    const groups = groupBy(hits, (x) => x.obj);
    const objs = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    const pick = ctx.params.obj && groups[ctx.params.obj] ? ctx.params.obj : null;
    const shown = pick ? [pick] : objs;

    const answer = q && (QUESTION.test(q) || !hits.length) ? Einstein.card({
      key: `search:${q}`, title: 'Einstein answer', label: 'Answer this', auto: QUESTION.test(q), icon: '✨', className: 'wide',
      intro: `Ask a question in plain words — ${Einstein.word()} answers from your data.`,
      ask: () => {
        const ctxText = objs.slice(0, 6).map((o) => `${DB.meta(o).plural} matching "${q}":\n${Einstein.listContext(o, groups[o].slice(0, 12).map((x) => x.rec))}`).join('\n\n');
        const pipe = DB.query('Opportunity', { filters: [['StageName', 'notin', ['Closed Won', 'Closed Lost']]], sort: 'Amount', dir: 'desc', limit: 25 });
        const cases = DB.query('Case', { filters: [['Status', 'ne', 'Closed']], sort: 'CreatedDate', dir: 'desc', limit: 15 });
        return { task: 'search-answer', prompt: `Question: ${q}\n\nAnswer in 1–4 sentences or a short list, citing records with [[Id]]. If the data below doesn't answer it, say what's missing and suggest where to look.\n\n${Einstein.orgContext()}\n\n${ctxText || '(no records matched the words directly)'}\n\nOpen deals (top 25):\n${Einstein.listContext('Opportunity', pipe, ['Name', 'AccountId', 'StageName', 'Amount', 'CloseDate', 'OwnerId'])}\n\nRecent open cases:\n${Einstein.listContext('Case', cases, ['CaseNumber', 'Subject', 'Priority', 'Status', 'AccountId'])}` };
      },
      actions: () => [h('button.btn.sm', { onclick: () => Shell.ask(q) }, 'Continue in Agentforce')],
    }) : null;

    const table = (obj) => {
      const m = DB.meta(obj);
      const cols = (m.list || [m.nameField]).slice(0, 6);
      const rows = groups[obj].slice(0, pick ? 200 : 6).map((x) => x.rec);
      return UI.card(m.plural, h('table.grid.compact', h('thead', h('tr', cols.map((c) => h('th', m.field[c] ? m.field[c].label : c)))),
        h('tbody', rows.map((r) => h('tr', cols.map((c, i) => i === 0 ? h('td.namecell', h('a.reclink', { href: '#/r/' + r.Id }, DB.name(r.Id))) : h('td', m.field[c] ? Field.view(obj, m.field[c], r) : '')))))),
      { icon: m.icon, count: groups[obj].length, actions: !pick && groups[obj].length > 6 ? h('button.link', { onclick: () => ctx.set({ obj }) }, 'View all') : null });
    };

    return h('div.page.searchpage',
      h('header.pagehead', h('span.objicon', { style: { width: '40px', height: '40px', background: '#5a6b7f' } }, '🔍'),
        h('div', h('div.eyebrow', 'Search results'), h('h1', `“${q}”`)), h('div.grow'),
        h('button.btn.ai', { onclick: () => Shell.ask(q) }, '✨ Ask Agentforce')),
      answer,
      h('div.search-cols',
        h('nav.facets', h('button' + (!pick ? '.on' : ''), { onclick: () => ctx.set({ obj: null }) }, 'Top Results', h('span.count', hits.length)),
          objs.map((o) => h('button' + (pick === o ? '.on' : ''), { onclick: () => ctx.set({ obj: o }) }, DB.meta(o).plural, h('span.count', groups[o].length)))),
        h('div.search-res', hits.length ? shown.map(table) : UI.empty('🔍', `No results for “${q}”`, 'Check the spelling, try fewer words, or ask Agentforce.'))));
  };
})();
