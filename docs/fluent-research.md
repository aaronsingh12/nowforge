# ServiceNow Fluent SDK — Research Findings

Phase 0 research for NowHelpAssist live Flow Designer authoring.

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

`x_2196302_nwforge` (17 chars) is what NowHelpAssist uses.

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

Two independent mechanisms. NowHelpAssist uses (a) today and should support (b) for CI.

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

**What Phase 2 actually shipped:** the server drives the SDK through the **stored alias** (a),
not the env vars. The alias already exists on this machine, works non-interactively, and keeps
the instance password out of the Node process entirely — NowHelpAssist never handles it. Mechanism
(b) remains the documented path for CI, where no credential store is present.

Note the two credential stores are independent: the SDK's alias store is separate from
NowHelpAssist's `server/data/settings.json`, so they can point at different instances.
`capability()` compares the alias host against the configured instance URL and the UI warns on
a mismatch, since flows would otherwise deploy somewhere other than the instance being read.
(There is no `.env` anywhere in this project — see §9.)

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
  surfacing in the NowHelpAssist UI.
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

Created a P1 incident against the Network group via NowHelpAssist's own Table API client, then
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

### ⚠️ Bug found in NowHelpAssist's existing readers — `_v2` tables

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

---

## 11. Phase 3 findings (semantic verification)

### No supported manual-execute path for scheduled flows ⚠️

Checked before building the verification layer, because firing a scheduled flow on demand
would be the cleanest way to verify one:

- **`now-sdk --help`** exposes no run/execute/trigger command. The only execution-related
  commands are `cicd test run` and `cicd testsuite run`, which run **ATF** tests — that
  requires authoring ATF artifacts, not executing a flow.
- **`sn_fd.FlowAPI`** (`FlowAPI.getRunner().flow('scope.name').inBackground().run()`) exists,
  but it is **server-side script only**. Reaching it over REST would mean creating a Scripted
  REST API or running a background script purely to trigger a flow — neither is a supported
  path, and both are exactly the kind of hack this project refuses.
