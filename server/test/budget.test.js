/**
 * D-7 — budgets from reality, and the guards that keep compaction from
 * thrashing against them.
 *
 *   node --test server/test/
 *
 * The defect these pin: a long spec produced THREE compaction digests inside a
 * single turn (9,629 -> 4,308, 7,209 -> 3,774, 6,298 -> 2,476 tokens), several
 * blank assistant rows, and then an empty completion. The model is
 * gpt-oss:120b-cloud, whose context window was read off the daemon rather than
 * assumed — 131,072 tokens — so none of this was context overflow.
 *
 * It was the budget. Measured on the real system prompt and the real 37 tool
 * schemas, the history allowance was 5,452 tokens: 4% of the window. Every
 * "before" number above is over that line and every "after" is under it. And it
 * ratcheted, because each digest is appended to the system prompt, so every
 * compaction raised the fixed overhead and lowered the next turn's allowance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeBudget, probeContextWindow, clearContextProbeCache,
  SANE_CONTEXT_CAP, OUTPUT_HEADROOM, FALLBACK_CONTEXT,
} from '../src/memory/budget.js';
import { estimateTextTokens } from '../src/memory/tokens.js';
import { MIN_COMPACTION_GAIN } from '../src/memory/compaction.js';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; clearContextProbeCache(); });

/** The daemon's answer for gpt-oss, verbatim in shape. */
function showReturns(contextLength, key = 'gptoss.context_length') {
  globalThis.fetch = async (url) => {
    if (!String(url).endsWith('/api/show')) throw new Error(`unexpected call to ${url}`);
    return { ok: true, status: 200, json: async () => ({ model_info: { [key]: contextLength } }) };
  };
}

/* ------------------------------------------------------------------ *
 * Probing the window
 * ------------------------------------------------------------------ */

test('the context window is read from the daemon, not assumed', async () => {
  showReturns(131_072);
  const { tokens, source } = await probeContextWindow('gpt-oss:120b-cloud', 'http://localhost:11434/v1');
  assert.equal(tokens, 131_072);
  assert.match(source, /api\/show/);
});

test('the context key is found by suffix, so a new architecture still works', async () => {
  // llama.context_length, qwen2.context_length, gptoss.context_length — the
  // prefix is the architecture, and guessing it wrong is how this silently
  // falls back to a small default on a large model.
  showReturns(32_768, 'qwen2.context_length');
  const { tokens } = await probeContextWindow('qwen2.5:14b', 'http://localhost:11434/v1');
  assert.equal(tokens, 32_768);
});

test('a daemon that cannot be reached falls back rather than throwing', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const { tokens, source } = await probeContextWindow('something-unknown:7b', 'http://localhost:11434/v1');
  assert.equal(tokens, FALLBACK_CONTEXT);
  assert.match(source, /fallback/);
});

test('a known API model uses its documented window without a daemon', async () => {
  globalThis.fetch = async () => { throw new Error('no daemon here'); };
  const { tokens, source } = await probeContextWindow('gpt-4o', 'https://api.openai.com/v1');
  assert.equal(tokens, 128_000);
  assert.match(source, /documented/);
});

test('the probe is cached — it runs per turn and must not be a request per turn', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ model_info: { 'gptoss.context_length': 131_072 } }) };
  };
  await probeContextWindow('gpt-oss:120b-cloud', 'http://localhost:11434/v1');
  await probeContextWindow('gpt-oss:120b-cloud', 'http://localhost:11434/v1');
  await probeContextWindow('gpt-oss:120b-cloud', 'http://localhost:11434/v1');
  assert.equal(calls, 1);
});

/* ------------------------------------------------------------------ *
 * The three numbers
 * ------------------------------------------------------------------ */

