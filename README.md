# NowForge — Agentic ServiceNow Studio

Connect a ServiceNow PDI and build on it two ways: through clean module UIs, or by telling an AI agent what you want and approving each change it proposes. Bring your own model — Anthropic, OpenAI, or fully-local Ollama. No Now Assist SKUs required.

**Scope (this build):** PDI connection · Incident Management (full CRUD) · Catalog Management (items, all variable types with choices, variable sets, order guides, record producers) · Flow Designer (full read, executions, activate, **live authoring of real flows and subflows via the ServiceNow SDK**, AI blueprint design + classic fallback) · deep reference-field/table handling everywhere · agentic chat with a human approval gate on every mutation.

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

### Enabling live flow authoring (optional)

Everything above works without this. To let NowForge build *real* flows, install ServiceNow's SDK and give it a credential:

```bash
# 1. the CLI (Node 18+)
npm i -g @servicenow/sdk

# 2. one stored credential — piping the password keeps it non-interactive
echo "$SN_PASSWORD" | now-sdk auth --add https://devXXXXXX.service-now.com \
    --type basic --alias nowforge --username admin --password-stdin

# 3. workspace dependencies + instance type definitions
npm install --prefix server/fluent-workspace
cd server/fluent-workspace && now-sdk dependencies
```

The Flows page shows a green banner when this is ready, and the exact fix commands when it isn't. `GET /api/flows/live/capability` returns the same detail (add `?deep=true` to actually round-trip the instance instead of just reading the local credential store).

**On credentials:** the SDK keeps its own credential store, addressed by alias — it does **not** read `server/data/settings.json`, and there is no `.env` anywhere in this project. For CI, skip the stored alias and export `SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL`, `SN_SDK_AUTH_TYPE`, `SN_SDK_INSTANCE_URL`, `SN_SDK_USER`, `SN_SDK_USER_PWD` (or the OAuth pair) instead. Note that `keys.ts` — despite living under a docs page called "keys file" — is a **sys_id map, not credentials**; commit it.

Because the SDK and NowForge authenticate separately, they can point at different instances. The capability banner warns you when they do, since flows would deploy somewhere other than the instance you're reading.

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
- **Read everything:** flows *and subflows* from `sys_hub_flow`, trigger instances, ordered action instances, logic blocks, and execution history from `sys_flow_context`. Activate/deactivate with one click. Trigger configuration (table, condition, run-in) is decoded from the platform's compressed `trigger_inputs` blob, because current releases keep none of it in columns.
- **Live build (the real thing):** type an automation in plain language → NowForge generates Fluent TypeScript, compiles it **offline**, installs it, and reads the result back. You get an active flow with its sys_id and a link, or a readable compile error and nothing on the instance.
- **Semantic verification:** press **Verify** and NowForge fires the flow on a real record, asserts the effects your sentence promised, and deletes the test data. Compiling proves a flow is well-formed; this proves it is *correct*. See [docs/demo.md](docs/demo.md) for a five-minute walkthrough.
- **Design with AI:** describe an automation → a precise blueprint (trigger, exact actions, configs, reference fields, test plan). Download it, or hit **Deploy as real flow** to feed it straight into the live pipeline.
- **Classic fallback:** where the SDK can't run, record-triggered blueprints still become an equivalent **Business Rule** (`sys_script`), always created **inactive** for review.

#### How live authoring works

```
plain-language spec
        │
        ├─► extract intent ─────────────► trigger table, artifact kind, proper nouns
        │
        ├─► LIVE CONTEXT from the instance
        │     getSchema(table)      real field names, types, reference targets,
        │                           and choice VALUE=LABEL pairs
        │     referenceLookup(name) real sys_ids for every named group/user/category
        │
        ├─► LLM ──► Fluent TypeScript          (cheatsheet + hard rules in the prompt)
        │
        ├─► now-sdk build          OFFLINE. Compile errors never reach the instance.
        │     └─ on failure: feed the compiler's own diagnostics back, retry (max 3),
        │        then delete the candidate and rebuild so src/ stays clean
        │
        ├─► now-sdk install        serialized; deploys the WHOLE managed app and
        │                          auto-activates flows
        │
        ├─► read back via flows.detail()  ──► {sys_id, type, active, link, counts}
        │
        └─► VERIFY (never automatic — its own button, its own approval)
              setup   create a record matching the flow's own trigger
              wait    poll sys_flow_context until the execution settles
              assert  check the effects the request promised
              resume  for approvals: patch the approval, wait, assert again
              cleanup always, in a finally
```

