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

### Survey of all 10 NowForge-scoped artifacts

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
impossible locator. None of those is a bug in NowForge. All of them shipped, or nearly shipped,
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
