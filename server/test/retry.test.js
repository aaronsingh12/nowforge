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
 *
 * The arithmetic moved to memory/budget.js in D-7, and so did its tests —
 * see budget.test.js. What stays here is the token estimator, because the
 * adapter's own diagnostics use it.
 * ------------------------------------------------------------------ */

const { estimateTextTokens } = await import('../src/memory/tokens.js');

test('the token estimate is pessimistic, because guessing low fails the request', () => {
  // 3.5 chars/token rather than the usual 4: tool results are JSON, and JSON
  // tokenises worse than prose.
  assert.ok(estimateTextTokens('a'.repeat(3500)) >= 1000);
});

/* ------------------------------------------------------------------ *
 * Empty completions
 * ------------------------------------------------------------------ */

/**
 * A 200 whose choice carries no content and no tool calls.
 *
 * `calls` counts REAL attempts only. D-7 made a cold-start retry issue a
 * one-token warm-up first, so raw fetch count stopped being a usable proxy for
 * "how many times did it try" — counting them together would have made the
 * warm-up look like an extra attempt against the retry budget, which is
 * exactly the confusion these tests exist to prevent.
 */
function emptyThen(finishReason, failures) {
  const state = { calls: 0, warmUps: 0 };
  globalThis.fetch = async (_url, init) => {
    const sent = JSON.parse(init.body);
    if (sent.max_tokens === 1) {
      state.warmUps += 1;
      return { ok: true, status: 200, json: async () => OK_BODY };
    }
    state.calls += 1;
    const body = state.calls <= failures
      ? { choices: [{ message: { content: '' }, finish_reason: finishReason }] }
      : OK_BODY;
    return { ok: true, status: 200, json: async () => body };
  };
  return state;
}

test('finish_reason "load" is a cold start, and is retried', async () => {
  // Ollama's own value, not OpenAI's: the request loaded the model and
  // generated nothing. It was surfacing to the user as a hard failure that
  // blamed their choice of model in Settings.
  const state = emptyThen('load', 1);
  const res = await chat({ provider: 'ollama', model: 'gpt-oss:120b-cloud', system: 's', history: HISTORY, tools: [] });
  assert.equal(res.text, 'done');
  assert.equal(state.calls, 2);
  // The retry landed on a model made resident on purpose, not on a guess about
  // how long a 120b load takes.
  assert.equal(state.warmUps, 1);
});

test('an empty "stop" is a hiccup, and is retried too', async () => {
  const state = emptyThen('stop', 2);
  const res = await chat({ provider: 'ollama', system: 's', history: HISTORY, tools: [] });
  assert.equal(res.text, 'done');
  assert.equal(state.calls, 3);
  // A hiccup is not a cold start: warming up for one spends a request on the
  // upstream for nothing.
  assert.equal(state.warmUps, 0);
});

test('an empty "length" is NOT retried — it has a cause and a remedy', async () => {
  // The budget was spent on hidden reasoning tokens. Three attempts arrive at
  // exactly the same place, slower.
  const state = emptyThen('length', 99);
  await assert.rejects(
    () => chat({ provider: 'ollama', system: 's', history: HISTORY, tools: [], maxTokens: 4096 }),
    /max_tokens budget \(4096\) was exhausted.*Raise max_tokens/s
  );
  assert.equal(state.calls, 1);
});

test('an empty completion that never resolves fails with its finish reason named', async () => {
  emptyThen('load', 99);
  await assert.rejects(
    () => chat({ provider: 'ollama', system: 's', history: HISTORY, tools: [] }),
    /empty completion \(finish reason: load\).*after 3 attempts/s
  );
});

test('a completion carrying only tool calls is not mistaken for an empty one', async () => {
  // The commonest shape this model produces: no prose, one tool call.
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      choices: [{
        message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query_records', arguments: '{"table":"incident"}' } }] },
        finish_reason: 'tool_calls',
      }],
    }),
  });
  const res = await chat({ provider: 'ollama', system: 's', history: HISTORY, tools: [] });
  assert.equal(res.text, '');
  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].name, 'query_records');
  assert.equal(res.stopReason, 'tool_calls');
});

test('a cold start is warmed up rather than waited out', async () => {
  // Observed live: three attempts burned inside ~2.4s while a 120b model was
  // still coming up, then reported failure. The first fix slept 4s+8s, which
  // was a guess about load time dressed as a constant. D-7 asks the question
  // directly instead — a one-token request that blocks until the model is
  // resident — so the wait IS the load rather than an estimate of it.
  const state = emptyThen('load', 99);
  await assert.rejects(() => chat({ provider: 'ollama', system: 's', history: HISTORY, tools: [] }));
  assert.equal(state.calls, RETRY_ATTEMPTS);
  // One warm-up before each retry, and none after the final attempt — warming
  // up a model we are about to give up on helps nobody.
  assert.equal(state.warmUps, RETRY_ATTEMPTS - 1);
});

test('a warm-up that itself fails does not sink the retry', async () => {
  // The warm-up is an optimisation. If it throws, the real retry must still
  // happen — otherwise a flaky spare request kills a turn that would have
  // succeeded.
  let real = 0;
  globalThis.fetch = async (_url, init) => {
    if (JSON.parse(init.body).max_tokens === 1) throw new Error('warm-up socket hang up');
    real += 1;
    if (real === 1) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'load' }] }) };
    return { ok: true, status: 200, json: async () => OK_BODY };
  };
  const res = await chat({ provider: 'ollama', system: 's', history: HISTORY, tools: [] });
  assert.equal(res.text, 'done');
  assert.equal(real, 2);
});
