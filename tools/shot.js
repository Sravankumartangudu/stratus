// shot.js — screenshots for the README and for eyeballing changes: boots Stratus on fresh demo data in a
// throwaway folder and saves a PNG per route.
//
//   npm run shot                         → the README set, into docs/screenshots/
//   npm run shot -- --out /tmp/s '#/app/sales/home' '#/settings'
//   add --dark for dark mode; --eval '<js>' prints what that expression returns on each page (for debugging)

const { app, nativeTheme, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-shot-'));
app.setPath('userData', tmp);
process.env.STRATUS_TEST = '1';
const ei = process.argv.indexOf('--eval');
const probe = ei > 0 ? process.argv[ei + 1] : '';
const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--out', '--eval'].includes(all[i - 1]));
const oi = process.argv.indexOf('--out');
const out = oi > 0 ? process.argv[oi + 1] : path.join(root, 'docs', 'screenshots');
const dark = process.argv.includes('--dark');
process.argv.push('--fresh', '--hidden');

const README = [
  ['home', '#/app/sales/home'], ['pipeline', '#/app/sales/Opportunity?mode=kanban'], ['record', 'FIRST:Opportunity'],
  ['forecast', '#/app/sales/forecast'], ['calendar', '#/app/sales/calendar'], ['console', '#/app/service/console'],
  ['journeys', '#/app/marketing/journeys'], ['storefront', '#/app/commerce/storefront'], ['integrations', '#/app/mulesoft/integrations'], ['agentforce', '#/app/agentforce/agent'], ['datacloud', '#/app/datacloud/profiles'],
  ['tableau', '#/app/tableau/pulse'], ['slack', '#/app/slack/slack'], ['dispatch', '#/app/fieldservice/dispatch'],
  ['dashboard', 'FIRST:dashboard'], ['flow', '#/setup/flows/fl1'], ['settings', '#/settings'],
];
const routes = args.map((r, i) => [`shot-${i + 1}`, r]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require(path.join(root, 'main.js'));

app.whenReady().then(async () => {
  if (dark) nativeTheme.themeSource = 'dark';
  let win = null;
  for (let i = 0; i < 100 && !win; i++) { await sleep(100); win = BrowserWindow.getAllWindows()[0]; }
  win.setSize(1440, 900);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  for (let i = 0; i < 100; i++) { if (await js(`!!document.querySelector('#main') && document.querySelector('#main').children.length > 0`).catch(() => false)) break; await sleep(100); }
  fs.mkdirSync(out, { recursive: true });
  for (const [name, r0] of routes.length ? routes : README) {
    let r = r0;
    if (r === 'FIRST:dashboard') r = await js(`'#/dashboard/' + DB.cfg.list('dashboards')[0].id`);
    else if (r.startsWith('FIRST:')) r = await js(`'#/r/' + DB.all(${JSON.stringify(r.slice(6))})[0].Id`);
    await js(`location.hash = ${JSON.stringify(r)}`);
    await sleep(900);
    const img = await win.webContents.capturePage();
    const f = path.join(out, `${name}${dark ? '-dark' : ''}.png`);
    fs.writeFileSync(f, img.toPNG());
    console.log('📸 ' + f);
    if (probe) console.log('   ' + JSON.stringify(await js(probe).catch((e) => 'eval failed: ' + e.message)));
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  app.exit(0);
});
