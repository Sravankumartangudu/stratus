# Changelog

## 1.0.0 — 2026-10-17

First release.

- **Ten apps on one demo org (Brightwave Energy):** Sales, Service, Marketing, Commerce, Agentforce, Data Cloud, Tableau, Slack, MuleSoft and Field Service.
- **CRM core:**
  - Create, edit and delete records, with a Recycle Bin.
  - List views with filters and "✨ filter in plain words".
  - Kanban boards and record pages with path, related lists, activity, Chatter and history.
  - Lead convert, quotes, forecasts with manager adjustments, and a calendar.
  - Global search, the App Launcher and "log in as another user".
- **Reports and dashboards:** a builder, charts, dashboards from report widgets, and "✨ build it from a sentence".
- **Setup:**
  - Object Manager with custom objects, fields and formulas.
  - Flow Builder and Flow Runs, plus users.
  - The Einstein Trust Layer (masking and audit) and an AI Audit Trail.
  - Data import and export, and a demo-org reset.
- **AI picker:** Claude Code, the Claude API, ChatGPT, Gemini, OpenRouter, Ollama or any OpenAI-compatible server.
  - Keys are encrypted in the Keychain.
  - Every ✨ uses the provider's name.
  - The app works fully with AI off.
- **Agentforce:** acts on records with undo. Also includes Agent Builder, Prompt Builder and an Agent Log.
- **Look and feel:** System, Light and Dark appearance (default System), and a ☁️ menu-bar icon.
- **Tests:**
  - `npm test` opens all 115 routes.
  - `npm run clicks` covers real tasks, and `--ai` adds the live-AI steps.
  - `npm run ai-sweep` presses every ✨ button with the real AI.
