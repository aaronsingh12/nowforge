import zlib from 'node:zlib';
import { table } from './client.js';
import { chatOnce } from '../agent/providers/index.js';

/**
 * Flow Designer module.
 *
 * READ side: flows and their parts are ordinary records —
 *   sys_hub_flow      flow / subflow headers (the `type` field distinguishes them)
 *   sys_flow_context  executions
 * plus one *family* of part tables. Current releases write the `_v2` tables;
 * older instances use the unsuffixed names. Both families exist side by side on
 * a modern instance, and the legacy tables are EMPTY for modern flows — so
 * reading the legacy names silently yields zero rows that look like "this flow
 * has no trigger". detail() therefore prefers `_v2`, falls back only when the
 * v2 tables genuinely do not exist, and always reports which family it used via
 * `sourceTables`.
 *
 * WRITE side: authoring is done with the ServiceNow SDK (Fluent) — see
 * ./fluent.js. There is still no supported REST API for inserting sys_hub_*
 * records directly, and this module never attempts it.
 *
 * Authoring tiers:
 *   1. "fluentSdk"       (shipped)  — generate Fluent TypeScript, compile it
 *                                     offline, install it. See fluent.js.
 *   2. "blueprint"       (shipped)  — LLM designs a precise build spec.
 *   3. "classicFallback" (shipped)  — record-triggered blueprints become an
 *                                     inactive Business Rule, for environments
 *                                     where the SDK cannot run.
 */

const PART_FAMILIES = {
  v2: {
    triggers: { table: 'sys_hub_trigger_instance_v2', fields: 'sys_id,trigger_type,name,comment,trigger_inputs' },
    actions: { table: 'sys_hub_action_instance_v2', fields: 'sys_id,order,action_type,comment' },
    logic: { table: 'sys_hub_flow_logic_instance_v2', fields: 'sys_id,order,logic_definition,comment' },
  },
  legacy: {
    triggers: { table: 'sys_hub_trigger_instance', fields: 'sys_id,trigger_type,table,condition,active,sys_class_name' },
    actions: { table: 'sys_hub_action_instance', fields: 'sys_id,order,active,action_type,comment,sys_updated_on' },
    logic: { table: 'sys_hub_flow_logic', fields: 'sys_id,order,active,logic_definition,sys_updated_on' },
  },
};

/** display='all' wraps every field as {value, display_value}. */
const raw = (record, field) => {
  const v = record?.[field];
  return v && typeof v === 'object' ? v.value : v;
};

/** A table that does not exist on this instance answers 400 "Invalid table X". */
const isMissingTable = (err) => err?.status === 400 && /invalid table/i.test(err.message || '');

/**
 * Trigger configuration (table, condition, ...) is not stored in columns — it
 * lives in `trigger_inputs` as gzipped, base64-encoded JSON. Decoding it is the
 * only way to show what a trigger actually listens to.
 */
function decodeTriggerInputs(encoded) {
  if (!encoded) return null;
  try {
    const json = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const config = {};
    for (const p of parsed) {
      if (p?.name && p.value !== '' && p.value != null) {
        config[p.name] = p.displayValue || p.value;
      }
    }
    return config;
  } catch {
    // Format changed or the blob is not gzip — surface absence, never a guess.
    return null;
  }
}

async function queryPart({ table: t, fields }, sysId, orderBy) {
  try {
    const rows = await table.query(t, {
      query: `flow=${sysId}`,
      fields,
      ...(orderBy ? { orderBy } : {}),
      limit: 100,
    });
    return { rows, available: true };
  } catch (err) {
    if (isMissingTable(err)) return { rows: [], available: false };
    throw err; // real failures (ACL, network, bad query) must surface
  }
}

async function readFamily(familyName, sysId) {
  const fam = PART_FAMILIES[familyName];
  const [triggers, actions, logic] = await Promise.all([
    queryPart(fam.triggers, sysId),
    queryPart(fam.actions, sysId, 'order'),
    queryPart(fam.logic, sysId, 'order'),
  ]);
  return { familyName, triggers, actions, logic };
}

