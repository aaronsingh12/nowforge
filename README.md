# NowForge — Agentic ServiceNow Studio

Connect a ServiceNow PDI and build on it two ways: through clean module UIs, or by telling an AI agent what you want and approving each change it proposes. Bring your own model — Anthropic, OpenAI, or fully-local Ollama. No Now Assist SKUs required.

**Phase 1 scope (this build):** PDI connection · Incident Management (full CRUD) · Catalog Management (items, all variable types with choices, variable sets, order guides, record producers) · Flow Designer (full read, executions, activate, AI blueprint design + classic fallback authoring) · deep reference-field/table handling everywhere · agentic chat with a human approval gate on every mutation.

---

## Quickstart

Requirements: Node 18+ (tested on 22), a ServiceNow PDI (free at developer.servicenow.com), and an LLM — an Anthropic/OpenAI API key or local Ollama.

```bash
# Terminal 1 — API server on :4000
cd server
npm install
npm run dev

# Terminal 2 — React client on :5173
cd client
npm install
npm run dev
```

Open http://localhost:5173 and then:

1. **Dashboard** → enter your PDI URL + admin credentials (basic auth is fine for a PDI) → Save → Test connection.
2. **Settings** → pick your LLM provider, paste the API key (or point at Ollama), save.
3. **Agent** → try: *"Create a Laptop Request catalog item with 6 variables including a reference to sys_user."* Watch it inspect schema, resolve references, then stop at the amber approval card before writing anything.

Credentials live only in `server/data/settings.json` on your machine (gitignored).

---

## The three modules

### Incidents
Full CRUD against the `incident` table. The editor is schema-driven: state/priority/impact/urgency/category choices are pulled live from `sys_choice` through the inheritance chain, and caller, assignment group, and assignee are real reference pickers that typeahead against `sys_user` / `sys_user_group` and store sys_ids. Work notes append on update. Stats chips use the Aggregate API.

### Catalog
Four tabs covering the catalog stack top to bottom:

- **Items & variables** — create items (with category/catalog), then add variables of any type. Choice types (Multiple Choice, Select Box, Lookup) take a one-per-line choices editor that writes `question_choice` rows. Reference (type 8) and List Collector (21) take a live table picker. Variables render with type labels, mandatory flags, and reference targets.
- **Variable sets** — create `item_option_new_set` records, add variables to them, attach sets to items via `io_set_item`.
- **Order guides** — create guides (`sc_cat_item_guide`, two-step supported) and manage rule-base entries.
- **Record producers** — create `sc_cat_item_producer` with a target-table picker and mapping script. Producers are catalog items, so their variables are managed from the Items tab.

### Flows
- **Read everything:** flows from `sys_hub_flow`, trigger instances, ordered action instances, logic blocks, and execution history from `sys_flow_context`. Activate/deactivate with one click.
- **Design with AI:** describe an automation in plain language → the model returns a precise blueprint (trigger, exact Flow Designer actions to pick, configs, reference fields involved, test plan). Download it as JSON or hand it to a junior admin.
- **Classic fallback:** record-triggered blueprints can be materialized as an equivalent **Business Rule** (`sys_script`) — generated script, correct table/when/conditions, always created **inactive** for review.

**Why no direct flow creation?** ServiceNow exposes no supported public API for authoring Flow Designer flows — definitions are compiled, serialized snapshots in `sys_hub_*` tables, and raw inserts produce broken, upgrade-fragile artifacts. NowForge refuses to ship broken writes. Authoring is a pluggable strategy interface (`server/src/servicenow/flows.js`): blueprint + classic fallback ship today; update-set XML templating and the ServiceNow SDK (Fluent) route are Phase 2 evaluations.

---

## Reference-field handling (everywhere)

This is the part most homegrown tools skimp on:

- Every read uses `sysparm_display_value=all`, so each field arrives as `{value, display_value}` — sys_ids for writes, labels for humans.
- `GET /api/system/schema/:table` walks the inheritance chain via `sys_db_object.super_class`, merges `sys_dictionary` across it (most-derived wins), and attaches `sys_choice` lists and reference targets per field.
- `GET /api/system/reference/:table?q=` auto-detects the table's display field (dictionary `display=true`, walked up the chain, with fallbacks) and returns `{sys_id, display}` pairs for typeahead.
- `GET /api/system/tables?q=` searches `sys_db_object` for table pickers (record producers, list collectors).
- The agent is instructed to never invent sys_ids — it must resolve references through the same lookups before any write.

## The agent backbone

Modeled on Claude Code / opencode:

- **Session loop** — provider-agnostic agent iterations (max 15/turn) with a neutral message format translated per provider.
- **Tool registry** — 15 tools (`server/src/agent/tools.js`): schema inspection, reference/table lookup, generic record CRUD, incident + catalog composites, flow reading, blueprint design. Each tool declares `mutating`.
- **Permission gate** — mutating calls pause the loop, stream an `approval_required` event, and wait (5-min timeout) for your Approve/Reject. Rejections are fed back to the model as tool errors. Auto-approve is opt-in.
- **BYO provider** — one adapter for Anthropic's Messages API, one OpenAI-compatible adapter covering OpenAI and Ollama (same wire format). Add a provider by writing one file.
- **Streaming** — SSE over the POST body: `meta`, `assistant_text`, `tool_use`, `approval_required`, `tool_result`, `done`.

## API map

```
/api/system      health · settings · connection/test · schema/:table · hierarchy/:table · reference/:table · tables
/api/incidents   list+filters · stats · get · create · update · delete
/api/catalog     meta · catalogs · categories · items CRUD + deep view · variables · variable-sets (+variables, attach) · order-guides (+items) · record-producers
/api/flows       list · :id detail · executions · :id/active · design · blueprint-to-rule
/api/agent       info · chat (SSE) · approve
```

## Known caveats

- Order-guide rule-base writes target `sc_cat_item_guide_items`; verify the table name on your release (constant `GUIDE_RULE_TABLE` in `server/src/servicenow/catalog.js`).
- Variable type codes are the stable canonical set but worth a spot-check on brand-new releases (`VARIABLE_TYPES`, same file).
- OAuth uses the password grant with the PDI's OAuth client; refresh-token rotation is Phase 2. Basic auth is the simple path for PDIs.
- This is a local dev tool: no user management, secrets in a local JSON file, CORS open. Don't deploy it to the internet as-is.

## Roadmap

- **Phase 2 — flow authoring for real:** update-set XML templating (known-good flow skeletons imported via `sys_remote_update_set`), ServiceNow SDK / Fluent evaluation, ATF test triggering after builds, OAuth refresh flow.
- **Phase 3 — productize:** multi-instance workspaces, update-set capture around agent sessions ("everything the agent did in this session" as one exportable set), audit log, packaging/licensing for consultancies.
