/**
 * WI-6 — the renderer cannot put a success glyph on a failure.
 *
 * The defect (E6), rendered literally in the transcript:
 *
 *     ✅ Update set "AGAMYA_Scope" … was not updated
 *
 * plus a duplicated "not captured / not captured" line, and approval cards
 * appearing after the result blocks so the gate looked post-hoc.
 *
 * `writeOutcome.js` is plain JS rather than JSX for exactly this reason — Node
 * cannot import a .jsx file, and the rule that a glyph and its words come from
 * one object is worth asserting rather than eyeballing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { writeOutcome, captureReason } from '../../client/src/components/writeOutcome.js';
import { APPROVAL_RESOLVED, executeTool } from '../src/agent/orchestrator.js';

const NOOP = {
  status: 'no-op', summary: 'no-op: the platform discarded this write — application unchanged',
  dropped: [{ field: 'application', requested: '73cd8416', actual: 'global' }], transformed: [], unverifiable: [],
};
const PARTIAL = {
  status: 'partial', summary: 'partial: the platform dropped 1 field (application)',
  dropped: [{ field: 'application', requested: '73cd8416', actual: 'global' }], transformed: [], unverifiable: [],
};
const TRANSFORMED = {
  status: 'transformed', summary: 'stored, but 1 field differs',
  dropped: [], transformed: [{ field: 'state', requested: 'On Hold', actual: '3', reason: 'a choice label was resolved to its stored value' }], unverifiable: [],
};
const APPLIED = { status: 'applied', summary: 'all 2 requested fields stored as sent', dropped: [], transformed: [], unverifiable: [] };

/* ------------------------------------------------------------------ *
 * The glyph
 * ------------------------------------------------------------------ */

test('E6 — a discarded write renders as a failure, never as a success', () => {
  const v = writeOutcome({ status: 'done', mutating: true, verification: NOOP });
  assert.equal(v.tone, 'bad');
  assert.equal(v.label, 'no-op');
  assert.equal(v.badgeClass, 'red');
  assert.equal(v.dotStyle.background, 'var(--red)');
  assert.match(v.detail, /The platform discarded this write/);
  assert.match(v.detail, /application unchanged/);
});

test('E6 — the tool "succeeded" at the transport layer and STILL renders as a failure', () => {
  // This is the exact shape that produced the ✅-on-a-negation: no exception,
  // status "done", and a write that did not happen.
  const v = writeOutcome({ status: 'done', mutating: true, verification: NOOP });
  assert.notEqual(v.tone, 'ok', 'a 2xx no-op rendered as success');
});

test('no status can pair a success tone with a failure sentence', () => {
  // The invariant, asserted across every status rather than for one case: if a
  // card says something did not happen, its tone is never "ok".
  for (const verification of [NOOP, PARTIAL, TRANSFORMED, APPLIED]) {
    const v = writeOutcome({ status: 'done', mutating: true, verification });
    const saysNotDone = /discarded|dropped|differ|not verifiable/i.test(v.detail || '');
    if (saysNotDone) assert.notEqual(v.tone, 'ok', `"${v.detail}" rendered with an ok tone`);
    if (v.tone === 'ok') assert.equal(v.detail, null, 'a success card carried a caveat it did not style');
  }
});

test('a partial is amber and says what survived', () => {
  const v = writeOutcome({ status: 'done', mutating: true, verification: PARTIAL });
  assert.equal(v.tone, 'warn');
  assert.equal(v.badgeClass, 'amber');
  assert.equal(v.dotStyle.background, 'var(--amber)');
  assert.match(v.detail, /The other fields were stored/);
});

test('a transformed write is amber and gives the reason', () => {
  const v = writeOutcome({ status: 'done', mutating: true, verification: TRANSFORMED });
  assert.equal(v.tone, 'warn');
  assert.match(v.detail, /a choice label was resolved to its stored value/);
});

