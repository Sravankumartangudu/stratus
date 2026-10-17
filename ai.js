// ai.js — the AI behind Einstein and Agentforce, for whichever provider you pick in Settings.
//
// Two kinds of provider: the local Claude Code CLI (no key, uses your own Claude sign-in) and HTTP APIs —
// Anthropic, OpenAI (ChatGPT), Google Gemini, OpenRouter, Ollama on this Mac and any OpenAI-compatible
// server. Keys are encrypted with Electron safeStorage (a Keychain-held key), never stored in plain text.
// Model lists come live from each provider, with a built-in list for when you're offline.
//
// Every call asks for one JSON object matching a schema, so every feature gets a reply it can use.

const { safeStorage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROVIDERS = [
  { id: 'claude-code', name: 'Claude Code (installed app)', word: 'Claude', key: 'none', base: '',
    help: 'https://claude.com/claude-code',
    fallback: [['sonnet', 'Sonnet'], ['haiku', 'Haiku · fast'], ['opus', 'Opus · best']] },
  { id: 'anthropic', name: 'Anthropic · Claude API', word: 'Claude', key: 'required', base: '',
    help: 'https://console.anthropic.com/settings/keys',
    fallback: [['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['claude-opus-5-5', 'Claude Opus 5.5'],
      ['claude-fable-5-1', 'Claude Fable 5.1'], ['claude-haiku-4-5', 'Claude Haiku 4.5']] },
  { id: 'openai', name: 'OpenAI · ChatGPT', word: 'GPT', key: 'required', base: '',
    help: 'https://platform.openai.com/api-keys', fallback: [['gpt-5', 'GPT-5'], ['gpt-5-mini', 'GPT-5 mini']] },
  { id: 'gemini', name: 'Google Gemini', word: 'Gemini', key: 'required', base: '',
    help: 'https://aistudio.google.com/apikey',
    fallback: [['gemini-2.5-flash', 'Gemini 2.5 Flash'], ['gemini-2.5-pro', 'Gemini 2.5 Pro']] },
  { id: 'openrouter', name: 'OpenRouter · many models, one key', word: 'AI', key: 'required', base: '',
    help: 'https://openrouter.ai/keys', fallback: [['openrouter/auto', 'Auto · OpenRouter picks']] },
  { id: 'ollama', name: 'Ollama · on this Mac, free', word: 'AI', key: 'none', base: 'http://localhost:11434',
    help: 'https://ollama.com/download', fallback: [] },
  { id: 'compatible', name: 'OpenAI-compatible (LM Studio, Groq, Mistral…)', word: 'AI', key: 'optional',
    base: 'http://localhost:1234/v1', help: '', fallback: [] },
];

const SHELL_PATH = 'export PATH="$HOME/.local/bin:$HOME/.devbar/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"';

let dir = '';            // app data folder
let settings = null;     // shared settings object from main.js (ai.provider, ai.models, ai.bases)
let save = () => {};
let keys = {};           // provider id -> encrypted key (base64)
let cache = {};          // provider id -> { at, models: [[id, label]] }
let modelErrors = {};
let claudeInstalled = null;

function init(opts) {
  dir = opts.dir; settings = opts.settings; save = opts.save;
  settings.ai = Object.assign({ provider: '', models: {}, bases: {} }, settings.ai || {});
  keys = readJSON(path.join(dir, 'keys.json')) || {};
  cache = readJSON(path.join(dir, 'models.json')) || {};
  detectClaude();
}

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
function writeJSON(f, v, mode) {
  fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2), { mode: mode || 0o644 });
  fs.renameSync(f + '.tmp', f);
}

function detectClaude() {
  const p = spawn('/bin/zsh', ['-lc', `${SHELL_PATH}; command -v claude >/dev/null`], { stdio: 'ignore' });
  p.on('exit', (code) => { claudeInstalled = code === 0; });
  p.on('error', () => { claudeInstalled = false; });
}

// ---------- which provider, model, key ----------

const provider = (id) => PROVIDERS.find((p) => p.id === id);

function current() {
  const p = provider(settings.ai.provider);
  if (p) return p;
  if (settings.ai.provider === 'off') return null;
  return claudeInstalled ? provider('claude-code') : null; // first run: Claude Code if it's here, else off until picked
}