test('the budget subtracts the fixed overhead the request actually carries', async () => {
  showReturns(131_072);
  // The measured sizes: the real system prompt is ~5,882 tokens and the 37
  // tool schemas ~6,666, for 12,548 of overhead. Not subtracting them is what
  // let a "24k" allowance ship a 35k request.
  const system = 'x'.repeat(20_586);
  const tools = [{ name: 'a', description: 'y'.repeat(23_330), inputSchema: {} }];

  const bare = await computeBudget({ system: '', tools: [] });
  const loaded = await computeBudget({ system, tools });

  assert.ok(loaded.fixed > 12_000, `the prompt and tool schemas must be counted, got ${loaded.fixed}`);
  assert.ok(loaded.budget < bare.budget, 'the history allowance must shrink as the envelope fills');
  assert.equal(loaded.budget, loaded.ceiling - loaded.fixed - loaded.headroom);
});

test('the history budget is a real share of the window, not 4% of it', async () => {
  showReturns(131_072);
  const system = 'x'.repeat(20_586);
  const tools = [{ name: 'a', description: 'y'.repeat(23_330), inputSchema: {} }];
  const { budget } = await computeBudget({ system, tools });

  // The measured old value was 5,452 on exactly this input. Anything in that
  // region is the defect, not a tuning choice.
  assert.ok(budget > 10_000, `history budget regressed to ${budget}; the thrash starts around 5,452`);
});

test('a small model caps the budget below our own ceiling', async () => {
  // The cap protects cost and latency; the model's own window protects
  // correctness. Whichever is smaller has to win, and it must be the model's
  // when the model is the smaller one.
  showReturns(8_192);
  const { ceiling, modelCtx } = await computeBudget({ system: 'x', tools: [] });
  assert.equal(modelCtx, 8_192);
  assert.equal(ceiling, 8_192, 'an 8k model must not be sent a 32k request');
});

test('output headroom exceeds the max_tokens we ask for', async () => {
  showReturns(131_072);
  const { headroom } = await computeBudget({ system: 'x', tools: [], maxTokens: 4096 });
  // This model bills hidden reasoning tokens against the same completion
  // budget — measured directly: a 20-token request returned finish_reason
  // "length" with empty content and a populated `reasoning` field. Reserving
  // exactly max_tokens reserves for the visible half only.
  assert.ok(headroom >= 4096, `headroom ${headroom} is under the requested max_tokens`);
  assert.equal(headroom, OUTPUT_HEADROOM);
});

test('the history allowance never collapses to nothing', async () => {
  // An enormous prompt must not drive the budget to zero and compact the
  // conversation out of existence; it hits a floor and lets the orchestrator's
  // size warning do the talking.
  showReturns(131_072);
  const { budget } = await computeBudget({ system: 'x'.repeat(5_000_000), tools: [] });
  assert.ok(budget >= 4_000, `floor breached: ${budget}`);
});

test('the self-imposed cap stays well inside the measured-safe range', () => {
  // Re-measured 2026-08-19, single attempt, no retry, 5 shots per size:
  // 35/35 succeeded from ~5,798 to 51,429 real prompt tokens, latency flat.
  // The estimator runs ~40% high, so a 32,000-token estimate is ~23,000 real.
  assert.ok(SANE_CONTEXT_CAP <= 40_000, 'the cap should stay inside what was actually measured');
  assert.ok(SANE_CONTEXT_CAP >= 24_000, 'below this the 5,452-token thrash comes back');
});

test('the token estimate is pessimistic, because guessing low fails the request', () => {
  // 3.5 chars/token rather than the usual 4: tool results are JSON, and JSON
  // tokenises worse than prose. Confirmed against real usage numbers — 32,000
  // estimated tokens measured as 22,911 real ones.
  assert.ok(estimateTextTokens('a'.repeat(3500)) >= 1000);
});

/* ------------------------------------------------------------------ *
 * The minimum-gain floor
 * ------------------------------------------------------------------ */

test('the minimum compaction gain is large enough to break the thrash loop', () => {
  // The observed thrash folded spans worth ~2,000-5,000 tokens to land just
  // under the line, where the next tool result pushed it straight back over.
  // A floor below ~1,000 would not have stopped any of the three.
  assert.ok(MIN_COMPACTION_GAIN >= 1_000, 'too low to prevent the observed thrash');
});