Two properties worth knowing:

- **`now-sdk install` deploys the entire managed application**, not one file. Every response lists what shipped. A build-verified source you *don't* want deployed goes in `server/fluent-workspace/staged/`, outside the scanned `fluentDir`.
- **Identity is stable.** Each artifact gets a deterministic filename and a `Now.ID` key recorded in `keys.ts`, so regenerating the same spec updates the same record instead of creating a duplicate. Deleting a managed flow removes its source — which is the SDK's own deletion mechanism — reinstalls, and confirms absence by read-back.

#### Capability matrix

Three tiers. **LIVE (verified)** means it was exercised end-to-end against a real PDI and proven by a real execution — not by the deploy log.

**Tier 1 — LIVE, semantically verified**

| Capability | Evidence |
|---|---|
| Flows and subflows from one plain-language spec | flow + subflow generated into one source, 3/3 activated |
| Record triggers (created) with encoded conditions | decoded trigger read back: `priority=1^assignment_group.name=Network^assigned_toISEMPTY` |
| Scheduled triggers (daily, with timezone) | stored `01:30 UTC` verified as `07:00` IST |
| Flow logic — if / else, forEach | present in read-back on every UC |
| Actions exercised: Look Up Record(s), Update Record, Send Email, Log, **Ask For Approval** | across UC1–UC4 |
| Subflow invocation with typed I/O + `waitForCompletion` | UC1 calls UC2; downstream steps land |
| **Approvals, including the approve-and-continue path** | approval raised for the right approver by identity, patched to approved, flow resumed to COMPLETE, post-approval effect asserted |
| In-place update (same spec, or edited spec via `updates`) | same `sys_id` across repeated and modified deploys |
| Delete | read-back returns 0 rows |
| Failure containment | 3 attempts, candidate deleted, instance snapshot **identical** |

**What semantic verification does and does not cover.** It creates a record matching the flow's own trigger, waits for the execution to settle, asserts the effects the request promised, and always deletes its test data. It **catches**: the flow never firing, firing then erroring, writing the wrong value, writing nothing, an approval routed to the wrong person. It **cannot catch**: an effect nobody asserted; a trigger condition wrong in the same direction as the setup payload (both derived from one misreading); anything timing-dependent past the wait window; and for scheduled flows, whether the schedule *fires* — there is no supported manual-execute path, so those are verified by schedule metadata only, and the result says so.

**Tier 2 — LIVE, metadata-verified only**

| Capability | Why |
|---|---|
| Scheduled flows | cannot be fired on demand: no CLI run command, and `sn_fd.FlowAPI` is server-side script only. Verified by decoded schedule metadata with an explicit caveat. |

**Tier 3 — BLUEPRINT / Business Rule fallback**

| Capability | Status |
|---|---|
| Editing pre-existing global or third-party flows | **out of scope** — NowForge only manages artifacts inside its own scoped app |
| Anything when the SDK cannot run | blueprint + inactive `sys_script`, with the capability banner printing the exact fix commands |
| Application triggers (inbound email, SLA, catalog) | supported by the SDK and documented in the cheatsheet, but **not exercised here** — treat as unproven until verified |

There is still **no supported REST API for writing `sys_hub_*` directly**, and NowForge never attempts it. Live authoring works because it drives ServiceNow's own toolchain.

#### Model-proofing floor (A1–A5)

Every guard answers a failure **measured** against `gpt-oss:120b-cloud`, not a hypothetical one. They do not make a weak model competent; they make it presentable — when it is wrong, the pipeline says so instead of deploying it.

