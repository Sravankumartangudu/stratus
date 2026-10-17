// clicks.js — clicks through the things a person does (not just the pages they visit): adjust a forecast,
// add an event from the calendar, create / edit / delete a record, merge a duplicate and undo it, refresh a
// stream, save a segment, pin a Tableau answer to a dashboard, post and run /case in Slack, run an
// integration, call an API, reply to a case, auto-schedule jobs, buy something in the storefront. No AI —
// tools/ai-sweep.js covers the ✨ buttons. Fails on any broken step, error toast or console error.
//
//   npm run clicks            → every step
//   npm run clicks -- --show  → same, with the window visible
//   npm run clicks -- --only slack → just the steps whose name has "slack"
//   npm run clicks -- --ai    → also the typed-in AI steps (filter, build, Agentforce, Slack, Ask Data…)

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-clicks-'));
app.setPath('userData', tmp);
process.env.STRATUS_TEST = '1';
process.argv.push('--fresh');
if (!process.argv.includes('--show')) process.argv.push('--hidden');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helpers the steps can use inside the page.
const HELPERS = `
  window.__t = {
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    async until(fn, ms = 4000, what = 'condition') {
      const t0 = Date.now();
      for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await new Promise((r) => setTimeout(r, 80)); }
    },
    async go(hash) { location.hash = hash; await this.wait(450); },
    vis: (el) => !!(el && el.getClientRects().length), // offsetParent is null for position: fixed
    find(text, scope = 'body', sel = 'button, a, span.btn, .tab, [role=button]') {
      const els = [...document.querySelectorAll(scope + ' ' + sel.split(',').join(', ' + scope + ' '))].filter((e) => this.vis(e));
      return els.find((e) => e.textContent.trim() === text) || els.find((e) => e.textContent.trim().includes(text));
    },
    async click(text, scope, sel) {
      const el = typeof text === 'string' ? await this.until(() => this.find(text, scope, sel), 3000, '"' + text + '"') : text;
      el.click(); await this.wait(250); return el;
    },
    type(el, v) {
      if (typeof el === 'string') el = document.querySelector(el);
      if (!el) throw new Error('no field to type into');
      el.focus(); el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return el;
    },
    enter(el) { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); },
    toast(re) { return [...document.querySelectorAll('.toast')].find((t) => re.test(t.textContent)); },
    async toasted(re) { return this.until(() => this.toast(re), 4000, 'a toast matching ' + re); },
    modal: () => document.querySelector('.modal-back .modal'),
    closeModals() { document.querySelectorAll('.modal-back').forEach((m) => m.remove()); },
    errToasts: () => [...document.querySelectorAll('.toast.err')].map((t) => t.textContent.replace(/[×!]/g, '').trim()),
    n: (o) => DB.all(o).length,
    log: () => DB.org().agentLog.length,
    // Wait for a real AI call to come back; fail if it errored.
    async ai(n0, ms = 200000) {
      await this.until(() => this.log() > n0 && !document.querySelector('#main .spinner, #panel .spinner, .typing') && ![...document.querySelectorAll('button.btn.ai')].some((b) => b.disabled), ms, 'the AI to answer');
      const e = DB.org().agentLog[0];
      if (!e.ok) throw new Error('AI call failed: ' + e.error);
      return e;
    },
  }; 0`;