test('a fully applied write is the only thing that renders clean', () => {
  const v = writeOutcome({ status: 'done', mutating: true, verification: APPLIED });
  assert.equal(v.tone, 'ok');
  assert.equal(v.label, 'done');
  assert.equal(v.detail, null);
});

test('only the three locked tokens are ever used — no new colours', () => {
  const seen = new Set();
  for (const verification of [NOOP, PARTIAL, TRANSFORMED, APPLIED, { status: 'unverified', unverifiable: [{ field: 'comments' }] }]) {
    const v = writeOutcome({ status: 'done', mutating: true, verification });
    if (v.dotStyle?.background) seen.add(v.dotStyle.background);
    if (v.badgeClass) seen.add(v.badgeClass);
  }
  for (const token of seen) {
    assert.ok(['var(--red)', 'var(--amber)', 'red', 'amber'].includes(token), `unexpected token ${token}`);
  }
});

test('a read-only tool is unaffected — it has no verification and never did', () => {
  assert.equal(writeOutcome({ status: 'done' }).tone, 'ok');
  assert.equal(writeOutcome({ status: 'running' }).tone, 'pending');
  assert.equal(writeOutcome({ status: 'error' }).tone, 'bad');
  assert.equal(writeOutcome({}).detail, null);
});

test('a tool that errored before reaching the instance still renders as an error', () => {
  const v = writeOutcome({ status: 'error', mutating: true, verification: null });
  assert.equal(v.tone, 'bad');
  assert.equal(v.label, 'error');
});

/* ------------------------------------------------------------------ *
 * The duplicated capture line
 * ------------------------------------------------------------------ */

test('E6 — the capture message no longer repeats the badge', () => {
  // Rendered as: [not captured] {reason}. The message used to begin with the
  // same two words, giving "not captured / not captured — data, not …".
  const m = { message: 'not captured — data, not configuration (incident does not extend sys_metadata)' };
  const reason = captureReason(m);
  assert.doesNotMatch(reason, /^not captured/i);
  assert.match(reason, /^data, not configuration/);
  assert.match(reason, /does not extend sys_metadata/, 'the reason itself must survive');
});

test('a captured message is trimmed the same way', () => {
  assert.match(captureReason({ message: 'captured 2 updates into NHA · x · global' }), /^2 updates into/);
});

test('a message that does not start with the verdict is left alone', () => {
  const msg = 'capture failed after create_record: boom';
  assert.equal(captureReason({ message: msg }), msg);
});

test('an empty capture message does not become empty chrome', () => {
  assert.equal(captureReason({ message: '' }), '');
  assert.equal(captureReason({}), '');
});

/* ------------------------------------------------------------------ *
 * The gate audit
 * ------------------------------------------------------------------ */

test('a mutating tool cannot execute without a resolved approval', async () => {
  let ran = false;
  const tool = { name: 'update_record', mutating: true, execute: async () => { ran = true; return {}; } };
  for (const approval of [null, undefined, 'rejected', 'pending', '']) {
    await assert.rejects(
      () => executeTool(tool, {}, approval),
      (err) => {
        assert.match(err.message, /Refusing to execute the mutating tool/);
        assert.equal(err.detail.reason, 'unapproved-mutation');
        return true;
      },
      `approval=${approval} was allowed through`,
    );
  }
  assert.equal(ran, false, 'the tool body ran despite an unresolved approval');
});

test('approved and auto are the only values that let a mutation run', async () => {
  assert.deepEqual([...APPROVAL_RESOLVED].sort(), ['approved', 'auto']);
  const tool = { name: 'update_record', mutating: true, execute: async () => 'ok' };
  assert.equal(await executeTool(tool, {}, 'approved'), 'ok');
  assert.equal(await executeTool(tool, {}, 'auto'), 'ok');
});

test('a read-only tool needs no approval', async () => {
  const tool = { name: 'query_records', mutating: false, execute: async () => 'rows' };
  assert.equal(await executeTool(tool, {}, null), 'rows');
});