| Guard | The measured failure it answers | Evidence |
|---|---|---|
| **A1** deterministic decoding | — | `temperature 0` + a fingerprint-derived seed, passed through per provider. Probed: this backend **ignores `seed`** on both `/v1` and native `/api/chat`, and `temperature 0` is only approximately stable, so no guard may assume reproducibility (§19) |
| **A2** pinned flow identity | one spec produced a different flow **name** on all six runs; the platform matches artifacts by name, so a rename creates a duplicate | name imposed by string rewrite, located by brace matching so an action's own `name:` cannot be hit; every correction streamed |
| **A3** promised literals | a regeneration silently dropped the `"Vendor issue: "` prefix — compiled, installed, activated 10/10, wrote the wrong text | literals intersected with the spec text, so the model can only narrow the guard, never invent a requirement |
| **A4** `trigger_strategy` lint | nothing set it, so the platform default `once` took over — fires **once ever** per record (trap #10) | the least visible defect in the pipeline: build green, install 10/10, single-shot verification **passes**, wrong only the second time |
| **A5** evidence-fed retries | three verification attempts re-asked the identical question and got the identical bad answer | each rejection attaches the instance's real field inventory; a `RetryLedger` refuses a byte-identical re-ask and names it as *our* defect |

**Test 1 Step 1, resumed and closed** (§20). The §14 failure class is gone: attempt 1 still reached for `^problemISNOTEMPTY`, A5 attached the real reference-field inventory of `incident`, and no attempt in any run went back to it. Three attempts of prose had not moved this model; one dictionary listing moved it immediately.

That surfaced a worse failure that was **ours**: the field check told the model to drop two impossible assertions and the coverage rule rejected it for dropping them — mutually unsatisfiable, unsatisfiable by any model. Fixed with a *verified* escape hatch (`unverifiable`, each excuse checked against the live dictionary or a live read), not a weaker rule. Final run: 2 attempts, 3 assertions + 2 confirmed-unverifiable, covering all 5 promises.

#### Memory and sessions

| Capability | Evidence |
|---|---|
| Conversations survive navigation **and** a server restart | server SIGKILLed mid-session; transcript identical across the restart, and the agent answered a sys_id from two turns earlier **with no tool call** (§21) |
| Compaction into structured digests | synthetic 100-turn session folded under budget; a probe about turn 5 still answerable because its sys_id survived into the digest |
| Compaction never loses data on failure | a summariser that throws, or returns an empty digest, discards nothing and says so |
| Tool-event audit trail outlives compaction | asserted: messages are rewritten, `tool_events` are not |
| Instance knowledge ledger drives behaviour | on the agent path — where the ledger is the **only** carrier of the fact — a P1 payload came back as `impact: 1` + `urgency: 1`, priority never written |
| Recall in both modes | keyword (no embed model) **5.48** vs 1.41; semantic (`nomic-embed-text`, 768d) **0.79** vs 0.56 — right session first in each |
| Degraded recall is loud | UI banner + API both report `mode: "keyword"` with the exact `ollama pull` command; never a silent downgrade |

Storage is the built-in **`node:sqlite`** — probed, not assumed: `DatabaseSync`, BLOB round-trip for float32 vectors, and FTS5 are all present on Node 24, so the layer is dependency-free (no node-gyp on this Windows machine). One gitignored file, `server/data/nowforge.db`, with idempotent migrations on boot.

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

- **Session loop** — provider-agnostic agent iterations (max 15/turn) with a neutral message format translated per provider. History is **persisted to SQLite** and written through on every append, so a conversation survives navigating away and survives a server restart.
- **Tool registry** — 24 tools (`server/src/agent/tools.js`): schema inspection, reference/table lookup, generic record CRUD, incident + catalog composites, flow reading, blueprint design, live flow authoring (`create_flow_live`, `verify_flow_live`, `delete_live_flow`, `smoke_test_flow`, `list_live_flows`, `flow_authoring_capability`), and memory (`recall_memory`, `list_instance_facts`, `remember_fact`). Each tool declares `mutating`.
- **Flow authoring tiers** — the prompt makes the order explicit: `design_flow_blueprint` designs, `create_flow_live` builds, and the Business Rule fallback is reserved for environments where capability reports `ok: false`. Verifying a flow (`verify_flow_live`) writes real records, so it is a *separate* mutating tool with its own approval and is never automatic after a deploy.
- **Permission gate** — mutating calls pause the loop, stream an `approval_required` event, and wait (5-min timeout) for your Approve/Reject. Rejections are fed back to the model as tool errors. Auto-approve is opt-in.
- **BYO provider** — one adapter for Anthropic's Messages API, one OpenAI-compatible adapter covering OpenAI and Ollama (same wire format). Add a provider by writing one file.
- **Streaming** — SSE over the POST body: `meta`, `assistant_text`, `tool_use`, `approval_required`, `tool_result`, `compacted`, `remembered`, `done`.
- **Model-proofing floor** — five guards (A1–A5) that stop a weak model shipping a wrong artifact: deterministic decoding, pinned flow identity, promised-literal checks, a `trigger_strategy` lint, and retries that must add measured evidence. See the capability matrix and `docs/fluent-research.md` §19–20.
- **Memory** — sessions, an instance knowledge ledger, compaction, and recall, all in one SQLite file. See below.

## API map

```
/api/system      health · settings · connection/test · schema/:table · hierarchy/:table · reference/:table · tables
/api/incidents   list+filters · stats · get · create · update · delete
/api/catalog     meta · catalogs · categories · items CRUD + deep view · variables · variable-sets (+variables, attach) · order-guides (+items) · record-producers
/api/flows       list (flows + subflows, type filter) · :id detail · executions · :id/active
                 design · blueprint-to-rule
                 live (POST, SSE — accepts `updates` to edit in place)
                 live (GET managed) · live/capability
                 live/verify (POST, SSE) · live/smoke · live/:name (DELETE)
/api/agent       info · chat (SSE) · approve
                 sessions (GET list · POST new) · sessions/:id (GET · PATCH rename · DELETE)
                 sessions/:id/messages
                 memory/status · memory/search
                 facts (GET · POST) · facts/:id (DELETE) · facts/seed
```

## Known caveats

- Order-guide rule-base writes target `sc_cat_item_guide_items`; verify the table name on your release (constant `GUIDE_RULE_TABLE` in `server/src/servicenow/catalog.js`).
- Variable type codes are the stable canonical set but worth a spot-check on brand-new releases (`VARIABLE_TYPES`, same file).
- OAuth uses the password grant with the PDI's OAuth client; refresh-token rotation is Phase 2. Basic auth is the simple path for PDIs.
- This is a local dev tool: no user management, secrets in a local JSON file, CORS open. Don't deploy it to the internet as-is.

## Roadmap

- **Done — flow authoring for real:** ServiceNow SDK (Fluent) codegen with offline compile validation, serialized install, read-back verification, and an approval-gated agent tool.
- **Done — semantic verification:** flows are proven by firing them on a real record and asserting the promised effects, including the approve-and-continue path for approvals. Reference use cases (record-triggered flow + subflow, scheduled digest, approval flow) all regenerated through codegen and verified live; idempotency battery green.
- **Done — the model-proofing floor:** five guards so the pipeline reports a weak model's mistakes instead of deploying them. The one available model (`gpt-oss:120b-cloud`) provably ignores `seed`, so every guard is written to hold under non-deterministic generation; a stronger model stays a pure Settings swap.
- **Done — memory and sessions:** conversations persist across restarts, compact into structured digests when they outgrow the context budget, and are searchable. A per-instance knowledge ledger carries every trap in `docs/fluent-research.md` into the agent prompt *and* the codegen context.
- **Next:** exercise application triggers (inbound email, SLA, catalog) so they can leave the unproven tier; ATF test triggering after builds; OAuth refresh flow. Also: the deployed vendor-hold flow still sets no `trigger_strategy` (trap #10) — A4 blocks new flows from shipping that defect but does not retro-fix a deployed one.
- **Later — productize:** multi-instance workspaces, update-set capture around agent sessions ("everything the agent did in this session" as one exportable set), audit log, packaging/licensing for consultancies.

## Notes from building this

Things that cost real time and are documented in `docs/fluent-research.md`:

- The published SDK CLI page lists **kebab-case flags that don't exist** (`--frozen-keys`, `--app-name`). The shipped CLI is camelCase. `now-sdk explain <topic>` is the reliable reference — it bundles better docs than the website.
- Modern releases store flow parts in the **`_v2`** tables. The legacy tables still exist and return zero rows, so reading them makes every modern flow look empty.
- Choice fields must be handed to the model as `value=label` pairs. Passing bare values produced a flow that fired on *Low* risk for a spec that asked for *High*, because `risk=4` means Low on this instance — and it compiled and installed perfectly.
- Reasoning models (gpt-oss, o-series) bill hidden reasoning tokens against `max_tokens` and return HTTP 200 with empty content when the budget runs out. NowForge now raises a specific error instead of reporting "the model returned nothing".
- `priority` on task tables is **calculated** from `impact` and `urgency`. Writing `{"priority":"1"}` is silently stored as *4 - Low*, so a verification setup that sets priority directly never matches a `priority=1` trigger. Drive calculated fields through their inputs.
- Schedule times are stored in **UTC**: `Time({hours:7}, 'Asia/Kolkata')` persists as `01:30`. Asserting the local wall-clock time against the stored value fails a perfectly correct flow.
- Identity cannot come from an LLM-chosen name. The same spec produced "…Incidents" and then "…Incident", which silently created a duplicate flow *and* a duplicate subflow. Identity now derives from the request itself.
