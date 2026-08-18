/**
 * Regression proof for Track C — catalog UI policies, and the guard that
 * stops the agent narrating a plan instead of doing the work. Entirely
 * offline: no instance, no SDK, no LLM.
 *
 *   node --test server/test/
 *
 * The cases that matter are the ones where a record saves cleanly and then
 * does nothing on the form. There is no server-side way to notice that after
 * the fact — a UI policy is evaluated in the browser — so every one of these
 * has to be caught before the write.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVariableConditions,
  buildVariableConditions,
  validatePolicyInput,
  normalizeOperator,
  renderPolicySource,
  policySlug,
  IO_PREFIX,
  CONDITION_OPERATORS,
  ACTION_STATES,
  actionState,
} from '../src/servicenow/catalogPolicy.js';
import { detectStalledTurn } from '../src/agent/orchestrator.js';

/* ------------------------------------------------------------------ *
 * Fixtures — the shapes itemVariables() produces.
 * ------------------------------------------------------------------ */

const CHECKBOX = {
  sys_id: '2217fd5183bacf10b939cc65eeaad317',
  name: 'needs_approval', question_text: 'Needs approval?', type: 7,
  order: 100, mandatory: false,
  choices: [{ value: 'true', text: 'Checked / Yes' }, { value: 'false', text: 'Unchecked / No' }],
  synthesizedChoices: true,
};
const TEXT = {
  sys_id: '3617b5d583bacf10b939cc65eeaad3f5',
  name: 'justification', question_text: 'Justification', type: 2,
  order: 200, mandatory: false, choices: null,
};
const SELECT = {
  sys_id: '397db91983facf10b939cc65eeaad389',
  name: 'duration', question_text: 'Access duration', type: 5,
  order: 100, mandatory: true,
  choices: [
    { value: 'temporary', text: 'Temporary (90 days)' },
    { value: 'permanent', text: 'Permanent' },
  ],
};
const MANDATORY_TEXT = { ...TEXT, sys_id: 'aaaa1111bbbb2222cccc3333dddd4444', name: 'reason', question_text: 'Reason', mandatory: true };

const ITEM = '5a17b5d583bacf10b939cc65eeaad37b';
const variablesFor = async () => [CHECKBOX, TEXT, SELECT, MANDATORY_TEXT];

const draft = (over = {}) => ({
  catalog_item: ITEM,
  short_description: 'Hide justification unless approval is needed',
  conditions: [{ variable: CHECKBOX.sys_id, operator: '=', value: 'false' }],
  actions: [{ variable: TEXT.sys_id, visible: 'false', mandatory: 'ignore', disabled: 'ignore' }],
  ...over,
});

/* ================================================================== *
 * Conditions — the IO: grammar
 * ================================================================== */

test('a condition addresses a variable by sys_id with an IO: prefix, not by field name', () => {
  const built = buildVariableConditions([{ variable: CHECKBOX.sys_id, operator: '=', value: 'true' }]);
  assert.equal(built, `${IO_PREFIX}${CHECKBOX.sys_id}=true^EQ`);
  const [clause] = parseVariableConditions(built);
  assert.equal(clause.kind, 'condition');
  assert.equal(clause.variableId, CHECKBOX.sys_id);
  assert.equal(clause.op, '=');
  assert.equal(clause.value, 'true');
});

test('operators are matched longest-first, so NOT IN is not read as IN', () => {
  const q = `${IO_PREFIX}${SELECT.sys_id}NOT INtemporary,permanent^EQ`;
  const [clause] = parseVariableConditions(q);
  assert.equal(clause.op, 'NOT IN');
  assert.equal(clause.value, 'temporary,permanent');

  const neq = parseVariableConditions(`${IO_PREFIX}${SELECT.sys_id}!=permanent^EQ`)[0];
  assert.equal(neq.op, '!=');
  assert.equal(neq.value, 'permanent');
});

