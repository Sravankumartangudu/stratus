# How Stratus is built

Stratus is an Electron app with no framework and no build step. The renderer is plain classic `<script>` files that share one global scope, loaded in the order `renderer/index.html` lists them. Everything runs on a local demo org (Brightwave Energy, a made-up company), saved as `org.json` in the app's data folder.

```
main.js            window, menu bar ☁️, files on disk, IPC          (main process)
ai.js              the AI picker: Claude Code, Claude API, ChatGPT, Gemini, OpenRouter, Ollama, OpenAI-compatible
preload.js         window.host — the only bridge (loadOrg/saveOrg, aiAsk, aiConfigure, open, export…)
nexus-beacon.js    health beacon for the Nexus fleet monitor
renderer/
  index.html       CSP (no network, no inline script), stylesheets, script order
  css/base.css     design tokens (light + dark), frame, buttons, inputs, cards, tables, modals, charts, ✨ AI
  css/views.css    list, Kanban, record page, home, search, reports, dashboards, setup, settings, Agentforce
  css/apps/<app>.css   one per app, only that app's pages
  js/core/         util · schema · formula · predict · db · seed · charts · einstein
  js/shell.js      frame, routing, app launcher, global search, Agentforce panel; declares Pages and Views
  js/views/        form · list · record · home · search · reports (+dashboards) · setup · settings
  js/apps/         agentforce · sales · service · marketing · commerce · datacloud · tableau · slack · mulesoft · fieldservice
  js/boot.js       DB.boot(saved org) → Shell.start()
tools/test.js      smoke test: every route, fails on any console error   (npm test)
tools/clicks.js    clicks through real tasks (create/edit/delete, drag, merge + undo,
                   checkout, API calls…); --ai adds the typed-in AI steps (npm run clicks)
tools/ai-sweep.js  presses every ✨ button on every page with the AI that's set up,
                   reports failed calls and error cards; --shard i/n      (npm run ai-sweep)
tools/shot.js      screenshots → docs/screenshots                         (npm run shot)
tools/icon.js      app icon + menu-bar template image                     (npm run icons)
```

## Routes

| Hash | Shows |
|---|---|
| `#/app/<appId>` | the app's first tab |
| `#/app/<appId>/<Object>` | list view (`?view=n`, `?mode=kanban`) |
| `#/app/<appId>/<pageId>` | a registered page, `Pages[pageId]` |
| `#/app/<appId>/home` · `reports` · `dashboards` | built-in tabs |
| `#/r/<recordId>` | record page (the app stays the same) |
| `#/report/<id>` · `#/dashboard/<id>` | one report or dashboard |
| `#/search?q=…` · `#/setup/<section>` · `#/settings` | search, Setup, Settings |

An app's tabs live in `APPS` (core/schema.js). `page:<id>` means a page registered in `Pages`.

## Adding a page

```js
Pages.forecast = {
  title: 'Forecast', icon: '📈',
  live: true,              // default: redraw when data changes. false = never redraw (chat UIs, editors)
  render: (ctx) => h('div.page', …),
};
```

`ctx` = `{ app, appId, tab, parts, params, route, set(patch, replace) }`. Keep page state in the URL with `ctx.set({ f: 'x' })` (it pushes history and redraws). Keep per-page memory in a closure object (`const st = {}`) for things that shouldn't be in the URL, such as drafts or the AI output on screen.

**Redraws:** any DB change triggers a debounced `Shell.render()`. It is skipped while a modal or menu is open, or while an input inside `#main` has focus, and runs later. So pages are functions of state: build them fresh each time and never hold DOM between renders. Use `data-scroll="key"` on inner scrolling areas so they keep their scroll position. An AI answer can arrive after a redraw: in an `Einstein.button` callback, save the result to state first, then fill the element that's on screen now (`$(sel)`), not one captured when the page was built.

Every page starts with the same header:

```js
h('div.page',
  h('header.pagehead', h('span.objicon', { style: { background: ctx.app.color } }, '📈'),
    h('div', h('div.eyebrow', ctx.app.name), h('h1', 'Forecast')), h('div.grow'), …buttons),
  …)
```

Record pages are extended, not edited: `Record.extend('Case' | '*', { actions, tabs, side, top })` (see the top of views/record.js).

## Globals you can use