function modelOptions(p) {
  const opts = p.id === 'claude-code' ? p.fallback.slice() : ((cache[p.id] && cache[p.id].models) || p.fallback).slice();
  const chosen = settings.ai.models[p.id];
  if (chosen && !opts.some((o) => o[0] === chosen)) opts.unshift([chosen, chosen]);
  return opts;
}
function model(p) {
  const m = settings.ai.models[p.id];
  if (m) return m;
  const opts = modelOptions(p);
  if (p.fallback[0] && opts.some((o) => o[0] === p.fallback[0][0])) return p.fallback[0][0];
  return opts[0] ? opts[0][0] : '';
}
function base(p) {
  const b = (settings.ai.bases[p.id] || '').trim();
  return (b || p.base).replace(/\/+$/, '');
}

function key(p) {
  const enc = keys[p.id];
  if (!enc) return '';
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch (_) { return ''; }
}
function setKey(id, value) {
  const v = (value || '').trim();
  if (!v) delete keys[id];
  else if (safeStorage.isEncryptionAvailable()) keys[id] = safeStorage.encryptString(v).toString('base64');
  else throw new Error("This Mac's Keychain isn't available, so the key can't be saved safely.");
  writeJSON(path.join(dir, 'keys.json'), keys, 0o600);
}

// Why the current provider can't run yet, or '' when it's ready.
function problem(p) {
  if (!p) return 'Pick an AI in Settings › AI to turn on Einstein and Agentforce.';
  if (p.key === 'required' && !key(p)) return `Add your ${p.name.split(' ·')[0]} key in Settings › AI.`;
  if (p.id === 'claude-code' && claudeInstalled === false) return "Claude Code isn't installed. Install it, or pick another AI in Settings.";
  if (p.id === 'ollama' && !model(p)) return 'No Ollama model yet. Start Ollama, run `ollama pull llama3.2`, then press ↻ in Settings.';
  if (p.id === 'compatible' && !base(p)) return 'Add the server address in Settings › AI.';
  if (p.id === 'compatible' && !model(p)) return 'Pick or type a model in Settings › AI.';
  return '';
}

// What the Settings page shows.
function state() {
  const p = current();
  return {
    current: p ? p.id : 'off',
    word: p ? p.word : 'AI',
    label: p ? `${p.word} · ${model(p)}` : 'AI off',
    problem: problem(p),
    claudeInstalled,
    providers: PROVIDERS.map((q) => ({
      id: q.id, name: q.name, key: q.key, help: q.help, defaultBase: q.base,
      hasKey: !!keys[q.id], base: settings.ai.bases[q.id] || '', model: model(q), models: modelOptions(q),
      modelsAt: (cache[q.id] && cache[q.id].at) || '', modelsErr: modelErrors[q.id] || '',
    })),
  };
}

function configure(patch) {
  if ('provider' in patch) settings.ai.provider = patch.provider;
  if (patch.model) settings.ai.models[patch.model.id] = patch.model.value;
  if (patch.base) settings.ai.bases[patch.base.id] = patch.base.value;
  if (patch.key) setKey(patch.key.id, patch.key.value);
  save();
  return state();
}

// ---------- live model lists ----------