// Each step runs in the page; throw to fail it.
const STEPS = [
  ['Forecast: adjust a number', `
    const me = DB.org().me;
    const mgr = DB.all('User').find((u) => u.Role === 'Sales Manager');
    DB.setMe(mgr.Id);
    try {
    await t.go('#/app/sales/forecast?who=team');
    const before = document.querySelectorAll('.fc-adj').length;
    (await t.until(() => document.querySelector('.fc-edit'), 3000, 'an adjust ✎ (shows on hover)')).click();
    await t.until(t.modal, 2000, 'the adjust dialog');
    t.type(t.modal().querySelector('input[type=number]'), '123456');
    t.type(t.modal().querySelector('input[type=text]'), 'Clicks test');
    await t.click('Save adjustment', '.modal');
    await t.toasted(/Forecast adjusted/);
    if (document.querySelectorAll('.fc-adj').length <= before) throw new Error('no ✎ mark on the adjusted cell');
    } finally { DB.setMe(me); }`],
  ['Calendar: click an empty slot to add an event', `
    await t.go('#/app/sales/calendar');
    const col = await t.until(() => document.querySelector('[title="Click to add an event"]'), 3000, 'a day column');
    const r = col.getBoundingClientRect();
    col.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 10, clientY: r.top + 200 }));
    await t.until(t.modal, 2000, 'the new event form');
    const before = t.n('Event');
    t.type(t.modal().querySelector('input'), 'Clicks test meeting');
    await t.click('Save', '.modal', 'button');
    await t.until(() => t.n('Event') > before, 3000, 'the event to be saved');`],
  ['Records: create, edit and delete an Account', `
    await t.go('#/app/sales/Account');
    await t.click('New', '#main');
    await t.until(t.modal, 2000, 'the new record form');
    const before = t.n('Account');
    t.type(t.modal().querySelector('input'), 'Clicks Test Co');
    await t.click('Save', '.modal', 'button');
    await t.until(() => t.n('Account') > before, 3000, 'the account to be created');
    const acc = DB.all('Account').find((a) => a.Name === 'Clicks Test Co');
    await t.go('#/r/' + acc.Id);
    await t.click('Edit', '.hl-actions', 'button');
    await t.until(t.modal, 2000, 'the edit form');
    t.type(t.modal().querySelector('input'), 'Clicks Test Co (edited)');
    await t.click('Save', '.modal', 'button');
    await t.until(() => DB.get(acc.Id).Name === 'Clicks Test Co (edited)', 3000, 'the edit to stick');
    await t.click('▾', '.hl-actions', 'button');
    await t.click('Delete', '.popmenu', 'button');
    await t.click('Delete', '.modal', 'button');
    await t.until(() => !DB.get(acc.Id), 3000, 'the delete');`],
  ['Kanban: drag a deal to the next stage', `
    await t.go('#/app/sales/Opportunity?mode=kanban');
    const card = await t.until(() => [...document.querySelectorAll('.kcard')].find((c) => DB.get(c.dataset.id).StageName === 'Prospecting'), 3000, 'a Prospecting card');
    const id = card.dataset.id;
    const col = [...document.querySelectorAll('.kcol')].find((c) => c.querySelector('.khead b').textContent === 'Qualification');
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await t.toasted(/→ Qualification/);
    if (DB.get(id).StageName !== 'Qualification') throw new Error('stage did not change');`],
  ['Service: reply to a case and set Waiting on Customer', `
    await t.go('#/app/service/console');
    const ta = await t.until(() => document.querySelector('.cs-composer textarea'), 3000, 'the reply box');
    t.type(ta, 'Thanks — we are on it. (clicks test)');
    const sel = document.querySelector('.cs-composer select'); if (sel) t.type(sel, 'Waiting on Customer');
    const before = t.n('CaseComment') + t.n('EmailMessage');
    await t.click('Send reply', '.cs-composer');
    await t.toasted(/Reply sent/);
    if (t.n('CaseComment') + t.n('EmailMessage') <= before) throw new Error('no comment saved');`],
  ['Data Cloud: merge a duplicate, then undo', `
    await t.go('#/app/datacloud/identity');
    if (!t.find('Merge into contact', '#main')) await t.click('Add sample duplicates', '#main');
    const before = t.n('Contact') + t.n('Lead');
    await t.click('Merge into contact', '#main');
    const toast = await t.toasted(/Merged/);
    toast.querySelector('button.link').click();
    await t.toasted(/Merge undone/);
    if (t.n('Contact') + t.n('Lead') !== before) throw new Error('undo did not restore the records');`],
  ['Data Cloud: refresh a stream', `
    await t.go('#/app/datacloud/streams');
    await t.click('Refresh now', '#main');
    await t.until(() => !t.find('Refreshing…', '#main'), 8000, 'the refresh to finish');`],
  ['Data Cloud: build and save a segment', `
    await t.go('#/app/datacloud/insights');
    await t.click('Segments', '#main .seg', 'button');
    const before = t.n('Segment');
    t.type(await t.until(() => document.querySelector('input[placeholder="Segment name"]'), 3000, 'the segment name box'), 'Clicks test segment');
    await t.click('Save as segment', '#main');
    await t.toasted(/Saved/);
    if (t.n('Segment') <= before) throw new Error('segment not saved');`],
  ['Tableau: answer a starter question and add it to a dashboard', `
    await t.go('#/app/tableau/tableau-ask');
    (await t.until(() => document.querySelector('.tb-starter'), 3000, 'a starter card')).click();
    await t.until(() => t.find('Add to dashboard', '#main'), 150000, 'the answer (AI picks the chart when it is on)');
    await t.click('Add to dashboard', '#main');
    (await t.until(() => document.querySelector('.popmenu button'), 2000, 'the dashboard menu')).click();
    await t.toasted(/Added to/);`],
  ['Slack: post a message and open a case with /case', `
    await t.go('#/app/slack/slack');
    const box = () => document.querySelector('.sk-composer textarea, .sk-composer input');
    t.type(await t.until(box, 3000, 'the composer'), 'Hello from the clicks test');
    document.querySelector('.sk-send').click(); await t.wait(300);
    await t.until(() => document.querySelector('#main').textContent.includes('Hello from the clicks test'), 3000, 'the posted message');
    const before = t.n('Case');
    t.type(box(), '/case Clicks test case from Slack');
    document.querySelector('.sk-send').click(); await t.wait(400);
    await t.until(() => t.n('Case') > before, 3000, 'the case /case opens');`],
  ['MuleSoft: run an integration', `
    await t.go('#/app/mulesoft/integrations');
    const before = (DB.org().runs || []).length;
    await t.click('▶ Run now', '#main');
    await t.until(() => (DB.org().runs || []).length > before || t.toast(/run|Run|records/), 8000, 'a new run');`],
  ['MuleSoft: call an API from the console, with and without client_id', `
    await t.go('#/app/mulesoft/apis');
    await t.click('Send', '#main', 'button');
    await t.until(() => /200/.test((document.querySelector('.ms-out') || {}).textContent || ''), 4000, 'a 200 response');
    const cid = [...document.querySelectorAll('#main input')].find((i) => /client/i.test(i.placeholder || '') || (i.value || '').length > 10 && !i.value.startsWith('/'));
    if (cid) { t.type(cid, ''); await t.click('Send', '#main', 'button'); await t.until(() => /401/.test(document.querySelector('.ms-out').textContent), 4000, 'a 401 response'); }`],
  ['Field Service: auto-schedule, apply, undo', `
    await t.go('#/app/fieldservice/dispatch');
    await t.click('⚡ Auto-schedule', '#main');
    await t.until(() => t.find('Discard', '#main'), 3000, 'the plan to review');
    const apply = [...document.querySelectorAll('#main button.btn.primary')].find((b) => t.vis(b) && /Apply|Schedule/.test(b.textContent));
    if (!apply) throw new Error('no apply button on the plan');
    apply.click();
    await t.toasted(/scheduled/);
    await t.click('↶ Undo', '#main');
    await t.toasted(/Undone/);`],
  ['Commerce: add to cart and place an order', `
    await t.go('#/app/commerce/storefront');
    const add = await t.until(() => [...document.querySelectorAll('.sf-card button.btn.primary')].find((b) => !b.disabled), 3000, 'an Add button');
    add.click(); await t.wait(250);
    const before = t.n('Order');
    await t.click('🛒 Cart', '#main', 'button');
    await t.click('Checkout', 'body', 'button');
    await t.until(t.modal, 2000, 'the checkout dialog');
    await t.click('Place order', '.modal', 'button');
    await t.until(() => t.n('Order') > before, 3000, 'the order');`],
  ['Settings: switch appearance to Dark and back to System', `
    await t.go('#/settings');
    await t.click('Dark', '#main', 'button');
    await t.until(() => matchMedia('(prefers-color-scheme: dark)').matches, 3000, 'the dark theme');
    await t.click('System', '#main', 'button');`],
];

