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

**What Phase 2 actually shipped:** the server drives the SDK through the **stored alias** (a),
not the env vars. The alias already exists on this machine, works non-interactively, and keeps
the instance password out of the Node process entirely — NowForge never handles it. Mechanism
(b) remains the documented path for CI, where no credential store is present.

Note the two credential stores are independent: the SDK's alias store is separate from
NowForge's `server/data/settings.json`, so they can point at different instances.
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
