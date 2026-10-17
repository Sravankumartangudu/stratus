// mulesoft.js — MuleSoft: integration flows, the API catalog with a try-it console, and run history.
// Integrations are Integration records ({ Steps: [source, transform, filter, target] }); runs live in org.runs
// ({ id, integrationId, at, status, records, ms, error }) and APIs in org.apis. "Run now" is a deterministic
// simulation that really inserts or updates a few records in the local data. Every ✨ only proposes.

(() => {
  const STEP = { source: ['📥', 'Source'], transform: ['🔀', 'Transform'], filter: ['🧹', 'Filter'], target: ['📤', 'Target'] };
  const STATUS = { Running: 'ok', Paused: 'warn', Error: 'bad', Draft: 'muted' };
  const hash = (s) => [...String(s)].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
  const head = (ctx, icon, title, ...btns) => h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, icon),
    h('div', h('div.eyebrow', ctx.app.name), h('h1', title)), h('div.grow'), ...btns);
  const steps = (it) => (Array.isArray(it.Steps) ? it.Steps : []);
  const stepOf = (it, type) => steps(it).find((s) => s.type === type);
  const targetObj = (it) => { const t = stepOf(it, 'target'); return t && t.config && t.config.object; };
  const runsOf = (it) => DB.org().runs.filter((r) => r.integrationId === it.Id);
  const rate = (rs) => (rs.length ? Math.round((100 * rs.filter((r) => r.status === 'Success').length) / rs.length) : null);
  const pill = (s) => h('span.ms-pill.' + (STATUS[s] || 'muted'), s);

  // Rule-based error categories; always shown, whatever the AI says.
  const CATS = [
    [/401|403|unauthori|forbidden|api key|expired|token|credential/i, 'Authentication', '🔑', 'The target system rejected our credentials. Rotate or re-issue the key, update it in the connection, then re-run.'],
    [/timeout|timed out|deadline/i, 'Timeout', '⏱️', 'The call took too long. Retry with a smaller batch, raise the timeout, or ask the owner of the system to check load.'],
    [/not found|404|missing|no such/i, 'Missing record', '🔎', 'The record the flow expected is not there. Check the key used to match, and whether it was deleted or never synced.'],
    [/429|rate limit|too many/i, 'Rate limit', '🚦', 'We are calling faster than the policy allows. Lower the schedule frequency or add backoff.'],
    [/5\d\d|unavailable|bad gateway|upstream|connection/i, 'Upstream down', '🌩️', 'The other system is unavailable. Check its status page, then retry. Nothing here needs changing.'],
    [/validation|required|invalid|schema|mapping/i, 'Bad data', '🧾', 'The payload did not fit the target. Compare the mapping with the target fields and fix the transform.'],
  ];
  const categorize = (err) => { const c = CATS.find((x) => x[0].test(err || '')); return c ? { name: c[1], icon: c[2], fix: c[3] } : { name: 'Other', icon: '❔', fix: 'Open the run details and check the last step that completed.' }; };

  // ---------- running a flow (deterministic simulation that changes real records) ----------

  const LEADS = [['Dana', 'Whitfield', 'Whitfield Orchards'], ['Marcus', 'Oyelaran', 'Oyelaran Dental'], ['Hana', 'Kobayashi', 'Kobayashi Print Co'], ['Luis', 'Ferreira', 'Ferreira Bakery'], ['Ines', 'Moreau', 'Moreau Studio'], ['Theo', 'Lindqvist', 'Lindqvist Cycles']];
  const FAULTS = ['E-21 inverter fault', 'E-07 grid sync lost', 'E-33 battery overtemp', 'E-14 string mismatch'];

  function simulate(it) {
    const R = rng(hash(it.Id) + (it.Runs || 0) * 7919);
    const obj = targetObj(it);
    const op = (stepOf(it, 'target').config || {}).op;
    const t0 = Date.now();
    if (it.Status === 'Error' && R.chance(0.75)) {
      const err = R.pick(['401 Unauthorized from PayBridge — API key expired', 'Timeout after 30s calling /settlements', '503 Service Unavailable from upstream']);
      return { status: 'Failed', records: 0, ms: R.int(900, 4200), error: err };
    }
    const accts = DB.all('Account');
    let n = 0;
    try {
      if (obj === 'Order') {
        const orders = DB.all('Order');
        if (op === 'update') {
          for (const o of R.chance(0.5) ? orders.slice(0, 3) : orders.slice(3, 7)) {
            const patch = it.Name.startsWith('Shipping') ? { TrackingNumber: 'FX' + R.int(100000, 999999), Status: o.Status === 'Draft' ? 'Activated' : 'Shipped' } : { Status: o.Status === 'Draft' ? 'Activated' : o.Status };
            DB.update(o.Id, patch); n++;
          }
        } else {
          for (let i = 0; i < R.int(2, 4); i++) { DB.insert('Order', { AccountId: R.pick(accts).Id, EffectiveDate: today(), Status: 'Draft' }); n++; }
        }
      } else if (obj === 'Case') {
        for (let i = 0; i < R.int(1, 2); i++) { const a = R.pick(accts); DB.insert('Case', { Subject: `${R.pick(FAULTS)} at ${a.Name}`, AccountId: a.Id, Origin: 'Web', Priority: 'High', Description: 'Opened by the Inverter alerts flow after repeated faults in 24 hours.' }); n++; }
      } else if (obj === 'Lead') {
        for (let i = 0; i < R.int(2, 3); i++) { const [f, l, c] = R.pick(LEADS); DB.insert('Lead', { FirstName: f, LastName: l, Company: c, Email: `${f}.${l}@example.com`.toLowerCase(), LeadSource: 'Web' }); n++; }
      } else n = R.int(1, 5);
    } catch (e) {
      return { status: 'Failed', records: n, ms: R.int(400, 1500), error: 'Validation failed: ' + e.message };
    }
    return { status: 'Success', records: n, ms: R.int(380, 2600) + (Date.now() - t0), error: null };
  }

  function runNow(it) {
    const r = simulate(it);
    const run = Object.assign({ id: DB.uid('run'), integrationId: it.Id, at: new Date().toISOString() }, r);
    DB.org().runs.unshift(run);
    const patch = { Runs: runsOf(it).length, LastRun: run.at };
    if (r.status === 'Success' && it.Status === 'Error') patch.Status = 'Running';
    if (r.status === 'Failed' && it.Status !== 'Paused') patch.Status = 'Error';
    DB.update(it.Id, patch);
    DB.save();
    if (r.status === 'Success') UI.toast(`${it.Name}: ${r.records} record${r.records === 1 ? '' : 's'} moved in ${r.ms} ms`, 'ok', { label: 'Run history', run: () => Shell.go('#/app/mulesoft/runs?int=' + it.Id) });
    else UI.toast(`${it.Name} failed: ${r.error}`, 'err', { label: 'Details', run: () => Shell.go('#/app/mulesoft/runs?int=' + it.Id) });
    return run;
  }
  function toggle(it) {
    DB.update(it.Id, { Status: it.Status === 'Running' ? 'Paused' : 'Running' });
    DB.save();
  }

  // ---------- flow pictures and mapping ----------

  function flow(it, small) {
    const ss = steps(it);
    return h('div.ms-flow' + (small ? '.sm' : ''), ss.map((s, i) => [i ? h('span.ms-arrow', '→') : null,
      h('div.ms-step.' + s.type, { title: s.label }, h('span.ms-step-ic', STEP[s.type] ? STEP[s.type][0] : '•'), h('div', h('small', STEP[s.type] ? STEP[s.type][1] : s.type), h('b', s.label)))]));
  }
  function mappingRows(it) {
    const obj = targetObj(it);
    const m = obj && DB.meta(obj);
    const out = [];
    for (const s of steps(it).filter((x) => x.type === 'transform')) {
      for (const [src, tgt] of Object.entries((s.config && s.config.mapping) || {})) {
        const note = String(tgt).match(/\((.*)\)/);
        const field = String(tgt).replace(/\(.*\)/, '').trim();
        const known = field.split('+').map((x) => x.trim().replace(/\[\]$/, '')).every((f) => m && (m.field[f] || DB.meta(f)));
        out.push({ src, field, note: note ? note[1] : '', ok: !!known, step: s.label });
      }
    }
    return out;
  }
  function dataweave(rows) {
    const pl = (s) => 'payload.' + s;
    return ['%dw 2.0', 'output application/json', '---', '{', ...rows.map((r, i) => `  ${r.field.replace(/\s*\+\s*/g, '')}: ${r.field.includes('+') ? r.field.split('+').map((x, j) => (j ? '" " ++ ' : '') + pl(r.src)).slice(0, 1).join('') : pl(r.src)}${r.note ? '  // ' + r.note : ''}${i < rows.length - 1 ? ',' : ''}`), '}'].join('\n');
  }

  // ✨ propose a mapping from a description or sample JSON; fields are checked against the schema before it is shown.
  function mapper(it, rerender) {
    const obj = targetObj(it) || 'Account';
    const m = DB.meta(obj);
    const box = h('div.ms-mapgen');
    const text = h('textarea', { rows: 5, placeholder: 'Describe the source data, or paste a sample JSON record.\n{ "customer_name": "Harbor Bakery", "order_date": "2026-10-12", "status": "paid" }' });
    const out = h('div');
    async function go() {
      if (!text.value.trim()) { UI.toast('Add a description or a sample record first.', 'info'); return; }
      if (!Einstein.ready()) { UI.toast(Einstein.state().problem, 'err'); return; }
      out.replaceChildren(UI.spinner(`${Einstein.word()} is mapping…`));
      try {
        const fields = m.fields.filter((f) => !['formula', 'rollup', 'autonumber'].includes(f.type) && !f.hidden).map((f) => `${f.name} (${f.type}${f.options ? ': ' + f.options.join('|') : ''}${f.required ? ', required' : ''})`).join('\n');
        const r = await Einstein.ask({ task: 'integration-mapping', prompt: `Map this source data to the Stratus ${m.label} object. Use only the target fields listed. Say how to transform when needed.\n\nSource:\n${text.value}\n\nTarget fields:\n${fields}`,
          schema: Einstein.S.obj({ mapping: Einstein.S.arr(Einstein.S.obj({ source: Einstein.S.str('source field name'), field: Einstein.S.str('target API field name'), note: Einstein.S.str('transform note or empty') }), 'one row per mapped field') }) });
        const good = (r.mapping || []).filter((x) => m.field[x.field] && x.source);
        const dropped = (r.mapping || []).length - good.length;
        if (!good.length) { out.replaceChildren(h('div.ai-err', `⚠️ None of the proposed fields exist on ${m.label}. Try again with more detail.`)); return; }
        out.replaceChildren(h('div.ai-card.ms-ai',
          h('div.ms-note', `${good.length} field${good.length === 1 ? '' : 's'} checked against ${m.label}.${dropped ? ` ${dropped} unknown field${dropped === 1 ? '' : 's'} left out.` : ''}`),
          h('table.grid.ms-tbl', h('thead', h('tr', h('th', 'Source'), h('th', 'Stratus field'), h('th', 'Note'))),
            h('tbody', good.map((x) => h('tr', h('td', h('code', x.source)), h('td', h('b', m.field[x.field].label || x.field)), h('td.muted', x.note || ''))))),
          h('div.ai-foot', Einstein.footnote(r.meta), h('div.grow'), h('button.btn.primary.sm', { onclick: () => {
            const map = {}; for (const x of good) map[x.source] = x.field + (x.note ? ` (${x.note})` : '');
            const ss = steps(it).map((s) => Object.assign({}, s));
            const t = ss.find((s) => s.type === 'transform');
            if (t) t.config = Object.assign({}, t.config, { mapping: map });
            else { const at = Math.max(0, ss.findIndex((s) => s.type === 'target')); ss.splice(at < 0 ? ss.length : at, 0, { type: 'transform', label: 'Map to ' + m.label, config: { mapping: map } }); }
            DB.update(it.Id, { Steps: ss }); DB.save(); UI.toast('Mapping applied', 'ok'); rerender && rerender();
          } }, 'Apply mapping'))));
      } catch (e) { out.replaceChildren(h('div.ai-err', '⚠️ ' + e.message)); }
    }
    box.append(h('p.muted', `Target: ${m.label}. ${Einstein.word()} proposes; nothing changes until you apply it.`), text, h('div.ms-row', h('button.btn.ai.sm', { onclick: go }, '✨ Generate mapping'), h('div.grow')), out);
    return box;
  }

  // ---------- Integrations ----------

  Pages.integrations = {
    title: 'Integrations', icon: '🔗',
    render(ctx) {
      const all = DB.all('Integration');
      const cur = all.find((i) => i.Id === ctx.params.id);
      if (cur) return detail(ctx, cur);
      const total = sum(all, (i) => i.Runs || 0);
      return h('div.page.ms',
        head(ctx, '🔗', 'Integrations', h('button.btn.sm', { onclick: () => Form.open('Integration') }, 'New integration')),
        h('div.kpis',
          UI.stat('Integrations', all.length, `${all.filter((i) => i.Status === 'Running').length} running`),
          UI.stat('Needs attention', all.filter((i) => i.Status === 'Error').length, 'in error', 'var(--bad)'),
          UI.stat('Runs', fmt.num(total), 'all time'),
          UI.stat('Success rate', (rate(DB.org().runs) ?? 0) + '%', 'last runs')),
        h('div.ms-cards', all.map((it) => card(ctx, it))));
    },
  };

  function card(ctx, it) {
    const rs = runsOf(it);
    const r = rate(rs);
    return h('article.ms-card.' + (STATUS[it.Status] || 'muted'), { onclick: () => ctx.set({ id: it.Id }) },
      h('div.ms-card-top', h('h3', it.Name), h('div.grow'), pill(it.Status)),
      h('p.muted', it.Description || ''),
      flow(it, true),
      h('div.ms-meta', h('span', '🗓 ', it.Trigger), h('span', it.LastRun ? 'Last run ' + fmt.ago(it.LastRun) : 'Never run'),
        h('span.ms-rate' + (r != null && r < 80 ? '.bad' : ''), r == null ? '—' : r + '% success')),
      h('div.ms-card-foot', { onclick: (e) => e.stopPropagation() },
        h('label.switch', { title: it.Status === 'Running' ? 'Pause' : 'Activate' }, h('input', { type: 'checkbox', checked: it.Status === 'Running', onchange: () => toggle(it) }), h('span.slider')),
        h('div.grow'), h('button.btn.sm', { onclick: () => runNow(it) }, '▶ Run now'), h('button.btn.sm.ghost', { onclick: () => ctx.set({ id: it.Id }) }, 'Open')));
  }

  function detail(ctx, it) {
    const rows = mappingRows(it);
    const rs = runsOf(it).slice(0, 8);
    const back = () => ctx.set({ id: null });
    return h('div.page.ms',
      h('header.pagehead', h('button.iconbtn', { title: 'Back', onclick: back }, '←'), h('div', h('div.eyebrow', 'Integration'), h('h1', it.Name)), pill(it.Status), h('div.grow'),
        h('label.ms-act', h('label.switch', h('input', { type: 'checkbox', checked: it.Status === 'Running', onchange: () => toggle(it) }), h('span.slider')), ' Active'),
        h('button.btn.primary.sm', { onclick: () => runNow(it) }, '▶ Run now'),
        h('a.btn.sm', { href: '#/r/' + it.Id }, 'Record')),
      h('p.muted.ms-desc', it.Description || '', ' ', h('b', it.Trigger || ''), ' · ', it.Source, ' → ', it.Target),
      UI.card('Flow', flow(it), { icon: '🧭' }),
      h('div.ms-two',
        UI.card('Field mapping', rows.length ? h('div',
          h('table.grid.ms-tbl', h('thead', h('tr', h('th', 'Source field'), h('th', ''), h('th', 'Stratus field'), h('th', 'Note'))),
            h('tbody', rows.map((r) => h('tr', h('td', h('code', r.src)), h('td.ms-ar', '→'), h('td', h('b', r.field), r.ok ? null : h('span.ms-warn', { title: 'Not a field on the target object' }, ' ⚠')), h('td.muted', r.note))))),
          h('pre.ms-dw', dataweave(rows))) : h('p.muted', 'No transform step yet. Generate a mapping below.'), { icon: '🔀' }),
        h('div', UI.card('Recent runs', rs.length ? h('table.grid.ms-tbl', h('tbody', rs.map((r) => h('tr', { onclick: () => Shell.go('#/app/mulesoft/runs?run=' + r.id), style: { cursor: 'pointer' } },
          h('td', h('span.ms-dot.' + (r.status === 'Success' ? 'ok' : 'bad'))), h('td', fmt.ago(r.at)), h('td', r.status === 'Success' ? r.records + ' records' : h('span.bad', r.error || 'Failed')), h('td.muted', r.ms + ' ms'))))) : h('p.muted', 'No runs yet.'), { icon: '🕘' }),
          UI.card('Generate mapping', mapper(it, () => ctx.set({})), { icon: '✨' }))));
  }

  // ---------- API catalog and try-it console ----------

  const RES = { accounts: 'Account', contacts: 'Contact', opportunities: 'Opportunity', cases: 'Case', leads: 'Lead', orders: 'Order', workorders: 'WorkOrder' };
  const POLICIES = (a) => [['Rate limit', a.layer === 'Experience' ? '300 / min' : a.layer === 'Process' ? '600 / min' : '1,200 / min'], ['Client ID enforcement', a.status === 'Design' ? 'off' : 'on'], a.layer !== 'Experience' ? ['IP allowlist', 'on'] : ['CORS', 'on']];

  function callApi(method, url, body, clientId) {
    const t0 = performance.now();
    const respond = (status, data) => ({ status, data, ms: Math.round(performance.now() - t0 + 18 + (hash(url) % 70)) });
    if (!clientId.trim()) return respond(401, { error: 'Unauthorized', message: 'client_id is required by the Client ID Enforcement policy' });
    const [pathPart, query = ''] = url.split('?');
    const seg = pathPart.replace(/^\/+|\/+$/g, '').split('/');
    const obj = RES[seg[0].toLowerCase()];
    if (!obj) return respond(404, { error: 'Not Found', message: `No resource "${seg[0]}". Try ${Object.keys(RES).join(', ')}.` });
    const m = DB.meta(obj);
    if (method === 'GET' && seg[1]) {
      const rec = DB.get(seg[1]);
      return rec && DB.objectOf(rec.Id) === obj ? respond(200, shape(obj, rec)) : respond(404, { error: 'Not Found', message: `${m.label} ${seg[1]} does not exist` });
    }
    if (method === 'GET') {
      const params = Object.fromEntries(query.split('&').filter(Boolean).map((p) => p.split('=').map(decodeURIComponent)));
      const limit = Math.min(50, Number(params.limit) || 10);
      let rows = DB.all(obj);
      for (const [k, v] of Object.entries(params)) {
        if (k === 'limit') continue;
        const f = Object.keys(m.field).find((x) => x.toLowerCase() === k.toLowerCase());
        if (!f) return respond(400, { error: 'Bad Request', message: `Unknown filter "${k}" on ${m.label}` });
        rows = rows.filter((r) => String(r[f] == null ? '' : r[f]).toLowerCase() === v.toLowerCase());
      }
      return respond(200, { total: rows.length, items: rows.slice(0, limit).map((r) => shape(obj, r)) });
    }
    if (method === 'POST' && !seg[1]) {
      if (!body || typeof body !== 'object') return respond(400, { error: 'Bad Request', message: 'Body must be a JSON object' });
      try { const rec = DB.insert(obj, body); DB.save(); return respond(201, shape(obj, rec)); } catch (e) { return respond(422, { error: 'Validation failed', message: e.message }); }
    }
    return respond(405, { error: 'Method Not Allowed', message: `${method} ${pathPart}` });
  }
  const shape = (obj, rec) => { const m = DB.meta(obj); const o = { id: rec.Id }; for (const f of m.list.concat(m.highlights || []).filter((x, i, a) => a.indexOf(x) === i).slice(0, 8)) if (rec[f] != null && rec[f] !== '' && m.field[f] && m.field[f].type !== 'json') o[f] = rec[f]; return o; };

  function specCard(obj) {
    const m = DB.meta(obj);
    return Einstein.card({
      key: 'ms-spec:' + obj, title: `API spec for ${m.label}`, icon: '✨', className: 'ms-ai', intro: `${Einstein.word()} drafts an OpenAPI-style summary from the ${m.label} fields.`, label: 'Generate spec',
      ask: () => ({ task: 'api-spec', prompt: `Draft a concise REST API spec (OpenAPI/RAML style) for the ${m.label} resource of a CRM. Use these fields only:\n${m.fields.filter((f) => !f.hidden).map((f) => `${f.name}: ${f.type}${f.required ? ' (required)' : ''}${f.options ? ' [' + f.options.join('|') + ']' : ''}`).join('\n')}`,
        schema: Einstein.S.obj({ title: Einstein.S.str(), basePath: Einstein.S.str('e.g. /api/cases'), paths: Einstein.S.arr(Einstein.S.obj({ method: Einstein.S.oneOf(['GET', 'POST', 'PATCH', 'DELETE']), path: Einstein.S.str(), summary: Einstein.S.str() })),
          fields: Einstein.S.arr(Einstein.S.obj({ name: Einstein.S.str(), type: Einstein.S.str(), required: Einstein.S.bool() }), 'main fields'), notes: Einstein.S.arr(Einstein.S.str(), 'policies and pagination notes') }) }),
      render: (r) => {
        const txt = [`#%RAML 1.0`, `title: ${r.title}`, `baseUri: ${r.basePath}`, ...(r.paths || []).map((p) => `${p.path}:\n  ${p.method.toLowerCase()}:\n    description: ${p.summary}`), 'types:', `  ${m.label.replace(/\s/g, '')}:`, '    properties:', ...(r.fields || []).map((f) => `      ${f.name}${f.required ? '' : '?'}: ${f.type}`)].join('\n');
        return h('div.ms-spec', h('table.grid.ms-tbl', h('tbody', (r.paths || []).map((p) => h('tr', h('td', h('span.ms-meth.' + p.method, p.method)), h('td', h('code', p.path)), h('td.muted', p.summary))))),
          h('pre.ms-dw', txt), (r.notes || []).length ? h('ul', r.notes.map((n) => h('li', n))) : null, h('button.btn.sm', { onclick: () => UI.copy(txt) }, 'Copy spec'));
      },
    });
  }

  Pages.apis = {
    title: 'APIs', icon: '🧩', live: false,
    render(ctx) {
      const apis = DB.org().apis || [];
      const cur = apis.find((a) => a.id === ctx.params.api) || apis[0];
      let method = 'GET';
      const url = h('input.ms-url', { value: '/accounts?industry=Energy', spellcheck: false });
      const cid = h('input.ms-cid', { value: 'demo-client-7f3a', spellcheck: false });
      const body = h('textarea.ms-body', { rows: 4, value: '{\n  "Subject": "Inverter offline at Harborview",\n  "Priority": "High"\n}' });
      const out = h('div.ms-out', h('p.muted', 'Send a request to see the response. Calls run against the local data only.'));
      const seg = h('div.seg', ['GET', 'POST'].map((x) => h('button' + (x === method ? '.on' : ''), { onclick: (e) => { method = x; $$('button', seg).forEach((b) => b.classList.toggle('on', b === e.currentTarget)); body.style.display = x === 'POST' ? '' : 'none'; } }, x)));
      body.style.display = 'none';
      const send = async () => {
        let b = null;
        if (method === 'POST') { try { b = JSON.parse(body.value); } catch (e) { out.replaceChildren(h('div.ai-err', 'Body is not valid JSON: ' + e.message)); return; } }
        out.replaceChildren(UI.spinner('Calling…'));
        await sleep(160);
        const r = callApi(method, url.value.trim(), b, cid.value);
        out.replaceChildren(h('div.ms-resp', h('span.ms-status.s' + String(r.status)[0], r.status + ' ' + ({ 200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 405: 'Method Not Allowed', 422: 'Unprocessable' }[r.status] || '')), h('span.muted', r.ms + ' ms'), h('div.grow'), h('button.btn.sm.ghost', { onclick: () => UI.copy(JSON.stringify(r.data, null, 2)) }, 'Copy')), h('pre.ms-json', JSON.stringify(r.data, null, 2)));
      };
      const preset = (m, u) => () => { method = m; url.value = u; $$('button', seg).forEach((b) => b.classList.toggle('on', b.textContent === m)); body.style.display = m === 'POST' ? '' : 'none'; };
      const firstOpp = (DB.all('Opportunity')[0] || {}).Id || 'id';
      const specObj = h('select', { onchange: () => specBox.replaceChildren(specCard(specObj.value)) }, Object.values(RES).map((o) => h('option', { value: o }, DB.meta(o).label)));
      const specBox = h('div', specCard(Object.values(RES)[0]));
      return h('div.page.ms',
        head(ctx, '🧩', 'API catalog'),
        h('div.ms-apis', h('div.ms-apilist', apis.map((a) => h('button.ms-api' + (a === cur ? '.on' : ''), { onclick: () => ctx.set({ api: a.id }) },
          h('div.ms-api-top', h('b', a.name), h('span.ms-ver', a.version)), h('div.ms-api-sub', h('span.ms-layer', a.layer), h('span.ms-pill.' + ({ Live: 'ok', Degraded: 'warn', Design: 'muted' }[a.status] || 'muted'), a.status)),
          h('code', a.base)))),
          cur ? h('div.ms-apimain',
            UI.card(cur.name, h('div',
              h('div.ms-endpoints', cur.methods.map((m) => h('div', h('span.ms-meth.' + m, m), h('code', cur.base + (m === 'GET' ? '' : m === 'PATCH' ? '/{id}' : ''))))),
              h('div.kpis.sm', UI.stat('Calls (24h)', fmt.num(cur.calls24h)), UI.stat('p95 latency', cur.p95 ? cur.p95 + ' ms' : '—', '', cur.p95 > 1000 ? 'var(--bad)' : null), UI.stat('Error rate', cur.errors + '%', '', cur.errors > 5 ? 'var(--bad)' : null), UI.stat('Consumers', cur.consumers)),
              h('div.ms-pol', POLICIES(cur).map(([k, v]) => h('span.chip', h('b', k), ' ', v)))), { icon: '🧩' }),
            UI.card('Try it', h('div', h('div.ms-row', seg, url, cid),
              h('div.ms-presets', h('span.muted', 'Examples'), h('button.chip', { onclick: preset('GET', '/accounts?industry=Energy') }, 'GET /accounts?industry=…'), h('button.chip', { onclick: preset('GET', '/opportunities/' + firstOpp) }, 'GET /opportunities/{id}'), h('button.chip', { onclick: preset('POST', '/cases') }, 'POST /cases')),
              body, h('div.ms-row', h('button.btn.primary.sm', { onclick: send }, 'Send'), h('small.muted', 'Header client_id is required; clear it to see a 401.')), out), { icon: '🧪' }),
            UI.card('Spec', h('div', h('div.ms-row', h('span.muted', 'Object'), specObj), specBox), { icon: '📄' })) : UI.empty('🧩', 'No APIs yet')));
    },
  };

  // ---------- Run history ----------

  Pages.runs = {
    title: 'Run history', icon: '📈',
    render(ctx) {
      const ints = DB.all('Integration');
      const name = (id) => (DB.get(id) || {}).Name || id;
      const f = { int: ctx.params.int || '', status: ctx.params.status || '', days: Number(ctx.params.days) || 7 };
      const since = addDays(today(), -f.days + 1);
      const all = DB.org().runs.filter((r) => isoDay(r.at) >= since);
      const rows = all.filter((r) => (!f.int || r.integrationId === f.int) && (!f.status || r.status === f.status));
      const ok = rows.filter((r) => r.status === 'Success');
      const keys = []; for (let k = f.days - 1; k >= 0; k--) keys.push(addDays(today(), -k));
      const chart = { keys: keys.map(fmt.dateShort), series: ['Success', 'Failed'].map((s) => ({ label: s, values: Object.fromEntries(keys.map((d) => [fmt.dateShort(d), rows.filter((r) => isoDay(r.at) === d && r.status === s).length])) })) };
      const sel = DB.org().runs.find((r) => r.id === ctx.params.run);
      const sele = (key, opts) => h('select', { onchange: (e) => ctx.set({ [key]: e.target.value || null, run: null }) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f[key]) }, l)));
      return h('div.page.ms',
        head(ctx, '📈', 'Run history', sele('int', [['', 'All integrations'], ...ints.map((i) => [i.Id, i.Name])]), sele('status', [['', 'Any status'], ['Success', 'Success'], ['Failed', 'Failed']]), sele('days', [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days']])),
        h('div.kpis',
          UI.stat('Runs', rows.length, `last ${f.days} days`),
          UI.stat('Success', rows.length ? Math.round((100 * ok.length) / rows.length) + '%' : '—', `${rows.length - ok.length} failed`, rows.length - ok.length ? 'var(--bad)' : 'var(--ok)'),
          UI.stat('Records moved', fmt.num(sum(rows, (r) => r.records || 0))),
          UI.stat('Avg time', rows.length ? fmt.num(Math.round(sum(rows, (r) => r.ms || 0) / rows.length)) + ' ms' : '—')),
        h('div.ms-two',
          UI.card('Runs per day', recolor(Charts.draw('stacked', chart, { format: fmt.num, width: 860, height: 320 })), { icon: '📊' }),
          sel ? runPanel(ctx, sel, name) : UI.card('Failures by cause', failBreakdown(rows), { icon: '🧯' })),
        UI.card('Runs', rows.length ? h('div.tablewrap', h('table.grid.ms-tbl', h('thead', h('tr', ['When', 'Integration', 'Status', 'Records', 'Time', 'Cause'].map((x) => h('th', x)))),
          h('tbody', rows.slice(0, 80).map((r) => h('tr' + (sel && sel.id === r.id ? '.sel' : ''), { style: { cursor: 'pointer' }, onclick: () => ctx.set({ run: r.id }) },
            h('td', fmt.datetime(r.at)), h('td', name(r.integrationId)), h('td', h('span.ms-dot.' + (r.status === 'Success' ? 'ok' : 'bad')), ' ', r.status), h('td', r.records), h('td', r.ms + ' ms'),
            h('td', r.status === 'Failed' ? h('span.ms-cat', categorize(r.error).icon + ' ' + categorize(r.error).name) : '')))))) : h('p.muted', 'No runs match.'), { icon: '🗒️', count: rows.length }));
    },
  };

  // The chart palette is generic; make failures red and successes green.
  function recolor(node) {
    $$('rect.bar', node).forEach((r) => { const t = (r.querySelector('title') || {}).textContent || ''; r.style.fill = t.includes(' · Failed:') ? 'var(--bad)' : 'var(--ok)'; });
    $$('rect:not(.bar)', node).filter((r) => r.getAttribute('width') === '10').forEach((r, i) => { r.style.fill = i ? 'var(--bad)' : 'var(--ok)'; });
    return node;
  }

  function failBreakdown(rows) {
    const fails = rows.filter((r) => r.status === 'Failed');
    if (!fails.length) return h('p.muted', 'No failed runs in this range. 🎉');
    const by = groupBy(fails, (r) => categorize(r.error).name);
    return h('div.ms-fails', Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => h('div.ms-fail', h('span', categorize(v[0].error).icon), h('div', h('b', k, ' ', h('span.count', v.length)), h('small.muted', categorize(v[0].error).fix)))),
      h('p.muted', 'Click a failed run to see the cause and a suggested fix.'));
  }

  function runPanel(ctx, r, name) {
    const it = DB.get(r.integrationId);
    const c = categorize(r.error);
    return UI.card('Run detail', h('div.ms-run',
      h('div.ms-row', h('b', name(r.integrationId)), h('div.grow'), h('button.iconbtn', { onclick: () => ctx.set({ run: null }) }, '×')),
      h('div.muted', fmt.datetime(r.at), ' · ', r.ms, ' ms · ', r.records, ' records'),
      r.status === 'Failed' ? h('div', h('div.ms-errbox', h('code', r.error || 'Failed')), h('div.ms-cause', h('b', c.icon + ' ' + c.name), h('p', c.fix)),
        Einstein.card({ key: 'ms-run:' + r.id, title: 'Explain and fix', icon: '✨', className: 'ms-ai', intro: 'Get a plain-English cause and fix steps for this failure.', label: 'Explain',
          ask: () => ({ task: 'integration-fix', prompt: `An integration run failed. Explain the likely cause and the steps to fix it.\nIntegration: ${name(r.integrationId)}\nSource: ${it && it.Source} → Target: ${it && it.Target}\nTrigger: ${it && it.Trigger}\nError: ${r.error}\nRule-based category: ${c.name}\nRecent runs: ${runsOf(it || {}).slice(0, 6).map((x) => x.status).join(', ')}`,
            schema: Einstein.S.obj({ cause: Einstein.S.str(), steps: Einstein.S.arr(Einstein.S.str(), 'ordered fix steps'), safeToRetry: Einstein.S.bool(), owner: Einstein.S.str('who should act') }) }),
          render: (x) => h('div', md(x.cause), h('ol', (x.steps || []).map((s) => h('li', s))), h('p', x.safeToRetry ? '🔁 Safe to retry once fixed.' : '⛔ Do not retry until fixed.'), h('small.muted', 'Owner: ' + x.owner)) }),
        it ? h('div.ms-row', h('button.btn.sm', { onclick: () => Shell.go('#/app/mulesoft/integrations?id=' + it.Id) }, 'Open integration'), h('button.btn.sm', { onclick: () => runNow(it) }, '▶ Run again')) : null)
        : h('p', '✅ This run completed without errors.')), { icon: '🔍' });
  }
})();
