// ai-sweep.js — presses every ✨ button with the AI that's really set up (whatever Settings › AI picks on
// this Mac), one page at a time, and reports any call that failed, any "⚠️" card, error toast or console
// error. Slow on purpose: each press is a real model call. Split the work across processes with --shard.
//
//   npm run ai-sweep                         → every app tab plus one record of each main object
//   npm run ai-sweep -- --shard 1/4          → a quarter of the pages (run 4 at once to go faster)
//   npm run ai-sweep -- '#/app/sales/home'   → just these pages

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-sweep-'));
app.setPath('userData', tmp);
process.env.STRATUS_TEST = '1';
process.argv.push('--fresh', '--hidden');
const si = process.argv.indexOf('--shard');
const [shard, shards] = si > 0 ? process.argv[si + 1].split('/').map(Number) : [1, 1];
const only = process.argv.filter((a) => a.startsWith('#/'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  for (let i = 0; i < 100; i++) { if (await js(`Einstein.ready()`)) break; await sleep(200); }
  if (!(await js(`Einstein.ready()`))) return finish([`AI is not set up: ${await js(`Einstein.state().problem`)}`]);
  console.log(`AI: ${await js(`Einstein.state().label`)}`);

  const all = only.length ? only : await js(`(() => {
    const out = [];
    for (const a of APPS) for (const t of a.tabs) if (!t.startsWith('page:') || Pages[t.slice(5)]) out.push('#/app/' + a.id + '/' + t.replace(/^page:/, ''));
    for (const o of ['Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'WorkOrder', 'Order', 'Campaign', 'Quote', 'Product2']) {
      const r = DB.all(o)[0]; if (r) out.push('#/r/' + r.Id);
    }
    const d = DB.cfg.list('dashboards')[0]; if (d) out.push('#/dashboard/' + d.id);
    const r = DB.cfg.list('reports')[0]; if (r) out.push('#/report/' + r.id);
    return [...new Set(out)];
  })()`);
  const routes = all.filter((_, i) => i % shards === shard - 1);

  // What's on screen right now that we'd call a failure.
  const snapshot = `(() => ({
    log: DB.org().agentLog.length,
    last: DB.org().agentLog[0] || null,
    busy: !!document.querySelector('#main .spinner, .modal .spinner, #panel .spinner') || !![...document.querySelectorAll('button.btn.ai')].some((b) => b.disabled),
    errs: [...document.querySelectorAll('.ai-err')].map((e) => e.textContent.trim()),
    toasts: [...document.querySelectorAll('.toast.err')].map((t) => t.textContent.replace(/[×!]/g, '').trim()),
    modal: !!document.querySelector('.modal-back'),
    crash: [...document.querySelectorAll('#main .empty')].map((x) => x.textContent).find((t) => /hit a problem/.test(t)) || '',
  }))()`;
  const buttons = (scope) => `[...document.querySelectorAll(${JSON.stringify(scope)})].filter((b) => b.offsetParent && !b.disabled)`;
  let calls = 0, ok = 0;

  async function press(scopeSel, i, label) {
    const before = await js(snapshot);
    await js(`${buttons(scopeSel)}[${i}].click()`);
    const t0 = Date.now();
    let s = before;
    await sleep(800);
    for (;;) {
      s = await js(snapshot);
      if (!s.busy && (s.log > before.log || Date.now() - t0 > 4000)) break;
      if (Date.now() - t0 > 300000) { problems.push(`[${where}] "${label}" still running after 5 min`); break; }
      await sleep(700);
    }
    const sec = ((Date.now() - t0) / 1000).toFixed(0);
    const fresh = (a, b) => a.filter((x) => !b.includes(x));
    const bad = [...fresh(s.errs, before.errs), ...fresh(s.toasts, before.toasts)];
    if (s.crash) bad.push(s.crash.trim());
    if (s.log > before.log) {
      calls++;
      if (s.last && !s.last.ok) bad.push(`call failed: ${s.last.error}`);
      else if (!bad.length) ok++;
    }
    console.log(`  ${bad.length ? '✗' : s.log > before.log ? '✓' : '·'} ${label} ${s.log > before.log ? `(${s.last.task}, ${sec}s)` : '(no AI call)'}${bad.length ? ' — ' + bad.join(' | ') : ''}`);
    for (const b of bad) problems.push(`[${where}] "${label}": ${b}`);
    return s;
  }

  for (const r of routes) {
    where = r;
    await js(`document.querySelectorAll('.modal-back').forEach((m) => m.remove()); location.hash = ${JSON.stringify(r)}`);
    await sleep(900);
    console.log(r);
    const done = new Set();
    for (let guard = 0; guard < 30; guard++) {
      const list = await js(`${buttons('#main button.btn.ai')}.map((b) => b.textContent.trim())`);
      const i = list.findIndex((l, k) => !done.has(l + '#' + list.slice(0, k).filter((x) => x === l).length));
      if (i < 0) break;
      const label = list[i];
      done.add(label + '#' + list.slice(0, i).filter((x) => x === label).length);
      const s = await press('#main button.btn.ai', i, label);
      // A ✨ that opens a dialog: press the ✨ buttons inside it once, then close it.
      if (s.modal) {
        const inner = await js(`${buttons('.modal button.btn.ai')}.map((b) => b.textContent.trim())`);
        for (let k = 0; k < inner.length; k++) await press('.modal button.btn.ai', 0, `${label} › ${inner[k]}`);
        await js(`document.querySelectorAll('.modal-back').forEach((m) => m.remove())`);
      }
      if ((await js(`location.hash`)) !== r) { await js(`location.hash = ${JSON.stringify(r)}`); await sleep(700); }
    }
  }
  console.log(`\nAI sweep (shard ${shard}/${shards}) — ${routes.length} pages, ${calls} AI calls, ${ok} clean`);
  finish(problems);
});

function finish(problems) {
  const uniq = [...new Set(problems)];
  if (uniq.length) { console.log(`  ✗ ${uniq.length} problem(s):`); for (const p of uniq) console.log('   • ' + p); }
  else console.log('  ✓ no problems');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  app.exit(uniq.length ? 1 : 0);
}
