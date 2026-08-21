/**
 * WI-8 — a completion that both asks the user something and calls mutating
 * tools. In the transcript the harness executed the calls, so the user was
 * asked to decide something already decided for them.
 *
 * The mirror of the A6 stall guard: A6 catches asking and doing NOTHING, this
 * catches asking and doing everything anyway.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectQuestionWithMutation } from '../src/agent/orchestrator.js';

const MUTATORS = new Set(['create_record', 'update_record', 'create_incident']);
const isMutating = (n) => MUTATORS.has(n);
const calls = (...names) => names.map((name, i) => ({ id: `c${i}`, name }));

test('a question plus a mutation holds the mutation', () => {
  const r = detectQuestionWithMutation({
    assistantText: 'I can set this up. Would you like me to use the Network group or Service Desk?',
    toolCalls: calls('create_incident'), isMutating,
  });
  assert.ok(r, 'the mutation was not held');
  assert.deepEqual(r.held, ['create_incident']);
  assert.match(r.asked, /Would you like me to/i);
});

test('every phrasing that means "I am asking you" is caught', () => {
  for (const text of [
    'Shall I create it now?',
    'Do you want me to proceed with the Network group?',
    'Should I use the existing category?',
    'Which one of these did you mean?',
    'Please confirm the assignment group before I continue.',
    'Let me know which group to use.',
  ]) {
    assert.ok(detectQuestionWithMutation({ assistantText: text, toolCalls: calls('create_record'), isMutating }), `missed: ${text}`);
  }
});

test('a question with only READS proceeds — gathering context while asking is right', () => {
  assert.equal(detectQuestionWithMutation({
    assistantText: 'Which group did you mean?',
    toolCalls: calls('query_records', 'lookup_reference'), isMutating,
  }), null);
});

test('a mutation with no question proceeds', () => {
  assert.equal(detectQuestionWithMutation({
    assistantText: 'Creating the incident now.',
    toolCalls: calls('create_incident'), isMutating,
  }), null);
});

test('only the mutating calls are held, and they are named', () => {
  const r = detectQuestionWithMutation({
    assistantText: 'Shall I proceed?',
    toolCalls: calls('query_records', 'create_record', 'update_record'), isMutating,
  });
  assert.deepEqual(r.held, ['create_record', 'update_record']);
});

test('the flag turns it off completely', () => {
  assert.equal(detectQuestionWithMutation({
    assistantText: 'Shall I create it?', toolCalls: calls('create_record'), isMutating, enabled: false,
  }), null);
});

test('empty or missing text is not a question', () => {
  for (const t of ['', '   ', null, undefined]) {
    assert.equal(detectQuestionWithMutation({ assistantText: t, toolCalls: calls('create_record'), isMutating }), null);
  }
});

test('prose that merely contains "confirm" as a noun is not treated as a question', () => {
  // "a confirmation email" must not hold a write. The pattern requires the
  // verb form aimed at the user.
  assert.equal(detectQuestionWithMutation({
    assistantText: 'The flow sends a confirmation email to the requester.',
    toolCalls: calls('create_record'), isMutating,
  }), null);
});