test('joins survive a round trip, and the ^EQ marker is not a clause', () => {
  const built = buildVariableConditions([
    { variable: CHECKBOX.sys_id, operator: '=', value: 'true' },
    { variable: SELECT.sys_id, operator: '=', value: 'permanent', join: 'OR' },
  ]);
  assert.equal(built, `${IO_PREFIX}${CHECKBOX.sys_id}=true^OR${IO_PREFIX}${SELECT.sys_id}=permanent^EQ`);
  const parsed = parseVariableConditions(built);
  assert.deepEqual(parsed.map((c) => c.kind), ['condition', 'condition', 'marker']);
  assert.equal(parsed[1].join, 'OR');
});

test('an operator that takes no value contributes none', () => {
  assert.equal(
    buildVariableConditions([{ variable: TEXT.sys_id, operator: 'ISEMPTY', value: 'ignored' }]),
    `${IO_PREFIX}${TEXT.sys_id}ISEMPTY^EQ`,
  );
});

test('anything that is not an IO: clause is reported as unparsed rather than skipped', () => {
  const parsed = parseVariableConditions('priority=1^EQ');
  assert.equal(parsed[0].kind, 'unparsed');
});

test('operator labels are accepted, because the mapping is exact and closed', () => {
  // Measured on gpt-oss:120b-cloud: it emitted "is", the label this module
  // publishes in its own metadata.
  assert.equal(normalizeOperator('is'), '=');
  assert.equal(normalizeOperator('IS NOT'), '!=');
  assert.equal(normalizeOperator('contains'), 'LIKE');
  assert.equal(normalizeOperator('is one of'), 'IN');
  assert.equal(normalizeOperator('='), '=');
  // Anything genuinely unknown passes through so validation names it.
  assert.equal(normalizeOperator('approximately'), 'approximately');
});

/* ================================================================== *
 * Validation — every case is a policy that would save and do nothing
 * ================================================================== */

test('a well-formed policy validates clean', async () => {
  const out = await validatePolicyInput(draft(), { variablesFor });
  assert.deepEqual(out.errors, []);
  assert.equal(out.ok, true);
});

test('a condition naming a variable that is not on the item is refused', async () => {
  const out = await validatePolicyInput(
    draft({ conditions: [{ variable: 'ffffffffffffffffffffffffffffffff', operator: '=', value: 'true' }] }),
    { variablesFor },
  );
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /not on this item/);
  assert.match(out.errors[0], /can never be satisfied/);
});

test('a choice value the variable cannot hold is refused, and the real ones are listed', async () => {
  // The commonest real mistake: comparing against the LABEL.
  const out = await validatePolicyInput(
    draft({ conditions: [{ variable: SELECT.sys_id, operator: '=', value: 'Permanent' }] }),
    { variablesFor },
  );
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /is not one of its choices/);
  assert.match(out.errors[0], /permanent \(Permanent\)/);
  assert.match(out.errors[0], /temporary \(Temporary \(90 days\)\)/);

  const good = await validatePolicyInput(
    draft({ conditions: [{ variable: SELECT.sys_id, operator: '=', value: 'permanent' }] }),
    { variablesFor },
  );
  assert.equal(good.ok, true);
});

test('every member of an IN list is checked, not just the first', async () => {
  const out = await validatePolicyInput(
    draft({ conditions: [{ variable: SELECT.sys_id, operator: 'IN', value: 'permanent,forever' }] }),
    { variablesFor },
  );
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /"forever"/);
});

test('a checkbox compared with anything but true/false is refused', async () => {
  const out = await validatePolicyInput(
    draft({ conditions: [{ variable: CHECKBOX.sys_id, operator: '=', value: 'yes' }] }),
    { variablesFor },
  );
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /only ever "true" or "false"/);
});

test('an action left entirely on "ignore" is refused — it saves and does nothing', async () => {
  const out = await validatePolicyInput(
    draft({ actions: [{ variable: TEXT.sys_id }] }),
    { variablesFor },
  );
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /leaves visible, mandatory and read-only all on "ignore"/);
});

test('a policy with no condition is refused — it would apply unconditionally', async () => {
  const out = await validatePolicyInput(draft({ conditions: [] }), { variablesFor });
  assert.equal(out.ok, false);
  assert.match(out.errors.join(' '), /always true/);
});