// With --ai: things that need typing before the ✨ does anything, run against the real AI.
const AI_STEPS = [
  ['Service console: ✨ Draft reply fills the reply box', `
    await t.go('#/app/service/console');
    const n0 = t.log();
    const b = await t.until(() => [...document.querySelectorAll('.cs-composer button.btn.ai')].find(t.vis), 3000, 'the Draft reply button');
    b.click();
    await t.wait(300);
    // A redraw while the AI thinks must not lose the draft (the console redraws on any data change).
    Shell.render();
    await t.ai(n0);
    const ta = document.querySelector('.cs-composer textarea');
    if (!ta || ta.value.trim().length < 20) throw new Error('reply box is empty after the draft');`],
  ['Slack: ✨ Draft reply fills the composer, even after a redraw', `
    await t.go('#/app/slack/slack');
    const n0 = t.log();
    (await t.until(() => [...document.querySelectorAll('.sk-main .sk-composer button.btn.ai')].find(t.vis), 3000, 'the Draft reply button')).click();
    await t.wait(300);
    Shell.render();
    await t.ai(n0);
    const ta = document.querySelector('.sk-main .sk-composer textarea');
    if (!ta || ta.value.trim().length < 5) throw new Error('composer is empty after the draft');`],
  ['Chatter: ✨ Write an update fills the post box, even after a redraw', `
    await t.go('#/r/' + DB.all('Opportunity')[0].Id);
    await t.click('Chatter', '#main .rec-main', 'button.tab');
    const n0 = t.log();
    await t.click('✨ Write an update', '#main', 'button');
    await t.wait(300);
    Shell.render();
    await t.ai(n0);
    const ta = document.querySelector('.chatter .composer textarea');
    if (!ta || ta.value.trim().length < 10) throw new Error('post box is empty after the draft');`],
  ['✨ Filter a list in plain words', `
    await t.go('#/app/sales/Opportunity');
    const n0 = t.log();
    t.type(document.querySelector('#main .aiq'), 'open deals over 50k closing this quarter');
    await t.click('✨ Filter', '#main', 'button');
    await t.ai(n0);`],
  ['✨ Build a report from a sentence', `
    await t.go('#/app/sales/reports');
    const n0 = t.log();
    t.type(document.querySelector('#main .aiq'), 'won deals by month this year as a line chart');
    await t.click('✨ Build it', '#main', 'button');
    await t.ai(n0);
    await t.until(() => location.hash.startsWith('#/report/new'), 3000, 'the draft report');`],
  ['✨ Build a dashboard from a sentence', `
    await t.go('#/app/sales/dashboards');
    const n0 = t.log();
    t.type(document.querySelector('#main .aiq'), 'service health for the support manager');
    await t.click('✨ Build dashboard', '#main', 'button');
    await t.ai(n0);
    await t.until(() => location.hash.startsWith('#/dashboard/'), 3000, 'the new dashboard');`],
  ['Agentforce panel: ask a question', `
    await t.go('#/app/sales/home');
    document.querySelector('.agentbtn').click(); await t.wait(300);
    const n0 = t.log();
    const ta = await t.until(() => [...document.querySelectorAll('textarea')].find((x) => /Ask Agentforce/.test(x.placeholder) && t.vis(x)), 3000, 'the Agentforce box');
    t.type(ta, 'Which of my open deals close this month?'); t.enter(ta);
    await t.ai(n0);`],
  ['Agentforce panel: do something (log a call), with undo', `
    const n0 = t.log(), tasks = t.n('Task');
    const acc = DB.all('Account')[0];
    const ta = [...document.querySelectorAll('textarea')].find((x) => /Ask Agentforce/.test(x.placeholder) && t.vis(x));
    t.type(ta, 'Log a completed call on ' + acc.Name + ' saying we discussed the renewal price.'); t.enter(ta);
    await t.ai(n0);
    await t.until(() => t.n('Task') > tasks || t.find('Undo', 'body', 'button.link'), 8000, 'a logged call (or an action to confirm)');
    document.querySelector('.agentbtn').click();`],
  ['Slack: ask @Agentforce in a channel', `
    await t.go('#/app/slack/slack');
    const n0 = t.log();
    const box = document.querySelector('.sk-composer textarea');
    t.type(box, '@Agentforce how many open cases are high priority?');
    document.querySelector('.sk-send').click();
    await t.ai(n0);`],
  ['Tableau: ask a question in your own words', `
    await t.go('#/app/tableau/tableau-ask');
    const n0 = t.log();
    const ta = document.querySelector('#main textarea');
    t.type(ta, 'won revenue by month this year'); t.enter(ta);
    await t.ai(n0);
    await t.until(() => t.find('Add to dashboard', '#main'), 4000, 'the chart');`],
  ['Commerce: chat with the store helper', `
    await t.go('#/app/commerce/storefront');
    await t.click('💬 Chat with us', 'body', 'button');
    const n0 = t.log();
    const inp = await t.until(() => document.querySelector('.sf-chat-f input'), 2000, 'the chat box');
    t.type(inp, 'Do you have home batteries in stock?');
    await t.click('Send', '.sf-chat-f', 'button');
    await t.until(() => document.querySelectorAll('.sf-msgs .msg.agent').length > 0 && !document.querySelector('.typing'), 200000, 'a reply');`],
  ['Field Service: ✨ Optimize with AI', `
    await t.go('#/app/fieldservice/dispatch');
    const n0 = t.log();
    await t.click('✨ Optimize with AI', '#main', 'button');
    await t.ai(n0);
    await t.until(() => t.find('Discard', '#main'), 3000, 'the AI plan to review');`],
];
if (process.argv.includes('--ai')) STEPS.push(...AI_STEPS);
const oi = process.argv.indexOf('--only');
if (oi > 0) STEPS.splice(0, STEPS.length, ...STEPS.filter(([n]) => n.toLowerCase().includes(process.argv[oi + 1].toLowerCase())));

