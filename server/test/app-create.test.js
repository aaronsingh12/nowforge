/**
 * WI-5 — the application-creation capability boundary.
 *
 * The defect (E5): `create_record` on `sys_scope` produced a record with
 * `sys_class_name: "sys_scope"`, `scope: ""` and no version. Studio will not
 * list it and nothing can be developed inside it. One turn earlier the model
 * had correctly said applications cannot be created this way — then created the
 * husk anyway with invented field values. Guidance did not hold, so the boundary
 * is enforced in code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { assertCreatableTable, toolMap, TOOLS } from '../src/agent/tools.js';
import {
  validateScopeName, suggestScopeName, scopeSuffixFrom, studioSteps, MAX_SCOPE_LENGTH,
} from '../src/servicenow/app-create.js';

const PREFIX = 'x_2196302_';   // measured from glide.appcreator.company.code

/* ------------------------------------------------------------------ *
 * The guard
 * ------------------------------------------------------------------ */

test('E5 — create_record on sys_scope is refused, and explains why it is a husk', () => {
  assert.throws(() => assertCreatableTable('sys_scope'), (err) => {
    assert.match(err.message, /non-functional husk/);
    assert.match(err.message, /sys_class_name stays "sys_scope"/);
    assert.match(err.message, /scope` name is empty/);
    assert.match(err.message, /Studio will not list it/);
    assert.equal(err.status, 422);
    assert.equal(err.detail.reason, 'application-husk-guard');
    return true;
  });
});

test('sys_app is refused too — the husk is only one of the two wrong routes', () => {
  assert.throws(() => assertCreatableTable('sys_app'), /custom application/);
});

test('the refusal names the tool that DOES work, not just the manual route', () => {
  assert.throws(() => assertCreatableTable('sys_scope'), (err) => {
    assert.match(err.message, /create_application/, 'a refusal with no path forward just gets retried');
    assert.match(err.message, /Studio/);
    return true;
  });
});

test('every other table is unaffected', () => {
  for (const t of ['incident', 'sc_cat_item', 'sys_script', 'sys_update_set', '', null, undefined]) {
    assert.doesNotThrow(() => assertCreatableTable(t), `${t} was blocked`);
  }
});

test('the guard sits inside create_record, not merely beside it', async () => {
  // Enforced where the call actually goes through, so no prompt path can route
  // around it.
  await assert.rejects(
    async () => toolMap.get('create_record').execute({ table: 'sys_scope', data: { name: 'AGAMYA_TEST' } }),
    /non-functional husk/,
  );
});

/* ------------------------------------------------------------------ *
 * Scope naming — the two rules that produce a broken app rather than an error
 * ------------------------------------------------------------------ */

test('a scope without the instance vendor prefix is rejected, and says why it matters', () => {
  const r = validateScopeName('x_acme_fleet', PREFIX);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /must start with this instance's vendor prefix "x_2196302_"/);
  assert.match(r.errors[0], /only a WARNING at install time/, 'the reason this is checked early must be stated');
});

test('a scope over 18 characters is rejected with the arithmetic shown', () => {
  const r = validateScopeName('x_2196302_way_too_long', PREFIX);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /is 22 characters; the platform maximum is 18/);
  assert.match(r.errors[0], /leaves 8 characters/);
  assert.equal(r.budget, 8);
});

test('exactly 18 characters is legal — the limit is inclusive', () => {
  const name = `${PREFIX}12345678`;
  assert.equal(name.length, MAX_SCOPE_LENGTH);
  assert.equal(validateScopeName(name, PREFIX).ok, true);
});

test('illegal characters are rejected', () => {
  for (const bad of ['x_2196302_Fleet', 'x_2196302_fl-et', 'x_2196302_fl et']) {
    const r = validateScopeName(bad, PREFIX);
    assert.equal(r.ok, false, `${bad} was accepted`);
  }
});

test('an empty scope name is rejected rather than defaulted', () => {
  assert.equal(validateScopeName('', PREFIX).ok, false);
  assert.equal(validateScopeName(null, PREFIX).ok, false);
});

/* ------------------------------------------------------------------ *
 * Derivation — a name a person would have chosen
 * ------------------------------------------------------------------ */

test('a name that fits is used whole', () => {
  assert.equal(suggestScopeName('Fleet', PREFIX), 'x_2196302_fleet');
});

test('a long name falls back to its first word before it truncates', () => {
  // "fleet_ma" is a name nobody would have picked.
  assert.equal(suggestScopeName('Fleet Management', PREFIX), 'x_2196302_fleet');
  assert.equal(suggestScopeName('AGAMYA_TEST', PREFIX), 'x_2196302_agamya');
});

test('a single long word drops vowels rather than being cut mid-syllable', () => {
  assert.equal(scopeSuffixFrom('Onboarding', 8), 'nbrdng');
});

test('initials are used when even the first word is too long', () => {
  assert.equal(scopeSuffixFrom('Extraordinarily Ambitious Programme', 4), 'eap');
});

test('every derived name is legal on this instance', () => {
  for (const n of ['Fleet Management', 'Incident Manager', 'A', 'Onboarding', 'Very Long Application Name Here', 'AGAMYA_TEST']) {
    const scope = suggestScopeName(n, PREFIX);
    const r = validateScopeName(scope, PREFIX);
    assert.equal(r.ok, true, `"${n}" derived "${scope}": ${r.errors.join('; ')}`);
  }
});

test('a name with nothing usable in it derives nothing rather than a bad guess', () => {
  assert.equal(scopeSuffixFrom('!!!', 8), '');
  assert.equal(suggestScopeName('!!!', PREFIX), '');
});

/* ------------------------------------------------------------------ *
 * The tools
 * ------------------------------------------------------------------ */

test('create_application is a mutation and check_scope_name is not', () => {
  assert.equal(toolMap.get('create_application').mutating, true);
  assert.equal(toolMap.get('check_scope_name').mutating, false);
});

test('the tool description says scaffolding is not installing', () => {
  // The overclaim this whole work item exists to stop: "created" when nothing
  // is on the instance yet.
  const d = toolMap.get('create_application').description;
  assert.match(d, /does NOT put anything on the instance/);
  assert.match(d, /do not tell the user the application exists on the instance/);
});

test('the manual route is always available, whatever the SDK is doing', () => {
  const steps = studioSteps(PREFIX);
  assert.ok(steps.length >= 3);
  assert.match(steps[0], /Studio/);
  assert.ok(steps.some((s) => s.includes('sys_app')), 'the husk-vs-app distinction must survive into the manual steps');
});

test('the registry still exposes every tool exactly once', () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'duplicate tool name');
});