test('a policy with no actions is refused', async () => {
  const out = await validatePolicyInput(draft({ actions: [] }), { variablesFor });
  assert.equal(out.ok, false);
  assert.match(out.errors.join(' '), /changes nothing/);
});

test('a state is ignore/true/false, and a boolean means what it says', async () => {
  assert.deepEqual(ACTION_STATES.map((s) => s.value), ['ignore', 'true', 'false']);
  // The platform stores strings, but `visible: false` from a JS caller means
  // "hide it", which is what "false" means here — so it is accepted, not
  // refused on a technicality. This used to happen by accident via String().
  assert.equal(actionState(false), 'false');
  assert.equal(actionState(true), 'true');
  assert.equal(actionState(undefined), 'ignore');
  assert.equal(actionState(''), 'ignore');
  const ok = await validatePolicyInput(
    draft({ actions: [{ variable: TEXT.sys_id, visible: false }] }),
    { variablesFor },
  );
  assert.equal(ok.ok, true);

  // Something that is genuinely not a state still fails, and says what is.
  const bad = await validatePolicyInput(
    draft({ actions: [{ variable: TEXT.sys_id, visible: 'hidden' }] }),
    { variablesFor },
  );
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /"ignore", "true" or "false"/);
});

test('hiding a MANDATORY variable warns rather than blocks — it is legal, and the fix is in the same action', async () => {
  const out = await validatePolicyInput(
    draft({ actions: [{ variable: MANDATORY_TEXT.sys_id, visible: 'false', mandatory: 'ignore', disabled: 'ignore' }] }),
    { variablesFor },
  );
  assert.equal(out.ok, true, 'this is allowed');
  assert.match(out.warnings.join(' '), /hidden mandatory variable can block submission/);

  // Clearing mandatory in the same action is the correct form, and is silent.
  const fixed = await validatePolicyInput(
    draft({ actions: [{ variable: MANDATORY_TEXT.sys_id, visible: 'false', mandatory: 'false', disabled: 'ignore' }] }),
    { variablesFor },
  );
  assert.deepEqual(fixed.warnings, []);
});

test('an unknown operator is named along with the ones that exist', async () => {
  const out = await validatePolicyInput(
    draft({ conditions: [{ variable: CHECKBOX.sys_id, operator: 'roughly', value: 'true' }] }),
    { variablesFor },
  );
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /"roughly"/);
  for (const o of CONDITION_OPERATORS) assert.match(out.errors[0], new RegExp(o.label.replace(/[()]/g, '\\$&')));
});

test('a missing item or name is refused before any variable is read', async () => {
  const out = await validatePolicyInput({ conditions: [], actions: [] }, { variablesFor });
  assert.match(out.errors.join(' '), /catalog_item is required/);
  assert.match(out.errors.join(' '), /short_description is required/);
});

/* ================================================================== *
 * Source rendering — deterministic, not generated
 * ================================================================== */

const rendered = (over = {}) => renderPolicySource({
  catalog_item: ITEM,
  short_description: 'Hide justification unless approval is needed',
  catalog_conditions: `${IO_PREFIX}${CHECKBOX.sys_id}=false^EQ`,
  order: 100,
  actions: [{ variableSysId: TEXT.sys_id, variableName: 'justification', visible: 'false', mandatory: 'ignore', disabled: 'ignore', order: 100 }],
  ...over,
}, policySlug(ITEM, 'Hide justification unless approval is needed'));

test('the rendered source carries the identity, the condition and the action', () => {
  const src = rendered();
  assert.match(src, /import \{ CatalogUiPolicy \} from '@servicenow\/sdk\/core'/);
  assert.match(src, new RegExp(`catalogItem: "${ITEM}"`));
  assert.match(src, new RegExp(`catalogCondition: "IO:${CHECKBOX.sys_id}=false\\^EQ"`));
  assert.match(src, new RegExp(`variableName: "${TEXT.sys_id}"`));
  assert.match(src, /variable: "justification"/);
  assert.match(src, /visible: false/);
});

test('the SDK adds the IO: prefix itself, so variableName is the bare sys_id', () => {
  // Measured: passing "IO:<sys_id>" produced catalog_variable "IO:IO:<sys_id>".
  const src = rendered();
  assert.ok(!src.includes(`variableName: "IO:`), 'variableName must not be IO-prefixed');
});

