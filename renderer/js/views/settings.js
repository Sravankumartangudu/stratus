// settings.js — Settings: Appearance, the AI picker (Claude Code, Claude API, ChatGPT, Gemini,
// OpenRouter, Ollama or any OpenAI-compatible server — one powers every ✨ in the app), data and about.
// Keys go to the main process, which keeps them in the macOS Keychain-backed safe storage; the page only
// ever learns whether a key is set.

(() => {
  const ICONS = { 'claude-code': '🟧', anthropic: '🅰️', openai: '🟢', gemini: '🔷', openrouter: '🔀', ollama: '🦙', compatible: '🔌' };
  const FEATURES = ['Record summaries & next best actions', 'Email drafts & replies', 'List filters from plain words', 'Report & dashboard builder',
    'Daily briefings', 'Formula & flow builder', 'Agentforce agents', 'Data Cloud segments', 'Tableau Pulse insights', 'Slack recaps', 'MuleSoft mappings'];

  async function apply(patch) {
    const ai = await window.host.aiConfigure(patch);
    Shell.setSettings(Object.assign({}, Shell.settings(), { ai }));
    Einstein.setState(ai);
    return ai;
  }

  function providerCard(p, ai) {
    const on = ai.current === p.id;
    const body = h('div.pv-body');
    if (on) {
      const rows = [];
      if (p.key !== 'none') {
        const key = h('input', { type: 'password', placeholder: p.hasKey ? '•••••••• saved — paste to replace' : p.key === 'optional' ? 'API key (if the server needs one)' : 'Paste your API key' });
        rows.push(h('label', 'API key', h('div.row', key,
          h('button.btn.sm', { onclick: async () => { if (!key.value.trim()) return key.focus(); await apply({ key: { id: p.id, value: key.value.trim() } }); UI.toast('Key saved'); Shell.render(); } }, 'Save'),
          p.hasKey ? h('button.btn.sm.ghost', { onclick: async () => { await apply({ key: { id: p.id, value: '' } }); UI.toast('Key removed'); Shell.render(); } }, 'Remove') : null),
        p.help ? h('small', h('a', { href: '#', onclick: (e) => { e.preventDefault(); UI.open(p.help); } }, 'Get a key ↗')) : null));
      }
      if (['ollama', 'compatible'].includes(p.id)) {
        const base = h('input', { value: p.base || p.defaultBase || '', placeholder: p.defaultBase });
        rows.push(h('label', 'Server address', h('div.row', base, h('button.btn.sm', { onclick: async () => { await apply({ base: { id: p.id, value: base.value.trim() } }); UI.toast('Address saved'); Shell.render(); } }, 'Save'))));
      }
      const models = p.models || [];
      const msel = h('select', { onchange: async (e) => { await apply({ model: { id: p.id, value: e.target.value } }); UI.toast('Model set'); } },
        models.map(([v, l]) => h('option', { value: v, selected: v === p.model }, l)), !models.length ? h('option', { value: '' }, 'No models yet — press ↻') : null);
      const custom = h('input', { placeholder: 'or type a model id', onkeydown: async (e) => { if (e.key === 'Enter' && e.target.value.trim()) { await apply({ model: { id: p.id, value: e.target.value.trim() } }); UI.toast('Model set'); Shell.render(); } } });
      const refresh = h('button.iconbtn', { title: 'Fetch the latest model list', onclick: async () => {
        refresh.disabled = true; refresh.replaceChildren(h('span.spinner.sm'));
        const s = await window.host.aiModels(p.id);
        Shell.setSettings(Object.assign({}, Shell.settings(), { ai: s })); Einstein.setState(s);
        const q = s.providers.find((x) => x.id === p.id);
        UI.toast(q && q.modelsErr ? q.modelsErr : `${(q && q.models.length) || 0} models`, q && q.modelsErr ? 'err' : 'ok');
        Shell.render();
      } }, '↻');
      rows.push(h('label', 'Model', h('div.row', msel, p.id !== 'claude-code' ? refresh : null), p.id !== 'claude-code' ? custom : null,
        p.modelsAt ? h('small.muted', `List updated ${fmt.ago(p.modelsAt)}`) : null, p.modelsErr ? h('small.err', p.modelsErr) : null));
      const out = h('div.pv-test');
      rows.push(h('div.row', h('button.btn.ai', { onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; out.replaceChildren(UI.spinner('Asking…'));
        try {
          const r = await Einstein.ask({ task: 'test', prompt: 'Reply with one short friendly sentence confirming you are connected to Stratus, and name the model you are.' });
          out.replaceChildren(h('div.ok', '✓ ', r.text), h('small.muted', `${r.meta.model} · ${(r.meta.ms / 1000).toFixed(1)}s`));
        } catch (err) { out.replaceChildren(h('div.err', '✗ ' + err.message)); }
        b.disabled = false;
      } }, '✨ Test it'), out));
      if (p.id === 'claude-code') rows.unshift(h('p.muted.sm', ai.claudeInstalled === false ? "Claude Code isn't installed on this Mac. Install it from claude.com/claude-code, sign in once, then come back." : 'Uses the Claude Code app already signed in on this Mac — no key needed.'));
      if (p.id === 'ollama') rows.unshift(h('p.muted.sm', 'Runs models on this Mac for free. Install Ollama, run `ollama pull llama3.2`, then press ↻.'));
      body.append(...rows);
    }
    return h(`div.pvcard${on ? '.on' : ''}`,
      h('button.pv-head', { onclick: async () => { if (!on) { await apply({ provider: p.id }); UI.toast(`${p.name} selected`, 'ai'); Shell.render(); } } },
        h('span.pv-ic', ICONS[p.id] || '🤖'), h('div.grow', h('b', p.name), h('small', on ? (ai.problem ? '⚠️ ' + ai.problem : `✓ In use · ${p.model}`) : p.key === 'required' ? (p.hasKey ? 'Key saved' : 'Needs an API key') : p.id === 'claude-code' ? (ai.claudeInstalled ? 'Installed' : 'Not found on this Mac') : 'No key needed')),
        h('span.radio' + (on ? '.on' : ''))),
      on ? body : null);
  }

  // The 14 style cards (FleetStyles.picker, js/core/fleet-styles.js); a pick here or in the tray menu shows in both.
  function styleGrid(s) {
    const box = h('div.st-grid');
    FleetStyles.picker(box, s.styles || [], s.uiStyle || 'standard', async (id) => {
      const ns = await window.host.setStyle(id);
      Shell.setSettings(Object.assign({}, Shell.settings(), ns));
    });
    return box;
  }

  Views.settings = (ctx) => {
    const s = Shell.settings() || {};
    const ai = s.ai || Einstein.state();
    const appearance = s.appearance || 'system';
    const providers = ai.providers || [];
    return h('div.page.settingspage', { dataset: { scroll: 'settings' } },
      h('header.pagehead', h('span.objicon', { style: { width: '40px', height: '40px', background: '#5a6b7f' } }, '⚙︎'), h('div', h('div.eyebrow', 'Stratus'), h('h1', 'Settings')), h('div.grow'),
        h('a.btn', { href: '#/setup/home' }, 'Open Setup')),

      UI.card('Appearance', h('div.seg.wide', [['system', '🖥 System'], ['light', '☀️ Light'], ['dark', '🌙 Dark']].map(([v, l]) => h(`button${appearance === v ? '.on' : ''}`, {
        onclick: async () => { const ns = await window.host.setAppearance(v); Shell.setSettings(Object.assign({}, Shell.settings(), ns)); Shell.render(); },
      }, l))), { icon: '🌗' }),

      UI.card('Style', h('div',
        h('p.muted', 'The design Stratus wears. Every style has a light and a dark look.'),
        styleGrid(s),
        s.styleFleet ? h('p.muted.sm', 'It can also be picked in the common settings (🎨 Style per App); both always show the same one.') : null), { icon: '🎨' }),

      UI.card('AI — Einstein & Agentforce', h('div',
        h('p.muted', 'Pick the AI that powers every ✨ in Stratus. Switch any time — nothing else changes.'),
        h(`div.ai-status${ai.problem ? '.warn' : '.ok'}`, ai.problem ? '⚠️ ' + ai.problem : `✓ ${ai.label} is on`),
        h('div.pvlist', providers.map((p) => providerCard(p, ai)),
          h(`div.pvcard${ai.current === 'off' ? '.on' : ''}`, h('button.pv-head', { onclick: async () => { await apply({ provider: 'off' }); UI.toast('AI turned off'); Shell.render(); } },
            h('span.pv-ic', '⭘'), h('div.grow', h('b', 'Off'), h('small', 'No AI. Rule-based insights and scores still work.')), h('span.radio' + (ai.current === 'off' ? '.on' : ''))))),
        h('details.features', h('summary', 'Where AI shows up'), h('ul', FEATURES.map((f) => h('li', '✨ ' + f)))),
        h('p.muted.sm', 'The Einstein Trust Layer masks emails and phone numbers before a prompt leaves the app. ', h('a', { href: '#/setup/trust' }, 'Trust Layer settings'))), { icon: '✨' }),

      UI.card('Data', h('div', h('p.muted', 'Brightwave Energy is a made-up company — every record is demo data stored on this Mac.'),
        h('div.btnrow', h('a.btn', { href: '#/setup/data' }, 'Export or reset data'), h('a.btn', { href: '#/setup/bin' }, 'Recycle Bin'))), { icon: '💾' }),

      UI.card('About', h('div',
        h('p', h('b', `Stratus ${s.version || ''}`), ' — a CRM that works the way Salesforce does: Sales, Service, Marketing, Commerce, Agentforce, Data Cloud, Tableau, Slack, MuleSoft and Field Service in one app, with the AI of your choice.'),
        h('p.muted.sm', 'An independent learning project. Not affiliated with or endorsed by Salesforce, Inc. MIT licensed.'),
        h('div.btnrow', h('button.btn', { onclick: () => UI.open('https://github.com/Sravankumartangudu/stratus') }, 'GitHub ↗'),
          h('button.btn', { onclick: () => UI.open('https://github.com/Sravankumartangudu/stratus/releases') }, 'Releases ↗'))), { icon: '☁️' }));
  };
})();
