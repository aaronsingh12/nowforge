# NowForge Architecture

```
client (React + Vite :5173)
  ├── pages: Dashboard · AgentChat · Incidents · Catalog · Flows · Settings
  ├── ReferenceField / TableField — debounced typeahead against /api/system
  └── SSE reader for agent streams (POST body → event stream)
        │  /api proxy
        ▼
server (Node 22 + Express :4000)
  ├── routes/        system · incidents · catalog · flows · agent
  ├── servicenow/
  │     client.js    auth (basic / OAuth password grant + token cache), Table API,
  │                  Aggregate API, error normalization (SnowError)
  │     schema.js    hierarchy walk (sys_db_object.super_class) → merged sys_dictionary
  │                  + sys_choice; display-field detection; reference & table lookups
  │     catalog.js   items / variables / choices / sets / guides / producers + composite
  │     flows.js     sys_hub_* reads, executions, activate; blueprint (LLM);
  │                  blueprint → Business Rule fallback (created inactive)
  ├── agent/
  │     orchestrator.js  session store, agent loop (≤15 iters/turn), approval gate
  │                      (mutating tools await user decision, 5-min timeout), SSE events
  │     tools.js         15-tool registry with `mutating` flags
  │     prompts.js       system prompt: schema-first, never invent sys_ids, report sys_ids
  │     providers/       anthropic.js · openaiCompat.js (OpenAI + Ollama) · index.js factory
  └── config/store.js    local settings.json (connection + llm + agent), secret redaction
        │
        ▼
ServiceNow PDI  ←— REST Table/Aggregate/OAuth endpoints
LLM provider    ←— Anthropic Messages API | OpenAI-compatible /chat/completions
```

## Claude Code concept mapping

| Claude Code | NowForge |
|---|---|
| Tool registry + JSON schemas | `agent/tools.js` (`inputSchema`, `execute`) |
| Permission prompts before edits | Amber approval gate on `mutating` tools |
| Provider-agnostic model layer | Neutral history format + per-provider adapters |
| Streaming progress in terminal | SSE event stream rendered as tool/approval cards |
| CLAUDE.md system guidance | `agent/prompts.js` operating rules |

## Adding a tool

1. Append to `TOOLS` in `server/src/agent/tools.js`: name, description (written for the model), `inputSchema`, `mutating`, `execute(input)`.
2. That's it — the orchestrator, approval gate, and chat UI pick it up automatically.

## Adding a provider

Create `agent/providers/yourprovider.js` exporting `chat({system, history, tools, ...}) → {text, toolCalls, stopReason}` translating the neutral history, then register it in `providers/index.js` and the Settings page select.