- Forcing the platform scheduler (editing the `sys_trigger` row's `next_action`) manipulates
  internals and is not verification of the flow's own schedule.

**Consequence:** scheduled flows are verified by **metadata assertion** against the decoded
`trigger_inputs` config — the flow is active, a scheduled trigger exists, and the cadence
fields carry the expected values. `verifySchedule()` returns an explicit `caveat` saying this
proves the schedule is *configured*, not that it *fired*. Waiting on wall-clock firing is not
an option a verification run can take.

### `.verify.json` next to sources is safe ✅

The build scans `fluentDir` for `.now.ts` only. A `probe-test.verify.json` placed in
`src/fluent/flows/` built cleanly and produced no extra artifact, so verification specs can
live beside their source (same slug) without polluting the app.

### Journal fields need a different read path

`work_notes` and `comments` are journal fields: a plain `GET` returns them empty, because the
entries live in `sys_journal_field` keyed by `element_id` + `element`. Any assertion on a work
note has to read that table instead — this is why the Phase 1 manual proof queried
`sys_journal_field` directly. `readFieldValue()` detects journal types from the schema and
switches read path automatically, and compares by **containment** (journals accumulate
entries) while every other field compares **exactly**.

### sys_flow_context states

```
terminal ok   : COMPLETE
terminal bad  : ERROR, CANCELLED, PRESUMED_INTERRUPTED
settled-paused: WAITING, PAUSED          ← an approval flow legitimately stops here
in flight     : IN_PROGRESS, QUEUED, CONTINUE_SYNC, PAUSED_IN_DEBUG
```

The runner treats settled-paused as assertable (effects before the pause have landed), which
is what makes approval flows verifiable at all.

### Whole-app install touches every artifact's `sys_updated_on`

Measured during the Step 0 clean-up: deleting two flows advanced `sys_updated_on` on **all
three** surviving artifacts, because `install` redeploys the entire application. Idempotency
must therefore be measured as *same sys_id, no new rows* — never as *timestamps unchanged*.

---

## 12. Phase 4 — the duplicate-identity failure class ⚠️

A live codegen run failed **all 3 build attempts** with an SDK abort that never appeared before:

```
Record sys_hub_flow_logic_instance_v2.3f6799c741524cc3afadf8bbd2a3e52d is defined 2 times in the project
Record sys_hub_action_instance_v2.10c0ec9dcf0c486ab1e40f73c0edbe8d   is defined 2 times in the project
```

The offline build gate held exactly as designed: **zero instance mutation**, three attempts, then
a stop-and-ask. Nothing was deployed. What follows is the diagnosis.

### The mechanism: `$id` keys are a PROJECT-GLOBAL namespace

This is the part that was never written down. `$id: Now.ID['add_work_note']` does **not** mean
"an element called add_work_note inside this flow". `keys.ts` is a **flat, project-wide map**:

```typescript
add_work_note:        { table: 'sys_hub_action_instance_v2',      id: '10c0ec9dcf0c486ab1e40f73c0edbe8d' }
if_priority_critical: { table: 'sys_hub_flow_logic_instance_v2',  id: '3f6799c741524cc3afadf8bbd2a3e52d' }
```

One key → one sys_id, for the whole application. So when a *second* flow declares
`Now.ID['add_work_note']`, it does not get a fresh record — it resolves to **the same sys_id as
the first flow's action**, and the build aborts because one record is now claimed by two flows.

`HARD RULE 2` told the model the $id must be *"unique within the file"*. That is the bug in one
line: **the constraint is project-wide, and the rule said file-wide.**

### Evidence — Step 1a, source inventory

`ls server/fluent-workspace/src/fluent/flows/` at diagnosis time (8 sources, 5 verify specs):

| source | tracked | `.verify.json` | note |
|---|---|---|---|
| `daily-p1-digest.now.ts` | yes | — | scheduled; verified by metadata |
| `demo-incident-flow.now.ts` | **no** | **missing** | ⚠️ see below |
| `demo-incident-priority-notification.now.ts` | no | yes | |
| `escalate-network-p1-incident.now.ts` | yes | yes | |
| `handle-high-priority-incident.now.ts` | no | yes | last good deploy, 10:51 |
| `high-risk-change-approval.now.ts` | yes | yes | |
| `notify-p1-incident-assignment-group-manager.now.ts` | no | yes | |
| `smoke-test.now.ts` | yes | — | |

**No candidate from the failed run survived** — invariant (b) held. The `flows/` directory mtime
is `11:03:06` with no file carrying that mtime, which is the signature of a create-then-delete:
the candidate was written and swept. `keys.ts` was rewritten at `11:03:13` by the cleanup build.

`demo-incident-flow.now.ts` is a **hygiene smell but not the cause**: it is a real deployed
artifact (it owns flow `ba6a8fa5…` on the instance) that was never committed and never got a
verification spec. It is unmanaged, not stray.

### Evidence — Step 1b, the two definition sites

```
$ grep -rn "3f6799c7\|10c0ec9d" server/fluent-workspace/
src/fluent/generated/keys.ts:14   id: '10c0ec9dcf0c486ab1e40f73c0edbe8d'   ← key add_work_note
src/fluent/generated/keys.ts:390  id: '3f6799c741524cc3afadf8bbd2a3e52d'   ← key if_priority_critical
```

The raw sys_ids appear **only** in `keys.ts` — sources never write them, they write the *key*.
Resolving each key to its declaring source:

```
$ grep -rn "add_work_note\|if_priority_critical" src/
escalate-network-p1-incident.now.ts:110   { $id: Now.ID['add_work_note'] }         → 10c0ec9d…
demo-incident-flow.now.ts:32              $id: Now.ID['if_priority_critical'],     → 3f6799c7…
```

And `dist/` proves both sys_ids were already **owned by deployed flows** before the failed run:

```
dist/app/update/sys_hub_flow_55a03b37….xml:61   <sys_id>10c0ec9dcf0c486ab1e40f73c0edbe8d</sys_id>
dist/app/update/sys_hub_flow_ba6a8fa5….xml:123  <sys_id>3f6799c741524cc3afadf8bbd2a3e52d</sys_id>
```

### Diagnosed class: **CLASS C**

Both duplicated sys_ids **already existed in previously deployed artifacts** (`Escalate Network
P1 Incident` and `Demo Incident Flow`). The failing candidate declared `add_work_note` and
`if_priority_critical` a *second* time, and each collided with a different existing flow.

- Not **CLASS A**: the collisions are candidate-vs-existing, not two `$id`s inside one file.
  Cross-checking all 60 `Now.ID` keys across the 8 surviving sources reports **zero** duplicates.
- Not **CLASS B**: no stray candidate from a prior failure was involved. The second definition
  site in each pair is a legitimately deployed artifact, not a leftover.

### Why the model reached for those two keys

The spec under generation said *"add a work note on the incident"* and *"If the incident's
priority is Critical"*. The model named its elements **semantically** — `add_work_note`,
`if_priority_critical` — which is exactly what a sensible author does, and exactly what
collides, because two different flows that both add a work note converge on the same name.

The cheatsheet makes this worse rather than better: it is fed into every codegen prompt as
"authoritative, build-verified" and its examples use **the live keys of deployed sources
verbatim** — `notify_manager_subflow`, `nm_lookup_task`, `nm_send_email`, `nm_outputs_sent`,
plus bare keys like `log`, `note`, `set`, `t`, `step`, `guard`. Any of those copied into a new
flow reproduces this failure immediately. Semantic convergence and example-copying are the same
defect: **a key that is not freshly minted is a live sys_id belonging to someone else.**

### Rejected fix: timestamp-suffixed keys

The runtime agent proposed suffixing keys with a timestamp. **Rejected.** That guarantees a
different key on every regeneration, which is precisely the Phase 3 identity defect in §6:
`Now.ID` stability is what makes redeploy *update in place* instead of duplicating. A spec that
regenerates must keep its sys_ids. Random or time-based identity is never the answer here —
uniqueness has to come from a **namespace**, not from entropy.

### Fix: three guards (see §13)

1. **Pre-build static validation** of every candidate — duplicate `$id` within the candidate, or
   collision with any other project source, is rejected *before* `now-sdk build`, with a precise
   retry diagnostic naming the key and both definition sites.
2. **Retry hygiene invariant** — every attempt for one request targets the same
   fingerprint-derived filename, never the model's chosen flow name; `src/` is swept before each
   request and *asserted* back to its pre-request state after a failure.
3. **Context sanitation** — `$id` keys in any source fed back into the prompt are neutralised
   (names kept), and the cheatsheet carries a HARD RULE with the mint format.

---

## 13. The three identity guards (Phase 4 fix)

All three are **offline**. None of them can touch the instance, and all three run before
`now-sdk build` is spawned. `npm test` in `server/` exercises them (18 tests, no network).

### Guard 1 — pre-build static validation ✅

`validateCandidateIds(candidate, others, { file })` parses every `Now.ID['key']` out of a
candidate and rejects it *before* the SDK runs when:

| check | why |
|---|---|
| same key twice inside the candidate | CLASS A |
| key already declared by another source in `src/` | CLASS B / CLASS C |
| literal 32-hex sys_id used as an `$id` | identity the SDK cannot track |
| leftover `__ID_n__` placeholder | guard 3 round-trip failed; never ship it |

The value is the *diagnostic*. The SDK aborts with a sys_id the model never wrote:

```
Record sys_hub_action_instance_v2.10c0ec9dcf0c486ab1e40f73c0edbe8d is defined 2 times in the project
```

There is nothing in the model's own source matching that string, so the retry is blind — which
is why all three attempts failed identically. The guard says instead:

```
ERROR: identity validation failed before build.
ERROR: Duplicate $id across the project: Now.ID['add_work_note'] is defined 2 times —
candidate-<fp>.now.ts:8 and escalate-network-p1-incident.now.ts:8. Now.ID keys are a
PROJECT-WIDE namespace: this key already identifies a live record owned by
escalate-network-p1-incident.now.ts, so reusing it collides instead of creating a new element.
Mint a fresh key unique to this flow (prefix every key with a short slug of this flow's name,
e.g. 'vhp_add_work_note').
```

It names the key, both definition sites, the rule, and the repair. It is shaped like compiler
output so the existing retry prompt feeds it back unchanged — **a cryptic abort became a
self-correcting retry**. A rejected candidate is never written to `src/`, so an identity failure
costs no disk state and no SDK invocation at all.

### Guard 2 — retry hygiene, asserted ✅

- **One filename per request.** Every attempt writes `candidate-<spec-fingerprint>.now.ts`.
  The model's chosen flow name no longer selects the file it is written to; a new artifact is
  renamed to its readable slug **only after it builds**, and never onto a name another spec
  already owns (that returns a loud `stage: 'naming'` failure instead of clobbering a live
  artifact's source).
- **Sweep on entry.** Any `candidate-*.now.ts` on disk means an earlier request died without
  cleaning up. It is removed and reported (`hygiene_swept`) before the run starts.
- **Cleanup is proven, not assumed.** `src/` is snapshotted (content-addressed) after the sweep
  and diffed after a terminal failure. The result carries
  `hygiene: { restored, drift, sweptOnEntry }`, and a non-empty `drift` changes the failure
  message. Invariant (b) is now an assertion the pipeline reports on.
- **Latent bug fixed.** The old terminal-failure path ran `rm(file)` — but on a *regeneration*
  `file` is the deployed artifact's own source. Three failed attempts at editing an existing
  flow would have deleted it from `src/`, and the next whole-app install would have deleted it
  **from the instance**. Restore-from-snapshot replaces the delete.

### Guard 3 — context sanitation ✅

Every source fed into the codegen prompt has its `Now.ID` keys swapped for `__ID_n__`
placeholders through one shared map, and the real keys are substituted back into the model's
output. Two consequences:

- The model **never sees a live key**, so it cannot copy one — the CLASS C vector is closed at
  the source rather than argued against in prose.
- Identity of a regenerated artifact is preserved **mechanically**. Previously the prompt asked
  the model to keep every `Now.ID` key verbatim and trusted it; now keeping a placeholder is the
  only thing it *can* do, and the mapping back is deterministic. This is strictly stronger than
  the old instruction, and the `sanitize → edit → restore` round trip is unit-tested.

`name:` values are never touched — the verbatim-name survival mechanism is what keeps the
platform matching the same artifacts, and it stays exactly as it was.

Cheatsheet examples are prefixed `ex_` before being embedded. Its snippets are **real deployed
sources**, so `Now.ID['nm_send_email']` in an example is a *live key*; copying it reproduced the
collision exactly.

### The rule that was wrong, in both places

`HARD_RULES` rule 2 (`fluent.js`) and rule 2 of the cheatsheet's non-negotiables both said keys
must be unique **"within the file"**. Both now state the project-wide namespace, forbid copying
from examples or existing sources, forbid entropy-based uniqueness, and give the **mint format**:

```typescript
// Flow "Vendor Hold Problem" → prefix vhp_
$id: Now.ID['vhp_trigger']
$id: Now.ID['vhp_create_problem']
$id: Now.ID['vhp_if_critical']
```

The prefix supplies uniqueness; the suffix supplies readability. Bare keys (`log`, `note`,
`set`, `add_work_note`, `if_priority_critical`) are precisely the ones that collide.

---

## 14. Phase 4 live test — the vendor-hold spec

Driven through `createLiveFlow()` → `verify()`, the entry point the panel route
(`POST /api/flows/live`) and the agent tool `create_flow_live` both call. Provider: Ollama
`gpt-oss:120b-cloud`.

### Deploy ✅

| | |
|---|---|
| build attempts | **1** |
| activation | **10/10** |
| flow | `Create Problem for On Hold Vendor Incidents` — `39acb67eac164650a6b15f5e724cae76`, active |
| structure read back | 1 trigger, 5 actions, 1 logic block |
| element keys | `vpo_trigger_updated`, `vpo_lookup_hw_group`, `vpo_create_problem`, `vpo_update_incident_problem`, `vpo_add_work_note`, `vpo_if_critical`, `vpo_assign_problem_manager` |

Every key is flow-prefixed and freshly minted. Across all six live runs the identity guard never
had to reject a candidate — the HARD RULE alone was enough once the cheatsheet stopped handing
out live keys.

### The guards, measured live ✅

- **Guard 2** — every attempt wrote `candidate-0a8c04f64afd4b31.now.ts`, the spec fingerprint,
  including a run where attempt 1 failed on `TS4111` and attempt 2 succeeded. The model named the
  flow *"Create Problem for On Hold Vendor Issues"*, *"...Vendor Incidents"* and *"...On Hold
  Vendor Incident"* on different runs; not one of those names ever selected a filename.
- **Guard 3** — on the regeneration path the deployed source went to the model with its keys
  replaced by `__ID_n__`, and came back with **every `cphv_*` key byte-identical** and the
  artifact name preserved verbatim, while the body changed. Identity survived mechanically.

### Trigger and condition, as generated

```typescript
wfa.trigger(
    trigger.record.updated,
    { $id: Now.ID['vpo_trigger_updated'] },
    { table: 'incident', condition: 'state=3^hold_reason=4', run_flow_in: 'background' }
),
// lookup:  conditions: `sys_id=8a5055c9c61122780043563ef53438e3`
// if:      condition: `${wfa.dataPill(params.trigger.current.priority, 'integer')}=1`
```

**Encoded values, not display labels** — confirmed against the instance's own choice lists:

| written | means | label on this instance |
|---|---|---|
| `state=3` | `state` value 3 | On Hold |
| `hold_reason=4` | `hold_reason` value 4 | Awaiting Vendor |
| `priority ... =1` | `priority` value 1 | 1 - Critical |
| `sys_id=8a5055c9…` | resolved sys_id | the Hardware group |

Not one display label leaked into a query. The group is matched by resolved sys_id rather than by
name, which is what the rewritten NO MATCH guidance pushes the model toward.

### Verification: create-then-update works, one promise is unsatisfiable

The runner extension fired correctly. Setup created the incident **outside** the trigger
condition, then transitioned it in, and the platform's computed value was read back:

```
transition -> incident_state: On Hold (3), hold_reason: Awaiting Vendor (4), priority: 1 - Critical
flow execution state: COMPLETE
```

`priority` was driven through `impact=1` + `urgency=1` and landed as Critical, never written
directly. A record-UPDATED trigger is now reachable; before this extension it was not.

**Direct read-back counter-probe of all five promised effects** (measurement, not a
model-authored assertion):

| | promise | expected | actual |
|---|---|---|---|
| ✅ | problem created, description prefixed | `Vendor issue: Counter probe alpha` | `Vendor issue: Counter probe alpha` |
| ✅ | problem assigned to Hardware | `Hardware` | `Hardware` |
| ❌ | incident's Problem field links back | `PRB0040006` | **no such field on this instance** |
| ✅ | work note contains the problem number | contains `PRB0040006` | `Linked Problem PRB0040006` |
| ✅ | Critical → problem Assigned to = Hardware manager | manager is EMPTY, so no assignment | empty |

**4 of 5 confirmed. The one failure is not a flow defect and not a pipeline defect.**
`problem_id` exists on **no table** on this instance — `element=problem_id` returns zero
`sys_dictionary` rows, and none of the 20 reference fields on `incident`/`task` points at
`problem`. The request asked for a link the instance has nowhere to store. ServiceNow accepts a
write to an unknown field silently, so the flow "succeeds" and the effect simply never happens.

The fifth promise is vacuous in a different way: the Hardware group has no manager
(`manager = ""`), so "assign to the group's manager" can only ever produce an empty value. The
flow does the right thing; there is nothing to observe.

### The false green, and why `verify` now refuses to run some specs ⚠️

One generated spec reported **4/4 green** and it was **wrong**. It proved the Problem link with

```json
"locate": { "byQuery": "sys_id={{setup.sys_id}}^problemISNOTEMPTY" }
```

ServiceNow **silently drops** a condition naming a field that does not exist. Measured against a
single incident:

```
sys_id=<id>^problemISNOTEMPTY             MATCHES
sys_id=<id>^problemISEMPTY                MATCHES   <- both, simultaneously
sys_id=<id>^zzz_totally_madeupISNOTEMPTY  MATCHES
sys_id=<id>^work_notesISNOTEMPTY          no match  <- a real field constrains
```

So the locator matched regardless, and an effect that never happened reported green. This is the
worst failure mode in the pipeline: it does not merely miss a bug, it **certifies its absence**.
Every asserted field and every field a locator constrains on is now checked against the live
schema — at generation time, and again before a stored spec runs. On the final run the model
spent all 3 attempts insisting on `^problemISNOTEMPTY`, so **no verification spec was produced**
and `createLiveFlow` reported the gap:

```
"verification": { "available": false,
  "reason": "Could not produce a valid verification spec in 3 attempts." }
```

That is the correct outcome. The flow is deployed and honest about being unverified, rather than
carrying a green that means nothing.

### Other defects this test surfaced (all fixed, each committed separately)

| defect | consequence | fix |
|---|---|---|
| create-only setup | a record-UPDATED trigger could never fire | `setup.update` transition step |
| empty related field omitted from context | model invented a group manager "John Doe" | empty fields stated as EMPTY |
| `{{token}}` accepted in `expect` | a correct work note reported FAIL | non-literal expectations rejected |
| `*` wildcard / "not empty" in `expect` | a correct work note reported FAIL again | same guard, widened |
| unresolvable proper noun | `name=Hardware group` matched nothing → **flow ERRORed on every run** | retry without trailing common noun; a real miss lists what exists |
| deployed source outranked live context | a stale name survived every regeneration | live context wins for values, never for identity |
| locator on a non-existent field | **false green** | schema check on every asserted and constrained field |

### Honest status

- Deploy: **green**, 1 attempt, 10/10, read back off the instance.
- Flow behaviour: **4 of 5 promises confirmed by direct read-back**; the 5th is unsatisfiable on
  this instance.
- Pipeline verification: **not green — no spec could be produced**, because the only assertion the
  model would write for the impossible promise was one that could only pass vacuously.
- The flow is **left deployed and active** for manual counter-probes.

The provider is the weak link throughout. Across six runs the same spec produced a different flow
name every time, dropped the `"Vendor issue: "` prefix on one regeneration, and wrote a different
malformed assertion on nearly every verification attempt. Each guard added here catches a real
class of that damage; none of them can make a weak model competent. `fluent.js` already surfaces
this as a hint, and it is the first lever to pull before reading anything else into these results.

---

## 15. Step 0 audit — is the field-existence checker lying?

The checker blocked a verification spec three attempts running and left Test 1 unverified. A
guard that blocks work has to meet the same falsifiability bar as the assertions it blocks, so
the claim *"`problem_id` has zero `sys_dictionary` rows on any table"* was re-tested from
scratch. The suspicion was reasonable: `problem_id` is standard OOB on `incident`, and this
instance plainly has a `problem` table — the flow created `PRB0040006` on it.

### Verdict: **the checker is correct. `incident.problem_id` does not exist on this instance.**

Four independent lines of evidence, one of which never touches `sys_dictionary`.

**(a) Raw `sys_dictionary`**

```
  0 rows | name=incident^element=problem_id
  0 rows | nameINincident,task^element=problem_id      (full hierarchy: incident -> task)
  0 rows | element=problem_id                          (ANY table)
  0 rows | nameINincident,task^element=problem
  0 rows | nameINincident,task^elementSTARTSWITHproblem
```

**(a2) …and the dictionary read is neither blocked nor truncated.** The same query path returns
**92 rows** for the chain (`task` 70, `incident` 22) against a limit of 2000, with ordinary
elements coming back (`hold_reason`, `caller_id`, `category`, `child_incidents`, …). The reader
works; there is simply no `problem_id` row to find.

**(b) `getSchema('incident')`** — 91 fields, `problem_id` absent, `problem` absent, and **zero**
reference fields pointing at `problem`.

**(c) The checker's own path**, exercised directly — and it is *not* over-generalising the
model's word "problem". It independently rejects `problem_id`, and it **passes** the real
control:

```
FAIL | assert field problem_id            FAIL | locator on bare problem
FAIL | locator on problem_id              PASS | locator on work_notes   <- real field, accepted
FAIL | assert made_up_field_xyz (control)
```

**(d) Independent of `sys_dictionary` entirely — the Table API itself.** A full record GET
returns **89 fields**; `problem_id` is not among them. Asking for it by name gets it dropped
exactly like an invented field, while a real field comes back:

```
sysparm_fields=sys_id,problem_id        -> ["sys_id"]
sysparm_fields=sys_id,made_up_field_xyz -> ["sys_id"]
sysparm_fields=sys_id,work_notes        -> ["sys_id","work_notes"]
```

And the silent-drop signature is unambiguous — a condition on an absent field matches *both*
`ISNOTEMPTY` and `ISEMPTY`, while a real field constrains:

```
problem_id         ISNOTEMPTY=match ISEMPTY=match   <- dropped
problem            ISNOTEMPTY=match ISEMPTY=match   <- dropped
rfc                ISNOTEMPTY=match ISEMPTY=match   <- dropped
caused_by          ISNOTEMPTY=match ISEMPTY=match   <- dropped
work_notes         ISNOTEMPTY=none  ISEMPTY=none    <- constrains
```

`rfc` and `caused_by` are absent too. That is a coherent pattern, not a random hole: **this PDI
does not carry the ITSM incident↔problem/change linkage fields at all.**

### So the model's three-attempt insistence was WRONG, and the guard was right

The hypothesis going in was that the guard had starved a valid assertion. It had not. The model
kept proposing `^problemISNOTEMPTY` for a field that does not exist, which would have passed
vacuously — the false green the guard was built to stop. `createLiveFlow` refusing to emit a
verification spec, and saying so, was the correct outcome.

The guard is now held to the bar it imposes: an **offline** regression test injects a schema
resolver and asserts that a field which exists passes (in both the asserted position and the
locator), that an absent field fails in both, and that an unreadable schema never fails a spec —
the guard must not block on our own outage.

### The link mechanism that DOES exist here

`problem` extends `task`, and so does `incident`, which leaves two real reference fields — both
verified to constrain properly:

| field | → | label | direction |
|---|---|---|---|
| `incident.parent` | `task` | Parent | incident → problem |
| `problem.first_reported_by_task` | `task` | Origin task | problem → incident |

```
incident.parent                ISNOTEMPTY=none ISEMPTY=match   <- constrains
problem.first_reported_by_task ISNOTEMPTY=none ISEMPTY=match   <- constrains
```

`task_rel_task`, `incident_problem` and `m2m_incident_problem` are all absent, so there is no m2m
route either.

**Test 1's third promise is therefore restated, not dropped:** *"link it back by setting the
incident's Problem field"* becomes **set `incident.parent` to the new problem** — the nearest
mechanism this instance actually provides, and one a verification spec can prove without faking
it. Writing `problem:` was never going to work; ServiceNow accepts writes to unknown fields
silently, which is why the flow reported success while the effect never landed.

---

## 16. Trap ledger

Instance and SDK behaviours that produce a *confidently wrong* result rather than an error.
Each one cost a debugging cycle here.

| # | trap | what it looks like | how to not be fooled |
|---|---|---|---|
| 1 | **`keys.ts` is a flat project-wide map** | `Record <table>.<sys_id> is defined 2 times in the project`, naming a sys_id absent from your source | `$id` keys are global. Prefix every key with a per-flow slug; never copy one from an example |
| 2 | **Encoded queries silently DROP conditions on unknown fields** | `^fooISNOTEMPTY` and `^fooISEMPTY` both match the same record | Check every queried field against the live schema before trusting a locator |
| 3 | **Writes to unknown fields are silently accepted** | flow completes, `activation 10/10`, effect never happens | Read the effect back off the instance; never infer it from a green deploy |
| 4 | **`sysparm_fields` drops unknown names without complaint** | requested 2 fields, got 1, no error | Compare returned keys against requested keys |
| 5 | **`priority` is computed** | `{"priority":"1"}` lands as `4 - Low` | Drive `impact` + `urgency`; never write the result |
| 6 | **`lookUpRecord` on a query matching nothing ERRORS the flow** | build green, every execution fails | Resolve proper nouns against the instance first; a miss is a loud failure, not a fallback |
| 7 | **Journal fields are invisible to a plain GET** | `work_notes` reads empty on a record that has notes | Read `sys_journal_field` by `element_id` + `element` |
| 8 | **`now-sdk install` ships the WHOLE application** | one artifact requested, every artifact's `sys_updated_on` moves | Measure idempotency as *same sys_id, no new rows* — never as unchanged timestamps |
| 9 | **This PDI lacks `problem_id`, `rfc`, `caused_by`** | "the standard field" isn't there | `incident.parent` / `problem.first_reported_by_task` are the available task-to-task links |
| 10 | **`trigger_strategy` defaults to `once`, and `once` means once EVER** | a record that re-enters the trigger condition is never processed again | Set it explicitly on every updated/createdOrUpdated trigger; `unique_changes` is the per-transition form |
| 11 | **`sys_hub_trigger_instance_v2` has no `condition`/`table_name` columns** | a field query returns a row of nulls | The config is a gzip+base64 blob in `trigger_inputs`; decode it |

---

## 17. Step 2 — behavioural counter-probes

The verification layer proves *that a promised effect happened*. It cannot prove *that an effect
happens only when it should*, or *how often*. Both blind spots were probed live against the
deployed flow, with every test record deleted and the deletion read back.

### The trigger construct, read off the instance

`sys_hub_trigger_instance_v2` stores its config in `trigger_inputs`, a gzip+base64 blob.
Decoded:

| parameter | value |
|---|---|
| `trigger_type` / `trigger_definition` | `record_update` / `Updated` |
| `table` | `incident` |
| `condition` | `state=3^hold_reason=4` |
| `run_flow_in` | `background` |
| `run_on_extended` | `false` |
| **`trigger_strategy`** | **`once`** |

So it is a **condition-on-update** trigger, not a changes-to construct. Nothing in the generated
source set `trigger_strategy` — the SDK left it out and the platform supplied its default.

> Reading this needed a detour: asking `table.query` for `condition`, `table_name`, `type` on
> `sys_hub_trigger_instance_v2` returned a row of **nulls**, because those columns do not exist —
> trap #4 (silent `sysparm_fields` drop) catching our own probe. The real columns are `flow`,
> `trigger_type`, `trigger_definition`, `trigger_inputs`.

### PROBE A — is the Critical branch actually conditional? ✅ **yes**

The probe as specified would have passed **vacuously**: `assigned_to` is set from the Hardware
group's manager, and that manager is empty, so `assigned_to` ends up empty whether the branch
runs or not. That is trap #2 applied to our own test. A manager (`Abel Tuter`) was set for the
duration and restored to empty afterwards, read-back confirmed, which makes the branch observable.

| | priority | assignment_group | assigned_to | `sys_mod_count` |
|---|---|---|---|---|
| non-critical | `4 - Low` (impact 3 + urgency 3) | Hardware | **empty** | 0 |
| critical (control) | `1 - Critical` (impact 1 + urgency 1) | Hardware | **Abel Tuter** | 1 |

The branch fires only for Critical, and the unconditional part (assign to Hardware) runs for
both. `sys_mod_count` agrees independently: the problem is untouched after insert in the
non-critical case, updated once in the critical one.

### PROBE B — does an unrelated update re-fire the flow? ✅ **no**

With the incident still On Hold / Awaiting Vendor, an unrelated field (`comments`) was updated.
Executions stayed at **1**, problems stayed at **1**. **No duplicate-record spam.**

### PROBE B2 — but `once` means once *ever*, not once *per transition* ⚠️

`trigger_strategy: 'once'` needed pinning down, so one incident was driven through a full cycle:

```
[1] entered condition  (On Hold / Awaiting Vendor)  -> 1 execution, 1 problem
[2] left the condition (In Progress, no hold reason) -> 1 execution, 1 problem
[3] RE-ENTERED the condition                         -> 1 execution, 1 problem
```

**The flow never runs again for that record.** An incident that goes on vendor hold, gets worked,
and later goes back on vendor hold gets **no second problem** — silently.

That behaviour was never chosen. The SDK exposes the setting and documents its default:

```typescript
trigger_strategy: Typed<"every" | "once" | "unique_changes" | "always", {
  label: "Run Trigger", default: "once",
  hint: "Run Trigger every time the condition matches, or only the first time.",
  choices: { once: "Once", unique_changes: "For each unique change",
             always: "Only if not currently running", every: "For every update" } }>
```

The spec said *"when an incident is **updated to** state On Hold"* — a **transition**, which is
`'unique_changes'`. The generated flow omitted the parameter, so the platform picked `'once'` and
narrowed the promise to "the first time this incident ever hits vendor hold".

The cheatsheet already listed `trigger_strategy` and even said "prefer `unique_changes`" — and
the model omitted it anyway. A parameter listed in a table is easy to skip; a **silent default
with teeth** is not something the author should be allowed to skip. Both the cheatsheet and
`HARD_RULES` now state that omitting it is not neutral, what `once` actually costs, and which
value a "updated TO" phrasing implies.

**Regenerating Test 1 with `trigger_strategy: 'unique_changes'` is the correct follow-up**, and
is queued behind the provider switch — it needs a generation run.

### What the probes cost, and what that says about the verification layer

Neither of these findings is reachable from a verification spec as the layer is built: both
require *two* runs of the same flow, or a run that is expected **not** to happen. The
`.verify.json` shape has one setup, one wait, one set of assertions. Branch conditionality and
re-fire semantics are structurally outside it. They belong in a separate probe harness, and until
one exists they are a known, named gap rather than a silent one.

---

## 18. Step 3 — hygiene closure, and two broken artifacts it exposed

### `demo-incident-flow.now.ts` is under git ✅

It is tracked, along with every other source and verify spec in `src/fluent/flows/`. The
working tree is clean.

### It cannot be given a verification spec — three independent reasons

**1. It has never executed. Not once.** Its trigger is `record_create` on `incident` with an
**empty condition**, so it should fire on every incident insert. Across this session's probes —
including a dedicated one that created a P1 incident and waited a fixed 45s — it produced **zero**
`sys_flow_context` rows, while other flows on the same insert did:

```
Notify P1 Incident Assignment Group Manager -> Complete
Demo Incident Priority Notification         -> Error
Demo Incident Flow                          -> (never appears)
```

Verification works by firing a flow and asserting its effects. A flow that does not fire cannot
be verified by any spec.

**2. `u_demo_flag` does not exist on `incident`.** Verified the same three ways as `problem_id`:
absent from the 91-field schema, no `u_*` fields on the table at all, and `sysparm_fields=sys_id,
u_demo_flag` returns only `sys_id`. The flow's `update_demo_flag` action writes to nothing, and
the field-existence checker would reject any assertion on it — correctly.

**3. The group "Incident Manager" does not exist.** The nearest is **"Incident Management"**. The
flow's `lookup_incident_manager_group` uses `conditions: name=Incident Manager`, which matches
nothing — trap #6, the failure that ERRORs a flow at run time.

So two of its three promised effects target things this instance does not have, and the flow
never runs. **The precise reason it has no `.verify.json` is recorded here rather than papered
over with a spec that could only pass vacuously.**

### Why it never fires: undetermined, and stated as undetermined

Two hypotheses were tested and **both failed**:

- *"Empty `compiler_build`"* — it is empty on this flow, **but also on `Handle High Priority
  Incident`, which runs.** Not the discriminator.
- *"The trigger instance is malformed"* — a field-by-field diff against `Demo Incident Priority
  Notification` (also `record_create` on `incident`, and it does fire) shows the two trigger
  records are structurally identical: same `trigger_type`, same `trigger_definition`, same scope.
  Not the difference.

One unexplained inconsistency remains, recorded without a causal claim: its published
`master_snapshot` is dated **2026-08-17 18:40:08**, which is *older* than its own trigger
instance's last update (**23:34:50**) and older than the source file itself. `latest_snapshot`
and `master_snapshot` are the same record, whereas working flows have them differ. That is
suspicious, not proven.

**Recommended disposition:** this artifact is a demo leftover whose two distinctive effects are
unbuildable here. Either regenerate it against real targets (`Incident Management`, and an effect
on a field that exists), or remove it with `removeManaged`. Both need a generation run, so both
are queued behind the provider switch.

### Bonus finding — `Demo Incident Priority Notification` is broken in production

It is active, it fires on every P1/P2 incident, and it **errors every time**:

```
Email validation failed: Email has no recipients.
```

Same root class as the Hardware manager: it emails a group's manager, the manager (or their
email) is empty, and `sendEmail` with no recipient is a hard error rather than a no-op. This is
pre-existing and unrelated to the hotfix, but it is a live flow failing on every execution and
should not stay that way.

### Survey of all 10 NowHelpAssist-scoped artifacts

| artifact | type | active | ever run |
|---|---|---|---|
| Notify P1 Incident Assignment Group Manager | Flow | ✅ | ✅ |
| Handle High Priority Incident | Flow | ✅ | ✅ |
| Create Problem for On Hold Vendor Incidents | Flow | ✅ | ✅ |
| Escalate Network P1 Incident | Flow | ✅ | ✅ |
| Demo Incident Priority Notification | Flow | ✅ | ✅ **errors every run** |
| Notify Manager | SubFlow | ✅ | ✅ |
| High Risk Change Approval | Flow | ✅ | ✅ |
| Daily P1 Digest | Flow | ✅ | ❌ scheduled, window not yet hit |
| NowForge Smoke Test | Flow | ✅ | ❌ no trigger by design |
| **Demo Incident Flow** | Flow | ✅ | ❌ **should fire on every incident; never does** |

---

## 19. The model-proofing floor (guards A1–A5)

Phase 4 ended with a working pipeline and an honest problem: *the provider is the weak link
throughout*. Six live runs of one spec produced six different flow names, one regeneration
silently dropped a promised text prefix, and three verification attempts re-sent the same
impossible locator. None of those is a bug in NowHelpAssist. All of them shipped, or nearly shipped,
a wrong artifact.

The floor is five guards that make each of those failure classes **structurally unable to reach
the instance**. They do not make `gpt-oss:120b-cloud` competent. They make it *presentable*: when
it is wrong, the pipeline says so instead of deploying it.

Offline proof: `server/test/model-proofing.test.js`, 30 cases, part of `npm test`.

### A1 — deterministic decoding, and the measurement that matters ⚠️

`temperature: 0` and a seed derived from the spec fingerprint are now sent on every codegen and
verification call, passed through by each adapter to whatever the provider actually has
(Anthropic has no `seed`, so none is fabricated — `DECODING_SENT` records that rather than
implying otherwise).

Then the obvious question was asked instead of assumed: **does Ollama honour any of it?**

Four pairs of identical calls, `gpt-oss:120b-cloud`, high-entropy prompt:

| probe | setup | result |
|---|---|---|
| P1 | temp 0, seed 42 twice | **DIFFERENT** |
| P2 | temp 0, seed 42 vs seed 9999 | **IDENTICAL** |
| P3 | temp 1.0, seed 42 twice | **DIFFERENT** |
| P4 | temp 1.0, seed 42 vs 9999 | DIFFERENT |

P2 and P3 together are decisive, and they point the same way: **the seed has no causal effect.**
Two different seeds produced identical text; the same seed twice produced different text. If the
seed were honoured, both of those results would be the other way round.

A follow-up separated "the OpenAI-compat shim drops the field" from "the backend ignores it".
Three calls to the **native** `/api/chat` with identical `options.seed` at temperature 1.0:

```
n1: Eclipsed Lattice of Aeons | Vermilion Quasar Canticle | Silicate Maelstrom Voyager | …
n2: Aetherial Nomad          | Chronicle of the Void     | Obsidian Whisperwind        | …
n3: Eclipsed Aurora          | Quantum Siren             | Obsidian Celestia           | …
```

Three seeded-identical requests, three different answers. **The seed is ignored by the backend,
not dropped by the shim.**

And temperature 0 is only *approximately* stable — three identical calls:

```
t1: Celestial Harbinger | Obsidian Whisper | Aetheric Nomad  | Quantum Siren     | Eclipsed Aurora
t2: Celestial Harbinger | Obsidian Whisper | Quantum Aurora  | Eclipsed Seraphim | Nebulae's Lament
t3: Celestial Harbinger | Obsidian Whisper | Quantum Aurora  | Eclipsed Seraphim | Nebulae's Lament
```

A shared prefix, then divergence at item 3 — the signature of batched GPU inference, where the
greedy argmax is stable while one candidate dominates and flips when two are near-tied.

**Consequence, and it is load-bearing:** no guard in this repo may assume a reproducible
generation, because on the only model available here there is no such thing. Every guard A2–A5
is written to hold under non-determinism. The parameters are still sent, because a stronger model
swapped in through Settings may well honour them and the passthrough costs nothing — which is
exactly the "a stronger model is a pure Settings swap" property this build is designed around.

`providerInfo()` now reports this reality to the UI, so a non-reproducible backend is a visible
fact rather than a footnote.

### A2 — pinned flow identity

The platform matches artifacts by **name**. A rename is therefore not cosmetic: it creates a
second flow instead of updating the first. Across six runs this model produced *"…Vendor
Issues"*, *"…Vendor Incidents"* and *"…Vendor Incident"*, and HARD RULE 2 asking it not to had
no measurable effect.

So the name is no longer requested — it is **imposed**. Pinned once per request (the deployed
name on a regeneration, the intent name on a new one), then rewritten into the model's output at
the string level, with every correction streamed as an SSE warning. Identity survives
mechanically, on the same principle as guard 3's placeholder substitution.

The names are located by **brace matching** on the `Flow(`/`Subflow(` config object, not a
fixed-width regex window: an `updateRecord` action's own `name:` parameter sits well inside an
800-character window, and a window-based rewrite would have pinned the wrong string. There is a
test for exactly that.

### A3 — promised literals

One regeneration dropped the `"Vendor issue: "` prefix the request asked for. It compiled,
installed, activated 10/10, and wrote the wrong text. Nothing downstream could catch it: the
build is green, and the verification assertion is written by the same model that dropped it.

The intent extractor now lists `promised_literals`, and every one is checked into the generated
source before the SDK runs.

The load-bearing detail is that **the extractor cannot invent a requirement**. Its list is
intersected with the spec text, so a hallucinated literal is discarded rather than blocking a
correct flow — the model can narrow this guard and never widen it. This repo has already had to
undo two guards that failed correct work (`{{token}}` and `*` in expectations); A3 is built so
that cannot happen.

Trailing whitespace is preserved deliberately. `"Vendor issue: "` and `"Vendor issue:"` are
different promises, and the space is the entire point of a prefix.

**Known limit, stated rather than assumed away:** grounding proves a string is in the *request*,
not that it is text the flow should *write*. A choice label the flow matches on ("Awaiting
Vendor", correctly encoded as `hold_reason=4`) would be enforced as a literal if the extractor
mislabelled it, and would then reject a correct flow. What prevents that is the extractor prompt,
not the checker. There is a test pinning this boundary so it stays visible.

### A4 — trigger_strategy lint

Trap #10, promoted from documentation to enforcement. An `updated` / `createdOrUpdated` trigger
must set `trigger_strategy` explicitly, and a request phrased as a **transition** ("updated to",
"moves to", "becomes", "whenever") must set `unique_changes`.

This is the least visible defect in the whole pipeline. The build is green, the install is 10/10,
and a single-shot verification run **passes** — because the first firing is correct. `once` is
only wrong the *second* time a record makes the transition, in production, weeks later. No
existing check could see it; §17's PROBE B2 found it only by deliberately re-transitioning a
record twice.

### A5 — retries that add evidence

Measured in §14: three verification attempts sent the same question and got the same rejected
answer. The attempt budget bought nothing, because nothing about attempt 2 differed from
attempt 1.

Two changes:

1. **Every rejection contributes measured evidence.** A field-check failure now attaches the
   instance's actual field inventory for the tables the spec named — including *every reference
   field and the table it points at*. "`problem` does not exist on `incident`" is a claim the
   model spent three attempts disbelieving. The dictionary is not a claim.
2. **An identical re-ask is structurally impossible.** A `RetryLedger` hashes every outgoing
   prompt and refuses to send one that repeats an earlier attempt, with a message saying this is
   a defect in the evidence builder rather than a model failure. Loud, per the house rule — the
   old behaviour quietly spent an attempt on a question that had already been answered.

Verification attempts were raised 3 → 4. Raising a budget is only worth anything *because* of
(2); four identical re-asks would simply cost four times as much.

### Trap ledger additions

| # | trap | what it looks like | how to not be fooled |
|---|---|---|---|
| 12 | **Ollama accepts `seed` and ignores it** | no error, no warning; the parameter is simply inert on `*-cloud` models, on both `/v1` and the native `/api/chat` | Never assume reproducibility. Verify with two identical seeded calls at temperature > 0 — if they differ, the seed is decorative |
| 13 | **`temperature: 0` is only approximately deterministic** | repeated identical calls agree for a while, then diverge mid-output | Batched inference re-orders floating-point reductions. Guards must hold under non-determinism; a "we pinned the seed" comment is not a guarantee |

---

## 20. Test 1 Step 1 resume — it closes, after the guards stopped contradicting each other

§14 left Test 1 with a deployed flow and **no verification spec**: three attempts running, the
model insisted on `sys_id={{setup.sys_id}}^problemISNOTEMPTY`, a locator on a field that exists
nowhere on this instance. Resumed here with the attempt budget at 4 and A5's measured evidence in
play.

**Result: closed. `ok: true`, 2 attempts, 3 assertions + 2 confirmed-unverifiable promises.**

Getting there took finding two bugs in the guards themselves, both of which mattered more than
the original failure.

### Provenance, stated plainly

The original spec text was **never persisted** — only its fingerprint, `0a8c04f64afd4b31`, and
none of three careful reconstructions reproduces it. The spec used here was rebuilt from the
deployed source's own `description` plus the five promises measured in §14.

So this is a re-run of the same **problem**, not a byte-identical replay of the same **request**.
That is a real limitation of the result and it is also the first concrete argument for Track A:
a pipeline that cannot say what it was asked to build cannot reproduce its own work. Sessions and
specs are now persisted (§A-1), so the next resume will not have this asterisk.

### The old failure class is gone

Attempt 1 reached for `^problemISNOTEMPTY` exactly as before. A5 attached one measured evidence
block — the actual reference-field inventory of `incident`, every field and the table it points
at — and **attempt 2 never returned to it, in any run.**

Three attempts of prose ("that field does not exist") had failed to move this model. One
dictionary listing moved it immediately. That is the whole thesis of A5, and it is the single
clearest measurement in this document: *the model does not need to be told again, it needs to be
shown once.*

### CLASS D — two guards that could not both be satisfied ⚠️

The first resume run did not close. It failed differently, and worse:

```
attempt 1  rejected: locator on `problem`, which does not exist        (evidence +1)
attempt 2  rejected: 6 promised effects, only 4 assertions written     (evidence +0)
attempt 3  rejected: 6 promised effects, only 4 assertions written     (evidence +0)
attempt 4  REFUSED by A5 — this prompt is byte-identical to attempt 3
```

The model had done exactly as instructed. The field-existence check told it to **drop** the two
assertions this instance cannot support; the coverage rule then rejected it for **dropping**
them. Two guards in direct contradiction, and **no model could have satisfied both.** More
attempts, a better model, a different prompt — none of it would have helped.

A5 caught it and named it correctly, in its own message: *"This is a defect in the evidence
builder, not a model failure."* Before A5, this would have quietly burned attempt 4 and reported
"could not produce a spec in 4 attempts", filing a bug in our own logic under the model's name.
That is the guard doing precisely the job it was built for.

Both dropped promises were independently re-measured and are genuinely unsatisfiable here:

```
incident.problem exists?                 false
incident.problem_id exists?              false
incident fields referencing `problem`:   NONE
Hardware group manager                   {"display_value":"","value":""}
```

**gpt-oss identified exactly the two promises §14's hand-run counter-probe found impossible, and
dropped exactly those two.** It was right, and the pipeline punished it for being right.

### The fix: a verified escape hatch, not a weaker rule

Coverage was not relaxed. A promise may now be excused only by naming itself, in a form this code
**checks against the live instance**:

```json
"unverifiable": [
  { "effect": "link the new problem back to the incident",
    "kind": "field_absent",  "table": "incident", "field": "problem" },
  { "effect": "assign the problem to the Hardware group manager when Critical",
    "kind": "source_empty",  "table": "sys_user_group", "field": "manager",
    "sys_id": "8a5055c9c61122780043563ef53438e3" }
]
```

`field_absent` is confirmed against the dictionary; `source_empty` by reading the named record.
An excuse that does **not** hold is rejected with the measurement refuting it — if the field turns
out to exist, or the value turns out to be non-empty, the model is told to assert the effect
instead. Without that, the hatch would be a way to assert nothing and still report a clean pass:
the false green of §14 in different clothes.

### Two bugs in the hatch, caught by running it

The first implementation of the hatch was itself wrong, in both of the ways this repo keeps
having to learn:

**1. A bare `catch` swallowed unverifiable claims.** The model excused a promise with
`table: "problem", field: "assigned_to"` while passing the sys_id of a **sys_user_group** record.
The read threw, `catch { continue; }` ate it, and the claim counted anyway. A silent fallback,
straight into the house rule. It now fails closed and says which table it could not read.

**2. Coverage subtracted CLAIMED excuses, not CONFIRMED ones.** A spec listed two excuses, only
one held up, and the requirement dropped by two regardless — a promise vanishing on the strength
of a claim about the wrong table. `validateVerifySpec` now takes `verifiedExcuses`, the count
`checkUnverifiableClaims` actually confirmed, and **defaults it to 0** so an unchecked caller
subtracts nothing.

The deliberate asymmetry is worth stating, because it looks like an inconsistency: the field
checker *never* fails a spec on our own outage, while an unverified *excuse* always fails closed.
Those protect opposite things. An unreadable schema must not block a correct **assertion**; an
unverified excuse must not silently remove a **requirement**. The failure modes are not
symmetric, so the rules are not either.

### The closing run

```
attempt 1  rejected: locator on `problem`             (evidence +1)
attempt 2  ready:    3 assertions, 2 excuses CONFIRMED
```

3 asserted + 2 confirmed-unverifiable = 5, exactly the 5 promised effects. The setup is a proper
create-then-update transition, and priority is driven through `impact` + `urgency` rather than
written directly — trap #5 respected without being reminded.

### Non-determinism, visible in the results themselves

Across three runs of the identical spec the intent extractor produced **6, 6 and 5** promised
effects, and the flow name came back as *"…Vendor Incidents"* once and *"…Vendor Issues"* twice.
Same input, same temperature 0, same seed. This is §19's finding showing up in ordinary
operation rather than in a probe, and it is why A2 imposes the name instead of asking for it.

### What remains, precisely

- **The deployed flow still carries trap #10.** `create-problem-for-on-hold-vendor-incidents.now.ts`
  sets no `trigger_strategy`, so it inherits `once` and fires **once ever** per incident.
  A4 now blocks new flows from shipping this defect, but it does not retro-fix a deployed one.
  Regenerating this flow would trip A4 and force the fix — that is a deliberate, separate change,
  not something to slip into a verification resume.
- **A3's ceiling is the intent extractor.** Grounding proves a literal is in the request, never
  that it is text the flow must write. A mislabelled choice label would reject a correct flow.
- **The spec is proven, not run.** `regenerateVerification` reads schema and calls the model; it
  writes nothing to the instance. Executing the spec is still a separate, approved step.

---

## 21. Memory and sessions (Part A)

The vanishing-chat bug had exactly one cause: history lived in a module-level
`Map`. Navigating Agent → Settings → Agent lost the transcript, and restarting the
server lost every conversation that had ever happened. Everything below follows
from fixing that at the root rather than papering over it in the client.

Offline proof: `server/test/memory.test.js`, 34 cases. Live acceptance runs are
quoted verbatim below.

### Storage — `node:sqlite`, checked rather than assumed

The choice was made by probing, not by preference:

| need | built-in `node:sqlite` on Node v24.18.0 |
|---|---|
| `DatabaseSync` / `StatementSync` | present |
| BLOB round-trip (`Uint8Array`) | works — required for float32 embeddings |
| FTS5 virtual tables | available — required for the keyword fallback |

All three hold, so `better-sqlite3` was not needed and the whole storage layer
is **dependency-free**. That matters specifically here: this is a Windows
machine with no node-gyp toolchain, so better-sqlite3 would have meant trusting
a prebuilt binary to match this exact Node ABI.

One file, `server/data/nowhelpassist.db`, gitignored. Migrations are idempotent on
boot, keyed on `PRAGMA user_version`, each in its own transaction — a
half-migrated database is worse than one that refuses to open. `migrate()` is
exported so the offline suite builds its scratch database through the **same**
code path; copying `sqlite_master` instead fails outright, because FTS5's shadow
tables (`chunks_fts_data`, …) cannot be created directly.

### A-1 — persistence

`sessions` / `messages` / `tool_events`. `messages.json` stores the neutral
history entry **verbatim**, so this table does not need migrating every time a
provider adapter learns a new field.

`tool_events` is deliberately a separate table, not a view over messages. It is
the record of what was done to the instance and what a human approved, and
**compaction rewrites messages but must never rewrite it**. There is a test
asserting exactly that.

### A-2 — the acceptance run, verbatim

Driven through the real HTTP surface the browser uses.

```
--- turn 1 ---
tools: lookup_reference
said : The Hardware group (sys_user_group) has the sys_id: 8a5055c9c61122780043563ef53438e3

--- turn 2: something unrelated in between ---
said : A ServiceNow subflow is a reusable, modular flow fragment…

--- remount: refetch the transcript exactly as the page does ---
messages persisted: 6 · tool events: 1 · tokens 175 / 24000

*** server killed (PID 11476, SIGKILL) and cold-restarted ***

transcript identical across the restart: YES   (6 -> 6 messages)

--- turn 3, on the freshly restarted server ---
tools: (none — answered from memory)
said : The Hardware group's sys_id is 8a5055c9c61122780043563ef53438e3.
```

The third turn is the one that matters: **no tool call**. The agent answered
from persisted history two turns later, across a process death.

The rail rehydrates from the NEUTRAL history rather than a second UI-shaped
copy, so what is redrawn cannot drift from what the model actually saw.
Approval cards are deliberately not reconstructed — an approval is a live
decision on an in-flight turn, and what it gated is visible in the tool card
beside it.

### A-3 — compaction

Oldest span → structured digest (artifacts + sys_ids, decisions, open threads),
spliced back as a **system-side note**, last K turns verbatim. The digest prompt
puts identifiers first and says so plainly, because an identifier cannot be
reconstructed and is what gets asked for later.

Budget sized at 24k against an advertised 131k window, deliberately. gpt-oss
bills hidden reasoning tokens against the same budget, and the adapter's
specific error ("the max_tokens budget was exhausted before any output was
produced") **must never fire during compaction**: a failed compaction leaves the
session over budget, so the next turn fails too. That is a loop, not a
degradation. The estimator uses 3.5 chars/token rather than the usual 4 for the
same reason — tool results are JSON and tokenise worse than prose, and guessing
high costs one early compaction while guessing low costs a failed request.

Every failure path is non-destructive: a summariser that throws, or returns an
empty digest, discards **nothing** and says so. Tested both ways.

Acceptance: a synthetic 100-turn session compacts under budget, and a probe
about turn 5 is answerable because its sys_id survives into the digest.

### A-3 again, live — where the offline test was lying to me ⚠️

The offline acceptance passed from the start. Running the same thing against
the real model did not, and the failure is the most instructive one in Part A
because **nothing reported an error**.

First live run, 60 turns of realistic traffic (query results dominating, one
flow deployed at turn 5):

```
history before: 36958 tokens (budget 24000), 120 entries
compacted: true  (76.5s)
tokens: 36958 -> 2502, under budget: true

ARTIFACTS AND IDENTIFIERS
- INC0010000 — incident — sys_id N/A — state 2
- INC0010001 — incident — sys_id N/A — state 2
- INC0010002 — incident — sys_id N/A — state 2
… 100+ more …

sys_id from turn 5 survived: false
flow name survived:          false
```

Green on every measurable signal — compacted, under budget, no error — and
**completely useless**. Told to "copy every record number and sys_id", the model
did exactly that: it enumerated a hundred padding incident numbers from query
*results*, hit its 6000-token cap, and never reached the one flow sys_id that
mattered. The digest was truncated, and a truncated digest is well-formed text
that simply stops.

The offline test passed because its stand-in summariser was a regex that pulled
out 32-hex strings. It was testing the splice, the budget arithmetic and the
failure paths correctly — and it could not test the only thing that failed,
because a regex is not a language model. **That is the general shape of the
lesson: a test double cannot exhibit the failure mode of the thing it doubles.**

Three fixes, in order of how much each mattered:

1. **Collapse list-shaped tool results before the model sees them.** A
   query result of 12 rows becomes `[12 rows returned; first row: …]`. Asking
   the model not to copy 700 record numbers is strictly weaker than not showing
   them to it. This is also what took the run from 76.5s to 8.8s.
2. **Separate the two kinds of identifier in the prompt.** `ARTIFACTS BUILT OR
   CHANGED` (created/updated/deleted — must be verbatim) versus `RECORDS ONLY
   LOOKED AT` (transient — a count, never a list). The old single heading
   invited exactly the confusion that occurred.
3. **Refuse a truncated digest.** All four headings must be present, or the
   generation was cut off and whatever came after it is gone. Without this,
   silent loss is indistinguishable from success — and this guard immediately
   caught two of my own test doubles, which is the right kind of noisy.

Same fixture, after:

```
compacted: true  (8.8s)
tokens: 36958 -> 2502, under budget: true

ARTIFACTS BUILT OR CHANGED
- Create Problem for On Hold Vendor Incidents — flow — sys_id 39acb67eac164650a6b15f5e724cae76 — active

RECORDS ONLY LOOKED AT
- 55 queries on Incident table for unassigned critical incidents

DECISIONS
- Deployed the "Create Problem for On Hold Vendor Incidents" flow to address vendor-hold incidents

OPEN THREADS
none

sys_id survived : true
flow name       : true
padding INC numbers leaked into the digest: 0
```

The adapter's reasoning-token error never fired in any run, which was the
specific risk this budget was sized against.

| # | trap | what it looks like | how to not be fooled |
|---|---|---|---|
| 16 | **A truncated LLM response is well-formed text that stops** | a summary that is fluent, plausible and silently missing its tail | Require a structural marker from the END of the expected output. Length and "no error" prove nothing |
| 17 | **A test double cannot exhibit the failure mode of the thing it doubles** | a green offline suite over a live path that is broken | Doubles test the plumbing. Run the real thing against the acceptance criterion at least once, or the criterion is untested |

### A-4 — the instance knowledge ledger

Seeded from §16 and §19. Everything this project learned the hard way was
sitting in a document the agent could not read.

Scope is enforced, and it is the part most likely to cause harm if sloppy: SDK
and platform traps are stored against `*` and apply everywhere, while a fact
MEASURED on one instance (`problem_id` exists nowhere here) is stored against
that instance and never leaks to another. A second PDI may well have the field,
and a confidently-wrong "it does not exist" is precisely the damage this ledger
exists to prevent.

Read into **both** prompts. The codegen context is the one that matters most —
`HARD_RULES` has no rule about calculated fields at all.

#### The acceptance demo, and its confound stated plainly

The specified demo — "a brand-new flow's verification setup drives priority via
impact+urgency without being told" — **passes**, but it does not isolate the
ledger: `VERIFY_SYSTEM` rule 9 already states the same thing, so a pass there is
over-determined. Reporting it as proof of the ledger would be dishonest.

The agent system prompt has **no** priority rule, so on that path the ledger is
the sole carrier. Run live, fresh session:

```
tools called: get_table_schema

{
  "short_description": "Test incident for Critical priority",
  "urgency": "1",   // 1 = High
  "impact":  "1",   // 1 = High → Priority is calculated as Critical (P1)
  "category": "inquiry"
}

Why these fields: urgency = 1 + impact = 1 forces the platform's calculated
priority = Critical (P1)…
```

`impact` and `urgency` driven, the word "calculated" used unprompted, and
`priority` never written. That is the ledger working, on a path where nothing
else could have supplied it.

Write paths: failed verification assertions, calculated-field discovery during
`get_table_schema`, and a `remember:` affordance. Re-observing a fact raises its
confidence; a changed value replaces it and resets provenance, because the old
evidence no longer supports the new claim.

### A-5 — recall, and a ranking bug the acceptance test caught ⚠️

Embeddings through the same `baseUrl` as chat. Endpoint checked rather than
guessed: Ollama 0.32.14 exposes **both** `/api/embed` (native, batch `input`)
and `/v1/embeddings`; the native one is used. They fail differently when a model
is missing — `{"error": "..."}` vs `{"error": {"message": "..."}}` — so the
probe reads both shapes.

Float32 blobs in SQLite, brute-force cosine in JS. A dimension mismatch is
skipped rather than scored, because comparing across embedding models produces a
number that looks exactly like a real similarity.

**The bug.** The A-5 acceptance query ranked the correct session **last of
five**:

```
0.6256  accept-laptop-catalog     <- wrong session winning
0.4351  (unrelated)
0.3533  (unrelated)
0.3058  accept-p1-digest
0.2467  accept-vendor-hold        <- the right one, dead last
```

Two causes, both mine:

1. **`Math.abs` on a value whose sign carried the meaning.** SQLite's `bm25()`
   returns a NEGATIVE score where a better match is *more* negative. Normalising
   with `1 / (1 + Math.abs(score))` inverted the ordering, so the best match got
   the lowest number and `searchSessions` — sorting descending — returned the
   worst first. Negating is the entire conversion.
2. **No stopword removal.** The acceptance question is five stopwords and three
   content words; leaving them in let a session match on "we" and "about".

After both fixes, the same query in the same mode:

```
5.4763  accept-vendor-hold
1.4074  accept-p1-digest
```

This is worth recording for a reason beyond the fix: **the offline tests were
green throughout.** They asserted that search returned hits, that it reported
its mode, that it degraded loudly — every property except the one that mattered,
which was the ORDER. Only running the acceptance criterion end to end found it.

#### Both modes, as required

| mode | condition | result |
|---|---|---|
| keyword | embedding model absent | `accept-vendor-hold` **5.4763**, next 1.4074 |
| semantic | `nomic-embed-text`, 768d | `accept-vendor-hold` **0.7897**, next 0.5628 |

The embedding model was pulled to demonstrate the second row (`ollama pull
nomic-embed-text`, ~274MB, local and free, reversible with `ollama rm`). The
degraded path is not a fallback that hides — the UI banner and the API both
report `mode: "keyword"` with the exact pull command, and the agent tool's
description tells the model to mention the mode if results look thin.

One test lesson: the fallback test originally went through `search()` and
asserted `mode === 'keyword'`. It **flipped mid-run** when the pull finished. A
test that changes meaning when someone runs `ollama pull` is testing the
environment, not the fallback, so it now calls the keyword path directly.

### Trap ledger additions

| # | trap | what it looks like | how to not be fooled |
|---|---|---|---|
| 14 | **`bm25()` is negative, and more-negative is better** | a relevance sort that returns the *worst* matches first, with plausible-looking scores | Never `Math.abs()` a value whose sign carries meaning. Assert the ORDER in a test, not merely that hits came back |
| 15 | **A test that branches on the environment silently changes meaning** | a green suite that was asserting something different yesterday | Call the degraded path directly. `ollama pull` finishing mid-run should not alter what a test proves |

---

## 22. Track B — SLAs and access control

Everything below was executed against `dev442675.service-now.com` before the
code that relies on it was written. Where a claim is a measurement, the numbers
are the ones that came back; where something was not verified, it says so.

### Storage note

Track B adds no storage. The SLA and ACL layers are stateless readers and
writers over the Table API — there is nothing durable to keep that the instance
is not already the source of truth for. `server/data/nowhelpassist.db` is unchanged
and no migration was added.

---

### B-1 — SLA definitions

`server/src/servicenow/sla.js`, `server/src/routes/sla.js`, the **SLA** page,
and the agent tools `sla_meta` / `list_slas` / `get_sla` / `create_sla`
(mutating, amber gate) / `verify_sla_live` (mutating).

#### The duration codec ✅

`contract_sla.duration` is a `glide_duration`, and it is **an offset from
1970-01-01 with whole days carried in the DATE half**:

| stored | means |
|---|---|
| `1970-01-01 04:00:00` | 4h |
| `1970-01-01 00:15:00` | 15m |
| `1970-01-03 00:00:00` | **2 days** — read as a clock time this is zero |

Read off this instance: "Priority 1 resolution (1 hour)" stores
`1970-01-01 01:00:00`, "Priority 4 resolution (2 day)" stores
`1970-01-03 00:00:00`.

#### `duration_type` replaces the duration entirely

`duration_type` references `cmn_relative_duration` (5 rows here: *Breach on Due
Date*, *End of next business day*, *Next business day by 4pm*, *2/3 business
days by 4pm*). When it is set, the fixed duration is not used and the breach
clock cannot be checked arithmetically — `assertTaskSla` says so and skips that
check rather than inventing an expectation.

#### The schedule is inert unless `schedule_source` switches it on ⚠️

Two definitions, identical but for one field, one incident, one run:

| definition | `schedule` | `schedule_source` | task_sla.schedule | wall-clock to planned end |
|---|---|---|---|---|
| probe A | 8-5 weekdays | `no_schedule` | *(empty)* | **4.00h** |
| probe B | 8-5 weekdays | `sla_definition` | 8-5 weekdays | **7.84h** |

Both were created with a 4h duration. Setting the schedule reference alone
produced a clock that ignores it, with nothing anywhere reporting that the
field was inert. `createSla` warns on exactly this combination, and the SLA
page prints the warning at the field, not after the save.

The 7.84h is correct arithmetic, incidentally: the incident was created at
04:09 PDT, before the schedule's 08:00 window opens, so the clock starts at
08:00 and four business hours land at 12:00 PDT = 19:00 UTC.

#### Conditions are field-checked before the write ✅

Trap #2 is worse on this table than anywhere else it has come up. A start
condition naming a field that does not exist is not rejected — the clause is
**dropped**, so `active=true^prioritee=1` becomes `active=true` and the SLA
attaches to **every active record on the table**. Nothing errors, and the
definition looks right in the UI.

`validateSlaInput` checks every one of start/stop/pause/reset/cancel against
the target table's live dictionary and refuses before anything is written.
Measured live:

```
create_sla { start_condition: 'active=true^prioritee=1' }
  → refused: The start condition constrains on "prioritee", which does not exist
    on incident. ... An SLA start condition loses its filter and attaches to
    every record on the table.
```

An SLA with **no** start condition is refused for the same reason.

#### Writes are read back field by field ✅

Trap #3 applies here too, and was re-measured on this table: a deliberate
`zzz_nowhelpassist_not_a_field` was accepted by the POST and absent from the stored
record, with no error. So `createSla`/`updateSla` compare every field sent
against the stored record and return `mismatches[]`; conditions compare modulo
the `^EQ` end marker, which the platform appends to anything saved through its
own condition builder and does not append to a REST write.

The live creation of the acceptance definition:

```
Created SLA definition "P1 resolve in 4h" (796fadd5837acf10b939cc65eeaad3ea);
every field read back as sent.
  duration  1970-01-01 04:00:00 → 4h
  clock     24x7 (no schedule in effect)
  start     active=true^priority=1
```

`contract_sla` writes land in the `global` scope as `sys_class_name:
contract_sla`, and DELETE followed by a read-back returns 0 rows — so create
and delete are both proven, not assumed.

---

### B-2 — SLA-aware verification

The runner gains an assertion type. In a `.verify.json` spec:

```json
{ "type": "sla",
  "sla": "P1 resolve in 4h",
  "locate": { "bySetupRecord": true },
  "expect": { "attached": true, "stage": "in_progress", "breached": false,
              "plannedEndToleranceSec": 120 },
  "note": "the P1 resolution clock starts" }
```

and `verifySla(name)` runs the same evaluator standalone for a definition that
has no flow attached to it. One implementation, two entry points.

#### The setup record is DERIVED, not generated ⚠️

A start condition is already a precise machine-readable statement of what has
to be true. Asking a model to restate it as a payload adds a way to be wrong
and nothing else — which is the entire §14/§20 failure class. So
`derivePayloadFor` parses the condition and builds the record in code, applying
trap #5 on the way:

```
start_condition   active=true^priority=1
derived payload   { active: "true", impact: "1", urgency: "1" }
note              priority=1 is CALCULATED (trap #5) — set impact=1, urgency=1
                  instead and never write priority
```

Then — and this is the part that makes the derivation checkable rather than
merely plausible — **the platform is asked whether the stored record satisfies
the condition**, by querying `sys_id=<id>^<start_condition>`. Live:

```
satisfies: true
observed:  active=true  impact=1 - High  urgency=1 - High  priority=1 - Critical
```

If a PDI had a customised priority matrix, this is where it would surface as a
named mismatch instead of a mysteriously unattached SLA. The check is sound
only because every field in the condition was confirmed to exist first —
otherwise the clause would drop and `sys_id=<id>` alone would match, passing
vacuously. Trap #2 defending against itself.

A clause with no single satisfying value (`LIKE`, `!=`, a `javascript:` value,
a dot-walk, an OR arm) is **named and the run refuses**, rather than being
approximated.

#### A task_sla row proves nothing about which SLA ⚠️ — new trap #18

One P1 incident, three attachments:

| task_sla.sla | name | planned end (UTC) |
|---|---|---|
| `796fadd5…` | **P1 resolve in 4h** (ours) | 15:24:19 |
| `35420982…` | Priority 1 resolution (1 hour) | 12:24:19 |
| `2ca94b74…` | Priority 1 response (15 minutes) | 11:39:19 |

An assertion of the form "a task_sla exists on the record" passes here **with
the definition under test deleted**. So the assertion filters by
`task_sla.sla == definition.sys_id`, and `sla` is mandatory in the spec —
enforced in `validateSlaAssertion`, not left to the prompt. When ours does not
attach, the failure names the rivals that did, because "nothing attached" and
"three attached and ours was not one of them" are different diagnoses and only
the second one is usually true.

#### Trap #UTC, applied

`task_sla` times are stored in UTC; the Table API's `display_value` renders
them in the session timezone. The same instant, from the live run:

```
start_time        value 2026-08-18 11:24:19   display 2026-08-18 04:24:19
planned_end_time  value 2026-08-18 15:24:19   display 2026-08-18 08:24:19
```

Seven hours. A runner that reads the display half and adds the 4h duration
expects 08:24:19, sees 15:24:19, and reports a **correct** SLA as seven hours
broken. `parseSnowUtc` takes only the `value` half and parses it with an
explicit `Z`; the display half is carried into the result for a human to look
at and is touched by no calculation. The offline suite fixture carries both
halves so a regression fails there rather than on a PDI.

#### The tolerance is stated in the spec, not defaulted in the runner

The clock starts when the platform attaches the row, not when the runner posted
the record, so the two differ by the insert's own latency. A tolerance living
inside the runner is a number that never appears in the artifact a human
reviews, so `expect.plannedEndToleranceSec` is **required** and its absence is
a validation error. Observed drift on the live run: **0s**.

#### Schedule-bound SLAs are bounded, not recomputed

Recomputing the schedule engine's arithmetic would mean reimplementing it, and
asserting the 24×7 expectation against it fails a correct SLA by 3.84h (see
B-1). So the assertion reports which mode it ran in and, for a scheduled SLA,
asserts what is actually true: the clock runs forward, it cannot be shorter
than the duration (a schedule can only push a breach out), and the schedule the
platform used is the one the definition names. Stated in the result, not
silently skipped.

#### Acceptance run, verbatim ✅

```
sla_verify_definition   P1 resolve in 4h on incident
sla_verify_setup        incident {active:"true", impact:"1", urgency:"1",
                                  short_description:"NowHelpAssist SLA check ..."}
                        note: priority=1 is CALCULATED (trap #5)
sla_verify_setup_done   INC0010035
sla_verify_setup_checked satisfies=true  priority=1 - Critical
sla_verify_poll         attached=1  pass=true
sla_verify_cleanup_done ok=true taskSlasAtStart=3 cascaded=true
                        taskSlasLeft=0 recordLeft=0

ok: true — "task_sla attached to the right definition with a sane breach clock
(4 checks passed)"
  exactly one task_sla references this definition
  stage is "in_progress"
  has_breached is false
  planned_end is start + 4h within 120s (drift 0s)
```

Cleanup is read back rather than assumed: deleting the incident **cascades**
its task_sla rows away on this instance (measured: 3 at start, 0 left), and any
survivor would be deleted explicitly and re-counted. A verification run that
leaves a running clock behind is debris with a breach date.

---

### B-3 — ACL analyzer (read / explain / diff)

`server/src/servicenow/acl.js`, `server/src/routes/access.js`, the **Access**
page, and the read-only tools `acl_report` / `acl_diff` / `explain_acls`.

**No authoring, deliberately.** An ACL is the one artifact class where a
confidently wrong write is a security incident rather than a bug. There is no
tool to create one and the system prompt forbids simulating one through
`create_record` on `sys_security_acl`.

#### `operation` and `type` are references with inconsistent sys_ids ⚠️ — new trap #16

`sys_security_operation` mixes two conventions in one table:

```
sys_id "read"    name read          sys_id "create" name create
sys_id "write"   name write         sys_id "delete" name delete
sys_id 0997ab83733303005978e4b9cdf6a7b9   name report_view
sys_id 7aad4c50b7f4621062b62181ce11a918   name conditional_table_query_range
```

A raw read gives a report that is half readable and half opaque, which looks
like a data problem rather than a reading error. `sys_security_type` is the
same: `record` is its own sys_id, `ux_page` is 32 hex. Every operation and type
is resolved through the display value, with a lookup map as the fallback and an
explicit `operationResolved: false` when neither can name it.

#### `nameSTARTSWITHincident` also matches `incident_task` ⚠️ — new trap #17

`incident_task` is a different table with **43** ACLs of its own. A prefix
query sweeps every one of them into an incident report. The query is
`name=<t>^ORnameSTARTSWITH<t>.` and each row is re-checked against
`belongsToTable`. Measured: **0 of 43** leaked.

#### ACLs are inherited

`incident` is governed by its own rows and by every `task` row. The report
walks `getTableHierarchy` and each row carries `definedOn` / `inherited`, so a
rule the reader cannot find on the incident ACL list is still visible with the
table that defines it named.

#### ACL conditions get the same trap #2 check

An ACL condition naming a field that does not exist has its clause dropped,
which makes the rule **broader** than it reads. Flagged per row and counted in
`counts.conditionsOnUnknownFields`. On `incident`: 0 — the OOB set is clean,
which is worth knowing rather than assuming.

#### The incident report, and the spot-check ✅

```
hierarchy   incident -> task
visibility  full        complete true
counts      total 143 · record 27 · field 116 · inactive 3 · scriptGuarded 17
            adminOverrides 99 · noRoleRequired 32 · conditionsOnUnknownFields 0
operations  conditional_table_query_range, create, delete, list_edit,
            query_range, read, report_view, save_as_template, write
roles       20
```

**Spot-check: 3/3.** Three ACLs — a deny-unless rule with a security attribute
and no roles, a role-plus-condition rule, and a script-guarded rule — were
re-read through a **separate** code path (a direct `table.get` per record plus
its own `sys_security_acl_role` query, sharing no helper with the analyzer) and
compared field by field on name, operation, type, active, admin_overrides,
advanced, condition, script presence and roles. All three match.

> **Provenance, stated plainly.** This is a read-back against the raw records,
> which is what the platform form renders. It is **not** a human opening three
> ACL forms in the ServiceNow UI, and it cannot be — nothing in this
> environment drives a browser. If the platform form shows a field this
> comparison does not read, the spot-check would not catch it.

#### The diff shows real differences ✅

`admin` vs `itil` on `incident`:

```
only itil   conditional_table_query_range, read, write
both        report_view
only admin  (none)
field differences  36
```

That "only admin: none" invites a wrong conclusion, and the diff says so
above the grid rather than under it: **21 of 27 record ACLs on incident set
`admin_overrides`**, which means they are *skipped* for admin. Admin not being
named is the grant, not the absence of one. The result also carries a standing
caveat that this compares which rules **name** each role and is not an
evaluation of access — the platform runs every matching ACL at each level, most
specific first, and a field ACL, condition, script or security attribute can
deny what a table-level row appears to allow. NowHelpAssist does not run that
engine, and a report implying it did would be worse than no report.

#### Read-restricted renders loudly ✅

`sys_security_acl` is itself ACL-protected: a connection without the
`security_admin` elevation gets a refusal or an empty list. An empty list
rendered as an empty report says *"this table has no ACLs"*, which is the most
dangerous sentence this feature could produce. Three states, always reported:

| `visibility` | what happened | what the banner says |
|---|---|---|
| `full` | rows read | the count and the chain |
| `empty` | none for this table, but other tables' ACLs ARE readable | "a real absence rather than a permission problem" |
| `restricted` | no ACL row visible anywhere | "a visibility result, not a security result… do not read this as *X has no ACLs*" |
| `error` | the read threw | "This report is INCOMPLETE", quoting the failure |

`complete` is false for `restricted` and `error`. The banner is rendered on
every report, not only the bad ones, so the reader is never left to infer which
state they are looking at.

The same distinction runs one level down. An ACL with **no role rows** is "no
role required"; an ACL whose roles could **not be read** is `roles: null,
rolesUnknown: true`. These are opposite answers, and a bug caught while writing
the tests had them sharing `undefined` — which rendered an unreadable rule as
an unrestricted one, in a security report. Both states are now asserted.

Since this cannot be produced on an admin connection, it is driven in the
offline suite by injecting a reader that throws and one that returns empty.
**Not** verified against a real de-elevated login here.

#### The explanation, and a measured model failure ⚠️ — guard B-1

"Explain in plain language" sends the structured report through the configured
provider, read-only, and the answer is labelled AI-generated at the API
boundary and again in the UI.

The **first live run** against `gpt-oss:120b-cloud` opened correctly and then
collapsed:

```
Roles that appear on record ACLs include sn_incident_read, sn_incident_write,
itil, itil_admin, … sn_incident_comments_write, sn_incident_write,
sn_incident_read, sn_incident_admin, sn_incident_comments_write,
sn_incident_write, sn_incident_read, sn_incident_admin, …
```

— four role names cycling roughly sixty times inside one sentence, at HTTP 200,
with plausible prose either side of it. That output is worse than none: it sits
beside a report that IS accurate, so the loop reads as a finding about the
instance rather than as the model breaking down.

`detectDegenerateRepetition` rejects it on two independent signals (a short
n-gram repeating back to back, or a 40-word window with fewer than 7 distinct
words), then **retries once with the repeated fragment quoted back as
evidence** — the A5 rule, because a byte-identical re-ask of a backend that
provably ignores `seed` (trap #12) is a coin flip dressed as a correction. Two
degenerate attempts is a loud 422 that says the failure is the generation's and
that the structured report beside it is unaffected.

The captured loop is a fixture in the offline suite. Re-running the same
request afterwards produced a clean, usable explanation on the first attempt —
which is trap #13 restated: nothing here is reproducible, so the guard has to
hold rather than the generation.

#### The assertion inside a real flow spec ✅

The two halves above — the evaluator and `verifySla` — were proven separately,
which leaves the runner's own dispatch unproven. So an SLA assertion was added
to the live spec for `Escalate Network P1 Incident` (a deployed flow whose setup
raises a P1) and the whole spec run:

```
verify_setup_done   INC0010036
verify_execution    IN_PROGRESS -> COMPLETE
verify_assert       incident.work_notes    PASS
verify_assert       incident.assigned_to   PASS  (Bow Ruggeri)
verify_assert       sla:P1 resolve in 4h   PASS
verify_cleanup

ok: true — 3/3 assertions passed
clock  { mode: "24x7", startUtc: "2026-08-18 11:43:07",
         plannedEndUtc: "2026-08-18 15:43:07", expectedSec: 14400,
         observedSec: 14400, driftSec: 0, toleranceSec: 120 }
others [ "Priority 1 resolution (1 hour)",
         "Priority 1 response (15 minutes)",
         "Network group resolution" ]
```

Three rival SLAs that run this time, not two — the flow assigns the Network
group, which brings a third definition with it. The spec file was restored
byte-for-byte afterwards and the working tree is clean.

---

### Trap ledger additions

| # | trap | what it looks like | how to not be fooled |
|---|---|---|---|
| 16 | **`sys_security_acl.operation` / `type` sys_ids are inconsistent** | half the report reads `read`/`write`, the other half reads `0997ab83733303005978e4b9cdf6a7b9` — it looks like corrupt data | The core operations' sys_ids ARE the words; extended ones are 32-hex. Resolve through `display_value`, keep a `sys_security_operation` map as the fallback, and flag anything neither can name |
| 17 | **`nameSTARTSWITH<table>` matches sibling tables** | 43 `incident_task` ACLs land in an `incident` report and read as incident rules | Query `name=<t>^ORnameSTARTSWITH<t>.` and re-check each row: a name belongs to a table only if it equals it or starts with it plus a dot |
| 18 | **A `task_sla` row proves nothing about WHICH SLA** | "the SLA attached" passes with the definition under test deleted — one P1 incident attaches three rows here | Filter by `task_sla.sla = <contract_sla sys_id>`, and when it is missing, report which rivals DID attach |
| 19 | **`contract_sla.duration` carries days in the DATE half** | a 2-day SLA reads as `00:00:00`, i.e. zero | It is an offset from 1970-01-01: `1970-01-03 00:00:00` is 2 days. Decode it; never read the time half alone |
| 20 | **A `schedule` is inert unless `schedule_source` is `sla_definition`** | the field is set, the UI shows it, the clock runs 24x7 | Measured: 4.00h vs 7.84h on otherwise identical definitions. Set both, and check `task_sla.schedule` on the attached row rather than the definition |
| 21 | **`task_sla` times are UTC; `display_value` is session-local** | a breach clock checked against the display half is out by the offset — 7h here — and fails a correct SLA | Parse the `value` half with an explicit `Z`. Trap #UTC, now with a second table it applies to |
| 22 | **A weak model can return HTTP 200 and a repetition loop** | correct prose, then one phrase cycling sixty times, printed next to an accurate report where it reads as a finding | Check generated text for n-gram loops and low lexical variety before showing it. Retry once WITH the fragment quoted as evidence, then refuse loudly |

---

## 23. Track C — catalog UI policies, variable editing, agent parity

Measured against `dev442675.service-now.com` before the code that relies on it
was written. The centrepiece is a constraint that changed the design mid-build.

---

### The finding: `catalog_ui_policy_action` cannot be written over REST ⚠️

A POST to `catalog_ui_policy_action` returns **201 Created** and silently
discards `ui_policy` and `catalog_variable` — the two fields that attach an
action to its policy and to its variable. Everything else lands. Field by
field:

```
ui_policy          sent="6717f5d5…"                stored=""   <-- DROPPED
catalog_variable   sent="IO:3617b5d5…"             stored=""   <-- DROPPED
variable           sent="justification"            stored="justification"  OK
visible            sent="false"                    stored="false"          OK
mandatory          sent="true"                     stored="true"           OK
disabled           sent="true"                     stored="true"           OK
order              sent="250"                      stored="250"            OK
```

The result is a policy with actions that do nothing, and nothing anywhere says
so. `PATCH` after insert is dropped too.

**The cause, found with Track B's own analyzer in one query:**

```
sys_security_acl:  sys_ui_policy_action.ui_policy / create  roles=["nobody"]  admin_overrides=false
                   sys_ui_policy_action.ui_policy / write   roles=["nobody"]  admin_overrides=false
```

A field ACL granting only the role `nobody`, with `admin_overrides` **off**, so
not even an admin passes it — and the Table API DROPS a field the caller may not
write rather than refusing the request. That is trap #3 wearing a different hat:
the same silence, a different reason.

Note the inversion that makes this hard to guess at. `variable` and
`catalog_item` ARE marked `read_only: true` in the dictionary and they store
fine; `ui_policy` and `catalog_variable` are `read_only: false` and do not. The
dictionary is not the thing to read here.

**Measured through three independent channels before redesigning around it:**

| channel | result |
|---|---|
| Table API, basic auth, admin | 201, both fields empty |
| Table API from a logged-in browser session with `X-UserToken` | 201, both fields empty |
| the platform's own classic form | renders `ui_policy` **read-only**; `sysparm_query` does not prefill it |

It is not a credential problem and not an item-state problem: it reproduces on
an out-of-box item whose policies already work. The `catalog_variable` half has
no ACL naming it and is presumably dropped by the `Restrict edit if the item is
checked out` business rule, whose script is not readable through any channel
tried here — so that half is a **measurement without a mechanism**, and is
recorded as such.

### The answer: drive the SDK, which is what the repo already does for `sys_hub_*`

`now-sdk explain --list` has `cataloguipolicy-api`. The SDK installs metadata as
a system operation, so both fields land:

```
action  ui_policy        = 668aba2f…   (the installed policy)
        catalog_variable = IO:3617b5d5…
        variable         = justification
        visible          = false
```

So NowHelpAssist **reads catalog UI policies over the Table API and writes them
through the SDK**, in one deterministic template — a policy draft is already
precise, so there is nothing for a model to add and one more way to be wrong.
`fluent.js` exports a shared build/install surface, because two concurrent
`now-sdk install` runs would each ship a half-built `dist/`.

One SDK detail, measured: `variableName` takes the **bare sys_id**. Passing
`IO:<sys_id>` produced `catalog_variable = "IO:IO:<sys_id>"`.

---

### Four more behaviours the builder handles up front

1. **The condition is not an encoded query.** `catalog_conditions` is a
   `variable_conditions` field addressing variables by sys_id with an `IO:`
   prefix — `IO:35c19214f7752110ed589ef0e3bfd6c3=true^EQ`. A field name means
   nothing here. `conditions.js`'s `splitQuery` handles the joiners, since
   `^` / `^OR` / `^NQ` mean the same thing; only the operand grammar differs.

2. **An action needs both `variable` and `catalog_variable`** — the internal
   name AND `IO:` + the sys_id. Every out-of-box action sets both.

3. **`visible` / `mandatory` / `disabled` are the strings `ignore` / `true` /
   `false`.** `ignore` means leave alone and is the default, so an action that
   sets nothing saves cleanly and does nothing. Refused before the write.

4. **`ui_type` — and a claim that was wrong.** It defaults to 0, labelled
   "Desktop" against 1 "Mobile / Service Portal" and 10 "All", and 82 of the
   100 out-of-box policies here sit at 0. The obvious reading is that a
   default-valued policy does not run on the portal, and this project asserted
   exactly that, in a code comment, a validation warning and a commit message,
   before measuring it.

   **It is wrong on this release.** The same policy installed at ui_type 0 hid
   and revealed its variable on `/sp?id=sc_cat_item` identically to the same
   policy at 10 — reinstalled at 0, re-driven through the portal, reinstalled
   back at 10, re-checked. The warning is gone; a guard that fires on a
   distinction which does not exist teaches people to ignore guards. NowHelpAssist
   still writes 10, but for a defensible reason rather than a measured one: it
   is the SDK's own default for `runScriptsInUiType` and unambiguous everywhere.

---

### C-1 — the builder ✅

`server/src/servicenow/catalogPolicy.js`, routes under `/api/catalog`, and a
**UI policies** tab in the item view alongside Variables and Variable sets.

Choice-aware by construction: the value control becomes a dropdown of the
variable's real choices the moment a variable with any is picked, so the
commonest way to write a condition that can never be true — comparing a select
box against its display label rather than its stored value — is not reachable
from the form. Validation refuses, before anything is written:

| refused | why it matters |
|---|---|
| a condition on a variable that is not on the item | evaluated against the form, so it can never be satisfied |
| a choice value the variable cannot hold | never true; the real values are listed in the error |
| a checkbox compared with anything but true/false | same |
| an action left entirely on `ignore` | saves cleanly, does nothing |
| no condition at all | always true, so it applies unconditionally |

Hiding a variable that is **mandatory** warns rather than blocks: it is legal,
and the correct fix (`mandatory: 'false'` in the same action) is one field away.
The SDK's own guide agrees — "hide mandatory variables that have no value" is on
its NEVER list.

**Acceptance, live, driven through NowHelpAssist's own UI:**

```
policies before the UI run: 0
  → item picked, UI policies tab, form filled, Create policy
result: Installed UI policy "Hide justification unless approval is needed"
        with 1 action(s); every action reads back attached to the policy and
        to its variable.
policies after: 1  managed=true  actions=1  problems=0

Service Portal /sp?id=sc_cat_item:
  checkbox unchecked → Justification NOT visible
  checkbox ticked    → Justification visible
```

Screenshots: `docs/media/c1-ui-1-builder.png`,
`c1-ui-2-installed.png`, `c1-ui-3-policy-list.png`,
`c1-portal-1-hidden.png`, `c1-portal-2-shown.png`. Visibility is asserted from
the element's own bounding box, not its presence in the DOM.

---

### C-2 — variable editing ✅

Inline edit (question text, order, mandatory, help text, default), reorder, and
choice CRUD on choice-type variables.

**Reordering renumbers the whole list**, server-side, from 100 in steps of 100,
reading every row back. `order` is an integer and two variables sharing a value
render in an order the platform picks — which looks exactly like the reorder
having failed. Measured live: swap and restore, every row `ok: true`.

**Editing is in place, never delete-and-recreate.** A recreated variable gets a
new sys_id, and every UI policy condition and action naming the old one keeps
the reference and silently stops matching. The agent tool description says so
too, because that is the shortcut a model reaches for.

A derived choice value drops punctuation rather than underscoring it:
`Contractor (30 days)` was producing `contractor_(30_days)`, a value nobody
wants to type into a condition and one that reads like a mistake when it turns
up in one.

Destructive confirmation is one module — `client/src/components/confirm.js` —
with the consequence text written once per artifact kind. Track D's dialog
replaces that file and nothing else.

---

### C-3 — completeness, and a stale hardcoded list ✅

Item active toggle, category creation inline where a category is picked, order
guide and record producer delete, and a producer row that links straight into
the item view — a record producer IS a catalog item, so managing its variables
should not mean finding it again by hand. Each exercised over HTTP against the
live PDI.

**Variable type codes now come from the instance dictionary.** The hardcoded
list was wrong here in the way hardcoded lists go wrong:

| code | the hardcoded list said | this instance says |
|---|---|---|
| 31 | Rich Text Label | **Requested For** |
| 32 | Attachment | **Rich Text Label** |
| 33 | *(absent)* | **Attachment** |

26 codes against the instance's 31. It survives as a fallback, and the UI says
loudly when it is being used — serving stale codes quietly is how a variable
ships with a silently different type.

---

### C-4 — agent parity, and A6 ✅

Five tools: `get_catalog_item` (deep read with the real choice VALUES),
`add_catalog_variable`, `update_catalog_variable`, `list_ui_policies`,
`create_ui_policy`. The two writers are mutating and gated.

#### Operator labels, normalised

Asked for "mandatory only when duration is Permanent", the model emitted
`"operator": "is"` — the label this module publishes in its own metadata.
Accepted now: the mapping is exact and closed, so rejecting it would be
pedantry. The choice VALUE is deliberately **not** normalised — "Permanent" and
"permanent" are genuinely different there, and guessing is how a condition ends
up never matching.

The same reasoning applies to action states: `visible: false` from a JS caller
means "hide it", which is what the string `"false"` means here. That used to
happen by accident through a bare `String()` call; it is now a named function
with a comment, because an accident is not a decision.

#### A6 — the stalled turn ⚠️

**Twice in three runs.** The model resolved the item, read its variables, quoted
the two correct sys_ids and the right choice value in a tidy table, and ended
the turn with:

> *Shall I create this UI Policy now? (It will take about a minute.)*

Nothing was created. Nothing said so. From outside, a stalled turn looks exactly
like a finished one: prose arrives, the stream closes.

Tightening the prompt did not fix it — the system prompt already said the
approval gate IS the confirmation and to call the tool, and the model asked
anyway. That is §20's lesson again, so it is a guard. One nudge per turn,
carrying the fact the model lacked: that its question reached nobody, and that
approval is requested BY calling the tool.

Narrow by construction — it needs a directive from the user, an assistant line
asking to proceed, and **no mutation anywhere in the turn**. That last clause was
itself a fix: the first version counted calls in the closing iteration and
nudged a turn that had already created the policy and was signing off politely.

**Acceptance, live, one approval:**

```
lookup_reference → get_catalog_item → list_ui_policies →
create_ui_policy (approved) → list_ui_policies

Corp VPN, Service Portal:
  duration = Temporary → justification aria-required="false"
  duration = Permanent → justification aria-required="true", starred,
                         and listed under "Required information"
```

Screenshots: `docs/media/c4-vpn-1-optional.png`, `c4-vpn-2-mandatory.png`.

#### A UI policy is proven by the form, never by the record

Driving that form produced one more finding worth keeping. Setting the Angular
model directly — `scope.$apply(() => { scope.fieldValue = 'permanent'; })` —
changed the value and did **not** re-evaluate the policy. Only a real click
through the input pipeline did. The record was identical in both cases.

---

### How the browser checks were run

No Playwright or Puppeteer, and none added: adding a browser dependency to this
repo for an acceptance run would change its dependency profile without being
asked. Node 24 ships a global `WebSocket`, so the checks drive the installed
Chrome directly over the DevTools protocol — launch with
`--remote-debugging-port`, attach to the page target, `Page.navigate`,
`Runtime.evaluate`, `Input.dispatchMouseEvent`, `Page.captureScreenshot`. About
90 lines, and it lives in the scratchpad rather than the repo.

---

### Trap ledger additions

| # | trap | what it looks like | how to not be fooled |
|---|---|---|---|
| 23 | **`catalog_ui_policy_action` silently drops `ui_policy` and `catalog_variable`** | POST returns 201, every other field lands, and the policy has actions that do nothing | A field ACL granting only `nobody` with `admin_overrides` off; the Table API DROPS a field the caller may not write. Write these through the SDK. Read the ACLs before assuming a write path exists |
| 24 | **The dictionary's `read_only` flag does not predict which fields a REST write keeps** | `variable` is read_only and stores; `ui_policy` is not and does not | Field ACLs decide, not the dictionary. Test the write and read it back, per field |
| 25 | **A catalog UI policy condition is `IO:<variable sys_id>`, not a field name** | a condition written with field names saves and never matches | `catalog_conditions` is a `variable_conditions` field. Address variables by sys_id with the `IO:` prefix, and end with `^EQ` |
| 26 | **`visible`/`mandatory`/`disabled` default to `ignore`** | an action saves cleanly and changes nothing | They are strings, not booleans, and `ignore` means leave alone. An action must set at least one |
| 27 | **`ui_type` 0 is labelled "Desktop" but is NOT a Service Portal exclusion** | you build a guard around a distinction that does not exist | Measured: a policy at ui_type 0 worked on `/sp` identically to one at 10. Read the label as a label |
| 28 | **Hardcoded platform code lists go stale silently** | a variable ships as "Requested For" when you asked for "Rich Text Label" | 31/32/33 all shifted here, and five codes were missing. Read choice lists from `sys_dictionary`; keep any hardcoded list as a loud fallback |
| 29 | **A stalled agent turn is indistinguishable from a finished one** | correct analysis, correct sys_ids, then "Shall I create this now?" — and nothing happened | The approval gate is only shown by CALLING the tool. Detect a directive answered with a request to proceed and no mutation, and feed that fact back |
| 30 | **Setting an Angular model directly does not re-evaluate a UI policy** | the variable's value changes on the form and the policy does not fire, so a correct policy looks broken | Drive the real control through the input pipeline. A UI policy is proven by the form, never by the record |

---

## 24. Track D — the experience layer

Six items, all client-side except the audit trail, which needed a fifth
migration before its page could say anything true. The rule for the whole track
was that the theme is fixed: the wordmark, the sidebar, and the `ink / panel /
verdigris / amber` + `Sora / Inter / IBM Plex Mono` token set are extended,
never replaced. Every selector added below resolves to a value already declared
at the top of `styles.css`.

The interesting part of this track is not the components. It is that four of
its six items were shipped with a defect that only a **measurement** exposed,
in each case after the code read as obviously correct.

### D-1 — markdown in agent bubbles ✅

`react-markdown` + `remark-gfm`. Agent bubbles render; user bubbles stay
literal, because what you typed is what you should see.

The plugin list and the element overrides live in a plain-JS
`markdownConfig.js` rather than inside `Markdown.jsx`. That is not tidiness:
Node cannot import `.jsx`, so anything expressed there is unreachable from the
offline suite, and "we added react-markdown" is not a claim worth making
without rendering something. `server/test/markdown.test.js` renders the real
pipeline through `react-dom/server`.

Two things that rendering found and reading would not have:

- **react-markdown passes the mdast `node` into every component override.**
  Spreading it onto a DOM element emits `node="[object Object]"` and makes
  React log *"does not recognize the `node` prop"* on every message. D-6's
  clean-console requirement would have failed on the agent page alone.
- **`**Vendor issue: **` is not emphasis.** The first draft of the test used
  the A3 guard's literal, trailing space and all, and failed. That is
  CommonMark working as specified — a closing `**` preceded by whitespace is
  not a closer. Pinned in a test so leftover asterisks there are never read as
  this feature being broken.

Raw HTML stays escaped; `rehype-raw` is absent and should stay absent, because
this text is written by a language model.

**Measured on the live page** (session `c9c9be27`, which contains the original
defect): 1 table inside its scroll wrapper, 19 `<strong>`, 5 `<code>`, 4 lists,
**0** stray `**`, **0** stray pipe rows, 0 `node=` attributes, user bubbles
plain, code rendered in IBM Plex Mono on `rgb(27,34,43)` — which is `--panel-2`
exactly.

### D-2 — toasts and one confirmation dialog ✅

Seven `window.confirm` calls and one `window.prompt` are gone. They already
routed through `components/confirm.js`, the seam Track C left for this, so the
swap touched call sites only to give the dialog what the native one could never
show: **the sys_id next to the label**, because a display name is not unique on
an instance, and **the stated consequence**, because deleting a catalog
variable does not fail — it silently breaks every UI policy that names it
(trap #25).

Cancel takes focus, not the destructive button, so Enter and Escape both mean
*no* on a dialog someone may have opened by accident.

Toasts are a module-level store rather than a React context, for two reasons
that are both about correctness rather than convenience. Raises happen in
`.catch` blocks and SSE callbacks that outlive the render that started them.
And React runs effects **child-first**, so a page toasting from its own mount
effect fires before an app-root host could have registered a sink — the store
queues, so an early toast renders late instead of vanishing.

With no dialog mounted, `confirmDestructive` throws rather than falling back to
`window.confirm`. A silent fallback would restore the removed behaviour on the
one code path where being wrong deletes a record.

### D-3 — loading, empty, and disconnected ✅

The honesty defect first, because it is the reason this item exists. Incidents,
SLA and Flows each rendered **one sentence for two opposite facts**:

> No incidents match. Connect your PDI on the Dashboard first.

That is the failure the ACL analyzer needed a `visibility` field to avoid (§22)
— an empty result and an unreadable one look identical unless something states
which it is. Worse, the binding was answered by four sources that disagreed:
the topbar's private 20s interval, the Dashboard reading `/system/settings`,
and three pages inferring it from an empty array.

One store, one poller, in-flight coalescing. `/api/system/health` is the only
answer, and "nothing matched" now only ever means nothing matched.

The rest: skeleton rows shaped like the table they stand in for, with widths
derived from position rather than random — a skeleton that reshuffles between
renders reads as content still arriving, and StrictMode's double render in dev
would make it visibly twitch. Designed empty states carrying a reason and a
next action. `aria-busy` on 27 async buttons, driving the spinner from the same
attribute assistive tech reads, so a button cannot be visually busy and
semantically idle. A route-level `ErrorBoundary` with a copyable stack, keyed
on the path so one bad page cannot brick the session.

### D-4 — identity ✅

One SVG, loaded by both the browser tab and the sidebar, so the two cannot
drift. `NH` in verdigris on ink, rounded square, hairline in verdigris-dim — it
splits where the wordmark splits, Now | HelpAssist. The
letters are **paths, not `<text>`**: a favicon renders outside the page, cannot
see the Sora webfont, and would fall back to whatever each OS picked.

The geometry was set by rendering it at 16px rather than by looking at it
large. The first pass had so much padding that the glyphs closed into a smudge
in the tab strip; they now occupy 56% of the square.

Two silent failures, both found by measuring `naturalWidth` rather than by
looking at the tab:

- **A double hyphen is illegal inside an XML comment.** Naming the design
  tokens the usual way put `--ink` and `--verdigris` in the comment. The HTML
  parser forgives that when an SVG is inlined; the XML parser does not when the
  same file is fetched through `<img>` or `<link rel=icon>`. The sidebar drew a
  broken-image glyph while the tab icon looked fine.
- **An SVG carrying only a `viewBox` has no intrinsic size**, so `<img>`
  reports `naturalWidth: 0`. It needs `width`/`height` as well.

And the mark's 35px cost the sidebar subtitle its single line, which pushed
every nav item down — so the subtitle keeps its own full-width row.

Titles are per route (`Agent — NowHelpAssist`). Eight pages behind one title made a
pinned tab unidentifiable among its own siblings.

### D-5 — the audit page ✅

`tool_events` was named after a job it could not do. Two gaps, both in storage:

1. **Results were never stored.** The sys_id of a created record exists only in
   the tool's return value, so *"what did this session do to the instance"* was
   unanswerable from the table whose comment says it is the audit trail.
2. **It is keyed on an agent session.** Every build driven from a module page —
   a flow deploy, a catalog UI policy, an SLA verification, each writing to the
   instance through the SDK — belonged to no session and left no trace at all.

Migration 5 adds `result`, `actor` and `instance` to `tool_events`, plus
`build_runs` and `build_events`. Instance and account are captured **per
event** rather than read off the session, because the bound connection can
change under a long conversation and the trail has to say where a write landed.
Six SSE routes stream through an audited emitter; `smoke` and `DELETE` are
recorded too, so the audit has no hole shaped like *"writes we did quickly"*.

Three honesty properties, each asserted in `server/test/audit.test.js`:

| property | why it is not cosmetic |
|---|---|
| `auto` stays `auto` | it means auto-approve was on and **no human saw the gate**. Rendering it as "approved" would assert a decision that never happened, on the one page whose entire job is trust |
| pre-migration rows say *not recorded* | "nothing came back" and "we did not store it" are opposite facts, and an empty cell asserts the first |
| a run that dropped events says so | an audit write must never kill a deploy already touching the instance, and must never vanish either. The count goes in the row and the page prints "this history is incomplete" |

On *"who approved"*: NowHelpAssist has no user management, so naming a person would
be a lie. What is recorded is what can be stated truthfully — the decision
(`approved` / `rejected` / `auto` / none) and the ServiceNow account the write
landed under.

Two bugs the tests caught:

- **sys_id harvesting used `\b`.** A ServiceNow deep link URL-encodes its
  separator — `catalog_ui_policy.do%3Fsys_id%3D196e6cb2…` — and the `D` of
  `%3D` is a word character, so `\b` never matched. The page dropped precisely
  the identifier of the thing that had just been created, in precisely the
  format the agent uses to report its own work. The boundary is "not more hex",
  not `\b`.
- **The CSV neutralises a leading `=`, `+`, `-` or `@`.** Excel and Sheets
  evaluate those, and these cells carry model-authored text.

#### Live acceptance (dev442675)

Driven end to end against the real PDI, then answered from `/api/audit` alone:

```
create_record   mutating=true  approval=approved  ok
                sys_ids  6816f79cc0a8016401c5a33be04be441 (caller)
                         c84b2da1837a4350b939cc65eeaad385 (INC0010037)
delete_record   mutating=true  approval=approved  ok
                sys_ids  c84b2da1837a4350b939cc65eeaad385
sla_verify      source=build   approval=ui        ok    dropped=0
                8 streamed events, 6 sys_ids incl. the task_sla rows
```

The CSV honours the page's filters rather than dumping the table, because an
export that silently differs from the screen is worse than no export.

### D-6 — the sweep ✅

The connected click-through was clean. The **disconnected** one logged 18
console errors and exposed two bugs behind them.

**The instance gate gated the wrong thing.** Wrapping a page's returned JSX
controls what it *draws*, not what it *does* — the component is already mounted
and its `useEffect` has already fired the request. Every gated page asked an
unbound instance for data and 400'd before the gate replaced it. The first fix
attempt got 18 → 14, which is the useful part of the story: gating inside the
component **cannot** work. Moving the wrapper to the route means React never
mounts the page. 18 → 0.

**`/api/system/health` blocked on the SDK capability probe** — two `now-sdk`
shell-outs, ~5.5s on a cold cache — to populate a field no client reads. That is
the endpoint every page polls to answer *"is an instance bound"*, so the topbar
read `checking…` for five seconds and the SLA page rendered ungated because the
answer had not arrived. It now serves the cached probe and refreshes in the
background: **5.5s → 21ms cold, 2ms warm.** A probe that has not run reports
`pending`, not `ok: false` — the latter prints fix commands for a problem
nobody has.

That is also what made it affordable for the gate to hold a page back while
health is unknown rather than render it optimistically, and the D-3 test
asserting the opposite was inverted with its reasoning kept.

**The session rail's actions were unreachable by keyboard.** They were revealed
on hover with `display: none`, which removes an element from the tab order — so
rename and delete could not be tabbed to on any row but the active one, and
D-2's dialog could not restore focus to a button that had gone `display: none`
while it was open. Adding `:focus-within` to that rule was measured and found
**inert**: nothing can focus into a subtree that is not rendered. Clipping
keeps them focusable and looks identical.

#### How the keyboard pass was run

Real key events over CDP (`Input.dispatchKeyEvent`), not `element.focus()`.
The distinction is load-bearing: `:focus-visible` — which is what paints
NowHelpAssist's verdigris ring — deliberately does **not** match programmatic focus,
so the first probe reported "no focus ring" on components whose ring is fine.
A probe that only looks for an `outline` also reports a false gap on every
select and textarea, because this theme gives fields a verdigris **border**
instead (`.input:focus { outline: none }`, which predates Track D).

Measured:

| check | result |
|---|---|
| focus indicator, tabbing every control on the Audit page | **14/14** verdigris (outline on buttons/links, border on fields) |
| collapsible payload blocks | reached by Tab, opened with Enter, `aria-expanded` flips |
| rail rename/delete on a non-active row | reachable, revealed on focus |
| confirm dialog | opens from the keyboard, focus lands on **Cancel**, Tab cycles only inside it, Escape closes, focus returns to the button that opened it |
| Enter-to-send | plain Enter sends; Shift+Enter still inserts a newline |
| console, 9 pages × connected and disconnected | **0 problems** |

Browser checks use the same scratchpad CDP driver §23 established — no
Playwright, no Puppeteer, no new repo dependency.

---

### Trap ledger additions

| # | trap | what it looks like | how to not be fooled |
|---|---|---|---|
| 31 | **Gating a component's returned JSX does not gate its effects** | a page that "cannot run without an instance" still fires every request and logs 400s behind its own not-connected screen | The component is mounted before it returns. Gate at the ROUTE — or anywhere the child is an unmounted element — so React never mounts it |
| 32 | **A status endpoint that shells out is a status endpoint that lies** | the topbar reads `checking…` for five seconds; a gate renders the wrong branch because the answer had not arrived | `/health` was `await capability()` — two `now-sdk` spawns, 5.5s cold, for a field no client read. Serve cached, refresh in the background, and report a probe that has not run as `pending` rather than `ok: false` |
| 33 | **`display: none` removes an element from the tab order, so `:focus-within` can never reveal it** | you add `:focus-within` to a hover-reveal rule, it changes nothing, and the CSS looks correct | Nothing can focus into a subtree that is not rendered. Clip it (`position: absolute; clip: rect(0 0 0 0)`) instead — focusable, and visually identical |
| 34 | **`:focus-visible` does not match `element.focus()`** | an accessibility probe reports "no focus ring" on components whose ring is perfect | Drive real key events. And read the indicator the design actually paints: this theme rings buttons with an outline and fields with a border |
| 35 | **A double hyphen inside an XML comment makes an SVG invalid** | the same file renders inlined and silently fails as `<img>` or `<link rel=icon>`; `naturalWidth` is 0 | Naming CSS custom properties in a comment (`--ink`) is enough to do it. The HTML parser forgives, the XML parser does not. Check `naturalWidth`, not the tab |
| 36 | **An SVG with only a `viewBox` has no intrinsic size** | `<img>` renders it as broken, or at 0×0, with no error anywhere | Ship `width`/`height` alongside `viewBox` |
| 37 | **`\b` does not bound a hex id inside a URL-encoded string** | a sys_id scanner silently skips `…sys_id%3D196e6cb2…` — the exact format the agent uses to report what it created | The `D` of `%3D` is a word character. Bound with "not more hex" (`(?<![0-9a-f])…(?![0-9a-f])`), and test against a real transcript rather than a tidy example |
| 38 | **A spreadsheet executes a CSV cell starting with `=`, `+`, `-` or `@`** | an audit export of model-authored text becomes a formula on open | Prefix a single quote. An export is the one artifact that leaves the tool, so it is the one place untrusted text becomes someone else's problem |
| 39 | **`**bold **` is not bold** | a markdown renderer ships and asterisks are still visible in one spot, so the feature looks broken | CommonMark: a closing `**` preceded by whitespace is not a closer. The source is wrong, not the renderer |

---

## 25. The rename — NowForge → NowHelpAssist

The product is renamed everywhere it names itself: the wordmark, the mark, tab
titles, prompts, log lines, error text, package names, the CSV export filename,
this document. The mark splits where the wordmark does — `NH` for
Now | HelpAssist — and was re-cut and re-checked at 16px, because that is the
only size the geometry is actually for.

### What was NOT renamed, and why

A name is a label in most places and an **address** in a few. The addresses are
left alone, and this is the list, because a later reader will otherwise see
"NowForge" in the tree and assume the rename was simply incomplete.

| kept | what it is | what renaming it would do |
|---|---|---|
| `x_2196302_nwforge` (+ its `scopeId`) | the scope of the application **installed on the PDI** | `now-sdk install` would create a second, empty application and leave all nine deployed artifacts behind in the first. A scope is not a display name; it cannot be edited in place |
| `NowForge Flows` | that application's name | same — the SDK matches the app by it |
| `nowforge-flows` | the SDK package name inside `fluent-workspace` | build identity for the above |
| `// nowforge-spec: <fingerprint>` | how `fluent.js` finds the existing source for a request (invariant **d**) | every managed source becomes unrecognisable, so the next edit of an existing flow deploys a **duplicate** instead of updating it. That is the CLASS C failure §12 exists to document, re-created on purpose |
| `// nowforge-policy: <slug>` | the same mechanism for catalog UI policies | a policy NowHelpAssist authored would start reading as one it did not, and become un-editable and un-removable through the toolchain (§23) |
| `NowForge Smoke Test`, and its `short_descriptionLIKEnowforge-smoke-test` trigger | a deployed flow and the condition it fires on | the deployed flow keeps the old name; a renamed source would install a second one |
| `NowForge: change approved…`, `NowForge URGENT escalation…` | **promised literals** asserted by `.verify.json` against flows currently running | the A3 guard would fail its own specs until every flow was regenerated and redeployed. These are the flows' content, not the product's name |

The whole of `server/fluent-workspace/` is therefore untouched.

If the scope should genuinely change, that is a migration, not a rename:
install under the new scope, move or recreate the artifacts, verify each one,
then delete the old application. It is worth doing deliberately or not at all.

### Two addresses that WERE renamed, with a migration each

| moved | carried across by |
|---|---|
| `server/data/nowforge.db` → `nowhelpassist.db` | `adoptLegacyDatabase()` runs before the first open: it checkpoints the old WAL into the main file — so renaming one file cannot strand committed rows in a `-wal` nobody will look for again — renames it, clears the stale sidecars, and logs that it did. Idempotent: once the new file exists it is a no-op |
| `localStorage['nowforge.sessionId']` | read as a fallback on mount and cleared on the first write, so a chat open across the rename is not silently replaced by a new empty one |

Both exist for the same reason: the Audit page's entire claim is that history
survives, and a rename that quietly started a fresh database would have been
the most ironic possible way to break it.

---

### Trap ledger additions

| # | trap | what it looks like | how to not be fooled |
|---|---|---|---|
| 40 | **A rename is a find-and-replace until it hits an address** | the product renames cleanly, the build is green, and the next deploy silently creates a second scoped application beside the live one | Separate labels from addresses first. A ServiceNow scope, an app name, an identity marker a tool matches sources by, and any literal a verification spec asserts are all addresses — protect them explicitly, and write down why, or the next reader will "finish the job" |
| 41 | **A renamed data file is a discarded data file** | the app starts, works perfectly, and has no history — the old database is sitting next to the new one | Rename the file *and* carry the data, checkpointing WAL first. The same applies to any localStorage key holding live state |

---

## 26. The empty turn, and why nothing was written down

A session reported `invalid message content type: <nil> (ref: …)` on every
message, forever. The UI showed a red box; the server terminal showed nothing,
because the failure arrived as an SSE `error` event that the client rendered
and dropped. Finding it meant reading the database by hand.

### The bug

The first hypothesis was wrong, and only a probe against the real backend
showed it. Measured on `gpt-oss:120b-cloud` through Ollama's `/v1` shim:

| assistant message | result |
|---|---|
| `content: null`, **with** `tool_calls` | **200** |
| `content: null`, **no** `tool_calls` | **400** `invalid message content type: <nil>` |
| `content: ''`, no `tool_calls` | **200** |

So the guess — "OpenAI allows a null content beside tool_calls and Ollama does
not" — was backwards. Ollama honours that case fine. What it rejects is a bare
null, and the adapter emitted one for any assistant entry with empty text:
`content: m.text || null`.

That mattered because of what the orchestrator stored. When the model returns
an empty turn — no text *and* no tool calls, which this model does — that was
appended to the history as a message. Replayed on the next turn it became
`{role:'assistant', content:null}` with no `tool_calls`, and the session was
**permanently bricked**: every later message failed at the wire, with an error
naming neither the session nor the offending entry.

Scanning the live database found exactly one such row across 90 messages —
`assistant text=EMPTY toolCalls=0` — and it was in the reported session.

Fixed at both levels, because either alone is insufficient:

- **The wire** coerces every `content` to a string. This repairs histories that
  already contain the poison message, including the user's.
- **The orchestrator** refuses to store an empty turn at all. A model returning
  nothing is a failure to report, not a message to keep. The existing
  "returned no content" guard only fired on `finish_reason: length`; this
  catches the rest.

### The reason it took a database read to find

Nothing logged. That is the real defect, and it is now fixed separately: see
§27.

---

## 27. One log stream

`server/src/logging.js`, plus `POST /api/logs` and `client/src/logging.js` so
the browser's half prints in the same terminal. Levels, a scope column, colour
when stdout is a TTY, `LOG_LEVEL=debug` for the health poll and per-request
reads.

What it prints without being asked: every HTTP request with status and
duration; every agent turn with its session, provider and model; every tool
call with its arguments, outcome and elapsed time; every approval decision,
with an explicit `UNGATED` warning when auto-approve let one through; every
build run; every migration; and on the browser side every navigation,
`console.error`/`warn`, uncaught exception, unhandled rejection, failed API
call and render error, tagged with the route it happened on.

Three properties that are load-bearing rather than nice:

- **Secrets never reach it.** Request bodies are never printed, and structured
  metadata goes through `redact()`, which masks `password`, `apiKey`,
  `client_secret`, `Authorization` and friends at any depth. A falsy secret is
  passed through as itself — `<redacted>` against an absent password would read
  as one being stored.
- **The browser half cannot loop.** A failure of the log transport is never
  logged over the transport.
- **Repeats collapse.** Consecutive identical entries become one line with a
  count. StrictMode double-invokes every effect in dev, so each navigation
  logged twice; more importantly a render loop would otherwise bury its own
  cause under a hundred copies of its symptom.

Immediately worth it: the first live run surfaced the bound PDI dropping a
request (`Could not reach dev428633… Is the PDI awake?`) and the agent
recovering by calling `test_connection` and retrying — a self-correction that
had been happening invisibly.

---

### Trap ledger additions

| # | trap | what it looks like | how to not be fooled |
|---|---|---|---|
| 42 | **An empty model turn, stored, bricks a session forever** | one conversation fails on every message with a wire error that names neither the session nor the message; every other conversation is fine | A turn with no text and no tool calls is the model returning nothing. Refuse it where it happens. Anything persisted into a replayed history is a permanent input, not a transient one |
| 43 | **`content: null` is legal beside `tool_calls` and illegal without it** | you fix the wrong branch, confidently, because the OpenAI spec says null is allowed | It is allowed — for the tool-call case, which is the one that was already working. Probe each shape against the actual backend; the wire is where the spec and the implementation differ |
| 44 | **A UI that renders an error is not a system that recorded one** | a red box in the browser, a silent terminal, and a bug that can only be found by reading the database | Log both halves into one stream. An SSE `error` frame, a rejected fetch and a render error are all invisible server-side unless the client sends them |
