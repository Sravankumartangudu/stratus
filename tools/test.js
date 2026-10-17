// test.js — smoke test: boots Stratus on fresh demo data in a throwaway folder (window hidden), visits every
// app tab, record type, report, dashboard, Setup and Settings page, opens the launcher and the Agentforce
// panel, and fails if anything logs an error or a page shows "This page hit a problem".
//
//   npm test            → all routes
//   npm test -- --show  → same, with the window visible

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-test-'));
app.setPath('userData', tmp);
process.env.STRATUS_TEST = '1';
process.argv.push('--fresh');
if (!process.argv.includes('--show')) process.argv.push('--hidden');

// Scripts index.html lists that aren't written yet: report them, but don't count their 404 as a failure.
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const listed = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
const missing = listed.filter((f) => !fs.existsSync(path.join(root, 'renderer', f)));

const errors = [];
// A syntax error stops a whole script before the console listener is attached, so compile each one first.
const vm = require('vm');
for (const f of listed.filter((x) => x.endsWith('.js') && !missing.includes(x))) {
  try { new vm.Script(fs.readFileSync(path.join(root, 'renderer', f), 'utf8'), { filename: f }); }
  catch (e) { errors.push(`[${f}] ${e.message} — ${(e.stack.split('\n')[0] || '').trim()}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require(path.join(root, 'main.js'));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 100 && !win; i++) { await sleep(100); win = require('electron').BrowserWindow.getAllWindows()[0]; }
  if (!win) return done('No window opened');
  const wc = win.webContents;
  let where = 'boot';
  wc.on('console-message', (e, level, message, line, source) => {
    const d = e && e.message !== undefined ? e : { level, message, lineNumber: line, sourceId: source };
    const lvl = typeof d.level === 'string' ? d.level : ['debug', 'info', 'warning', 'error'][d.level];
    if (lvl !== 'error') return;
    if (missing.some((f) => String(d.message).includes(f) || String(d.sourceId || '').includes(f))) return;
    errors.push(`[${where}] ${d.message}${d.sourceId ? ` (${path.basename(d.sourceId)}:${d.lineNumber})` : ''}`);
  });
  wc.on('render-process-gone', (_e, d) => { errors.push(`[${where}] renderer gone: ${d.reason}`); done(); });
  wc.on('preload-error', (_e, p, err) => errors.push(`[preload] ${err.message}`));

  const js = (code) => wc.executeJavaScript(code, true);
  for (let i = 0; i < 100; i++) { if (await js(`!!document.querySelector('#main') && document.querySelector('#main').children.length > 0`).catch(() => false)) break; await sleep(100); }
  const boot = await js(`document.body.textContent.startsWith('Stratus could not start') ? document.body.textContent : ''`);
  if (boot) return done(boot);

  // Every route worth a look, worked out from the live org so new apps, tabs and records are picked up.
  const plan = await js(`(() => {
    const out = [], skipped = [];
    for (const a of APPS) for (const t of a.tabs) {
      if (t.startsWith('page:') && !Pages[t.slice(5)]) { skipped.push(a.id + '/' + t); continue; }
      out.push('#/app/' + a.id + '/' + t.replace(/^page:/, ''));
    }
    for (const o of Object.keys(SCHEMA)) {
      const r = DB.all(o)[0];
      if (r) out.push('#/r/' + r.Id);
    }
    for (const o of ['Opportunity', 'Lead', 'Case']) out.push('#/app/sales/' + o + '?mode=kanban', '#/app/sales/' + o + '?view=1');
    for (const r of DB.cfg.list('reports').slice(0, 40)) out.push('#/report/' + r.id);
    for (const d of DB.cfg.list('dashboards')) out.push('#/dashboard/' + d.id);
    for (const s of ['home', 'objects', 'objects/Opportunity', 'objects/Case', 'flows', 'runs', 'users', 'trust', 'audit', 'bin', 'data']) out.push('#/setup/' + s);
    const f = DB.cfg.list('flows')[0];
    if (f) out.push('#/setup/flows/' + f.id);
    out.push('#/search?q=solar', '#/search?q=a', '#/settings');
    return { out, skipped };
  })()`);

  for (const r of plan.out) {
    where = r;
    await js(`location.hash = ${JSON.stringify(r)}`);
    await sleep(350);
    const bad = await js(`(() => {
      const m = document.querySelector('#main');
      const e = m && [...m.querySelectorAll('.empty')].find((x) => /hit a problem|no page called/.test(x.textContent));
      return e ? e.textContent.trim() : (m && !m.children.length ? 'blank page' : '');
    })()`);
    if (bad) errors.push(`[${r}] ${bad}`);
  }

  // A few things that aren't routes: the app launcher, the Agentforce panel, a record's ✨ cards, user switcher.
  where = 'launcher';
  await js(`location.hash = '#/app/sales/home'`); await sleep(300);
  await js(`document.querySelector('.waffle').click()`); await sleep(250);
  if (!(await js(`!!document.querySelector('.launcher')`))) errors.push('[launcher] did not open');
  await js(`document.querySelector('.modal-back') && document.querySelector('.modal-back').click()`); await sleep(200);
  where = 'agent panel';
  await js(`document.querySelector('.agentbtn').click()`); await sleep(300);
  if (!(await js(`document.body.classList.contains('panel-on')`))) errors.push('[agent panel] did not open');
  await js(`document.querySelector('.agentbtn').click()`); await sleep(200);
  where = 'global search';
  await js(`(() => { const i = document.querySelector('.gsearch'); i.focus(); i.value = 'bright'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(400);
  if (!(await js(`!!document.querySelector('.sdrop.open .srow')`))) errors.push('[global search] no suggestions for "bright"');

  console.log(`\nStratus smoke test — ${plan.out.length} routes`);
  if (plan.skipped.length) console.log(`  ⏳ not built yet: ${plan.skipped.join(', ')}`);
  if (missing.length) console.log(`  ⏳ files listed in index.html but missing: ${missing.join(', ')}`);
  done();
});

function done(fatal) {
  if (fatal) errors.unshift(fatal);
  const uniq = [...new Set(errors)];
  if (uniq.length) { console.log(`  ✗ ${uniq.length} problem(s):`); for (const e of uniq) console.log('   • ' + e); }
  else console.log('  ✓ no errors');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  app.exit(uniq.length ? 1 : 0);
}
