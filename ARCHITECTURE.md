# NowHelpAssist Architecture

```
client (React + Vite :5173)
  ├── pages: Dashboard · AgentChat · Incidents · Catalog · Flows · SLA ·
  │          Access · Applications · Transport · Audit · Settings
  ├── components/
  │     states.jsx      skeletons · designed empty states · RequiresInstance
  │                     (applied at the ROUTE, so a gated page never mounts
  │                      and never fires its load effect)
  │     instanceState.js  the gate's DECISION, in plain JS so the offline
  │                     suite can assert it — Node cannot import .jsx
  │     ConfirmDialog · confirm.js   one seam for every destructive prompt
  │     Toasts · toast.js            module-level store, not a context
  │     Markdown · markdownConfig.js react-markdown + remark-gfm, no raw HTML
  │     ScopeBadge.jsx    ONE component for the scope shown on Flows, Catalog,
  │                       SLA and Access — the scope NAME (the address), never
  │                       the application's display label
  │     ErrorBoundary.jsx            route-level, copyable stack
  ├── hooks/useHealth.js — ONE shared poller over /api/system/health; the
  │                        single answer to "is an instance bound"
  ├── hooks/useScopeLabels.js — sys_id → scope name for a WHOLE list in one
  │                        request; per-row would be 50 requests on SLA
  ├── ReferenceField / TableField — debounced typeahead against /api/system
  └── SSE reader for agent streams (POST body → event stream)
        │  /api proxy
        ▼
server (Node 22 + Express :4000)
  ├── routes/        system · incidents · catalog · flows · agent · sla ·
  │                  access · applications · transport · audit
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
  │                  install, read-back, managed list/remove, opt-in smoke run,
  │                  SEMANTIC VERIFICATION (setup/wait/assert/resume/cleanup),
  │                  and for a triggerless artifact setup/invoke/settle/assert
  │     subflows.js  subflow CONTRACTS, the reuse CATALOG injected into codegen,
  │                  and the CALL GRAPH — all parsed from the managed sources
  │                  with a string-aware bracket matcher; plus the artifact-type
  │                  and prefer-call lints
  │     execution-harness.js  runs any server-side script through a one-shot
  │                  sysauto_script and returns its JSON report; used to call a
  │                  subflow via sn_fd.FlowAPI. Job + result row deleted and
  │                  read back. Shared infrastructure for v0.4's fix-script and
  │                  script-include verification (see §32)
  │     sla.js       contract_sla reads/writes, duration decode, breach-clock
  │                  verification matched to the RIGHT definition
  │     acl.js       sys_security_acl report / two-role diff / explain, with
  │                  an explicit `visibility` so an empty report is never an answer
  │     catalogPolicy.js  catalog UI policies through the SDK — the actions
  │                  cannot be written over REST at all (see §23)
  │     conditions.js · codegen-guards.js  condition building; the A1–A6 guards
  │     workspaces.js  the SDK workspace REGISTRY — scope → workspace discovered
  │                  by scanning for now.config.json, so "which scopes do we
  │                  manage" is data and a second scoped app is a directory
  │     applications.js  all 743 scopes off sys_scope (sys_store_app, sys_package
  │                  and sys_plugins are 403 to admin over REST — the class name
  │                  separates custom/store/global), with the managed flag from
  │                  the registry and an explicit `visibility` saying so
  │     transport.js   SESSION CAPTURE. The sweep: find the update rows a call
  │                  produced, group by the ROW's application, re-parent into a
  │                  set per scope created lazily — global over REST, scoped
  │                  through the harness — then collapse same-name rows.
  │                  Configuration vs data is answered from the live hierarchy
  │                  (sys_metadata in the super_class chain), never a list
  │     transport-export.js  update set XML built from Table API reads, always
  │                  entity-escaped (CDATA cannot nest and payloads contain it),
  │                  deterministic, and verified against its own source rows
  │                  before it is ever offered as a download
  ├── agent/
  │     orchestrator.js  session store, agent loop (≤15 iters/turn), approval gate
  │                      (mutating tools await user decision, 5-min timeout), SSE events
  │     tools.js         39-tool registry with `mutating` flags
  │     capture.js       the hook after a mutating tool succeeds. Never throws —
  │                      the write already landed — and a non-config mutation
  │                      SAYS "not captured — data, not configuration" rather
  │                      than going quiet, which would read as a failure
  │     prompts.js       system prompt: schema-first, never invent sys_ids, report sys_ids,
  │                      flow authoring tiers (design → build → fallback)
  │     providers/       anthropic.js · openaiCompat.js (OpenAI + Ollama) · index.js factory
  ├── memory/            THE STORAGE LAYER — one gitignored SQLite file,
  │     db.js            node:sqlite (built-in; probed, not assumed).
  │                      Idempotent migrations keyed on PRAGMA user_version,
  │                      run on boot. NEVER edit a shipped migration — append.
  │     sessions.js      sessions · messages (neutral history verbatim) ·
  │                      tool_events (what was DONE, incl. the approval
  │                      decision and the result; outlives compaction)
  │     compaction.js    fold old turns into digests under a token budget
  │     facts.js         per-instance knowledge ledger, seeded from the
  │                      trap ledger in docs/fluent-research.md
  │     recall.js        embeddings + FTS5 keyword fallback (loudly degraded)
  │     audit.js         build_runs / build_events for UI-driven work, the
  │                      merged timeline, sys_id harvesting, CSV export
  │     (migration 6)    capture_state (ON by default, so absence = enabled) and
  │                      capture_sets, keyed (session, instance, scope) — which
  │                      is what makes set creation lazy and idempotent
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
        ├── src/fluent/flows/*.now.ts      managed sources — anything here SHIPS on install
        ├── src/fluent/flows/*.verify.json semantic verification specs (build ignores them)
        ├── src/fluent/generated/keys.ts   Now.ID → sys_id map (identity; commit it)
        └── staged/                        build-verified, deliberately NOT deployed
                                           (outside fluentDir, so the build never scans it)

  server/data/nowhelpassist.db    the SQLite file above — gitignored, WAL mode
  server/data/settings.json  connection + llm + agent settings — gitignored
```

