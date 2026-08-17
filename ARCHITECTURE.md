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
  │     flows.js     sys_hub_flow reads (flows + subflows), _v2 part tables with
  │                  legacy fallback + sourceTables/notes, trigger_inputs decode,
  │                  executions, activate; blueprint (LLM);
  │                  blueprint → Business Rule fallback (created inactive)
  │     fluent.js    LIVE AUTHORING: capability probe, LLM codegen against live
  │                  schema, offline compile validation w/ retry, serialized
  │                  install, read-back, managed list/remove, opt-in smoke run
  ├── agent/
  │     orchestrator.js  session store, agent loop (≤15 iters/turn), approval gate
  │                      (mutating tools await user decision, 5-min timeout), SSE events
  │     tools.js         20-tool registry with `mutating` flags
  │     prompts.js       system prompt: schema-first, never invent sys_ids, report sys_ids,
  │                      flow authoring tiers (design → build → fallback)
  │     providers/       anthropic.js · openaiCompat.js (OpenAI + Ollama) · index.js factory
  └── config/store.js    local settings.json (connection + llm + agent), secret redaction
        │
        ├──────────────► ServiceNow PDI  ←— REST Table/Aggregate/OAuth endpoints
        ├──────────────► LLM provider    ←— Anthropic Messages | OpenAI-compatible
        │
        ▼
  now-sdk (ServiceNow SDK 4.x)  ←— spawned as `node <sdk entry>`, fixed literal args only
        │   build (offline)  ·  install (whole app)  ·  auth --list  ·  query
        ▼
  server/fluent-workspace/   scope x_2196302_nwforge, app "NowForge Flows"
        ├── src/fluent/flows/*.now.ts   managed sources — anything here SHIPS on install
        ├── src/fluent/generated/keys.ts  Now.ID → sys_id map (identity; commit it)
        └── staged/                     build-verified, deliberately NOT deployed
                                        (outside fluentDir, so the build never scans it)
```

## Live authoring pipeline

```
spec ──► extractIntent ──► buildLiveContext ──► generate ──► validate ──► deploy ──► verify
          (LLM, JSON)       getSchema()          (LLM +      now-sdk      now-sdk    flows
                            referenceLookup()     cheatsheet  build        install    .detail()
                                                  + rules)    OFFLINE      queued
                                                                 │
                                                        fail ────┤ feed diagnostics back,
                                                                 │ retry ≤3
                                                                 └─► delete candidate,
                                                                     rebuild, return error
```

Invariants enforced in `fluent.js`, all load-bearing because installs are whole-application:

| # | Invariant | Why |
|---|---|---|
| a | only build-validated sources may sit in `src/fluent` at install time | anything there ships |
| b | a candidate that never compiles is deleted and the workspace rebuilt | keeps `src/` and `keys.ts` clean after a failure |
| c | every build/install goes through one serialized queue | concurrent runs would race on `dist/` and `keys.ts` |
| d | one file per artifact family, deterministic slug name | regeneration overwrites in place, so `Now.ID` keeps sys_ids stable instead of duplicating |

## Claude Code concept mapping

| Claude Code | NowForge |
|---|---|
| Tool registry + JSON schemas | `agent/tools.js` (`inputSchema`, `execute`) |
| Permission prompts before edits | Amber approval gate on `mutating` tools |
| Provider-agnostic model layer | Neutral history format + per-provider adapters |
| Streaming progress in terminal | SSE event stream rendered as tool/approval cards |
| CLAUDE.md system guidance | `agent/prompts.js` operating rules |
| Compile/typecheck before claiming done | `now-sdk build` offline, retry on diagnostics |
| Never report success unverified | read-back through `flows.detail()` after install |

## Adding a tool

1. Append to `TOOLS` in `server/src/agent/tools.js`: name, description (written for the model), `inputSchema`, `mutating`, `execute(input)`.
2. That's it — the orchestrator, approval gate, and chat UI pick it up automatically.

## Adding a provider

Create `agent/providers/yourprovider.js` exporting `chat({system, history, tools, ...}) → {text, toolCalls, stopReason}` translating the neutral history, then register it in `providers/index.js` and the Settings page select.
