import { table, testConnection } from '../servicenow/client.js';
import { getSchema, referenceLookup, tableLookup } from '../servicenow/schema.js';
import { catalog } from '../servicenow/catalog.js';
import { flows, designFlowBlueprint } from '../servicenow/flows.js';
import { capability, createLiveFlow, listManaged, removeManaged, smokeRun, verify } from '../servicenow/fluent.js';
import { listSlas, getSla, slaMeta, createSla, verifySla } from '../servicenow/sla.js';
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
      'Get the full field schema for any ServiceNow table, walking the inheritance chain (e.g. incident→task). Returns each field with type, label, mandatory flag, choice list values, and — for reference fields — the referenced table. ALWAYS call this before creating/updating records on an unfamiliar table.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string', description: 'Table name, e.g. incident, sc_cat_item' } },
      required: ['table'],
    },
    execute: async ({ table: t }) => {
      const schema = await getSchema(t);
      // A-4 write path: fields the platform computes accept a write and then
      // discard it (trap #5's family). Recording them here means the next
      // session starts knowing, instead of rediscovering it by shipping a bug.
      try { recordCalculatedFields(t, schema); } catch { /* the ledger is never load-bearing for a read */ }
      return schema;
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
      'BUILD STEP. Create a REAL, active Flow Designer flow on the instance from a plain-language description or a blueprint from design_flow_blueprint. Generates Fluent TypeScript, compiles it offline (nothing reaches the instance unless it compiles), installs it, and reads the result back. Returns the flow name, sys_id, type and link. Requires user approval. Note: installing deploys the whole managed application, so the response lists every artifact shipped.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Plain-language automation request' },
        blueprint: { type: 'object', description: 'A blueprint object previously returned by design_flow_blueprint' },
      },
      required: [],
    },
    execute: async ({ description, blueprint }) => {
      const spec = description || (blueprint ? JSON.stringify(blueprint, null, 1) : null);
      if (!spec) throw new Error('Provide either description or blueprint.');
      return createLiveFlow(spec);
    },
  },
  {
    name: 'list_live_flows',
    description: 'List the flows and subflows NowForge manages as Fluent source, with their current state on the instance.',
    mutating: false,
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: () => listManaged(),
  },
  {
    name: 'delete_live_flow',
    description:
      'Delete a NowForge-managed flow by name: removes its Fluent source, reinstalls, and confirms it is gone from the instance. Destructive — confirm with the user in conversation first. Requires user approval.',
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
