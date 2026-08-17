# ServiceNow Fluent SDK — Research Findings

Phase 0 research for NowForge live Flow Designer authoring.

**Status:** pipeline proven end-to-end on `dev442675.service-now.com`.
Everything below marked ✅ **verified** was executed against the real CLI/instance in this
repo, not read off a docs page. Where the published documentation contradicts the shipped
CLI, the CLI wins and the discrepancy is called out.

---

## 1. What actually ships

| Item | Value |
|---|---|
| npm package | `@servicenow/sdk` |
| Version used | **4.10.1** (`latest`) |
| Binaries | `now-sdk`, `sdk`, `now-sdk-debug` |
| Node requirement | 18+ (this machine: v24.18.0) |
| Install | `npm install -g @servicenow/sdk@latest` ✅ |

Release-aligned dist-tags exist: `washingtondc: 1.0.6`, `xanadu: 3.0.2`, `latest: 4.10.1`.
The SDK major tracks the platform release family; `latest` (4.x) worked against this PDI
without a compatibility flag. If a future instance is older, pin the matching dist-tag.

### `now-sdk explain` — the best documentation source

The CLI bundles its own reference docs, which are **more accurate and more complete than the
public docs site**:

```bash
now-sdk explain --list                 # ~200 topics
now-sdk explain wfa-flow-guide         # full guide text
now-sdk explain action-api             # every action.core.* signature
```

This matters for Phase 2: the codegen cheatsheet is derived from `explain` output, and the
same command can regenerate it when the SDK is upgraded.

---

## 2. Documentation errata (verified against `--help`)

The public CLI page at `servicenow.github.io/sdk/cli` lists **kebab-case flags that do not
exist**. Using them fails. Verified correct spellings:

| Public docs say | Actually shipped | Command |
|---|---|---|
| `--frozen-keys` | **`--frozenKeys`** | `build` |
| `--error-on-conflict` | **`--errorOnConflict`** | `build` |
| `--skip-clean` | **`--skipClean`** | `build` |
| `--legacy-choices` | **`--legacyChoices`** | `build` |
| `--app-name` | **`--appName`** | `init` |
| `--scope-name` | **`--scopeName`** | `init` |
| `--package-name` | **`--packageName`** | `init` |
| `--demo-data` | **`--demoData`** | `install` |

Flag casing is genuinely inconsistent within `install`: `--demoData` is camelCase while
`--skip-flow-activation` and `--open-browser` are kebab-case. Don't assume a convention;
check `--help`.

Also note: the brief's link for "headless auth" (`/config/keys-file`) is about
`src/fluent/generated/keys.ts` — the **sys_id mapping file**. It has nothing to do with
credentials. Real headless auth is in §4.

---

## 3. Project layout (verified)

`now-sdk init` is fully non-interactive when given all flags **and an existing stored
credential** — it contacts the instance to reserve the app record:

```bash
now-sdk init --appName "NowForge Flows" \
             --packageName nowforge-flows \
             --scopeName x_2196302_nwforge \
             --template base
```

Templates: `base`, `javascript.basic|react|aiux|aiux-extension`, `typescript.basic|react|vue`.

### Scope name constraints ⚠️

- Must start with the **instance's vendor prefix** — here `x_2196302_`
  (from `glide.appcreator.company.code`).
- **Maximum 18 characters total.** With a 10-char prefix that leaves 8.
- A mismatched prefix only produces a *warning*, then installs into an app that
  "may not install correctly". Get this right the first time.

`x_2196302_nwforge` (17 chars) is what NowForge uses.

### What `base` actually generates

```
server/fluent-workspace/
├── now.config.json              { scope, scopeId, name }
├── package.json                 devDeps: @servicenow/sdk, @servicenow/glide
├── .gitignore                   .now/ dist/ target/ node_modules/ *.tsbuildinfo
├── .vscode/extensions.json
├── @types/servicenow/           ← from `now-sdk dependencies` (needs instance)
│   ├── glide.client.d.ts
│   ├── glide.server.d.ts
│   └── tables.modules.d.ts      typed schema for every table on the instance
├── src/fluent/                  ← YOU create this; base template ships no src/
│   ├── flows/*.now.ts           flows AND subflows both live here
│   └── generated/keys.ts        ← auto-generated Now.ID → sys_id map
└── dist/app/                    build output
    ├── scope/sys_app_<scopeId>.xml
    └── update/sys_hub_flow_<sysid>.xml, sys_module_*.xml ...
```

