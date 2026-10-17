// fieldservice.js — Field Service: the dispatcher console (Gantt, drag to schedule, auto-schedule and a ✨
// optimizer that proposes), the route map, and the Work Order extras (technician briefing, Complete job).
//
// Work orders carry ResourceId, ScheduledStart (ISO) and DurationHours; the end is start + duration.
// Nothing here changes data until the dispatcher clicks Apply, except dragging a bar, which is undoable.

(() => {
  const CLOSED = ['Completed', 'Cannot Complete', 'Canceled'];
  const PRIO = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  const TYPE_ICON = { Installation: '🛠️', Repair: '🔧', Maintenance: '🧰', Inspection: '🔍', Upgrade: '⬆️' };
  const STATUS_CLS = { New: 'new', Scheduled: 'sched', Dispatched: 'disp', 'In Progress': 'prog', Completed: 'done', 'Cannot Complete': 'fail', Canceled: 'fail' };
  const H0 = 6, H1 = 20, WORK0 = 8, WORK1 = 17, CAP = 8;
  const hash = (s) => [...String(s)].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
  const st = { plan: null, undo: null, route: null };

  const techs = () => DB.all('ServiceResource').filter((t) => t.IsActive !== false);
  const open = (w) => !CLOSED.includes(w.Status);
  const skillsOf = (t) => [].concat(t.Skills || []);
  const num = (w) => DB.name(w.Id) || w.WorkOrderNumber;
  const label = (w) => `${num(w)} · ${w.Subject}`;
  const startOf = (w) => new Date(w.ScheduledStart);
  const endOf = (w) => new Date(startOf(w).getTime() + (Number(w.DurationHours) || 2) * 3600000);
  const hourOf = (d) => d.getHours() + d.getMinutes() / 60;
  const at = (day, hour) => { const d = new Date(day + 'T00:00:00'); d.setMinutes(Math.round(hour * 60)); return d; };
  const hh = (hr) => { const h0 = Math.floor(hr), m = Math.round((hr - h0) * 60); return `${((h0 + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h0 >= 12 ? 'PM' : 'AM'}`; };
  const monday = (day) => { const d = new Date(day + 'T12:00:00'); return addDays(day, -((d.getDay() + 6) % 7)); };
  const dayName = (day) => new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const head = (ctx, icon, title, ...btns) => h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, icon),
    h('div', h('div.eyebrow', ctx.app.name), h('h1', title)), h('div.grow'), ...btns);

  // Coordinates: the record's own Lat/Lng, else a stable synthetic spot near the Bay Area.
  function coords(w) {
    if (w.Lat != null && w.Lng != null && w.Lat !== '') return [Number(w.Lat), Number(w.Lng)];
    const base = (typeof CITIES !== 'undefined' && CITIES[w.City]) || [37.55, -122.0];
    const R = rng(hash(w.Id));
    return [base[0] + (R() - 0.5) * 0.12, base[1] + (R() - 0.5) * 0.12];
  }
  const home = (t) => (t.HomeLat != null ? [Number(t.HomeLat), Number(t.HomeLng)] : [37.55, -122.0]);
  function km(a, b) {
    const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(x)) * 1.3; // road factor
  }
  const driveMin = (k) => Math.round((k / 45) * 60);
  const fk = (k) => (k < 10 ? k.toFixed(1) : Math.round(k)) + ' km';

  // Work orders for one technician on one day, in time order.
  const jobs = (t, day) => DB.all('WorkOrder').filter((w) => w.ResourceId === t.Id && w.ScheduledStart && isoDay(w.ScheduledStart) === day && w.Status !== 'Canceled').sort((a, b) => a.ScheduledStart.localeCompare(b.ScheduledStart));
  const unscheduled = () => DB.all('WorkOrder').filter((w) => open(w) && (w.Status === 'New' || !w.ResourceId || !w.ScheduledStart)).sort((a, b) => (PRIO[b.Priority] || 0) - (PRIO[a.Priority] || 0));

  // Conflicts (overlaps), overtime and skill gaps for a technician-day.
  function checks(t, day, list = jobs(t, day)) {
    const conflict = new Set();
    let hours = 0, late = false;
    list.forEach((w, i) => {
      hours += Number(w.DurationHours) || 2;
      if (hourOf(endOf(w)) > WORK1 || hourOf(startOf(w)) < WORK0) late = true;
      for (let j = i + 1; j < list.length; j++) if (startOf(list[j]) < endOf(w)) { conflict.add(w.Id); conflict.add(list[j].Id); }
    });
    return { conflict, hours, over: hours > CAP || late, late };
  }
  const lacks = (t, w) => w.Skill && !skillsOf(t).includes(w.Skill);

  // ---------- applying changes (with undo) ----------

  function applyChanges(changes, why) {
    const prev = changes.map((c) => { const w = DB.get(c.id); return { id: c.id, patch: { ResourceId: w.ResourceId || null, ScheduledStart: w.ScheduledStart || null, Status: w.Status } }; });
    for (const c of changes) DB.update(c.id, c.patch);
    DB.save();
    st.undo = { why, prev };
    Shell.render();
  }
  function undo() {
    if (!st.undo) return;
    for (const p of st.undo.prev) DB.update(p.id, p.patch);
    DB.save();
    UI.toast('Undone: ' + st.undo.why, 'ok');
    st.undo = null;
    Shell.render();
  }
  const schedStatus = (w) => (['New', 'Scheduled'].includes(w.Status) ? 'Scheduled' : w.Status);

  function schedule(w, t, day, hour) {
    const start = at(day, Math.max(H0, Math.min(H1 - 0.5, hour)));
    applyChanges([{ id: w.Id, patch: { ResourceId: t.Id, ScheduledStart: start.toISOString(), Status: schedStatus(w) } }], `${num(w)} moved to ${t.Name}, ${hh(hourOf(start))}`);
    const c = checks(t, day);
    const warn = [];
    if (lacks(t, w)) warn.push(`${t.Name} does not list the ${w.Skill} skill`);
    if (c.conflict.has(w.Id)) warn.push('it overlaps another job');
    if (c.over) warn.push(`${t.Name} is over 8 working hours or past 5 PM`);
    if (warn.length) UI.toast('Scheduled, but ' + warn.join('; '), 'err', { label: 'Undo', run: undo });
    else UI.toast(`${num(w)} scheduled for ${t.Name} at ${hh(hourOf(start))}`, 'ok', { label: 'Undo', run: undo });
  }

  // ---------- rule-based auto-schedule: skill, territory, capacity ----------

  function freeSlot(list, dur) {
    for (let s = WORK0; s + dur <= WORK1 + 1e-6; s += 0.5) if (list.every((j) => s + dur <= j.s + 1e-6 || s >= j.e - 1e-6)) return s;
    return null;
  }
  function autoPlan(days, wos) {
    const T = techs();
    const sim = new Map(); // "tech|day" → [{s,e,pos}]
    const slotsOf = (t, day) => {
      const k = t.Id + '|' + day;
      if (!sim.has(k)) sim.set(k, jobs(t, day).map((w) => ({ s: hourOf(startOf(w)), e: hourOf(endOf(w)), pos: coords(w) })));
      return sim.get(k);
    };
    const terr = (w) => { const p = coords(w); return T.slice().sort((a, b) => km(home(a), p) - km(home(b), p))[0]; };
    const items = [], skipped = [];
    const order = wos.slice().sort((a, b) => (PRIO[b.Priority] || 0) - (PRIO[a.Priority] || 0) || (b.DurationHours || 2) - (a.DurationHours || 2));
    for (const w of order) {
      const dur = Number(w.DurationHours) || 2, p = coords(w), near = terr(w);
      let best = null;
      days.forEach((day, di) => {
        for (const t of T) {
          if (lacks(t, w)) continue;
          const list = slotsOf(t, day);
          if (sum(list, (j) => j.e - j.s) + dur > CAP) continue;
          const s = freeSlot(list, dur);
          if (s == null) continue;
          const prev = list.filter((j) => j.e <= s + 1e-6).sort((a, b) => b.e - a.e)[0];
          const dist = km(prev ? prev.pos : home(t), p);
          const score = di * 100 + dist + sum(list, (j) => j.e - j.s) * 2 + (t.Id === near.Id ? 0 : 40) - (PRIO[w.Priority] || 0) * di * 20;
          if (!best || score < best.score) best = { t, day, s, dist, score, anchor: prev ? 'previous job' : 'home' };
        }
      });
      if (!best) { skipped.push({ w, why: w.Skill && !T.some((t) => !lacks(t, w)) ? `No technician has the ${w.Skill} skill` : 'No free capacity in this range' }); continue; }
      slotsOf(best.t, best.day).push({ s: best.s, e: best.s + dur, pos: p });
      items.push({ w, t: best.t, start: at(best.day, best.s).toISOString(), reason: `${w.Skill ? w.Skill + ' skill matched' : 'Available'} · ${fk(best.dist)} from ${best.anchor} · ${hh(best.s)}–${hh(best.s + dur)}${best.t.Id === near.Id ? ' · home territory' : ''}` });
    }
    items.sort((a, b) => a.start.localeCompare(b.start));
    return { title: 'Auto-schedule', source: 'rules', items, skipped };
  }

  // ✨ the AI proposes assignments; each one is checked here before it is shown.
  async function aiPlan(days, wos) {
    const T = techs();
    const idx = wos.map((w, i) => ({ i: i + 1, w }));
    const sched = T.map((t) => `${t.Name} (${skillsOf(t).join('/')}; ${t.Territory}; home ${home(t).map((x) => x.toFixed(2)).join(',')}): ` + days.map((d) => `${d}: ${jobs(t, d).map((w) => `${hh(hourOf(startOf(w)))}-${hh(hourOf(endOf(w)))}`).join(', ') || 'free'}`).join(' | ')).join('\n');
    const list = idx.map(({ i, w }) => `#${i} ${w.Subject} | needs ${w.Skill || 'any'} | ${w.DurationHours || 2}h | ${w.Priority} | ${w.City} (${coords(w).map((x) => x.toFixed(2)).join(',')})`).join('\n');
    const r = await Einstein.ask({ task: 'dispatch-optimize',
      system: 'You are a field-service dispatcher. Work days run 8:00 to 17:00. A technician must have the required skill. Do not overlap jobs for one technician. Max 8 job hours per technician per day. Prefer finishing Critical and High priority work earliest and keeping each technician’s stops close together.',
      prompt: `Days available: ${days.join(', ')}\n\nTechnicians and what they already have:\n${sched}\n\nWork orders to schedule:\n${list}\n\nAssign as many as fit. Give a one-line reason for each.`,
      schema: Einstein.S.obj({ assignments: Einstein.S.arr(Einstein.S.obj({ order: Einstein.S.num('the # of the work order'), technician: Einstein.S.str('exact technician name'), day: Einstein.S.str('YYYY-MM-DD'), startHour: Einstein.S.num('start hour 8 to 16.5 in half hours'), reason: Einstein.S.str() })), summary: Einstein.S.str('one sentence') }) });
    const sim = new Map();
    const items = [], skipped = [];
    const used = new Set();
    for (const a of r.assignments || []) {
      const o = idx.find((x) => x.i === Number(a.order));
      const t = T.find((x) => x.Name.toLowerCase() === String(a.technician).toLowerCase());
      if (!o || used.has(o.i)) continue;
      const w = o.w, dur = Number(w.DurationHours) || 2, s = Number(a.startHour);
      const why = !t ? 'unknown technician' : !days.includes(a.day) ? 'a day outside the range' : lacks(t, w) ? `${t.Name} lacks the ${w.Skill} skill` : !(s >= WORK0 && s + dur <= WORK1 + 1e-6) ? 'outside working hours' : null;
      if (why) { skipped.push({ w, why: 'AI proposed ' + why }); used.add(o.i); continue; }
      const k = t.Id + '|' + a.day;
      if (!sim.has(k)) sim.set(k, jobs(t, a.day).map((j) => ({ s: hourOf(startOf(j)), e: hourOf(endOf(j)) })));
      const list = sim.get(k);
      if (list.some((j) => s < j.e - 1e-6 && s + dur > j.s + 1e-6) || sum(list, (j) => j.e - j.s) + dur > CAP) { skipped.push({ w, why: 'AI proposed a slot that overlaps or exceeds 8 hours' }); used.add(o.i); continue; }
      list.push({ s, e: s + dur });
      used.add(o.i);
      items.push({ w, t, start: at(a.day, s).toISOString(), reason: a.reason });
    }
    for (const { i, w } of idx) if (!used.has(i)) skipped.push({ w, why: 'Not assigned by the AI' });
    items.sort((a, b) => a.start.localeCompare(b.start));
    return { title: 'AI-optimized schedule', source: 'ai', items, skipped, summary: r.summary, meta: r.meta };
  }

  // ---------- Dispatcher console ----------

  Pages.dispatch = {
    title: 'Dispatcher', icon: '🗓️',
    render(ctx) {
      const v = ctx.params.v === 'week' ? 'week' : 'day';
      const d = ctx.params.d || today();
      const days = v === 'day' ? [d] : [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday(d), i));
      const T = techs();
      const unsched = unscheduled();
      const rangeDays = v === 'day' ? [d] : days.slice(0, 5);
      const step = v === 'day' ? 1 : 7;
      const nav = h('div.fs-nav',
        h('button.iconbtn', { title: 'Previous', onclick: () => ctx.set({ d: addDays(d, -step) }) }, '‹'),
        h('button.btn.sm', { onclick: () => ctx.set({ d: today() }) }, 'Today'),
        h('button.iconbtn', { title: 'Next', onclick: () => ctx.set({ d: addDays(d, step) }) }, '›'),
        h('b.fs-range', v === 'day' ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : `${dayName(days[0])} – ${dayName(days[6])}`),
        h('div.seg', ['day', 'week'].map((x) => h('button' + (x === v ? '.on' : ''), { onclick: () => ctx.set({ v: x }) }, x === 'day' ? 'Day' : 'Week'))));
      const autoBtn = h('button.btn.sm', { disabled: !unsched.length, title: 'Match skill, territory and capacity. You review before anything changes.', onclick: () => { st.plan = autoPlan(rangeDays, unsched); Shell.render(); } }, '⚡ Auto-schedule');
      const aiBtn = Einstein.button('Optimize with AI', () => { if (!unsched.length) throw new Error('Nothing is waiting to be scheduled.'); return {}; }, () => {}, 'sm');
      const ai = h('button.btn.ai.sm', { disabled: !unsched.length, onclick: async (e) => {
        if (!Einstein.ready()) { UI.toast(Einstein.state().problem, 'err'); return; }
        const b = e.currentTarget; b.disabled = true; b.replaceChildren(h('span.spinner.sm'), ` ${Einstein.word()}…`);
        try { st.plan = await aiPlan(rangeDays, unsched.slice(0, 20)); Shell.render(); } catch (err) { UI.toast(err.message, 'err'); b.disabled = false; b.replaceChildren('✨ Optimize with AI'); }
      } }, '✨ Optimize with AI');
      void aiBtn;
      const board = v === 'day' ? dayBoard(T, d) : weekBoard(T, days);
      return h('div.page.fs',
        head(ctx, '🗓️', 'Dispatcher console', st.undo ? h('button.btn.sm', { onclick: undo }, '↶ Undo ' + st.undo.why.slice(0, 34)) : null, autoBtn, ai),
        nav,
        st.plan ? planPanel() : null,
        h('div.fs-wrap', board, unschedPanel(unsched)));
    },
  };

  function unschedPanel(list) {
    return h('aside.fs-uns', h('div.fs-uns-h', h('b', 'Unscheduled'), h('span.count', list.length)),
      h('p.muted.fs-hint', 'Drag a job onto a technician and time.'),
      h('div.fs-uns-list', list.length ? list.map((w) => woChip(w)) : h('p.muted', 'Everything is scheduled. 🎉')));
  }
  function woChip(w) {
    return h('div.fs-job.p' + (PRIO[w.Priority] || 2), { draggable: true, ondragstart: (e) => { e.dataTransfer.setData('text/plain', w.Id); e.dataTransfer.effectAllowed = 'move'; } },
      h('div.fs-job-t', h('span', TYPE_ICON[w.WorkType] || '🔧'), h('b', num(w)), h('span.fs-prio.p' + (PRIO[w.Priority] || 2), w.Priority)),
      h('div.fs-job-s', w.Subject), h('div.fs-job-m', [w.Skill, (w.DurationHours || 2) + 'h', w.City].filter(Boolean).join(' · ')),
      h('a.fs-job-l', { href: '#/r/' + w.Id, draggable: false }, 'Open'));
  }

  function techLabel(t, day, c) {
    return h('div.fs-tech', UI.avatar(t.Name, 30),
      h('div', h('b', t.Name), h('small', skillsOf(t).join(' · ')), h('small', t.Territory + ' · ' + (t.Vehicle || ''))),
      day ? h('span.fs-load' + (c.over ? '.over' : ''), { title: c.over ? 'Over 8 working hours or past 5 PM' : 'Booked hours' }, c.hours + 'h' + (c.over ? ' ⚠' : '')) : null);
  }

  function dayBoard(T, day) {
    const span = H1 - H0;
    const hours = []; for (let x = H0; x < H1; x++) hours.push(x);
    const dropAt = (e, lane, t) => {
      e.preventDefault(); lane.classList.remove('over');
      const w = DB.get(e.dataTransfer.getData('text/plain'));
      if (!w || DB.objectOf(w.Id) !== 'WorkOrder') return;
      const r = lane.getBoundingClientRect();
      const hour = Math.round((H0 + ((e.clientX - r.left) / r.width) * span) * 2) / 2;
      schedule(w, t, day, hour);
    };
    return h('div.fs-gantt', { dataset: { scroll: 'fs-gantt' } },
      h('div.fs-g-head', h('div.fs-g-corner', 'Technician'), h('div.fs-g-hours', { style: { '--n': span } }, hours.map((x) => h('span', hh(x).replace(':00', ''))))),
      T.map((t) => {
        const list = jobs(t, day), c = checks(t, day, list);
        const lane = h('div.fs-lane', { style: { '--n': span } });
        lane.addEventListener('dragover', (e) => { e.preventDefault(); lane.classList.add('over'); });
        lane.addEventListener('dragleave', () => lane.classList.remove('over'));
        lane.addEventListener('drop', (e) => dropAt(e, lane, t));
        for (const w of list) {
          const s = hourOf(startOf(w)), e2 = hourOf(endOf(w));
          lane.append(h('div.fs-bar.' + (STATUS_CLS[w.Status] || 'new') + (c.conflict.has(w.Id) ? '.conflict' : '') + (lacks(t, w) ? '.noskill' : ''), {
            draggable: open(w), title: `${label(w)}\n${hh(s)}–${hh(e2)} · ${w.Status} · ${w.Priority}${lacks(t, w) ? '\nTechnician lacks ' + w.Skill : ''}${c.conflict.has(w.Id) ? '\nOverlaps another job' : ''}`,
            style: { left: ((Math.max(s, H0) - H0) / span) * 100 + '%', width: ((Math.min(e2, H1) - Math.max(s, H0)) / span) * 100 + '%' },
            ondragstart: (ev) => { ev.dataTransfer.setData('text/plain', w.Id); ev.dataTransfer.effectAllowed = 'move'; },
            onclick: () => Shell.go('#/r/' + w.Id),
          }, h('span.fs-bar-t', (TYPE_ICON[w.WorkType] || '') + ' ' + num(w), lacks(t, w) || c.conflict.has(w.Id) ? ' ⚠' : ''), h('span.fs-bar-s', w.Subject.replace(/ – .*/, ''))));
        }
        if (day === today()) { const nowH = hourOf(new Date()); if (nowH >= H0 && nowH <= H1) lane.append(h('div.fs-now', { style: { left: ((nowH - H0) / span) * 100 + '%' } })); }
        return h('div.fs-g-row', techLabel(t, true, c), lane);
      }));
  }

  function weekBoard(T, days) {
    return h('div.fs-week', { dataset: { scroll: 'fs-week' } },
      h('div.fs-wk-row.head', h('div.fs-g-corner', 'Technician'), days.map((x) => h('div.fs-wk-day' + (x === today() ? '.today' : ''), dayName(x)))),
      T.map((t) => h('div.fs-wk-row', techLabel(t), days.map((x) => {
        const list = jobs(t, x), c = checks(t, x, list);
        const cell = h('div.fs-wk-cell' + (c.over ? '.over' : '') + (new Date(x + 'T12:00:00').getDay() % 6 === 0 ? '.off' : ''),
          list.map((w) => h('a.fs-chip.' + (STATUS_CLS[w.Status] || 'new') + (c.conflict.has(w.Id) ? '.conflict' : ''), { href: '#/r/' + w.Id, draggable: open(w), title: label(w),
            ondragstart: (ev) => { ev.dataTransfer.setData('text/plain', w.Id); } }, h('b', hh(hourOf(startOf(w))).replace(':00', '')), ' ', w.Subject.replace(/ – .*/, ''))),
          c.hours ? h('small.fs-cell-h' + (c.over ? '.over' : ''), c.hours + 'h') : null);
        cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop'); });
        cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
        cell.addEventListener('drop', (e) => {
          e.preventDefault(); cell.classList.remove('drop');
          const w = DB.get(e.dataTransfer.getData('text/plain'));
          if (!w || DB.objectOf(w.Id) !== 'WorkOrder') return;
          const dur = Number(w.DurationHours) || 2;
          const s = freeSlot(jobs(t, x).filter((j) => j.Id !== w.Id).map((j) => ({ s: hourOf(startOf(j)), e: hourOf(endOf(j)) })), dur);
          schedule(w, t, x, s == null ? WORK0 : s);
        });
        return cell;
      }))));
  }

  function planPanel() {
    const p = st.plan;
    const when = (iso) => `${dayName(isoDay(iso))}, ${hh(hourOf(new Date(iso)))}`;
    return h('section.fs-plan' + (p.source === 'ai' ? '.ai' : ''),
      h('div.fs-plan-h', h('b', (p.source === 'ai' ? '✨ ' : '⚡ ') + p.title), h('span.muted', `${p.items.length} proposed · ${p.skipped.length} left out`), h('div.grow'),
        h('button.btn.sm.ghost', { onclick: () => { st.plan = null; Shell.render(); } }, 'Discard'),
        h('button.btn.primary.sm', { disabled: !p.items.length, onclick: () => {
          const items = p.items; st.plan = null;
          applyChanges(items.map((i) => ({ id: i.w.Id, patch: { ResourceId: i.t.Id, ScheduledStart: i.start, Status: schedStatus(i.w) } })), `${items.length} jobs scheduled`);
          UI.toast(`${items.length} work orders scheduled`, 'ok', { label: 'Undo', run: undo });
        } }, `Apply ${p.items.length}`)),
      p.summary ? h('p.fs-plan-s', p.summary) : null,
      p.items.length ? h('table.grid.fs-tbl', h('thead', h('tr', ['Work order', 'Technician', 'When', 'Why'].map((x) => h('th', x)))),
        h('tbody', p.items.map((i) => h('tr', h('td', h('b', num(i.w)), ' ', i.w.Subject.replace(/ – .*/, '')), h('td', i.t.Name), h('td', when(i.start)), h('td.muted', i.reason))))) : h('p.muted', 'Nothing could be placed.'),
      p.skipped.length ? h('details.fs-skip', h('summary', `${p.skipped.length} left out`), h('ul', p.skipped.map((s) => h('li', h('b', num(s.w)), ' ', s.why)))) : null,
      p.meta ? h('div.fs-foot', Einstein.footnote(p.meta)) : null);
  }

  // ---------- Map and routes ----------

  const W = 960, Hh = 560, PAD = 46;

  function routeStops(t, day) { return jobs(t, day).filter((w) => w.Status !== 'Canceled'); }
  function routeLen(t, stops) {
    let prev = home(t), total = 0;
    for (const w of stops) { total += km(prev, coords(w)); prev = coords(w); }
    return total + km(prev, home(t));
  }
  function nearestOrder(t, stops) {
    const left = stops.slice(), out = []; let prev = home(t);
    while (left.length) {
      left.sort((a, b) => km(prev, coords(a)) - km(prev, coords(b)));
      const n = left.shift(); out.push(n); prev = coords(n);
    }
    return out;
  }
  // New start times for a stop order: first job keeps its start, the rest follow with drive time.
  function retime(t, order, day) {
    let clock = Math.min(...order.map((w) => hourOf(startOf(w))));
    let prev = home(t);
    return order.map((w, i) => {
      if (i) clock += driveMin(km(prev, coords(w))) / 60;
      clock = Math.ceil(clock * 4 - 1e-6) / 4;
      const s = clock; clock += Number(w.DurationHours) || 2; prev = coords(w);
      return { id: w.Id, patch: { ScheduledStart: at(day, s).toISOString() } };
    });
  }

  Pages['fs-map'] = {
    title: 'Map', icon: '🗺️',
    render(ctx) {
      const d = ctx.params.d || today();
      const T = techs();
      const sel = T.find((t) => t.Id === ctx.params.tech);
      const wos = DB.all('WorkOrder').filter((w) => open(w) || (w.ScheduledStart && isoDay(w.ScheduledStart) === d));
      const pts = wos.map(coords).concat(T.map(home));
      const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
      const minLa = Math.min(...lats) - 0.04, maxLa = Math.max(...lats) + 0.04, minLn = Math.min(...lngs) - 0.06, maxLn = Math.max(...lngs) + 0.06;
      const k = Math.min((W - 2 * PAD) / (maxLn - minLn), (Hh - 2 * PAD) / (maxLa - minLa));
      const ox = (W - (maxLn - minLn) * k) / 2, oy = (Hh - (maxLa - minLa) * k) / 2;
      const P = (p) => [ox + (p[1] - minLn) * k, Hh - oy - (p[0] - minLa) * k];
      const tcolor = (t) => Charts.color(T.indexOf(t));

      const layers = [];
      // grid, a soft "water" shape and city names: just enough to read as a map, with no tiles
      for (let i = 1; i < 8; i++) layers.push(svg('line', { x1: (W / 8) * i, y1: 0, x2: (W / 8) * i, y2: Hh, class: 'fs-gridl' }));
      for (let i = 1; i < 6; i++) layers.push(svg('line', { x1: 0, y1: (Hh / 6) * i, x2: W, y2: (Hh / 6) * i, class: 'fs-gridl' }));
      layers.push(svg('path', { d: `M0 0 L${W * 0.3} 0 C${W * 0.22} ${Hh * 0.2} ${W * 0.3} ${Hh * 0.36} ${W * 0.2} ${Hh * 0.55} C${W * 0.12} ${Hh * 0.7} ${W * 0.17} ${Hh * 0.9} ${W * 0.08} ${Hh} L0 ${Hh} Z`, class: 'fs-water' }));
      const cities = [];
      if (typeof CITIES !== 'undefined') for (const [nm, c] of Object.entries(CITIES)) {
        if (c[0] < minLa || c[0] > maxLa || c[1] < minLn || c[1] > maxLn) continue;
        const [x, y] = P(c);
        cities.push({ nm, x, y });
        layers.push(svg('circle', { cx: x, cy: y, r: 2.5, class: 'fs-city' }));
      }
      // routes
      const selStops = sel ? routeStops(sel, d) : [];
      const drawRoute = (t, stops, dim) => {
        const path = [home(t)].concat(stops.map(coords), [home(t)]).map(P);
        layers.push(svg('polyline', { points: path.map((p) => p.join(',')).join(' '), class: 'fs-route' + (dim ? ' dim' : ''), stroke: tcolor(t) }));
      };
      for (const t of T) { const st2 = routeStops(t, d); if (!sel || t === sel) drawRoute(t, st2, false); }
      for (const w of wos) {
        const t = T.find((x) => x.Id === w.ResourceId);
        const onDay = w.ScheduledStart && isoDay(w.ScheduledStart) === d;
        if (sel && (!t || t !== sel || !onDay)) { const [x, y] = P(coords(w)); layers.push(svg('circle', { cx: x, cy: y, r: 4, class: 'fs-pin-dim' })); continue; }
        const [x, y] = P(coords(w));
        const n = onDay && t ? routeStops(t, d).indexOf(w) + 1 : 0;
        layers.push(svg('g', { class: 'fs-pin' + (t && onDay ? '' : ' un'), style: 'cursor:pointer', onclick: () => Shell.go('#/r/' + w.Id) },
          svg('circle', { cx: x, cy: y, r: 11, fill: t && onDay ? tcolor(t) : 'var(--card)', stroke: t && onDay ? 'var(--card)' : 'var(--muted)', 'stroke-width': 2 }),
          svg('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'fs-pin-n' }, t && onDay ? String(n || '•') : '?'),
          svg('title', null, `${label(w)}\n${w.City || ''} · ${w.Priority} · ${w.Status}${w.ScheduledStart ? '\n' + fmt.datetime(w.ScheduledStart) : ''}`)));
      }
      for (const t of T) { const [x, y] = P(home(t)); layers.push(svg('g', { class: 'fs-home' }, svg('rect', { x: x - 8, y: y - 8, width: 16, height: 16, rx: 4, fill: tcolor(t) }), svg('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'fs-home-i' }, '⌂'), svg('title', null, `${t.Name} — home base`))); }
      // City names go on top, at the first spot around the dot that misses pins, home bases and other names.
      const blocks = wos.map((w) => { const [x, y] = P(coords(w)); return { x: x - 12, y: y - 12, w: 24, h: 24 }; })
        .concat(T.map((t) => { const [x, y] = P(home(t)); return { x: x - 9, y: y - 9, w: 18, h: 18 }; }));
      const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (const c of cities) {
        const tw = c.nm.length * 6.2 + 4, th = 14;
        const spots = [[6, -7], [-6 - tw, -7], [-tw / 2, -22], [-tw / 2, 8], [14, -7], [-14 - tw, -7], [-tw / 2, -34], [-tw / 2, 20]];
        let best = null;
        for (const [dx, dy] of spots) {
          const r = { x: c.x + dx, y: c.y + dy, w: tw, h: th };
          if (r.x < 2 || r.x + r.w > W - 2 || r.y < 2 || r.y + r.h > Hh - 2) continue;
          if (!blocks.some((b) => hits(r, b))) { best = r; break; }
          if (!best) best = r;
        }
        if (!best) continue;
        blocks.push(best);
        layers.push(svg('text', { x: best.x + 2, y: best.y + 11, class: 'fs-cityl' }, c.nm));
      }
      const map = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'fs-map', preserveAspectRatio: 'xMidYMid meet' }, layers);

      const side = sel ? routePanel(ctx, sel, d, selStops) : h('div.fs-routes', h('p.muted', 'Pick a technician to draw their route for the day.'),
        T.map((t) => { const s = routeStops(t, d); return h('button.fs-tcard', { onclick: () => ctx.set({ tech: t.Id }) }, h('span.fs-sw', { style: { background: tcolor(t) } }), h('div', h('b', t.Name), h('small', `${s.length} stop${s.length === 1 ? '' : 's'} · ${s.length ? fk(routeLen(t, s)) : 'no route'}`))); }));
      return h('div.page.fs',
        head(ctx, '🗺️', 'Field map',
          h('button.iconbtn', { onclick: () => ctx.set({ d: addDays(d, -1) }) }, '‹'), h('b.fs-range', dayName(d)), h('button.iconbtn', { onclick: () => ctx.set({ d: addDays(d, 1) }) }, '›'),
          h('select', { onchange: (e) => ctx.set({ tech: e.target.value || null }) }, h('option', { value: '' }, 'All technicians'), T.map((t) => h('option', { value: t.Id, selected: sel === t }, t.Name)))),
        h('div.fs-mapwrap', h('div.fs-mapbox', map, h('div.fs-legend', h('span', '⌂ Home base'), h('span', '● Scheduled stop'), h('span', '○ Unscheduled (?)'))), side));
    },
  };

  function routePanel(ctx, t, day, stops) {
    const key = t.Id + '|' + day;
    const prop = st.route && st.route.key === key ? st.route : null;
    let prev = home(t), total = 0;
    const legs = stops.map((w) => { const dist = km(prev, coords(w)); total += dist; prev = coords(w); return { w, dist }; });
    const back = km(prev, home(t)); total += back;
    const driveTotal = driveMin(total);
    const reasonOf = (w) => (prop && prop.reasons && prop.reasons[w.Id]) || '';
    const propose = (order, source, reasons, summary, meta) => { st.route = { key, order, source, reasons: reasons || {}, summary, meta }; Shell.render(); };

    const proposal = prop ? (() => {
      const before = routeLen(t, stops), after = routeLen(t, prop.order);
      const same = prop.order.every((w, i) => w === stops[i]);
      return h('div.fs-plan' + (prop.source === 'ai' ? '.ai' : ''),
        h('div.fs-plan-h', h('b', (prop.source === 'ai' ? '✨ ' : '⚡ ') + 'Proposed order'), h('div.grow'), h('button.btn.sm.ghost', { onclick: () => { st.route = null; Shell.render(); } }, 'Discard'),
          h('button.btn.primary.sm', { disabled: same, onclick: () => { const ch = retime(t, prop.order, day); st.route = null; applyChanges(ch.map((c) => ({ id: c.id, patch: c.patch })), `${t.Name}'s route re-ordered`); UI.toast('Route applied', 'ok', { label: 'Undo', run: undo }); } }, same ? 'Already best' : 'Apply')),
        prop.summary ? h('p.fs-plan-s', prop.summary) : null,
        h('p', h('b', fk(before)), ' → ', h('b', fk(after)), after < before - 0.05 ? h('span.fs-save', ` saves ${fk(before - after)} (${driveMin(before - after)} min)`) : h('span.muted', ' no shorter')),
        h('ol.fs-order', prop.order.map((w) => h('li', h('b', num(w)), ' ', w.Subject.replace(/ – .*/, ''), reasonOf(w) ? h('small.muted', reasonOf(w)) : null))),
        prop.meta ? h('div.fs-foot', Einstein.footnote(prop.meta)) : null);
    })() : null;

    return h('div.fs-routes',
      h('div.fs-route-h', h('span.fs-sw', { style: { background: Charts.color(techs().indexOf(t)) } }), h('div', h('b', t.Name), h('small', `${t.Vehicle || ''} · ${t.Territory}`)), h('div.grow'), h('button.iconbtn', { title: 'All technicians', onclick: () => ctx.set({ tech: null }) }, '×')),
      stops.length ? h('div',
        h('div.kpis.sm', UI.stat('Stops', stops.length), UI.stat('Distance', fk(total)), UI.stat('Driving', driveTotal + ' min')),
        h('ol.fs-legs', h('li.home', h('span', '⌂'), h('div', h('b', 'Leave home'), h('small', t.Name))),
          legs.map(({ w, dist }, i) => h('li', h('span', String(i + 1)), h('div', h('b', hh(hourOf(startOf(w))) + ' · ' + num(w)), h('small', w.Subject.replace(/ – .*/, '') + ' · ' + (w.City || '')), h('small.fs-leg', `${fk(dist)} · ${driveMin(dist)} min drive`)))),
          h('li.home', h('span', '⌂'), h('div', h('b', 'Back home'), h('small.fs-leg', `${fk(back)} · ${driveMin(back)} min`)))),
        h('div.fs-route-btns',
          h('button.btn.sm', { disabled: stops.length < 2, onclick: () => propose(nearestOrder(t, stops), 'rules', {}, 'Nearest-neighbor: always drive to the closest remaining job.') }, '⚡ Nearest-neighbor'),
          Einstein.button('Plan the best route', () => {
            if (stops.length < 2) throw new Error('A route needs at least two stops.');
            return { task: 'route-plan', system: 'You plan a technician’s driving day. Minimize total driving, but do not push Critical or High priority jobs late if it can be avoided. Every stop must appear exactly once.',
              prompt: `Technician ${t.Name} starts and ends at home (${home(t).map((x) => x.toFixed(3)).join(', ')}).\nStops (current order):\n${stops.map((w, i) => `${i + 1}. ${w.Subject} | ${w.City} (${coords(w).map((x) => x.toFixed(3)).join(', ')}) | ${w.Priority} | ${w.DurationHours || 2}h`).join('\n')}`,
              schema: Einstein.S.obj({ order: Einstein.S.arr(Einstein.S.obj({ stop: Einstein.S.num('the stop number from the list'), reason: Einstein.S.str() })), summary: Einstein.S.str() }) };
          }, (r) => {
            const seen = new Set(), order = [], reasons = {};
            for (const o of r.order || []) { const w = stops[Number(o.stop) - 1]; if (w && !seen.has(w.Id)) { seen.add(w.Id); order.push(w); reasons[w.Id] = o.reason; } }
            for (const w of stops) if (!seen.has(w.Id)) { order.push(w); reasons[w.Id] = 'Kept in place (not placed by the AI)'; }
            propose(order, 'ai', reasons, r.summary, r.meta);
          }, 'sm')),
        proposal) : h('p.muted', 'No jobs for this technician on this day.'));
  }

  // ---------- Work Order extras ----------

  function completeJob(w) {
    const notes = h('textarea', { rows: 4, placeholder: 'What was done, what was found, anything the customer should know.' });
    notes.value = w.CompletionNotes || '';
    const outcome = h('select', ['Completed', 'Cannot Complete'].map((x) => h('option', x)));
    const chatter = h('input', { type: 'checkbox', checked: true }), slackBox = h('input', { type: 'checkbox', checked: true });
    const flowOn = (DB.org().flows || []).some((f) => f.object === 'WorkOrder' && f.active && JSON.stringify(f.conditions).includes('Completed'));
    UI.modal({ title: `Complete ${num(w)}`, body: h('div.form', h('label', 'Outcome', outcome), h('label', 'Completion notes', notes),
      h('label.fs-check', chatter, ' Post a summary to Chatter'), h('label.fs-check', slackBox, ' Post a summary to #field-ops'),
      flowOn ? h('small.muted', 'The “Work order completed” flow is active and may already post these when the job is completed.') : null),
    actions: [{ label: 'Cancel', run: () => {} }, { label: 'Complete job', primary: true, run: () => {
      const text = `${outcome.value === 'Completed' ? '✅' : '⚠️'} ${num(w)} ${outcome.value.toLowerCase()}: ${w.Subject}${notes.value.trim() ? '\n' + notes.value.trim() : ''}`;
      const flowPosts = flowOn && outcome.value === 'Completed';
      DB.update(w.Id, { Status: outcome.value, CompletionNotes: notes.value.trim() });
      if (chatter.checked && !flowPosts) DB.post(w.Id, text);
      const ch = DB.channel('field-ops');
      if (slackBox.checked && ch && !flowPosts) DB.slackPost(ch.id, text.replace(/^(\S+) (\S+)/, '$1 $2') + `\n[[${w.Id}]]`, null, { recordId: w.Id });
      DB.save();
      UI.toast(`${num(w)} marked ${outcome.value.toLowerCase()}`, 'ok', ch && slackBox.checked ? { label: 'Open #field-ops', run: () => Shell.go('#/app/slack/slack?ch=' + ch.name) } : null);
    } }] });
  }

  function visitCard(w) {
    const t = DB.get(w.ResourceId);
    const rows = [['Technician', t ? t.Name : 'Not assigned'], ['When', w.ScheduledStart ? `${fmt.date(w.ScheduledStart)}, ${hh(hourOf(startOf(w)))}–${hh(hourOf(endOf(w)))}` : 'Not scheduled'], ['Where', w.City || '—'],
      ['Drive from home', t ? fk(km(home(t), coords(w))) + ' · ' + driveMin(km(home(t), coords(w))) + ' min' : '—']];
    const warn = t && lacks(t, w) ? h('div.fs-warnbar', `⚠ ${t.Name} does not list the ${w.Skill} skill.`) : null;
    return UI.card('Visit', h('div', warn, h('dl.fs-dl', rows.map(([k, v]) => [h('dt', k), h('dd', v)])),
      h('div.fs-route-btns', h('a.btn.sm', { href: '#/app/fieldservice/dispatch?d=' + (w.ScheduledStart ? isoDay(w.ScheduledStart) : today()) }, 'Open in dispatcher'), t && w.ScheduledStart ? h('a.btn.sm', { href: `#/app/fieldservice/fs-map?d=${isoDay(w.ScheduledStart)}&tech=${t.Id}` }, 'Route') : null)), { icon: '🚐' });
  }

  function briefing(w) {
    return Einstein.card({
      key: 'fs-brief:' + w.Id, title: 'Technician briefing', icon: '🦺', className: 'fs-ai', label: 'Brief the technician',
      intro: `${Einstein.word()} prepares a one-page briefing from this job, the customer’s history and the description. Check safety notes against your site procedures.`,
      ask: () => {
        const hist = DB.all('WorkOrder').filter((x) => x.AccountId === w.AccountId && x.Id !== w.Id).slice(0, 6).map((x) => `${x.WorkType} · ${x.Status} · ${fmt.dateShort(x.ScheduledStart)} · ${x.CompletionNotes || x.Subject}`).join('\n') || 'none';
        const cases = DB.all('Case').filter((c) => c.AccountId === w.AccountId).slice(0, 5).map((c) => `${c.CaseNumber || ''} ${c.Subject} (${c.Status})`).join('\n') || 'none';
        const assets = DB.meta('Asset') ? DB.all('Asset').filter((a) => a.AccountId === w.AccountId).slice(0, 6).map((a) => a.Name).join(', ') : '';
        return { task: 'work-order-briefing', system: 'You brief a field technician before a visit. Use only the facts given and general electrical/solar safety practice. Mark anything you infer as "check on site".',
          prompt: `Job:\n${Einstein.recordContext(w.Id, { depth: 1 })}\n\nPrevious work orders for this customer:\n${hist}\n\nCases:\n${cases}\n${assets ? 'Equipment on file: ' + assets : ''}`,
          schema: Einstein.S.obj({ job: Einstein.S.str('what to do, 2 sentences'), customer: Einstein.S.str('relevant history for this customer'), equipment: Einstein.S.arr(Einstein.S.str(), 'equipment likely on site'), bring: Einstein.S.arr(Einstein.S.str(), 'parts and tools to bring'), safety: Einstein.S.arr(Einstein.S.str(), 'safety notes') }) };
      },
      render: (r) => h('div.fs-brief', h('p', h('b', 'Job. '), r.job), h('p', h('b', 'Customer. '), r.customer),
        r.equipment && r.equipment.length ? h('div', h('h4', 'Equipment'), h('ul', r.equipment.map((x) => h('li', x)))) : null,
        r.bring && r.bring.length ? h('div', h('h4', 'Bring'), h('ul', r.bring.map((x) => h('li', x)))) : null,
        r.safety && r.safety.length ? h('div.fs-safety', h('h4', '🦺 Safety'), h('ul', r.safety.map((x) => h('li', x)))) : null),
    });
  }

  Record.extend('WorkOrder', {
    actions: (w) => (open(w) ? [{ label: 'Complete job', icon: '✅', primary: ['In Progress', 'Dispatched'].includes(w.Status), run: () => completeJob(w) }] : []),
    side: (w) => [visitCard(w), briefing(w)],
  });
})();
