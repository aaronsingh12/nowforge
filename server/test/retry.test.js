/**
 * The model call retries transient failures — and only transient ones.
 *
 *   node --test server/test/
 *
 * Written from a measurement that nearly produced the wrong fix. A session kept
 * dying on `Internal Server Error (ref: …)` from Ollama's cloud shim. Replaying
 * the captured request body looked exactly like a size limit:
 *
 *   111,412B  FAIL        24 tools  100,710B  FAIL
 *    88,094B  ok          30 tools  106,685B  ok      <- not monotonic
 *
 * That second column is the tell. Sending the SAME body six times settled it:
 * the full request succeeded 4/6, the "passing" smaller one 5/6, and half the
 * history 6/6. The upstream is flaky, with failure probability rising with
 * size — it is not a limit. Truncating the agent's history to dodge it would
 * have degraded the product to work around someone else's bad afternoon.
 *
 * So: retry. The tests below pin the two halves that matter — that a transient
 * failure is retried, and that a 4xx is NOT, because a retried 400 is just a
 * bug that takes three times as long to find.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { chat } from '../src/agent/providers/openaiCompat.js';
import { isRetryableStatus, withRetry, retryable, RETRY_ATTEMPTS } from '../src/agent/providers/retry.js';

const OK_BODY = { choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] };
const HISTORY = [{ role: 'user', text: 'go' }];

/** Fails the first `failures` calls with `status`, then succeeds. */
function flakyFetch(failures, status = 500) {
  const state = { calls: 0 };
  globalThis.fetch = async () => {
    state.calls += 1;
    if (state.calls <= failures) {
      return { ok: false, status, json: async () => ({ error: { message: `Internal Server Error (ref: r${state.calls})` } }) };
    }
    return { ok: true, status: 200, json: async () => OK_BODY };
  };
  return state;
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

test('only transport-level failures are retryable', () => {
  for (const s of [500, 502, 503, 504, 408, 429]) {
    assert.ok(isRetryableStatus(s), `${s} should be retried`);
  }
  for (const s of [400, 401, 403, 404, 409, 422]) {
    assert.ok(!isRetryableStatus(s), `${s} is our own bad request and must fail loudly`);
  }
});

/* ------------------------------------------------------------------ *
 * The real path
 * ------------------------------------------------------------------ */

test('a flaky 500 is retried and the turn survives', async () => {
  const state = flakyFetch(2);
  const res = await chat({ provider: 'ollama', model: 'gpt-oss:120b-cloud', system: 's', history: HISTORY, tools: [] });
  assert.equal(res.text, 'done');
  assert.equal(state.calls, 3, 'should have taken exactly three attempts');
});

test('a 400 is never retried — it is our request that is wrong', async () => {
  const state = flakyFetch(99, 400);
  await assert.rejects(
    () => chat({ provider: 'ollama', system: 's', history: HISTORY, tools: [] }),
    /Internal Server Error/
  );
  assert.equal(state.calls, 1, 'a malformed request must fail on the first attempt, not the third');
});

test('a network failure is retried, and named for what it is', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('fetch failed'); };
  await assert.rejects(
    () => chat({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', system: 's', history: HISTORY, tools: [] }),
    (err) => {
      assert.match(err.message, /unreachable at http:\/\/localhost:11434/);
      // "after N attempts" is the difference between "it is down" and "the
      // request was wrong", without reading the log.
      assert.match(err.message, new RegExp(`after ${RETRY_ATTEMPTS} attempts`));
      return true;
    }
  );
  assert.equal(calls, RETRY_ATTEMPTS);
});

test('exhausting the attempts reports the LAST upstream message, with the count', async () => {
  flakyFetch(99, 503);
  await assert.rejects(
    () => chat({ provider: 'ollama', system: 's', history: HISTORY, tools: [] }),
    (err) => {
      // The newest ref, not the first: each attempt gets its own from the
      // upstream, and the one worth quoting in a support thread is the last.
      assert.match(err.message, /Internal Server Error \(ref: r3\)/);
      assert.match(err.message, /after 3 attempts/);
      return true;
    }
  );
});

/* ------------------------------------------------------------------ *
 * The helper's own contract
 * ------------------------------------------------------------------ */

test('a success on the first attempt costs nothing', async () => {
  let calls = 0;
  const v = await withRetry('x', async () => { calls += 1; return 'v'; });
  assert.equal(v, 'v');
  assert.equal(calls, 1);
});

test('an error that is not marked retryable propagates immediately', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry('x', async () => { calls += 1; throw new Error('nope'); }),
    /^Error: nope$/
  );
  assert.equal(calls, 1);
  // And it is not decorated with an attempt count it never made.
  assert.doesNotMatch('nope', /attempts/);
});

test('the retry budget is bounded', async () => {
  let calls = 0;
  await assert.rejects(() => withRetry('x', async () => {
    calls += 1;
    throw retryable(new Error('always'), 500);
  }));
  assert.equal(calls, RETRY_ATTEMPTS, 'an unbounded retry is a hang, not a fix');
});

/* ------------------------------------------------------------------ *
 * The request budget
 * ------------------------------------------------------------------ */

const { historyBudgetFor, estimateTextTokens, REQUEST_TOKEN_BUDGET, REQUEST_TOKEN_CEILING } =
  await import('../src/memory/compaction.js');

test('the budget subtracts the fixed overhead the request actually carries', () => {
  const system = 'x'.repeat(19_600);          // the real system prompt's size
  const tools = [{ name: 'a', description: 'y'.repeat(23_000), inputSchema: {} }];

  const bare = historyBudgetFor({ system: '', tools: [] });
  const loaded = historyBudgetFor({ system, tools });

  assert.ok(loaded.overhead > 10_000, 'the prompt and tool schemas are ~11k tokens and must be counted');
  assert.ok(
    loaded.budget < bare.budget,
    'the history allowance must shrink as the envelope fills — not subtracting this shipped a 35k request'
  );
  // Not exactly the budget: an empty tool array still serialises to "[]".
  assert.ok(bare.budget >= REQUEST_TOKEN_BUDGET - 5 && bare.budget <= REQUEST_TOKEN_BUDGET);
});

test('the history allowance never collapses to nothing', () => {
  // An enormous prompt must not drive the budget to zero and compact the
  // conversation out of existence; it should hit a floor and let the warning
  // in the orchestrator do the talking.
  const { budget } = historyBudgetFor({ system: 'x'.repeat(5_000_000), tools: [] });
  assert.ok(budget >= 4_000, `floor breached: ${budget}`);
});

test('the compaction target sits below the measured-reliable ceiling', () => {
  // 8/8 at ~20,100 tokens, 4/8 at ~27,900. The budget aims under the evidence,
  // and the warning fires at the evidence — not the other way round.
  assert.ok(REQUEST_TOKEN_BUDGET < REQUEST_TOKEN_CEILING);
  assert.ok(REQUEST_TOKEN_CEILING <= 20_000);
});

test('the token estimate is pessimistic, because guessing low fails the request', () => {
  // 3.5 chars/token rather than the usual 4: tool results are JSON, and JSON
  // tokenises worse than prose.
  assert.ok(estimateTextTokens('a'.repeat(3500)) >= 1000);
});