require(path.join(root, 'main.js'));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 100 && !win; i++) { await sleep(100); win = require('electron').BrowserWindow.getAllWindows()[0]; }
  if (!win) return finish(['No window opened']);
  const wc = win.webContents;
  const problems = [];
  let where = 'boot';
  wc.on('console-message', (e, level, message) => {
    const d = e && e.message !== undefined ? e : { level, message };
    const lvl = typeof d.level === 'string' ? d.level : ['debug', 'info', 'warning', 'error'][d.level];
    if (lvl === 'error') problems.push(`[${where}] console: ${d.message}`);
  });
  const js = (code) => wc.executeJavaScript(code, true);
  for (let i = 0; i < 100; i++) { if (await js(`!!document.querySelector('#main') && document.querySelector('#main').children.length > 0`).catch(() => false)) break; await sleep(100); }
  await js(HELPERS);
  for (const [name, body] of STEPS) {
    where = name;
    const r = await js(`(async () => { const t = window.__t; t.closeModals(); const e0 = t.errToasts();
      try { ${body}
        const bad = t.errToasts().filter((x) => !e0.includes(x)); return bad.length ? 'error toast: ' + bad.join(' | ') : '';
      } catch (e) { return e.message || String(e); } })()`).catch((e) => e.message);
    console.log(`  ${r ? '✗' : '✓'} ${name}${r ? ' — ' + r : ''}`);
    if (r) problems.push(`[${name}] ${r}`);
  }
  console.log(`\nStratus clicks — ${STEPS.length} steps`);
  finish(problems);
});

function finish(problems) {
  const uniq = [...new Set(problems)];
  if (uniq.length) { console.log(`  ✗ ${uniq.length} problem(s):`); for (const p of uniq) console.log('   • ' + p); }
  else console.log('  ✓ no problems');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  app.exit(uniq.length ? 1 : 0);
}