test('states left on "ignore" are omitted rather than emitted as false', () => {
  const src = rendered();
  assert.match(src, /visible: false/);
  assert.ok(!/mandatory:/.test(src), '"ignore" means leave alone — emitting mandatory: false would be a different policy');
  assert.ok(!/readOnly:/.test(src));
});

test('mandatory and read-only render when they are actually set', () => {
  const src = rendered({
    actions: [{ variableSysId: TEXT.sys_id, variableName: 'justification', visible: 'ignore', mandatory: 'true', disabled: 'true', order: 100 }],
  });
  assert.match(src, /mandatory: true/);
  assert.match(src, /readOnly: true/);
  assert.ok(!/visible:/.test(src));
});

test('the source pins ui_type to all, and its $id is unique per item and name', () => {
  assert.match(rendered(), /runScriptsInUiType: 'all'/);
  const a = policySlug(ITEM, 'Hide justification');
  const b = policySlug(ITEM, 'Require justification');
  const c = policySlug('ffffffffffffffffffffffffffffffff', 'Hide justification');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  // The key is the slug with dashes swapped for underscores — no double prefix.
  assert.match(rendered(), new RegExp(`Now\\.ID\\["${policySlug(ITEM, 'Hide justification unless approval is needed').replace(/-/g, '_')}"\\]`));
});

test('a name that is all punctuation still yields a usable slug', () => {
  const slug = policySlug(ITEM, '!!! ???');
  assert.match(slug, /^cuip-[0-9a-f]{8}-policy$/);
});

/* ================================================================== *
 * A6 — the stalled turn
 * ================================================================== */

test('A6 fires on the shape that was actually measured', () => {
  const out = detectStalledTurn({
    assistantText: 'Here is the UI Policy you need:\n\n| Condition | ... |\n\nShall I create this UI Policy now? (It will take about a minute.)',
    userText: 'On the Corp VPN catalog item, make the justification field mandatory only when duration is Permanent.',
    mutatingCallCount: 0,
  });
  assert.ok(out);
  assert.equal(out.asked, 'Shall I');
});

test('A6 recognises the other phrasings of the same stall', () => {
  const user = 'make the justification field mandatory';
  for (const text of [
    'Please confirm and I will create it.',
    'Would you like me to proceed?',
    'Let me know if you want me to go ahead.',
    'Give me the go-ahead and I will apply it.',
    'Waiting for your approval before creating the policy.',
  ]) {
    assert.ok(detectStalledTurn({ assistantText: text, userText: user, mutatingCallCount: 0 }), `missed: ${text}`);
  }
});

test('A6 does NOT fire once the turn has actually changed something', () => {
  // The first version counted calls in the closing iteration, so a turn that
  // created the policy and then signed off politely was nudged into a
  // pointless extra read.
  assert.equal(detectStalledTurn({
    assistantText: 'Created the policy. Let me know if you want anything else.',
    userText: 'make it mandatory', mutatingCallCount: 1,
  }), null);
});

test('A6 does NOT fire on a genuine clarifying question', () => {
  assert.equal(detectStalledTurn({
    assistantText: 'I found two items matching "VPN" — did you mean Corp VPN or VPN Token Request?',
    userText: 'make the justification field mandatory', mutatingCallCount: 0,
  }), null);
});

test('A6 does NOT fire when the user only asked a question', () => {
  assert.equal(detectStalledTurn({
    assistantText: 'There are three policies on that item. Would you like me to list their actions?',
    userText: 'what UI policies exist on the VPN item?', mutatingCallCount: 0,
  }), null);
});

test('A6 does NOT fire on an ordinary completed answer', () => {
  assert.equal(detectStalledTurn({
    assistantText: 'Done — the policy is installed and its action reads back attached.',
    userText: 'make it mandatory', mutatingCallCount: 0,
  }), null);
  assert.equal(detectStalledTurn({ assistantText: '', userText: 'make it mandatory', mutatingCallCount: 0 }), null);
});
