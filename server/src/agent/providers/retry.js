import { log } from '../../logging.js';

/**
 * Bounded retry for the model call, and only for the model call.
 *
 * This exists because of a measurement, not a hunch. A session kept failing
 * with `Internal Server Error (ref: …)` from Ollama's cloud shim. Replaying the
 * captured request body showed something that looked at first like a size
 * limit — 111KB failed, 88KB passed — and the obvious "fix" would have been to
 * truncate history hard. Sending the SAME body six times showed what it
 * actually is:
 *
 *   the full failing request   111,412B   4/6 ok
 *   the same, without tools     88,094B   5/6 ok
 *   half the history            80,314B   6/6 ok
 *
 * Nothing is deterministic. The upstream is simply flaky, with failure
 * probability rising with request size, so an earlier bisect showing 24 tools
 * failing while 30 tools passed was noise being read as signal. Truncating the
 * agent's memory to work around that would have degraded it for no reason.
 *
 * What is safe to retry: this wraps the LLM request ONLY. It is a read, it
 * writes nothing to the instance, and tool execution sits outside it — a
 * mutation approved at the gate is never re-run by this.
 *
 * What is NOT retried: any 4xx other than 408/429. Those are our own malformed
 * request, and retrying one three times turns a clear bug into a slow one —
 * which is exactly how the `invalid message content type: <nil>` defect stayed
 * invisible for as long as it did.
 *
 * Every retry is logged at warn. A silent retry would hide an upstream getting
 * steadily worse behind a slightly slower app.
 */

export const RETRY_ATTEMPTS = 3;
const BASE_DELAY_MS = 600;

/**
 * A cold start is not a blip, and must not be waited on like one.
 *
 * `finish_reason: load` means the backend was loading the model. For a 120b
 * cloud model that takes far longer than the 600ms/1.8s a 5xx deserves, so the
 * generic backoff burned all three attempts inside ~2.4s and reported failure
 * while the model was still coming up — observed exactly that way in a live
 * session.
 */
const LOAD_DELAY_MS = 4_000;
const isColdStart = (err) => /finish reason: load/i.test(err?.message || '');

/** 408 timeout, 429 rate limit, and anything 5xx. Nothing else. */
export function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/** Mark an error as worth another attempt. */
export function retryable(err, status) {
  err.retryable = true;
  if (status !== undefined) err.status = status;
  return err;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withRetry(label, fn, { attempts = RETRY_ATTEMPTS } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const value = await fn(attempt);
      if (attempt > 1) log.warn('llm', `${label} succeeded on attempt ${attempt}/${attempts}`);
      return value;
    } catch (err) {
      lastError = err;
      if (!err.retryable || attempt === attempts) break;
      // Exponential, with jitter so repeated turns do not land in lockstep.
      const base = isColdStart(err) ? LOAD_DELAY_MS : BASE_DELAY_MS;
      const delay = Math.round(base * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
      log.warn('llm', `${label} attempt ${attempt}/${attempts} failed (${err.status || 'network'}) — retrying in ${delay}ms`, err.message);
      await sleep(delay);
    }
  }
  if (lastError?.retryable) {
    // Say how hard it tried, so "the model is down" is distinguishable from
    // "the request was wrong" without reading the log.
    lastError.message = `${lastError.message} (after ${attempts} attempts)`;
  }
  throw lastError;
}
