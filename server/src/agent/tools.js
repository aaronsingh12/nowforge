import { table, testConnection } from '../servicenow/client.js';
import { getSchema, toCompactSchema, referenceLookup, tableLookup } from '../servicenow/schema.js';
import { catalog } from '../servicenow/catalog.js';
import { flows, designFlowBlueprint } from '../servicenow/flows.js';
import { capability, createLiveFlow, listManaged, removeManaged, smokeRun, verify } from '../servicenow/fluent.js';
import { listSlas, getSla, slaMeta, createSla, verifySla } from '../servicenow/sla.js';
import { listPoliciesForItem, itemVariables, createPolicy, CONDITION_OPERATORS } from '../servicenow/catalogPolicy.js';
import { aclReport, aclDiff, explainAclReport } from '../servicenow/acl.js';
import { search } from '../memory/recall.js';
import { recordCalculatedFields, listFacts, recordFact } from '../memory/facts.js';

/**
 * Tool registry — the agent's hands.
 * `mutating: true` tools are intercepted by the approval gate unless the user
 * has enabled auto-approve (same idea as Claude Code's permission prompts).
 */
export const TOOLS = [
  {
    name: 'test_connection',
    description: 'Verify the configured ServiceNow instance is reachable and authenticated.',
    mutating: false,
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: () => testConnection(),
  },
  {
    name: 'get_table_schema',
    description:
      'Get the field schema for any ServiceNow table, walking the inheritance chain (e.g. incident -> task). ' +
      'Returns EVERY field with its type, reference target, and mandatory flag — so if a field is not in the list, ' +
      'it does not exist on that table, and you can say so with confidence. Choice values are counted, not listed; ' +
      'pass expand:["state","priority"] to see the values for the specific fields you are about to write to. ' +
      'ALWAYS call this before creating or updating records on an unfamiliar table.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name, e.g. incident, sc_cat_item' },
        expand: {
          type: 'array',
          items: { type: 'string' },
          description: 'Field names whose choice values you need in full. Keep this short — name only the fields the current task touches.',
        },
        full: {
          type: 'boolean',
          description: 'Rarely needed. Returns labels, max lengths and defaults for every field as well — large enough to crowd out the rest of the conversation.',
        },
      },
      required: ['table'],
    },
    execute: async ({ table: t, expand, full }) => {
      const schema = await getSchema(t);
      // A-4 write path: fields the platform computes accept a write and then
      // discard it (trap #5's family). Recording them here means the next
      // session starts knowing, instead of rediscovering it by shipping a bug.
      try { recordCalculatedFields(t, schema); } catch { /* the ledger is never load-bearing for a read */ }
      /*
       * D-7 — compact by default, and the default is the correctness fix.
       *
       * MEASURED on dev442675: `incident` carries 91 fields and serialises to
       * 29,152 characters, about 8,330 tokens. The agent's history budget at
       * the time was 5,452, so one schema read was 153% of everything the
       * conversation could hold — and the orchestrator's 8,000-character result
       * cap hid that instead of fixing it. Fields are sorted alphabetically, so
       * the cut landed after `company`: the agent saw 26 of 91 fields, never
       * saw `state`, `priority` or `assignment_group`, and — because `u_`
       * fields sort last — could not observe that a custom field was ABSENT.
       *
       * Compact mode is 1,007 tokens for the same table, 8.3x smaller, with
       * every field name present. `full` stays for the UI and codegen paths
       * that genuinely need labels and defaults.
       */
      return full ? schema : toCompactSchema(schema, { expand });
    },
  },
  {
    name: 'lookup_reference',
    description:
      'Resolve a reference field value: search a table by its display field and get back sys_id + display value pairs. Use this to turn names like "Service Desk" or "Abel Tuter" into sys_ids BEFORE writing them into reference fields. Never invent sys_ids.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Referenced table, e.g. sys_user, sys_user_group, cmdb_ci' },
        search: { type: 'string', description: 'Text to search for' },
        limit: { type: 'number' },
      },
      required: ['table'],
    },
    execute: ({ table: t, search, limit }) => referenceLookup(t, search || '', limit || 10),
  },
  {
    name: 'lookup_table',
    description: 'Find ServiceNow tables by name or label (searches sys_db_object). Use when you need the exact table name for a record producer, list collector, or flow trigger.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { search: { type: 'string' } },
      required: ['search'],
    },
    execute: ({ search }) => tableLookup(search),
  },
  {
    name: 'query_records',
    description:
      'Query any ServiceNow table with an encoded query. Returns records with both raw values and display values for every field (reference fields come back as {value: sys_id, display_value: label}).',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        query: { type: 'string', description: 'ServiceNow encoded query, e.g. active=true^priority=1' },
        fields: { type: 'string', description: 'Comma-separated field list (keep results small)' },
        limit: { type: 'number' },
        order_by_desc: { type: 'string' },
      },
      required: ['table'],
    },
    execute: ({ table: t, query, fields, limit, order_by_desc }) =>
      table.query(t, { query, fields, limit: Math.min(limit || 10, 50), orderByDesc: order_by_desc }),
  },
  {
    name: 'get_record',
    description: 'Fetch a single record by sys_id from any table.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, sys_id: { type: 'string' } },
      required: ['table', 'sys_id'],
    },
    execute: ({ table: t, sys_id }) => table.get(t, sys_id),
  },
  {
    name: 'create_record',
    description:
      'Create a record in any ServiceNow table. Reference fields must contain sys_ids you resolved with lookup_reference. Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        data: { type: 'object', description: 'Field/value pairs' },
      },
      required: ['table', 'data'],
    },
    execute: ({ table: t, data }) => table.create(t, data),
  },
  {
    name: 'update_record',
    description: 'Update a record by sys_id. Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        sys_id: { type: 'string' },
        data: { type: 'object' },
      },
      required: ['table', 'sys_id', 'data'],
    },
    execute: ({ table: t, sys_id, data }) => table.update(t, sys_id, data),
  },
  {
    name: 'delete_record',
    description: 'Delete a record by sys_id. Destructive — requires user approval. Confirm intent with the user before calling.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' }, sys_id: { type: 'string' } },
      required: ['table', 'sys_id'],
    },
    execute: ({ table: t, sys_id }) => table.remove(t, sys_id),
  },
  {
    name: 'create_incident',
    description:
      'Convenience tool to create an incident. Resolve caller/assignment_group/assigned_to to sys_ids first via lookup_reference. Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        short_description: { type: 'string' },
        description: { type: 'string' },
        caller_id: { type: 'string', description: 'sys_id of a sys_user' },
        assignment_group: { type: 'string', description: 'sys_id of a sys_user_group' },
        assigned_to: { type: 'string', description: 'sys_id of a sys_user' },
        urgency: { type: 'string', description: '1|2|3' },
        impact: { type: 'string', description: '1|2|3' },
        category: { type: 'string' },
      },
      required: ['short_description'],
    },
    execute: (input) => table.create('incident', input),
  },
  {
    name: 'create_catalog_item',
    description:
      'Composite builder: create a catalog item WITH its variables (and their choices) in one shot. Variable types: 1 Yes/No, 2 Multi Line Text, 3 Multiple Choice, 5 Select Box, 6 Single Line Text, 7 Checkbox, 8 Reference (set reference_table), 9 Date, 10 Date/Time, 21 List Collector (set reference_table), 25 Masked, 26 Email. Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        short_description: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', description: 'sys_id of sc_category (optional; resolve via lookup_reference on sc_category)' },
        variables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'internal name, snake_case' },
              question_text: { type: 'string' },
              type: { type: 'number', description: 'variable type code' },
              mandatory: { type: 'boolean' },
              reference_table: { type: 'string', description: 'for type 8 / 21' },
              choices: {
                type: 'array',
                items: { type: 'object', properties: { text: { type: 'string' }, value: { type: 'string' } } },
              },
            },
            required: ['name', 'type'],
          },
        },
      },
      required: ['name', 'short_description'],
    },
    execute: (input) => catalog.createCatalogItemComposite(input),
  },
  {
    name: 'create_record_producer',
    description: 'Create a record producer targeting a table (resolve exact table name with lookup_table first). Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        table_name: { type: 'string' },
        short_description: { type: 'string' },
        script: { type: 'string' },
      },
      required: ['name', 'table_name'],
    },
    execute: (input) => catalog.createRecordProducer(input),
  },
  {
    name: 'list_flows',
    description: 'List Flow Designer flows on the instance (name, active, status, scope).',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { search: { type: 'string' }, active_only: { type: 'boolean' } },
      required: [],
    },
    execute: ({ search, active_only }) => flows.list({ search, activeOnly: active_only }),
  },
  {
    name: 'get_flow',
    description: 'Read one flow top-to-bottom: header, trigger instances, ordered action instances, and flow logic blocks.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { sys_id: { type: 'string' } },
      required: ['sys_id'],
    },
    execute: ({ sys_id }) => flows.detail(sys_id),
  },
  {
    name: 'design_flow_blueprint',
    description:
      'DESIGN STEP. Turn a plain-language automation request into a precise flow blueprint: trigger, exact actions, configs, reference fields, and a test plan. Use this to think through and show the design before building. To actually build it on the instance, pass the blueprint to create_flow_live.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { description: { type: 'string' } },
      required: ['description'],
    },
    execute: ({ description }) => designFlowBlueprint(description),
  },
  {
    name: 'flow_authoring_capability',
    description:
      'Check whether live Flow Designer authoring is available: ServiceNow SDK present, credentials stored, workspace healthy. Call this before promising to build a real flow. If ok is false, the returned fixes[] carry the exact commands, and the Business Rule fallback becomes the only option.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { deep: { type: 'boolean', description: 'Also run an authenticated probe against the instance (slower, ~8s)' } },
      required: [],
    },
    execute: ({ deep }) => capability({ deep: Boolean(deep) }),
  },
  {
    name: 'create_flow_live',
    description:
      'BUILD STEP. Create or UPDATE a REAL, active Flow Designer flow on the instance from a plain-language description or a blueprint from design_flow_blueprint. Generates Fluent TypeScript, compiles it offline (nothing reaches the instance unless it compiles), installs it, and reads the result back. Returns the flow name, sys_id, type and link. Requires user approval. Note: installing deploys the whole managed application, so the response lists every artifact shipped. ' +
      'TO CHANGE AN EXISTING FLOW — adding a step, a condition, a branch — pass its EXACT current name as `updates`, and describe the flow as it should be when finished. Editing in place keeps the same sys_id. Creating a second flow instead collides with the first on its element keys and fails. Use list_live_flows to get the exact name.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Plain-language automation request, describing the finished flow' },
        blueprint: { type: 'object', description: 'A blueprint object previously returned by design_flow_blueprint' },
        updates: {
          type: 'string',
          description:
            'Exact name of an existing managed flow or subflow to edit IN PLACE, keeping its sys_id. Omit when creating something new.',
        },
      },
      required: [],
    },
    execute: async ({ description, blueprint, updates }) => {
      const spec = description || (blueprint ? JSON.stringify(blueprint, null, 1) : null);
      if (!spec) throw new Error('Provide either description or blueprint.');
      return createLiveFlow(spec, () => {}, { updates: updates || null });
    },
  },
  {
    name: 'list_live_flows',
    description: 'List the flows and subflows NowHelpAssist manages as Fluent source, with their current state on the instance.',
    mutating: false,
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: () => listManaged(),
  },
  {
    name: 'delete_live_flow',
    description:
      'Delete a NowHelpAssist-managed flow by name: removes its Fluent source, reinstalls, and confirms it is gone from the instance. Destructive — confirm with the user in conversation first. Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Exact flow/subflow name' } },
      required: ['name'],
    },
    execute: ({ name }) => removeManaged(name),
  },
  {
    name: 'verify_flow_live',
    description:
      'SEMANTIC VERIFICATION. Prove a deployed record-triggered flow actually does what was asked: creates a record matching its trigger, waits for the execution to settle, asserts the promised effects (field set, note added, record created), then deletes the test data. Compiling only proves a flow is well-formed — this proves it is correct. Writes real records, so it needs its own approval and never runs automatically after a deploy.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Exact flow name as deployed' } },
      required: ['name'],
    },
    execute: ({ name }) => verify(name),
  },
  {
    name: 'smoke_test_flow',
    description:
      'Optionally verify a deployed record-triggered flow by creating a test record that matches its trigger, waiting for a sys_flow_context execution, then deleting the test record. This writes real data, is NEVER part of a deploy, and needs its own approval. Resolve any reference values to sys_ids with lookup_reference first.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table to create the test record on, e.g. incident' },
        values: { type: 'object', description: 'Field values chosen to satisfy the flow trigger condition' },
        wait_ms: { type: 'number', description: 'How long to wait for an execution (default 45000)' },
      },
      required: ['table', 'values'],
    },
    execute: ({ table: t, values, wait_ms }) => smokeRun({ table: t, values, waitMs: wait_ms || 45000 }),
  },
  {
    name: 'get_catalog_item',
    description:
      'Read a catalog item top to bottom: its variables in order (with type, mandatory flag, help text, default, and the REAL choice values for choice-type variables), plus every UI policy scoped to it. Call this before proposing any change to an item — variable sys_ids and choice VALUES are what conditions and actions are built from, and neither can be guessed.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { sys_id: { type: 'string', description: 'sys_id of the sc_cat_item (resolve the name with lookup_reference on sc_cat_item)' } },
      required: ['sys_id'],
    },
    execute: async ({ sys_id }) => {
      const [item, policies] = await Promise.all([catalog.getItemDeep(sys_id), listPoliciesForItem(sys_id)]);
      return {
        item: { sys_id, name: item.item?.name?.display_value ?? item.item?.name, active: item.item?.active?.value },
        variables: policies.variables,
        variableSets: item.variableSets?.map((s) => ({ title: s.title?.display_value ?? s.title, variables: (s._variables || []).length })) || [],
        policies: policies.policies,
      };
    },
  },
  {
    name: 'add_catalog_variable',
    description:
      'Add one variable to an EXISTING catalog item. For a choice type (3 Multiple Choice, 5 Select Box, 18 Lookup Select Box, 22 Lookup Multiple Choice) pass choices — a choice with no value cannot be referenced by a UI policy condition. Call get_catalog_item first so the order does not collide. Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        cat_item: { type: 'string', description: 'sys_id of the catalog item' },
        name: { type: 'string', description: 'internal name, snake_case' },
        question_text: { type: 'string' },
        type: { type: 'number', description: 'variable type code — read the real list from the catalog meta rather than assuming' },
        mandatory: { type: 'boolean' },
        order: { type: 'number' },
        help_text: { type: 'string' },
        default_value: { type: 'string' },
        reference_table: { type: 'string', description: 'for type 8 (Reference) / 21 (List Collector)' },
        choices: {
          type: 'array',
          items: { type: 'object', properties: { text: { type: 'string' }, value: { type: 'string' } } },
        },
      },
      required: ['cat_item', 'name', 'type'],
    },
    execute: ({ cat_item, ...v }) => catalog.createVariable({ cat_item }, v),
  },
  {
    name: 'update_catalog_variable',
    description:
      'Update one variable in place: question_text, order, mandatory, help_text, default_value. Use this rather than deleting and recreating — a recreated variable gets a NEW sys_id, and every UI policy condition and action that names the old one silently stops matching. Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        sys_id: { type: 'string', description: 'sys_id of the item_option_new record' },
        question_text: { type: 'string' },
        order: { type: 'number' },
        mandatory: { type: 'boolean' },
        help_text: { type: 'string' },
        default_value: { type: 'string' },
      },
      required: ['sys_id'],
    },
    execute: async ({ sys_id, ...patch }) => {
      const data = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        data[k] = typeof v === 'boolean' ? String(v) : String(v);
      }
      if (!Object.keys(data).length) throw new Error('Nothing to update — pass at least one field.');
      const before = await table.get('item_option_new', sys_id);
      await catalog.updateVariable(sys_id, data);
      const after = await table.get('item_option_new', sys_id);
      // Read-back, because a write to a field that does not exist is accepted
      // and discarded rather than refused.
      const mismatches = Object.entries(data)
        .map(([f, want]) => ({ field: f, sent: want, stored: after?.[f]?.value ?? after?.[f] }))
        .filter((m) => String(m.stored) !== String(m.sent));
      return {
        ok: mismatches.length === 0,
        sys_id,
        name: after?.name?.value ?? after?.name,
        changed: Object.fromEntries(Object.keys(data).map((f) => [f, {
          from: before?.[f]?.value ?? before?.[f], to: after?.[f]?.value ?? after?.[f],
        }])),
        mismatches,
      };
    },
  },
  {
    name: 'list_ui_policies',
    description:
      'List the catalog UI policies scoped to one item, with their conditions decoded into readable form (which variable, which operator, which value) and their actions. Also reports problems NowHelpAssist can see without running the form: a condition on a variable that is not on the item, a value the variable cannot hold, or an action that leaves everything on "ignore" and therefore does nothing.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { cat_item: { type: 'string', description: 'sys_id of the catalog item' } },
      required: ['cat_item'],
    },
    execute: ({ cat_item }) => listPoliciesForItem(cat_item),
  },
  {
    name: 'create_ui_policy',
    description:
      'Create a catalog UI policy that shows, hides, requires or freezes a variable in response to another variable. Conditions and actions both address variables by their item_option_new sys_id, which you must read with get_catalog_item first — a condition naming anything else can never be satisfied, and NowHelpAssist refuses it rather than writing a policy that saves and does nothing. Choice values are checked against the variable real choices for the same reason. IMPORTANT: this compiles and installs through the ServiceNow SDK and takes about a minute, because catalog_ui_policy_action cannot be written over REST at all — a POST returns 201 and silently discards the fields that attach the action to its policy. Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        catalog_item: { type: 'string', description: 'sys_id of the catalog item' },
        short_description: { type: 'string', description: 'The policy name, e.g. "Require justification for permanent access"' },
        conditions: {
          type: 'array',
          description: 'WHEN. Every entry names a variable by sys_id.',
          items: {
            type: 'object',
            properties: {
              variable: { type: 'string', description: 'item_option_new sys_id of the variable being tested' },
              operator: { type: 'string', description: 'One of: =, !=, IN, NOT IN, ISEMPTY, ISNOTEMPTY, LIKE, STARTSWITH' },
              value: { type: 'string', description: 'For a choice variable this must be the choice VALUE, not its display text' },
              join: { type: 'string', description: 'AND (default) | OR' },
            },
            required: ['variable', 'operator'],
          },
        },
        actions: {
          type: 'array',
          description: 'THEN. Each state is the string "true", "false" or "ignore" — "ignore" means leave alone, and an action left entirely on ignore does nothing.',
          items: {
            type: 'object',
            properties: {
              variable: { type: 'string', description: 'item_option_new sys_id of the variable being changed' },
              visible: { type: 'string', description: 'true | false | ignore' },
              mandatory: { type: 'string', description: 'true | false | ignore' },
              disabled: { type: 'string', description: 'true | false | ignore — "disabled" is read-only' },
            },
            required: ['variable'],
          },
        },
        reverse_if_false: { type: 'boolean', description: 'Put the variables back when the condition stops being true. Default true, and almost always what "only when" means.' },
        active: { type: 'boolean' },
        order: { type: 'number' },
      },
      required: ['catalog_item', 'short_description', 'conditions', 'actions'],
    },
    execute: (input) => createPolicy(input),
  },
  {
    name: 'list_slas',
    description:
      'List SLA definitions (contract_sla) on the instance: name, table, duration (decoded to seconds and a human form), schedule, and the start/stop/pause conditions. Read-only.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Match on name' },
        table: { type: 'string', description: 'Restrict to SLAs that run on this table, e.g. incident' },
        active_only: { type: 'boolean' },
      },
      required: [],
    },
    execute: ({ search, table: t, active_only }) => listSlas({ search, collection: t, activeOnly: active_only }),
  },
  {
    name: 'get_sla',
    description: 'Read one SLA definition top to bottom by name or sys_id, including whether its schedule is actually in effect.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Exact name, or a sys_id' } },
      required: ['name'],
    },
    execute: ({ name }) =>
      (/^[0-9a-f]{32}$/i.test(name)
        ? getSla(name)
        : listSlas({ search: name }).then((r) => r.find((x) => x.name === name) || r[0] || null)),
  },
  {
    name: 'sla_meta',
    description: 'Choice values, schedules and relative-duration types available for building an SLA definition on this instance. Call before create_sla so every value is real.',
    mutating: false,
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: () => slaMeta(),
  },
  {
    name: 'create_sla',
    description:
      'Create an SLA definition (contract_sla) on the instance. Every condition is checked field-by-field against the target table BEFORE anything is written — a start condition naming a field that does not exist is not an error on this platform, it is a WIDER condition, and the SLA then attaches to every record on the table. duration accepts "4h", "90m", "2d 4h", "4:00:00" or seconds. A schedule is only honoured when schedule_source is "sla_definition". Requires user approval.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        collection: { type: 'string', description: 'Table the SLA runs on, e.g. incident' },
        duration: { type: 'string', description: '"4h", "90m", "2d 4h", "4:00:00", or a number of seconds' },
        start_condition: { type: 'string', description: 'Encoded query on the target table. Required.' },
        stop_condition: { type: 'string', description: 'Encoded query on the target table' },
        pause_condition: { type: 'string', description: 'Encoded query on the target table' },
        type: { type: 'string', description: 'SLA | OLA | Underpinning contract' },
        target: { type: 'string', description: 'response | resolution' },
        schedule: { type: 'string', description: 'sys_id of a cmn_schedule (resolve with lookup_reference on cmn_schedule)' },
        schedule_source: { type: 'string', description: 'no_schedule | sla_definition | task_field. A schedule is IGNORED unless this is sla_definition.' },
        duration_type: { type: 'string', description: 'sys_id of a cmn_relative_duration, INSTEAD of a fixed duration' },
        timezone_source: { type: 'string' },
        retroactive: { type: 'boolean' },
        when_to_cancel: { type: 'string' },
        active: { type: 'boolean' },
      },
      required: ['name', 'collection', 'start_condition'],
    },
    execute: (input) => createSla(input),
  },
  {
    name: 'verify_sla_live',
    description:
      "SEMANTIC VERIFICATION for an SLA. Derives a record from the definition's OWN start condition (driving calculated fields through their inputs), creates it, confirms the platform agrees it matches, then asserts that a task_sla attached REFERENCING THIS DEFINITION with a planned_end of start + duration inside a stated tolerance — and deletes the record again, reading back to prove it is gone. Note that other SLAs on the instance attach to the same record, so \"an SLA attached\" is not the assertion; \"this one attached\" is. Writes real records, so it needs its own approval.",
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact SLA definition name, or a sys_id' },
        tolerance_sec: { type: 'number', description: 'Allowed drift on planned_end (default 120)' },
      },
      required: ['name'],
    },
    execute: ({ name, tolerance_sec }) => verifySla(name, () => {}, { toleranceSec: tolerance_sec || undefined }),
  },
  {
    name: 'acl_report',
    description:
      'Read the access control rules for a table: record and field ACLs across the whole inheritance chain, with operation, roles, condition, active flag, admin_overrides, and whether a script guards the rule. Read-only, and it never authors an ACL. If the ACL tables are not readable on this connection the report says so — an empty result is a visibility answer, not "this table has no ACLs".',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        inherited: { type: 'boolean', description: 'Include ACLs defined on parent tables (default true)' },
      },
      required: ['table'],
    },
    execute: ({ table: t, inherited }) => aclReport(t, { includeInherited: inherited !== false }),
  },
  {
    name: 'acl_diff',
    description:
      'Compare two roles against one table: which ACL rows name each, per operation, plus field-level differences. This is a diff of what the rules SAY, not a simulation of the decision engine — the response carries that caveat and you must pass it on rather than telling the user what a role "can do".',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        role_a: { type: 'string', description: 'e.g. admin' },
        role_b: { type: 'string', description: 'e.g. itil' },
      },
      required: ['table', 'role_a', 'role_b'],
    },
    execute: ({ table: t, role_a, role_b }) => aclDiff(t, role_a, role_b),
  },
  {
    name: 'explain_acls',
    description:
      'Turn the structured ACL report for a table into a plain-language summary. The summary is GENERATED and the response labels it as such; the report it describes is read off the instance. Read-only.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' } },
      required: ['table'],
    },
    execute: async ({ table: t }) => explainAclReport(await aclReport(t)),
  },
  {
    name: 'recall_memory',
    description:
      'Search every past conversation and the instance knowledge ledger. Use this whenever the user refers to earlier work — "what did we decide about vendor-hold incidents", "the flow we built last week", "that sys_id from before" — instead of guessing or saying you cannot know. Read-only. The response states which mode answered: "semantic" (embeddings) or "keyword" (the embedding model is not pulled), so report the mode if the results look thin.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in plain language' },
        limit: { type: 'number', description: 'Max results (default 8)' },
        session_id: { type: 'string', description: 'Restrict to one session; omit to search all of them' },
      },
      required: ['query'],
    },
    execute: ({ query, limit, session_id }) =>
      search(query, { limit: Math.min(limit || 8, 25), sessionId: session_id || null }),
  },
  {
    name: 'list_instance_facts',
    description:
      'Read the instance knowledge ledger: traps, measured facts about this instance, established decisions, and user preferences. These are already injected into your system prompt — call this only when you need the full list or a specific provenance.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', description: 'trap | mapping | decision | preference' } },
      required: [],
    },
    execute: ({ kind }) => listFacts({ kind: kind || undefined }),
  },
  {
    name: 'remember_fact',
    description:
      'Store something durable in the instance knowledge ledger, so future sessions start knowing it. Use for a measured fact about this instance, a decision the user made, or a preference they stated. Give provenance — how it was established. Not a mutation on the instance, but it does change future behaviour, so only record things you actually verified or the user actually said.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'trap | mapping | decision | preference' },
        key: { type: 'string', description: 'Short kebab-case identifier, e.g. incident-problem-link-absent' },
        value: { type: 'string', description: 'The fact itself, stated so a future session can act on it' },
        provenance: { type: 'string', description: 'How this was established (a read-back, a failed verification, the user said so)' },
      },
      required: ['kind', 'key', 'value'],
    },
    execute: ({ kind, key, value, provenance }) => recordFact({ kind, key, value, provenance }),
  },
];

export const toolMap = new Map(TOOLS.map((t) => [t.name, t]));