export const flows = {
  /**
   * Lists flows AND subflows. `type` filters to one kind ('flow' | 'subflow');
   * anything else (default) returns both, because live authoring creates
   * subflows and hiding them makes deployed work look missing.
   */
  list: ({ search = '', activeOnly = false, type = 'all' } = {}) => {
    const clauses = [];
    if (type === 'flow' || type === 'subflow') clauses.push(`type=${type}`);
    if (activeOnly) clauses.push('active=true');
    if (search) clauses.push(`nameLIKE${search}`);
    return table.query('sys_hub_flow', {
      query: clauses.join('^'),
      fields: 'sys_id,name,description,active,type,status,sys_scope,sys_updated_on,sys_created_by',
      orderBy: 'name',
      limit: 100,
    });
  },

  /** Exact-name lookup — used to read back what an install actually shipped. */
  findByName: (name, type) => {
    const clauses = [`name=${name}`];
    if (type) clauses.push(`type=${type}`);
    return table.query('sys_hub_flow', {
      query: clauses.join('^'),
      fields: 'sys_id,name,description,active,type,status,sys_scope,sys_updated_on',
      limit: 10,
    });
  },

  /**
   * Reads a flow top-to-bottom. Returns `sourceTables` so callers can see which
   * table family answered, and `notes` for anything the caller would otherwise
   * have to infer from an empty array.
   */
  async detail(sysId) {
    const flow = await table.get('sys_hub_flow', sysId);
    if (!flow) throw Object.assign(new Error(`No flow found with sys_id ${sysId}`), { status: 404 });

    let result = await readFamily('v2', sysId);
    const notes = [];

    const v2Available = result.triggers.available || result.actions.available || result.logic.available;
    if (!v2Available) {
      // Only legitimate reason to read the legacy tables: v2 isn't on this instance.
      result = await readFamily('legacy', sysId);
      notes.push('This instance has no *_v2 flow tables; read the legacy tables instead.');
    }

    const fam = PART_FAMILIES[result.familyName];
    for (const [part, res] of Object.entries({ triggers: result.triggers, actions: result.actions, logic: result.logic })) {
      if (!res.available) notes.push(`Table ${fam[part].table} does not exist on this instance; ${part} could not be read.`);
    }
    if (result.triggers.available && result.triggers.rows.length === 0) {
      notes.push(
        raw(flow, 'type') === 'subflow'
          ? 'Subflows have no trigger by design — they are invoked by other flows.'
          : 'No trigger instance found for this flow.'
      );
    }

    // Attach decoded trigger configuration (table / condition / strategy).
    const triggers = result.triggers.rows.map((t) => {
      const config = decodeTriggerInputs(raw(t, 'trigger_inputs'));
      const { trigger_inputs: _drop, ...rest } = t; // the raw blob is noise for clients
      return { ...rest, config };
    });

    return {
      flow,
      triggers,
      actions: result.actions.rows,
      logic: result.logic.rows,
      sourceTables: {
        family: result.familyName,
        triggers: fam.triggers.table,
        actions: fam.actions.table,
        logic: fam.logic.table,
      },
      notes,
    };
  },

  executions: (flowSysId) =>
    table.query('sys_flow_context', {
      query: flowSysId ? `flow=${flowSysId}` : '',
      fields: 'sys_id,name,state,flow,sys_created_on,sys_updated_on',
      orderByDesc: 'sys_created_on',
      limit: 25,
    }),

  setActive: (sysId, active) =>
    table.update('sys_hub_flow', sysId, { active: active ? 'true' : 'false' }),
};

const BLUEPRINT_SYSTEM = `You are a senior ServiceNow Flow Designer architect. Given a plain-language automation request, design a precise flow blueprint.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{
  "name": "short flow name",
  "description": "one paragraph",
  "trigger": {
    "type": "record_created" | "record_updated" | "record_created_or_updated" | "scheduled" | "service_catalog",
    "table": "servicenow_table_name or null",
    "condition_encoded_query": "ServiceNow encoded query or empty string",
    "condition_plain": "human readable condition",
    "schedule": "cron-like description or null"
  },
  "inputs": [{ "name": "...", "type": "...", "purpose": "..." }],
  "steps": [
    {
      "order": 1,
      "kind": "action" | "if" | "else" | "foreach" | "end",
      "summary": "what this step does",
      "flow_designer_action": "the exact Flow Designer action to pick (e.g. 'Look Up Records', 'Update Record', 'Send Email', 'Ask For Approval')",
      "config": { "key": "value pairs the builder should enter" }
    }
  ],
  "reference_fields_used": [{ "field": "...", "table": "...", "referenced_table": "..." }],
  "test_plan": ["step by step verification"],
  "notes": "risks, ACLs, or release caveats"
}
Use real ServiceNow table names and real encoded query syntax. Be specific enough that a junior admin can build it without guessing.`;

export async function designFlowBlueprint(description) {
  const raw = await chatOnce({
    system: BLUEPRINT_SYSTEM,
    user: description,
    maxTokens: 3000,
  });
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return { blueprint: JSON.parse(cleaned) };
  } catch {
    return { blueprint: null, raw: cleaned, error: 'Model did not return valid JSON. Raw output included.' };
  }
}

const RULE_SYSTEM = `You convert a ServiceNow flow blueprint into an equivalent server-side Business Rule when the trigger is record-based. Respond with ONLY JSON:
{
  "name": "...",
  "when": "after" | "before" | "async",
  "action_insert": true|false,
  "action_update": true|false,
  "condition_encoded_query": "...",
  "script": "ES5 GlideRecord script using (function executeRule(current, previous) { ... })(current, previous); Use gs.info for logging. No modern JS syntax."
}
The script must faithfully implement the blueprint steps that are implementable server-side; note skipped steps in comments.`;

export async function blueprintToBusinessRule(blueprint) {
  const t = blueprint?.trigger || {};
  if (!t.table || !String(t.type || '').startsWith('record')) {
    return { error: 'Classic fallback only applies to record-triggered blueprints (created/updated on a table).' };
  }
  const raw = await chatOnce({
    system: RULE_SYSTEM,
    user: JSON.stringify(blueprint),
    maxTokens: 3000,
  });
  const cleaned = raw.replace(/```json|```/g, '').trim();
  let spec;
  try { spec = JSON.parse(cleaned); } catch {
    return { error: 'Model did not return valid JSON for the business rule.', raw: cleaned };
  }
  const record = await table.create('sys_script', {
    name: spec.name || `NowForge: ${blueprint.name}`,
    collection: t.table,
    when: spec.when || 'after',
    action_insert: spec.action_insert ? 'true' : 'false',
    action_update: spec.action_update ? 'true' : 'false',
    filter_condition: spec.condition_encoded_query || t.condition_encoded_query || '',
    script: spec.script || '// empty',
    description: `Generated by NowForge from flow blueprint "${blueprint.name}". Review before activating.`,
    active: 'false', // always created inactive — review first
  });
  return { rule: record, spec };
}
