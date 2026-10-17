// Loads the renderer core in a Node VM, builds the demo org and reports problems.
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'renderer', 'js', 'core');
const ctx = { console, setTimeout, clearTimeout, Date, Math, JSON, window: {}, document: undefined };
vm.createContext(ctx);
const files = ['util', 'schema', 'formula', 'predict', 'db', 'seed'];
const src = files.map((f) => fs.readFileSync(path.join(dir, f + '.js'), 'utf8')).join('\n;\n') +
  '\n;globalThis.__ = { DB, SCHEMA, Predict, Formula };';
vm.runInContext(src, ctx, { filename: 'core.js' });
const { DB, SCHEMA } = ctx.__;
const t0 = Date.now();
const r = DB.boot(null);
console.log('boot', r, Date.now() - t0 + 'ms');
const org = DB.org();
let bad = 0;
for (const [obj, list] of Object.entries(org.records)) {
  const m = DB.meta(obj);
  if (!m) { console.log('UNKNOWN OBJECT', obj); bad++; continue; }
  const unknown = new Set();
  for (const rec of list) for (const k of Object.keys(rec)) if (!m.field[k]) unknown.add(k);
  const badRef = new Set();
  for (const f of m.fields.filter((f) => f.type === 'lookup')) for (const rec of list) if (rec[f.name] && !DB.get(rec[f.name]) && !String(rec[f.name]).startsWith('bot:')) badRef.add(f.name);
  const missing = new Set();
  for (const f of m.fields.filter((f) => f.required && !['autonumber', 'formula'].includes(f.type))) for (const rec of list) if (rec[f.name] == null || rec[f.name] === '') missing.add(f.name);
  const badPick = new Set();
  for (const f of m.fields.filter((f) => f.type === 'picklist' && f.options)) for (const rec of list) if (rec[f.name] != null && rec[f.name] !== '' && !f.options.includes(rec[f.name])) badPick.add(f.name + '=' + rec[f.name]);
  const notes = [unknown.size && 'unknown: ' + [...unknown], badRef.size && 'bad refs: ' + [...badRef], missing.size && 'missing required: ' + [...missing], badPick.size && 'bad picklist: ' + [...badPick].slice(0, 6)].filter(Boolean);
  console.log(obj.padEnd(20), String(list.length).padStart(4), notes.join(' | '));
  if (notes.length) bad++;
}
console.log('slack', org.slack.channels.length, 'ch', org.slack.messages.length, 'msgs; feed', org.feed.length, '; events', org.events.length, '; sources', org.sources.length, '; reports', org.reports.length, '; dashboards', org.dashboards.length, '; flows', org.flows.length);
for (const rp of org.reports) { try { const x = DB.runReport(rp); if (!x.rows.length) console.log('EMPTY report', rp.name); } catch (e) { console.log('REPORT FAIL', rp.name, e.message); bad++; } }
const o = DB.all('Opportunity')[0];
console.log('sample opp', o.Name, o.Amount, o.StageName, o.WinScore, o.ExpectedRevenue);
const ord = DB.all('Order')[0]; console.log('sample order', ord.OrderNumber, ord.TotalAmount);
const c = DB.all('Case')[0]; console.log('sample case', c.CaseNumber, c.Subject, c.Sentiment, c.SlaDue);
const l = DB.all('Lead')[0]; console.log('sample lead', l.Name, l.Score, l.ScoreReason);
console.log('size', (JSON.stringify(org).length / 1024).toFixed(0) + 'KB');
process.exit(bad ? 1 : 0);
