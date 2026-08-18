import { getDb } from './db.js';
import { getSettings } from '../config/store.js';

/**
 * A-3/A-4 — the instance knowledge ledger.
 *
 * Everything this project learned the hard way lives in docs/fluent-research.md
 * §16, where a human can read it and the agent cannot. Each of those entries
 * cost a debugging cycle, and the agent rediscovers them from scratch in every
 * new session — or, more often, does not, and ships the confidently wrong
 * result the trap produces.
 *
 * So the ledger is seeded from those entries and injected into BOTH prompts
 * that matter: the agent's system prompt and the codegen context.
 *
 * Scope matters. A trap that is a property of the SDK or the platform holds
 * everywhere and is stored against `*`. A fact MEASURED on one instance
 * ("problem_id exists on no table here") is stored against that instance and
 * must never leak to another — a second PDI may well have the field, and a
 * confidently wrong "it does not exist" is exactly the kind of damage this
 * ledger is supposed to prevent.
 */

const UNIVERSAL = '*';
const now = () => new Date().toISOString();

export const FACT_KINDS = ['trap', 'mapping', 'decision', 'preference'];

export function currentInstance() {
  return (getSettings().connection.instanceUrl || '').replace(/\/+$/, '') || '(unbound)';
}

/**
 * Upsert. Confidence only ever moves UP for an unchanged value: a fact
 * re-observed is a fact confirmed. A changed value resets provenance, because
 * the old evidence no longer supports the new claim.
 */
export function recordFact({ instance, kind, key, value, provenance, confidence = 0.6 }) {
  if (!FACT_KINDS.includes(kind)) throw new Error(`Unknown fact kind "${kind}". Use one of: ${FACT_KINDS.join(', ')}`);
  if (!key || !value) throw new Error('A fact needs both a key and a value.');
  const db = getDb();
  const inst = instance || currentInstance();
  const existing = db.prepare('SELECT * FROM facts WHERE instance = ? AND kind = ? AND key = ?').get(inst, kind, key);

  if (existing && existing.value === String(value)) {
    const bumped = Math.min(0.99, Math.max(existing.confidence, confidence) + 0.05);
    db.prepare('UPDATE facts SET confidence = ?, ts = ? WHERE id = ?').run(bumped, now(), existing.id);
    return { ...existing, confidence: bumped, reconfirmed: true };
  }

  db.prepare(
    `INSERT INTO facts (instance, kind, key, value, provenance, confidence, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance, kind, key) DO UPDATE SET
       value = excluded.value, provenance = excluded.provenance,
       confidence = excluded.confidence, ts = excluded.ts`
  ).run(inst, kind, key, String(value), provenance || null, confidence, now());
  return db.prepare('SELECT * FROM facts WHERE instance = ? AND kind = ? AND key = ?').get(inst, kind, key);
}

/** Facts that apply here: this instance's own, plus the universal ones. */
export function listFacts({ instance, kind } = {}) {
  const inst = instance || currentInstance();
  const sql = kind
    ? 'SELECT * FROM facts WHERE (instance = ? OR instance = ?) AND kind = ? ORDER BY kind, key'
    : 'SELECT * FROM facts WHERE (instance = ? OR instance = ?) ORDER BY kind, key';
  const args = kind ? [inst, UNIVERSAL, kind] : [inst, UNIVERSAL];
  return getDb().prepare(sql).all(...args);
}

export function deleteFact(id) {
  return { deleted: getDb().prepare('DELETE FROM facts WHERE id = ?').run(id).changes > 0 };
}

/* ------------------------------------------------------------------ *
 * Seed — docs/fluent-research.md §16 and §19, verbatim in substance
 * ------------------------------------------------------------------ */