## Storage and the audit trail

Everything NowHelpAssist remembers lives in one gitignored SQLite file,
`server/data/nowhelpassist.db`, opened through the built-in **`node:sqlite`** —
chosen because it was probed rather than assumed (`DatabaseSync`, BLOB
round-trip for float32 vectors, and FTS5 are all present), which keeps the
storage layer dependency-free on a Windows machine with no node-gyp toolchain.
Migrations are idempotent, keyed on `PRAGMA user_version`, and run before the
listener binds, so a database that cannot open stops the server rather than
failing the first chat turn with something unrecognisable. A shipped migration
is never edited — `user_version` is the only thing that decides what has run,
and an edit would silently skip on every existing file.

Two tables carry the audit trail, and they are separate on purpose.
`tool_events` records what the **agent** did — the call, its arguments, its
result, whether a human approved it at the amber gate, and the instance and
account it landed on — and it survives compaction, which rewrites `messages`
and must never rewrite this. `build_runs` / `build_events` record what the
**module pages** did: a flow deploy, a catalog UI policy, an SLA verification
each drive the SDK from an SSE route and belong to no conversation. The Audit
page merges the two into one timeline. The result column is what makes it
answerable at all: a created record's sys_id exists only in the tool's return
value, so before it was stored, "what did this session do to the instance" had
no answer in the table named after the question.

## Verification pipeline

```
verify(name)
   │  <slug>.verify.json
   ├─► setup    create a record satisfying the flow's OWN trigger condition
   │              (calculated fields driven through their inputs: impact+urgency,
   │               never priority directly — the platform overwrites it)
   ├─► wait     poll sys_flow_context for THIS flow's execution
   │              COMPLETE → assertable
   │              WAITING/PAUSED → assertable (approval flows stop here)
   │              ERROR/CANCELLED → fail with the state
   │              timeout → fail with the last observed state, never a hang
   ├─► assert   journal fields read from sys_journal_field and compared by
   │              containment; everything else compared exactly
   ├─► resume   approvals only: patch the approval, wait again, assert again
   └─► cleanup  ALWAYS, in a finally — a failed assertion leaves no test data
```

Two rules are enforced in code rather than asked of the model, because both
would otherwise produce a confident green tick that proves nothing:

| Rule | Failure it prevents |
|---|---|
| An assertion may not read a field `setup.payload` itself wrote | passes regardless of what the flow does |
| Assertions must cover every `promised_effect` from intent extraction | proves half the request while reporting a clean pass |

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
| d | identity follows the **request**, not the model's chosen name | the same spec named its flow "…Incidents" then "…Incident", creating a duplicate. Sources carry a spec fingerprint; an edited request names its target via `updates`; the deployed source is fed back so names and `Now.ID` keys survive verbatim — those strings are what keys.ts is keyed on |
| e | `deploy()` builds before installing | `install` ships `dist/`, so deploying without building silently installs a stale package — a restored source once reported 3/3 while never reaching the instance |

## Transport and scope

```
                       REST tier                        SDK tier
artifact is born in    global, always                   the app's scope
                       (sys_scope on an insert is
                        accepted and ignored — 201,
                        no warning)
portable by            an update set                    the scoped app itself
capture mechanism      the sweep                        already a migration unit
```

That split is the whole reason this layer exists: the SDK tier was already
portable, and this gives the REST tier its equivalent.

The sweep re-parents update rows AFTER the fact rather than pointing the
platform's current-set preference at a named set. The preference route works —
and is not used, because it is a per-USER setting while every session shares
one API user. Measured: two interleaved sessions put **8 of 16** changes in
each other's set, with no error anywhere (docs/fluent-research.md §33).

Three rules the sweep obeys, each enforced by the platform rather than chosen:

| rule | what happens if you get it wrong |
|---|---|
| group by the ROW's `application`, one set per scope | business rule `Handle updates moving between sets` aborts with a 403 mid-sweep |
| scoped sets are minted server-side, not over REST | REST returns a *global* set that then refuses every row |
| collapse rows sharing a name inside a set | the count reads high and the export applies the same record twice |

An update set carries **configuration** — anything extending `sys_metadata`.
It has never carried task data, and a mutation on `incident` therefore reports
"not captured — data, not configuration" instead of nothing at all.

## Claude Code concept mapping

| Claude Code | NowHelpAssist |
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
