import { table } from './client.js';
import { chatOnce } from '../agent/providers/index.js';

/**
 * Flow Designer module.
 *
 * READ side is fully supported: flows and their parts are records —
 *   sys_hub_flow             flow / subflow headers
 *   sys_hub_trigger_instance triggers
 *   sys_hub_action_instance  action steps
 *   sys_hub_flow_logic       IF / ELSE / FOR EACH blocks
 *   sys_flow_context         executions
 *
 * WRITE side (authoring a brand-new flow) has NO supported public API.
 * Flow definitions are serialized snapshots compiled by the platform, and raw
 * inserts into sys_hub_* produce broken artifacts across releases.
 *
 * Strategy interface below keeps authoring pluggable:
 *   1. "blueprint"       (shipped)  — LLM designs a precise flow spec you build
 *                                     in Flow Designer in minutes, or feed to
 *                                     ServiceNow's own flow generation.
 *   2. "classicFallback" (shipped)  — for record-triggered automation, generate
 *                                     an equivalent Business Rule (sys_script),
 *                                     created INACTIVE for review.
 *   3. "updateSetXml"    (phase 2)  — template known-good flows as update set
 *                                     XML and import via /sys_remote_update_set.
 *   4. "fluentSdk"       (phase 2)  — evaluate ServiceNow SDK / Fluent for
 *                                     code-defined artifacts + deploy.
 */

export const flows = {
  list: ({ search = '', activeOnly = false } = {}) => {
    let q = 'type=flow';
    if (activeOnly) q += '^active=true';
    if (search) q += `^nameLIKE${search}`;
    return table.query('sys_hub_flow', {
      query: q,
      fields: 'sys_id,name,description,active,status,sys_scope,sys_updated_on,sys_created_by',
      orderBy: 'name',
      limit: 100,
    });
  },

  async detail(sysId) {
    const flow = await table.get('sys_hub_flow', sysId);
    const [triggers, actions, logic] = await Promise.all([
      table.query('sys_hub_trigger_instance', { query: `flow=${sysId}`, limit: 20 }).catch(() => []),
      table.query('sys_hub_action_instance', {
        query: `flow=${sysId}`,
        fields: 'sys_id,order,active,action_type,comment,sys_updated_on',
        orderBy: 'order',
        limit: 100,
      }).catch(() => []),
      table.query('sys_hub_flow_logic', {
        query: `flow=${sysId}`,
        fields: 'sys_id,order,active,logic_definition,sys_updated_on',
        orderBy: 'order',
        limit: 100,
      }).catch(() => []),
    ]);
    return { flow, triggers, actions, logic };
  },

  executions: (flowSysId) =>
    table.query('sys_flow_context', {
      query: flowSysId ? `flow=${flowSysId}` : '',
      fields: 'sys_id,name,state,flow,sys_created_on,sys_updated_on',
      orderByDesc: 'sys_created_on',
      limit: 25,
    }).catch(() => []),

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