const SEED = [
  // --- Universal: properties of the SDK and the platform ---
  { scope: UNIVERSAL, kind: 'trap', key: 'priority-is-calculated',
    value: 'On task tables (incident, problem, change_request, sc_task) `priority` is CALCULATED from `impact` and `urgency`. Writing it directly is silently overwritten on insert: {"priority":"1"} lands as 4 - Low. To reach Critical set impact=1 and urgency=1 and do not set priority at all.',
    provenance: 'fluent-research §16 trap 5; re-measured in the §20 setup', confidence: 0.99 },

  { scope: UNIVERSAL, kind: 'trap', key: 'encoded-query-silent-drop',
    value: 'An encoded query naming a field that does not exist is silently DROPPED, not rejected. `^fooISNOTEMPTY` and `^fooISEMPTY` then both match the same record. Check every queried field against the live schema before trusting a locator — a condition on an unknown field certifies the absence of a bug rather than finding one.',
    provenance: 'fluent-research §16 trap 2 and §14 false green', confidence: 0.99 },

  { scope: UNIVERSAL, kind: 'trap', key: 'unknown-field-writes-accepted',
    value: 'Writes to a field that does not exist are silently ACCEPTED. The flow completes, activation reports 10/10, and the effect never happens. Read the effect back off the instance; never infer it from a green deploy.',
    provenance: 'fluent-research §16 trap 3', confidence: 0.99 },

  { scope: UNIVERSAL, kind: 'trap', key: 'sysparm-fields-drops-unknown',
    value: '`sysparm_fields` drops unknown names without complaint — request two fields, get one, no error. Compare returned keys against requested keys.',
    provenance: 'fluent-research §16 trap 4', confidence: 0.95 },

  { scope: UNIVERSAL, kind: 'trap', key: 'trigger-strategy-default-once',
    value: '`trigger_strategy` defaults to `once`, and `once` means once EVER for a record — a record that leaves the trigger condition and re-enters is never processed again. Set it explicitly on every updated/createdOrUpdated trigger. `unique_changes` is the per-transition form; `every` fires on every save while the condition holds and duplicates anything the flow creates.',
    provenance: 'fluent-research §16 trap 10, PROBE B2 in §17; enforced by guard A4', confidence: 0.99 },

  { scope: UNIVERSAL, kind: 'trap', key: 'keys-ts-is-project-global',
    value: '`keys.ts` is a FLAT PROJECT-WIDE map from a Now.ID key to one sys_id. A key is not "an element in this flow" — it is a live record owned by whichever flow declared it first. Reusing one collides instead of creating a new element, and the build aborts naming a sys_id you never wrote. Prefix every key with a per-flow slug; never copy one from an example.',
    provenance: 'fluent-research §16 trap 1, CLASS C in §12', confidence: 0.99 },

  { scope: UNIVERSAL, kind: 'trap', key: 'lookuprecord-miss-errors-flow',
    value: 'A `lookUpRecord` whose query matches nothing does NOT return empty — it ERRORS the whole flow at run time. Resolve every proper noun against the instance first; a miss is a loud failure, not a fallback, so a stale name left in a query is a flow that fails on every execution while the build stays green.',
    provenance: 'fluent-research §16 trap 6', confidence: 0.99 },

  { scope: UNIVERSAL, kind: 'trap', key: 'journal-fields-invisible-to-get',
    value: 'Journal fields (work_notes, comments) are invisible to a plain GET — the record reads empty even when it has notes. Read `sys_journal_field` by `element_id` + `element` instead.',
    provenance: 'fluent-research §16 trap 7', confidence: 0.99 },

  { scope: UNIVERSAL, kind: 'trap', key: 'install-ships-whole-application',
    value: '`now-sdk install` deploys the WHOLE application, not the one artifact requested: every artifact\'s `sys_updated_on` moves. Measure idempotency as "same sys_id, no new rows", never as unchanged timestamps.',
    provenance: 'fluent-research §16 trap 8', confidence: 0.99 },

  { scope: UNIVERSAL, kind: 'trap', key: 'trigger-instance-v2-blob',
    value: '`sys_hub_trigger_instance_v2` has no `condition` or `table_name` columns — querying them returns a row of nulls. The trigger configuration is a gzip+base64 blob in `trigger_inputs`; decode it. The real columns are flow, trigger_type, trigger_definition, trigger_inputs.',
    provenance: 'fluent-research §16 trap 11', confidence: 0.95 },

  { scope: UNIVERSAL, kind: 'trap', key: 'schedules-stored-in-utc',
    value: 'Scheduled flow times are stored in UTC. A schedule that should read 07:00 IST is stored as 01:30 UTC. Convert before asserting a cadence, and state the timezone when reporting one.',
    provenance: 'fluent-research §8 capability matrix', confidence: 0.9 },

  { scope: UNIVERSAL, kind: 'trap', key: 'ollama-ignores-seed',
    value: 'Ollama accepts a `seed` and ignores it on *-cloud models, on both /v1 and the native /api/chat: three identically-seeded calls return three different completions. `temperature: 0` is only approximately stable — repeated calls share a prefix then diverge. Never assume a generation is reproducible.',
    provenance: 'fluent-research §19, measured 2026-08-18', confidence: 0.99 },

  { scope: UNIVERSAL, kind: 'decision', key: 'verify-locator-carries-proof',
    value: 'When an expected value is not knowable in advance (a generated PRB/INC number, a sys_id), do not guess it — move the proof into the LOCATOR. Locate with a query that can only match when the effect happened, then assert a field whose value you do know. A locator matching nothing is reported as a failed assertion. This only works when every field in the locator EXISTS.',
    provenance: 'fluent-research §14', confidence: 0.9 },

  // --- Measured on THIS instance, and scoped to it ---
  { scope: 'instance', kind: 'mapping', key: 'incident.problem-link-absent',
    value: 'This instance has no `problem_id`, `rfc` or `caused_by` on incident, and NO field on incident/task references `problem` at all. A request to "link the problem back to the incident" cannot be satisfied here. The available task-to-task links are `incident.parent` and `problem.first_reported_by_task`.',
    provenance: 'fluent-research §15 audit and §20 re-measurement', confidence: 0.99 },

  { scope: 'instance', kind: 'mapping', key: 'hardware-group-has-no-manager',
    value: 'The Hardware group (sys_user_group 8a5055c9c61122780043563ef53438e3) has an EMPTY manager field. Any effect of the form "assign to the group\'s manager" produces nothing observable here. Never invent a placeholder name for it.',
    provenance: 'fluent-research §14 and §20, read off the instance', confidence: 0.95 },
];