async function refreshModels(id) {
  const p = provider(id);
  if (!p || p.id === 'claude-code') return state();
  const k = key(p), b = base(p);
  let url, headers = {};
  switch (p.id) {
    case 'anthropic': url = 'https://api.anthropic.com/v1/models?limit=100'; headers = { 'x-api-key': k, 'anthropic-version': '2023-06-01' }; break;
    case 'openai': url = 'https://api.openai.com/v1/models'; headers = { Authorization: 'Bearer ' + k }; break;
    case 'gemini': url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200'; headers = { 'x-goog-api-key': k }; break;
    case 'openrouter': url = 'https://openrouter.ai/api/v1/models'; break;
    case 'ollama': url = b + '/api/tags'; break;
    default: url = b + '/models'; if (k) headers = { Authorization: 'Bearer ' + k };
  }
  try {
    const j = await send(url, headers, null, 30);
    const rows = j.data || j.models || [];
    let list = [];
    if (p.id === 'anthropic') list = rows.map((r) => [r.id, r.display_name || r.id]);
    else if (p.id === 'openai') list = rows.map((r) => r.id).filter((m) => /^(gpt|o\d|chatgpt)/.test(m) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(m)).sort().reverse().map((m) => [m, m]);
    else if (p.id === 'gemini') list = rows.filter((r) => (r.supportedGenerationMethods || []).includes('generateContent')).map((r) => [r.name.replace('models/', ''), r.displayName || r.name]);
    else if (p.id === 'openrouter') list = rows.map((r) => [r.id, r.name || r.id]);
    else if (p.id === 'ollama') list = rows.map((r) => [r.name, r.name]);
    else list = rows.map((r) => [r.id, r.id]);
    if (!list.length) throw new Error('No models came back.');
    cache[p.id] = { at: new Date().toISOString(), models: list };
    delete modelErrors[p.id];
    writeJSON(path.join(dir, 'models.json'), cache);
  } catch (e) {
    modelErrors[p.id] = e.message;
  }
  return state();
}

// ---------- calls ----------

const TEXT_SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };

function parse(text) {
  let t = (text || '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch (_) { return null; }
}
const badShape = () => new Error("The AI's reply wasn't in the expected shape. Try again, or pick a bigger model in Settings.");

// The one entry point: { system, prompt, schema? } → parsed object. No schema → { text }.
async function ask({ system, prompt, schema }) {
  const p = current();
  const why = problem(p);
  if (why) throw new Error(why);
  const sch = schema || TEXT_SCHEMA;
  const started = Date.now();
  const out = p.id === 'claude-code' ? await runCLI(p, system, sch, prompt) : await call(p, system, sch, prompt);
  return { result: out, meta: { provider: p.id, word: p.word, model: model(p), ms: Date.now() - started } };
}

async function call(p, system, schema, prompt) {
  const m = model(p), k = key(p), b = base(p);
  const jsonNote = '\n\nReply with only one JSON object (no prose, no code fences) that matches this JSON schema:\n' + JSON.stringify(schema);
  const pick = (text) => { const o = parse(text); if (!o) throw badShape(); return o; };

  if (p.id === 'anthropic') {
    const body = { model: m, max_tokens: 8192, system, messages: [{ role: 'user', content: prompt }],
      tools: [{ name: 'reply', description: 'Return your reply.', input_schema: schema }], tool_choice: { type: 'tool', name: 'reply' } };
    const j = await send('https://api.anthropic.com/v1/messages', { 'x-api-key': k, 'anthropic-version': '2023-06-01' }, body);
    const blocks = j.content || [];
    const tool = blocks.find((x) => x.type === 'tool_use');
    if (tool && tool.input) return tool.input;
    return pick(blocks.map((x) => x.text || '').join(''));
  }
  if (p.id === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
    const body = (strict) => ({
      systemInstruction: { parts: [{ text: strict ? system : system + jsonNote }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: Object.assign({ responseMimeType: 'application/json' }, strict ? { responseJsonSchema: schema } : {}),
    });
    const text = (j) => (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map((x) => x.text || '').join('');
    try { return pick(text(await send(url, { 'x-goog-api-key': k }, body(true)))); } catch (e) {
      if (e.status !== 400) throw e;
      return pick(text(await send(url, { 'x-goog-api-key': k }, body(false)))); // older models don't take a schema
    }
  }
  if (p.id === 'ollama') {
    const body = { model: m, stream: false, format: schema, options: { temperature: 0.3 },
      messages: [{ role: 'system', content: system + jsonNote }, { role: 'user', content: prompt }] };
    const j = await send((b || 'http://localhost:11434') + '/api/chat', {}, body, 300);
    return pick((j.message || {}).content);
  }
  // OpenAI, OpenRouter and OpenAI-compatible servers share the chat completions API.
  const root = p.id === 'openai' ? 'https://api.openai.com/v1' : p.id === 'openrouter' ? 'https://openrouter.ai/api/v1' : b;
  const h = k ? { Authorization: 'Bearer ' + k } : {};
  if (p.id === 'openrouter') Object.assign(h, { 'HTTP-Referer': 'https://github.com/Sravankumartangudu/stratus', 'X-Title': 'Stratus' });
  // Strict schema first; servers that don't support it get "JSON please", then plain text.
  for (let mode = 0; mode < 3; mode++) {
    const body = { model: m, messages: [{ role: 'system', content: mode === 0 ? system : system + jsonNote }, { role: 'user', content: prompt }] };
    if (mode === 0) body.response_format = { type: 'json_schema', json_schema: { name: 'reply', schema, strict: false } };
    if (mode === 1) body.response_format = { type: 'json_object' };
    try {
      const j = await send(root + '/chat/completions', h, body, p.id === 'compatible' ? 300 : 150);
      return pick((((j.choices || [])[0] || {}).message || {}).content);
    } catch (e) {
      if (![400, 422].includes(e.status) || mode === 2) throw e;
    }
  }
  throw badShape();
}

async function send(url, headers, body, timeout = 150) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout * 1000);
  let res;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET', signal: ctl.signal,
      headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const host = (() => { try { return new URL(url).host; } catch (_) { return 'the server'; } })();
    throw new Error(e.name === 'AbortError' ? `${host} took too long to answer.` : `Couldn't reach ${host}. Are you online, and is the address right?`);
  } finally { clearTimeout(t); }
  let j = null;
  try { j = await res.json(); } catch (_) {}
  if (res.ok && j) return j;
  let msg = (j && ((j.error && (j.error.message || j.error)) || j.message)) || '';
  if (typeof msg !== 'string') msg = JSON.stringify(msg);
  if (!msg) msg = { 401: 'The key was refused. Check it in Settings › AI.', 403: 'The key was refused. Check it in Settings › AI.',
    404: 'Not found — the model or address may be wrong.', 429: 'Rate limit or quota reached. Wait a bit, or check your plan.' }[res.status] || `The AI service answered ${res.status}.`;
  else if ([401, 403].includes(res.status)) msg = 'The key was refused: ' + msg;
  const err = new Error(msg.slice(0, 300));
  err.status = res.status;
  throw err;
}

// ---------- Claude Code (the local CLI) ----------

// Copies only the auth keys from ~/.claude/settings.json: user settings are skipped
// (`--setting-sources project`) so no allow-list, hook or plugin from them can ride along.
function authSettings() {
  const out = path.join(dir, 'auth-settings.json');
  const auth = { enabledPlugins: {} };
  const all = readJSON(path.join(os.homedir(), '.claude', 'settings.json')) || {};
  for (const k of ['apiKeyHelper', 'env', 'awsAuthRefresh', 'awsCredentialExport', 'forceLoginMethod']) if (k in all) auth[k] = all[k];
  writeJSON(out, auth, 0o600);
  return out;
}

function runCLI(p, system, schema, prompt) {
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--disable-slash-commands',
    '--setting-sources', 'project', '--strict-mcp-config', '--tools', '', '--settings', authSettings(),
    '--append-system-prompt', system, '--json-schema', JSON.stringify(schema), '--model', model(p), prompt];
  const env = Object.assign({}, process.env, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/zsh', ['-lc', `${SHELL_PATH}; exec claude "$@"`, 'stratus', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    child.stdout.on('data', (d) => { o += d; });
    child.stderr.on('data', (d) => { e += d; });
    // claude traps SIGTERM and exits 143 rather than by signal, so remember that we stopped it.
    let timedOut = false;
    const killer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 180000);
    child.on('error', (err) => { clearTimeout(killer); reject(new Error("Couldn't start Claude: " + err.message)); });
    child.on('exit', (code, signal) => {
      clearTimeout(killer);
      let obj = null;
      try { obj = JSON.parse(o); } catch (_) {}
      if (obj && obj.structured_output) return resolve(obj.structured_output);
      if (obj && typeof obj.result === 'string') { const parsed = parse(obj.result); if (parsed && !obj.is_error) return resolve(parsed); }
      let msg = ((obj && obj.result) || e || '').trim();
      if (signal || timedOut) msg = 'Claude took over 3 minutes, so Stratus stopped waiting. Try again; most answers take seconds.';
      reject(new Error(msg ? msg.slice(-300) : `Claude returned nothing (exit ${code}).`));
    });
  });
}

module.exports = { init, state, configure, refreshModels, ask, current };