Two surprises worth knowing:
1. **The `base` template creates no `src/` directory at all.** You must create
   `src/fluent/flows/` yourself before the first build.
2. The stock `.gitignore` already covers all build artifacts — no extra ignore rules needed.

---

## 4. Headless authentication (the part the docs bury)

Two independent mechanisms. NowForge uses (a) today and should support (b) for CI.

### (a) Stored credential aliases — what this machine uses ✅

```bash
now-sdk auth --list          # shows aliases, hosts, usernames; never prints secrets
now-sdk auth --use <alias>   # set default
```

Current state on this machine:

```
*[snada-pdi]
      host = https://dev442675.service-now.com
      type = basic
      username = admin
      default = Yes
```

Because a default alias exists, `init` / `install` / `dependencies` / `query` all run
**non-interactively with no env vars and no password in the repo**. Commands accept
`-a/--auth <alias>` to target a specific instance.

To add one fully non-interactively (undocumented on the docs site — found in `auth --help`
examples; note `--username` / `--password-stdin` are not listed in the flags table but work):

```bash
echo "$SN_PASSWORD" | now-sdk auth --add https://devXXXXXX.service-now.com \
    --type basic --alias my-pdi --username admin --password-stdin
```

### (b) CI environment variables (no stored alias)

```bash
export SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL
export SN_SDK_AUTH_TYPE=basic
export SN_SDK_INSTANCE_URL=https://devXXXXXX.service-now.com
export SN_SDK_USER=admin
export SN_SDK_USER_PWD=...
now-sdk install
```

OAuth variant (preferred for production): `SN_SDK_AUTH_TYPE=oauth` with
`SN_SDK_OAUTH_CLIENT_ID` / `SN_SDK_OAUTH_CLIENT_SECRET`.

**Phase 2 consequence:** NowForge's server can drive the SDK using the *same* PDI credentials
it already keeps in `server/.env`, by exporting these five variables into the child process —
no interactive step, no second credential store. Falling back to the stored alias when the env
vars are absent gives a good default.

---

## 5. Build and install semantics (verified)

### `now-sdk build` runs offline ✅ — architecturally important

`build` printed no "Attempting to log into instance" line and completed successfully, whereas
`init`, `dependencies`, and `install` all print one. So:

> Once `@types/` has been fetched once via `now-sdk dependencies`, **`build` validates
> generated TypeScript with zero instance contact.**

This is exactly what the mission needs: the codegen loop can compile-check LLM output and
reject bad Fluent *before the instance is ever touched*. `dependencies` is the only
network-dependent setup step, and it is a one-time (per-schema-change) cost.

Exit codes: `0` on success, **`1` on compile failure**, with TypeScript diagnostics carrying
file, line, column and TS error code — precisely the text to feed back to the model on a retry.
Observed format (ANSI colour codes present; strip them before prompting):

```
[now-sdk] ERROR: src/fluent/flows/daily-p1-digest.now.ts:21:6 - error TS6133: 'params' is declared but its value is never read.
[now-sdk] ERROR: Found 1 diagnostic error(s) while building the project.
[now-sdk] ERROR: Build failed due to errors
```

This was a real failure hit while writing the examples, and it is the single most likely class
of LLM mistake: **`noUnusedParameters` is enforced.** A scheduled flow's body must be declared
`() => {`, not `(params) => {`, because scheduled triggers expose no `current` record. The
cheatsheet calls this out as a hard rule.

### `now-sdk install` — flows auto-activate ✅

```
[now-sdk] Rollback (undo installation): https://.../sys_rollback_context.do?sys_id=7840f401...
[now-sdk] Flow activation complete: 3/3 succeeded
[now-sdk] Installation completed. Access the application at: https://.../sys_app.do?sys_id=c44f3c6c...
```

Three things to exploit:
- **`Flow activation complete: N/N succeeded`** is a parseable success signal.
  `--skip-flow-activation` disables it; do not pass that flag.
- Every install prints a **rollback URL** (`sys_rollback_context`) — a genuine undo path worth
  surfacing in the NowForge UI.
- The app URL contains the scope sys_id, so a deep link is derivable without another query.

