import { table } from './client.js';

/**
 * Reference/table handling core.
 *
 * ServiceNow tables inherit (incident extends task extends...), and dictionary
 * entries for inherited fields live on the parent table. To describe a table
 * "top to bottom" we walk sys_db_object.super_class, then merge sys_dictionary
 * rows across the whole chain, preferring the most-derived override.
 */

const hierarchyCache = new Map();
const schemaCache = new Map();
const displayFieldCache = new Map();

export function clearSchemaCaches() {
  hierarchyCache.clear();
  schemaCache.clear();
  displayFieldCache.clear();
}

export async function getTableHierarchy(t) {
  if (hierarchyCache.has(t)) return hierarchyCache.get(t);
  const chain = [t];
  let current = t;
  for (let i = 0; i < 10; i++) {
    const rows = await table.query('sys_db_object', {
      query: `name=${current}`,
      fields: 'name,super_class.name',   // dot-walk to get the parent's table name, not its label
      display: 'false',
      limit: 1,
    });
    const parent = rows[0]?.['super_class.name'];
    if (!parent || chain.includes(parent)) break;
    chain.push(parent);
    current = parent;
  }
  hierarchyCache.set(t, chain);
  return chain;
}

export async function getSchema(t) {
  if (schemaCache.has(t)) return schemaCache.get(t);
  const chain = await getTableHierarchy(t);
  const inClause = chain.join(',');

  const dictRows = await table.query('sys_dictionary', {
    query: `nameIN${inClause}^elementISNOTEMPTY^ORDERBYelement`,
    fields: 'element,column_label,internal_type,reference.name,max_length,mandatory,read_only,default_value,name',
    display: 'false',
    limit: 800,
  });

  // Most-derived definition wins (chain index 0 = the table itself).
  const byElement = new Map();
  for (const r of dictRows) {
    const rank = chain.indexOf(r.name);
    const existing = byElement.get(r.element);
    if (!existing || rank < existing._rank) {
      byElement.set(r.element, {
        name: r.element,
        label: r.column_label || r.element,
        type: r.internal_type,
        reference: r['reference.name'] || null,
        maxLength: r.max_length ? Number(r.max_length) : null,
        mandatory: r.mandatory === 'true',
        readOnly: r.read_only === 'true',
        defaultValue: r.default_value || null,
        definedOn: r.name,
        _rank: rank,
      });
    }
  }

  // Choice lists (state, priority, ...). Most-derived table's set wins per element.
  let choiceRows = [];
  try {
    choiceRows = await table.query('sys_choice', {
      query: `nameIN${inClause}^inactive=false^language=en^ORDERBYsequence`,
      fields: 'name,element,label,value,sequence',
      display: 'false',
      limit: 1000,
    });
  } catch { /* non-fatal */ }
  const choicesByElement = new Map();
  for (const c of choiceRows) {
    const rank = chain.indexOf(c.name);
    const cur = choicesByElement.get(c.element);
    if (!cur || rank < cur.rank) {
      if (!cur || cur.rank !== rank) choicesByElement.set(c.element, { rank, table: c.name, items: [] });
    }
    const slot = choicesByElement.get(c.element);
    if (slot.table === c.name) slot.items.push({ label: c.label, value: c.value });
  }

  const fields = [...byElement.values()]
    .map(({ _rank, ...f }) => ({ ...f, choices: choicesByElement.get(f.name)?.items ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const schema = { table: t, hierarchy: chain, fields };
  schemaCache.set(t, schema);
  return schema;
}

/** The field ServiceNow marks display=true for a table (walking the hierarchy), with sane fallbacks. */
export async function getDisplayField(t) {
  if (displayFieldCache.has(t)) return displayFieldCache.get(t);
  const chain = await getTableHierarchy(t);
  let element = null;
  try {
    const rows = await table.query('sys_dictionary', {
      query: `nameIN${chain.join(',')}^display=true^elementISNOTEMPTY`,
      fields: 'element,name',
      display: 'false',
      limit: 10,
    });
    for (const c of chain) {
      const hit = rows.find((r) => r.name === c);
      if (hit) { element = hit.element; break; }
    }
  } catch { /* fall through */ }
  if (!element) {
    const schema = await getSchema(t);
    for (const cand of ['number', 'name', 'title', 'short_description', 'u_name']) {
      if (schema.fields.some((f) => f.name === cand)) { element = cand; break; }
    }
  }
  element = element || 'sys_id';
  displayFieldCache.set(t, element);
  return element;
}

/** Typeahead lookup for any reference field: returns [{ sys_id, display }]. */
export async function referenceLookup(t, q = '', limit = 15) {
  const df = await getDisplayField(t);
  const query = q ? `${df}LIKE${q}^ORDERBY${df}` : `ORDERBY${df}`;
  const rows = await table.query(t, { query, fields: `sys_id,${df}`, display: 'false', limit });
  return rows.map((r) => ({ sys_id: r.sys_id, display: r[df] || r.sys_id }));
}

/** Table picker (for record producers, list collectors, flow triggers): searches sys_db_object by label or name. */
export async function tableLookup(q = '', limit = 15) {
  const query = q
    ? `labelLIKE${q}^ORnameLIKE${q}^ORDERBYlabel`
    : 'ORDERBYlabel';
  const rows = await table.query('sys_db_object', { query, fields: 'name,label', display: 'false', limit });
  return rows.map((r) => ({ name: r.name, label: r.label || r.name }));
}

/**
 * D-7 — the compact schema, and why the full one cannot be what the agent reads.
 *
 * MEASURED against dev442675: `incident` inherits from `task` and carries 91
 * fields. Serialised in full that is 29,152 characters — about 8,330 estimated
 * tokens. The agent's entire history budget at the time was 5,452, so ONE
 * schema read was 153% of everything the conversation was allowed to remember.
 *
 * The orchestrator's 8,000-character result cap hid this rather than fixing it,
 * and hid it in the worst possible way: fields are sorted alphabetically, so
 * the cut landed after `company` and the agent saw 26 of 91 fields. It never
 * saw `description`, `priority`, `state`, `urgency` or `assignment_group` —
 * and, because `u_` fields sort last, it could never observe that a custom
 * field was ABSENT. It was being asked to check for fields it was structurally
 * incapable of seeing.
 *
 * So the diet is not a size optimisation, it is a correctness fix. Compact mode
 * keeps what the agent reasons with — every field name, its type, what it
 * references, whether it is mandatory — and drops what it almost never needs at
 * read time: labels, max lengths, defaults, and the choice VALUES, which are
 * counted instead of listed. Choices come back on request, per field, because
 * a task mentions two or three of them and pays for ninety-eight.
 */
function compactField(f) {
  const bits = [`${f.name}: ${f.type || 'unknown'}`];
  if (f.reference) bits.push(`-> ${f.reference}`);
  if (f.mandatory) bits.push('*mandatory');
  if (f.readOnly) bits.push('ro');
  if (f.choices?.length) bits.push(`+${f.choices.length} choices`);
  return bits.join(' ');
}

/**
 * `expand` names the fields whose choice VALUES are wanted in full. Anything
 * not named is counted only. Unknown names are reported rather than ignored —
 * asking to expand a field that does not exist is exactly the signal the agent
 * needs, and silently returning nothing reads as "this field has no choices".
 */
export function toCompactSchema(schema, { expand = [] } = {}) {
  const wanted = new Set((expand || []).map((s) => String(s).trim()).filter(Boolean));
  const byName = new Map(schema.fields.map((f) => [f.name, f]));
  const expanded = {};
  const unknown = [];
  for (const name of wanted) {
    const f = byName.get(name);
    if (!f) { unknown.push(name); continue; }
    expanded[name] = f.choices?.length
      ? f.choices.map((c) => `${c.value} = ${c.label}`)
      : '(no choice list on this field)';
  }

  const out = {
    table: schema.table,
    hierarchy: schema.hierarchy,
    fieldCount: schema.fields.length,
    legend: 'name: type [-> referenced table] [*mandatory] [ro = read-only] [+N choices]',
    // Every field name, always. This list is what makes "that field does not
    // exist on this table" a conclusion the agent can actually reach.
    fields: schema.fields.map(compactField),
  };
  if (Object.keys(expanded).length) out.choices = expanded;
  if (unknown.length) {
    out.expandNotFound = unknown;
    out.expandNote =
      `These field names do not exist on ${schema.table}: ${unknown.join(', ')}. ` +
      'The fields list above is complete, so treat them as absent rather than assuming they were omitted.';
  }
  if (!Object.keys(expanded).length) {
    out.note = 'Choice values are counted, not listed. To see them, call get_table_schema again with expand: ["state","priority"] naming only the fields you need.';
  }
  return out;
}