/**
 * Idempotent seed, run on boot. Uses the same upsert as any other write, so
 * re-seeding a live database re-confirms rather than duplicating, and a fact
 * the user has since corrected by hand is overwritten only if its key matches.
 */
export function seedLedger({ instance } = {}) {
  const inst = instance || currentInstance();
  let written = 0;
  for (const f of SEED) {
    recordFact({
      instance: f.scope === 'instance' ? inst : UNIVERSAL,
      kind: f.kind,
      key: f.key,
      value: f.value,
      provenance: f.provenance,
      confidence: f.confidence,
    });
    written += 1;
  }
  return { seeded: written, instance: inst };
}

/* ------------------------------------------------------------------ *
 * Read path — the block injected into both prompts
 * ------------------------------------------------------------------ */

const KIND_HEADING = {
  trap: 'TRAPS — behaviours that produce a confidently WRONG result rather than an error',
  mapping: 'THIS INSTANCE — measured facts about what exists here',
  decision: 'ESTABLISHED DECISIONS — how this project has settled these questions',
  preference: 'USER PREFERENCES',
};

/**
 * The fact block. `kinds` lets the codegen path take the subset that is
 * actionable while writing a flow, without the conversational preferences.
 */
export function factBlock({ instance, kinds = FACT_KINDS, limit = 40 } = {}) {
  const facts = listFacts({ instance }).filter((f) => kinds.includes(f.kind)).slice(0, limit);
  if (!facts.length) return '';

  const byKind = new Map();
  for (const f of facts) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }

  const parts = [
    'INSTANCE KNOWLEDGE LEDGER — facts this project has MEASURED, not guessed.',
    'Each one cost a real debugging cycle. Treat them as established: they override your priors about how ServiceNow "usually" behaves, and none of them will produce an error to warn you when violated.',
  ];
  for (const kind of FACT_KINDS) {
    const list = byKind.get(kind);
    if (!list?.length) continue;
    parts.push(
      `\n${KIND_HEADING[kind]}:\n` +
        list.map((f) => `  - [${f.key}] ${f.value}`).join('\n')
    );
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------------ *
 * Write paths
 * ------------------------------------------------------------------ */

/**
 * A verification that FAILED is the single most valuable thing this agent
 * learns about an instance, and it used to die with the session. Records the
 * failed assertions of a `verify_flow_live` result as instance facts.
 */
export function recordVerificationFailure(toolName, result) {
  if (toolName !== 'verify_flow_live' || !result || typeof result !== 'object') return null;
  const failed = (result.assertions || []).filter((a) => a && a.pass === false);
  if (!failed.length) return null;

  const recorded = [];
  for (const a of failed) {
    const key = `verify-failed:${a.table}.${a.field}`;
    recorded.push(
      recordFact({
        kind: 'mapping',
        key,
        value:
          `Asserting ${a.table}.${a.field} did not hold on this instance` +
          (a.want !== undefined ? ` (expected "${a.want}", read "${a.got ?? ''}")` : '') +
          (a.note ? ` — the promise was: ${a.note}` : '') +
          '. Check whether the field exists and can hold this value here before promising it again.',
        provenance: `verify_flow_live on "${result.flow || result.name || 'a flow'}"`,
        confidence: 0.7,
      })
    );
  }
  return recorded;
}

/**
 * Schema discovery records calculated/read-only fields, which are the ones that
 * accept a write and then quietly ignore it (trap #5's whole family).
 */
export function recordCalculatedFields(tableName, schema) {
  if (!schema?.fields?.length) return [];
  const computed = schema.fields.filter((f) => f.calculated || f.readOnly || f.read_only);
  if (!computed.length) return [];
  return [
    recordFact({
      kind: 'mapping',
      key: `calculated-fields:${tableName}`,
      value:
        `On ${tableName} these fields are calculated or read-only and cannot be set directly — ` +
        `a write is accepted and then discarded: ${computed.map((f) => f.name).join(', ')}. ` +
        `Drive the inputs they are computed from instead.`,
      provenance: `get_table_schema on ${tableName}`,
      confidence: 0.8,
    }),
  ];
}

/** The chat affordance: "remember: <something>" becomes a durable preference. */
export function rememberFromChat(text) {
  const m = String(text || '').match(/^\s*remember\s*[:\-—]\s*(.+)$/is);
  if (!m) return null;
  const value = m[1].trim();
  if (!value) return null;
  // Keyed on the leading words so a restated preference updates rather than
  // accumulating near-duplicates the model then has to reconcile.
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-') || 'note';
  return recordFact({ kind: 'preference', key, value, provenance: 'the user asked to remember this', confidence: 0.9 });
}