`-r/--reinstall` uninstalls then reinstalls. It **destroys on-instance metadata not present
locally** — never use it as a routine deploy.

### Read-back without REST credentials ✅

`now-sdk query` reads any table using the stored alias, with JSON output:

```bash
now-sdk query sys_hub_flow -q "sys_scope.scope=x_2196302_nwforge" \
    -f sys_id,name,active,type -o json
```

Useful as a verification path that doesn't depend on `server/.env` being populated.
It is **read-only** — there is no SDK write command, so creating test records for an
execution test still requires the Table API (i.e. `server/.env`).

---

## 6. Identity and deletion

### `Now.ID` → `keys.ts`

`$id: Now.ID['descriptive-key']` maps a human key to a generated sys_id recorded in
`src/fluent/generated/keys.ts`. On rebuild the same key resolves to the same sys_id, so
**redeploying updates in place instead of creating duplicates** — this is the idempotency
mechanism Phase 3 requires. `keys.ts` must be committed; it is the source of truth for record
identity. `now-sdk build --frozenKeys` fails the build if keys would change, which is the
right guard for CI.

Never let a model invent a sys_id. Every `$id` must be a `Now.ID[...]` key.

### Deletion

For records the SDK created, **delete the source file** — removal is tracked automatically and
the record is deleted on the next `install`. `Now.del(table, keysOrSysId)` is for *out-of-box*
records the SDK didn't create. So `remove(name)` in Phase 2 = delete the `.now.ts` file +
rebuild + reinstall.

---

## 7. Flow authoring model (summary — full syntax in the cheatsheet)

A flow is exactly three arguments: config, one trigger, one body callback.

```typescript
Flow(
  { $id: Now.ID['...'], name: '...', runAs: 'system' },
  wfa.trigger(trigger.record.created, { $id: Now.ID['...'] }, { table: 'incident', condition: '...' }),
  (params) => { /* wfa.action / wfa.subflow / wfa.flowLogic.* */ }
)
```

Constraints that bite (all confirmed in the bundled guides):

- **Exactly one trigger per flow.** Subflows have none.
- **Never assign a data pill to a variable.** `wfa.dataPill(...)` goes directly inside an
  action parameter. Capturing an *action result* in a `const` is correct and required; capturing
  a *data pill* is not.
- **Template literals interpolate in `ah_subject` and `log_message` only.** Not in `ah_body`,
  not in SMS `message`, and not inside `TemplateValue({...})` — pass the bare data pill there.
- **No JavaScript in flow-logic conditions.** `if`/`elseIf`/`else` take encoded queries only;
  `javascript:gs.daysAgoStart(30)` fails. JS is allowed in *table action* conditions.
- **Action parameter names are inconsistent by design** — `values` (createRecord/updateRecord)
  vs `field_values` (createTask/updateMultipleRecords) vs `fields` (createOrUpdateRecord) vs
  `ah_*` (catalog task). Always check `action-api`.
- **`lookUpRecord` outputs are capitalised** — `Record`, `Table`; `lookUpRecords` gives
  `Records`, `Count`. Most other actions use lowercase `record`. This is the single easiest
  thing for an LLM to get wrong.
- **`waitForCompletion` belongs in the subflow's *inputs* object** (3rd arg), not the instance
  config (2nd arg).
- `TemplateValue`, `Time`, `Duration`, `Now.ID` are **globals** — importing them is an error.
- There is no `deleteMultipleRecords`; use `lookUpRecords` + `forEach` + `deleteRecord`.

---

## 8. Phase 1 proof — what is live right now ✅

Built and installed from `server/fluent-workspace`, then read back off the instance:

| Artifact | sys_id | type | active |
|---|---|---|---|
| P1 Network Escalation | `ee327e93b62847e4901ba23b1b31e03f` | flow | **true** |
| Notify Manager | `af90366362d04879b7ab39f6dc66bcc1` | subflow | **true** |
| NowForge Smoke Test | `317907f254684c749d9b458f84e30938` | flow | **true** |

- Trigger instance confirmed on the flow (`trigger_type = record_create`).
- Subflow inputs confirmed on the instance: `Task Table`, `Task Sys ID`, `Message`.
- Both UC files compiled clean on the **first** `now-sdk build` — the syntax in the cheatsheet
  is build-verified, not guessed.