- **DOM:** `h('tag.class#id', {attrs, onclick, style:{}, dataset:{}}, ...kids)`, `svg(...)`, `$(sel, root)`, `$$(sel, root)`. null/false kids are skipped, and arrays are flattened. The DOM's own `append`/`replaceChildren` behave the same way.
- **Text:** `esc`, `md(text)` (tiny markdown for AI replies; `[[recordId]]` becomes a record link). Never use `innerHTML`; `md()` is the only HTML door, and it escapes first.
- **Numbers/dates:** `fmt.money/short/num/pct/date/dateShort/time/datetime/ago`, `today()`, `addDays(day, n)`, `daysBetween(a, b)`, `quarterOf`, `monthOf`, `DAY`, `sum(arr, fn)`, `groupBy(arr, fn)`, `uniq`, `clamp`, `debounce`, `initials`, `rng(seed)`.
- **UI:** `UI.toast(msg, 'ok'|'err'|'ai'|'info', {label, run})`, `UI.modal({title, body, actions:[{label, primary, danger, run}], wide})`, `UI.confirm(title, detail, label)` → Promise<boolean>, `UI.menu(anchor, [{label, icon, danger, run} | '-'])`, `UI.tabs([{id,label,count,render}], key)`, `UI.card(title, body, {icon, count, actions, className})`, `UI.badge(text, color)`, `UI.avatar(name, size)`, `UI.icon(obj, size)`, `UI.copy(text)`, `UI.empty(icon, title, detail, action)`, `UI.spinner(label)`, `UI.stat(label, value, sub, color)`, `UI.open(url)`.
- **Data (`DB`):**
  - Records: `all(obj)`, `get(id)`, `name(id)`, `objectOf(id)`, `meta(obj)`, `query(obj, {filters:[[field, op, value]], sort, dir, limit, q})`, `search(q)`, `related(id)`, `activity(id)`, `insert(obj, data)`, `update(id, patch)`, `remove(id)`, `display(obj, field, value)`, `merge(text, rec)`.
  - Chatter and Slack: `post(parentId, text)`, `slackPost(channel, text, userId, {recordId, thread})`, `channel(idOrName)`.
  - Org and config: `me()`, `org()` for raw collections such as `org().events/sources/insights/streams/apis/runs/workbooks/metrics/cart/slack/agentLog`, `cfg.list/get/add/update/remove(kind, …)` for reports/dashboards/flows/prompts/agents, `runReport(r)`, `aggregate`, `uid(prefix)`, `save()`, `on(fn)`.
  - Read `core/seed.js` to see the exact shape of every collection.
- **Scores:** `Predict.lead/win/sentiment/caseRisk/health` are rule-based, need no AI, and return a score plus reasons. `scoreColor(n)`.
- **Charts:** `Charts.draw('bar'|'hbar'|'line'|'area'|'donut'|'pie'|'funnel'|'gauge'|'stacked'|'spark', data, {format, goal, …})` returns an `<svg>`; data is `[{label, value}]`. Also `Charts.fromReport(res, type)` and `Charts.color(i)`.
- **Formulas:** `Formula.evaluate(expr, rec, obj)`.
- **Shell:** `Shell.go(hash)`, `Shell.render()`, `Shell.current()`, `Shell.app()`, `Shell.togglePanel(true)`, `Shell.objUrl(obj, params)` (list URL for an object).
- **Agentforce:** `Agentforce.run(text, {agentId, msgs, context})` returns `{text, steps, undo, out}`. `Agentforce.chatUI({wide})` and `Agentforce.ACTIONS` are also available.

## ✨ AI everywhere — the rule

Every app has AI wherever it saves someone time: summaries, drafts, explanations, "build it from words", and anomaly call-outs. Stratus works with whichever AI the user picked in Settings and says the provider's name (`Einstein.word()` is "Claude", "ChatGPT", "Gemini"…). The app must still work fully with AI off: rule-based scores, insights and charts never need it.

```js
// A card with a Generate button. Its result survives redraws (keyed) and it shows setup help when AI is off.
Einstein.card({ key: 'forecast-' + userId, title: 'Forecast call', intro: 'What will land this quarter, and what is at risk.',
  label: 'Explain', ask: () => ({ task: 'forecast', prompt: '…' + Einstein.listContext('Opportunity', rows) ,
    schema: Einstein.S.obj({ summary: Einstein.S.str('2–3 sentences'), risks: Einstein.S.arr(Einstein.S.str()) }) }),
  render: (r) => h('div', md(r.summary), h('ul', r.risks.map((x) => h('li', x)))) })

// Or by hand:
const r = await Einstein.ask({ task: 'my-task', prompt, schema });   // → the parsed object, plus r.meta {model, ms, word}
Einstein.button('✨ Draft reply', () => askArgs, (r) => …)          // a one-off button with a spinner
```

- Always pass a `schema` (built with `Einstein.S.obj/str/num/bool/oneOf/arr`), so every provider returns JSON.
- Use a clear `task` name; it shows in Agent Log and the AI Audit Trail.
- Feed context with `Einstein.recordContext(id)`, `listContext(obj, rows, fields)` and `orgContext()`. The Trust Layer masks emails and phone numbers automatically.
- AI never changes data on its own. It drafts, the user clicks to apply, and changes are undoable where practical.
- AI buttons use `button.btn.ai` and a ✨. AI output sits in `.ai-card` or a `.ai-*` box with the provider name in an `.ai-foot`.

## CSS conventions

Use tokens, never raw colors, so dark mode works: `--bg --card --card-2 --line --line-2 --ink --ink-2 --muted --accent --accent-soft --ai --ai-soft --ai-grad --ok --warn --bad` (+ `-soft`), `--r` (radius), `--shadow`. An app's own color is `ctx.app.color`, and the nav sets `--app`. Prefix each app's classes (`.fc-`, `.cs-`, `.sf-`, `.dc-`…) to avoid clashes. The generic `.wide` class spans grid columns, so don't reuse it as a modifier. Reuse `.page`, `.pagehead`, `.card`, `.cardgrid`, `.kpis`, `.stat`, `table.grid`, `.chip`, `.badge`, `.seg` and `.btn` before adding new ones.

## Rules

- No network from the renderer (CSP `connect-src 'none'`). AI goes through `window.host.aiAsk` and links through `UI.open`.
- No `eval`, `new Function` or `innerHTML`.
- Fictional data only. No real company names or Salesforce logos. Product names describe what a page does the way Salesforce does it, and the About page says Stratus isn't affiliated with Salesforce.
- `npm test` and `npm run clicks` must pass, with no console errors on any route. Run `npm run clicks -- --ai` and `npm run ai-sweep` after AI changes.