**Note on duplicate rows (corrected in Phase 2):** querying action instances by
`flow.name=<name>` returns them in pairs (order 1,1,3,3,5,5), because Flow Designer keeps a
published *snapshot* record carrying the same name as the master. Querying by
`flow=<sys_id>` returns each step exactly once, so `detail(sysId)` is unaffected and needs no
deduplication.

### Execution proof ✅

Created a P1 incident against the Network group via NowForge's own Table API client, then
watched the flow run:

```
created: INC0010005  priority = 1 - Critical
sys_flow_context: [{ name: 'P1 Network Escalation', state: 'In Progress' }]   (~3s)
assigned_to : Bow Ruggeri            ← the Network group's manager
work_notes  : ['P1 Network Escalation: the Network group manager has been notified.']
deleted test incident INC0010005
```

Both the work note *and* the manager assignment landed, and they are steps 3 and 4 — i.e.
downstream of the `wfa.subflow(...)` call at step 2 with `waitForCompletion: true`. **The
subflow wiring is therefore proven**, not just present. The test incident was deleted and a
follow-up query confirms it is gone.

### ⚠️ Bug found in NowForge's existing readers — `_v2` tables

`flows.detail()` in `server/src/servicenow/flows.js` queries `sys_hub_trigger_instance`,
`sys_hub_action_instance`, and `sys_hub_flow_logic`. On this release those return **nothing**:

```
triggers(non-v2): 0   actions(non-v2): 0   logic(non-v2): 0
triggers(_v2):    1   actions(_v2):    3
```

The current tables are **`sys_hub_trigger_instance_v2`**, **`sys_hub_action_instance_v2`**, and
**`sys_hub_flow_logic_instance_v2`** — confirmed independently by the generated `keys.ts`, which
maps SDK records to exactly those `_v2` table names. Phase 2 must update these readers, ideally
querying `_v2` first and falling back to the legacy names for older instances.

Second, smaller issue: `flows.list()` hardcodes `type=flow`, so **subflows are invisible** in
the NowForge Flows page. `Notify Manager` (`type=subflow`) does not appear. Live authoring
creates subflows, so the list needs to include them (and label the type).

---

## 9. Open items / risks

| Item | Status |
|---|---|
| `server/.env` does not exist — **and is not needed** | The brief asks for `server/.env`, but nothing in this codebase reads `.env` (no `dotenv`, no `process.env` for connection). Credentials live in **`server/data/settings.json`** via `config/store.js`, and were already correctly populated for `dev442675`. Phase 2 should keep using the settings store; if `.env` support is wanted it must be added deliberately. |
| Repo is not a git repo | No `.git` present, so the per-phase commits the brief asks for **cannot be made**. Needs `git init` before Phase 2. |
| `_v2` reader bug | See §8 — `flows.detail()` returns empty for every modern flow. Fix in Phase 2. |
| Subflows hidden from the UI | `flows.list()` filters `type=flow`. Fix in Phase 2. |
| `forEach` pill type ambiguity | **Resolved.** `wfa.dataPill(result.Records, 'records')` compiles against a `lookUpRecords` output; `'array.object'` is the underlying generic form. Use `'records'`. |
| UC3 built but not deployed | `daily-p1-digest.now.ts` is build-verified and sits in the workspace, deliberately **not installed** — Phase 3 owns its deployment. The next `now-sdk install` will deploy it. |
| Serialized deploys | `build` writes to a shared `dist/`, so concurrent builds in one workspace would race. Phase 2's queue must serialize (already planned). |
| UC4 approvals | `askForApproval` + `wfa.approvalRules()` are fully documented and appear usable; not yet built. |

---

## 10. Phase 2 findings (codegen pipeline)

Everything here was measured while wiring `server/src/servicenow/fluent.js`.

### Build exclusion is by location, not configuration ✅

There is **no build-level exclude glob**. `now-sdk build` scans `fluentDir` (default
`src/fluent`) for `.now.ts` files; the config's `excludeFilePatterns` applies to
`now-sdk transform` only. So `server/fluent-workspace/staged/`, sitting outside the scanned
tree, is excluded by construction — verified by rebuilding and watching
`sys_hub_flow_b2f18c96….xml` disappear from `dist/app/update/`.

### Removing a source is a pending DELETE ✅

The build records removals in `keys.ts` as `deleted: true` while **retaining the sys_id**:

```typescript
daily_p1_digest_flow: { table: 'sys_hub_flow', id: 'b2f18c96…', deleted: true }
```

The next `install` deletes that record from the instance, and restoring the source later
reuses the same identity. This is the mechanism behind `removeManaged()` — confirmed live:
deleting "Auto triage incident" removed it, and an independent read-back returned zero rows.

### Cost of the CLI, and what actually proves auth

Every `now-sdk` invocation pays ~5s of start-up:

| Command | Time | Contacts instance? |
|---|---|---|
| `now-sdk --version` | ~5s | no |
| `now-sdk auth --list` | ~5.5s | **no** — reads the local credential store |
| `now-sdk install --info` | ~2.3s | prints a URL only; not an auth proof |
| `now-sdk query sys_user -f sys_id --limit 1` | ~8.5s | **yes** — the cheapest real proof |

So `capability()` is shallow by default (version + stored credentials, ~6s, cached 30s) and
takes `deep: true` to run the authenticated query. `auth --list` proving a credential *exists*
is not the same as proving it still *works* — the API reports `verified: 'stored' | 'live' | 'failed'`
so callers can tell which claim they have.

Parsing gotcha: every CLI line is prefixed `[now-sdk] …`, so a naive `\[([^\]]+)\]` block regex
matches the log prefix as a credential alias. An alias header is a bracketed token **alone on
its line**, and a block with no `host =` is a log line.

### Windows cannot `execFile` the CLI

`now-sdk` is a `.cmd` shim: `execFile('now-sdk')` → `ENOENT`, `execFile('now-sdk.cmd')` →
`EINVAL` (Node ≥20 refuses batch files without `shell: true`). Rather than enable a shell,
the service spawns `node <sdk>/bin/index.js` and passes **only fixed literal arguments** —
no injection surface. Anything needing user-supplied values (read-back by name) goes through
the REST client instead.

### Compile diagnostics are good enough to self-repair

Failure output is precise and machine-usable:

```
[now-sdk] ERROR: src/fluent/flows/x.now.ts:27:33 - error TS2551: Property 'deleteMultipleRecords'
  does not exist on type '{ ... }'. Did you mean 'updateMultipleRecords'?
[now-sdk] ERROR: Found 2 diagnostic error(s) while building the project.
```

Exit code 1, ANSI colour codes present (strip before prompting). Feeding this back verbatim
is what drives the retry loop. An intentionally-invalid spec burned all 3 attempts, then the
candidate was deleted and the workspace rebuilt: `src/` returned to its exact prior file list,
`keys.ts` gained no orphaned keys, and every artifact on the instance kept its original
`sys_updated_on`.

### The failure mode that compiles cleanly ⚠️

The sharpest lesson of this phase: **a semantically wrong flow is still a valid flow.**

"when a change request is created with risk set to High" generated `condition: 'risk=4'`. It
compiled, installed, and activated — but on this instance `risk` is High=2, Moderate=3,
**Low=4**, so the flow was built to fire on Low risk. Nothing in the toolchain can catch this;
only reading the choice list can.

Cause was the prompt, not the model: the live-context block emitted `risk (integer) [2|3|4]`,
values with no labels. It now emits `choices[2=High, 3=Moderate, 4=Low]` and instructs the
model to use the numeric value and never assume a conventional ordering. Re-running the same
spec produced `risk=2`, verified by read-back — and reused the same sys_id, confirming
deterministic filenames plus `Now.ID` update in place rather than duplicating.

Generalisation: any instance-specific encoding (choice values, catalog variable type codes,
state models) must be *given* to the model, never inferred.

### Reasoning models silently truncate

Not an SDK issue, but it blocks codegen. `gpt-oss` bills hidden reasoning tokens against
`max_tokens` and returns **HTTP 200 with empty `content`** and `finish_reason: 'length'` when
the budget is exhausted:

```json
{ "message": { "content": "", "reasoning": "The user request: …" }, "finish_reason": "length" }
```

At `max_tokens: 40` content was empty; at 400 the same prompt answered correctly. The adapter
now raises a specific error instead of returning an empty string, and codegen budgets are
sized for reasoning models (intent 3000, generation 12000).

### Nothing was blocked

No SDK limitation prevented any Phase 2 requirement. Live authoring, subflows, offline
validation, idempotent redeploy, and deletion all work through supported commands.
