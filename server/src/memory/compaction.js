import { getDb } from './db.js';
import { loadHistory, loadDigests, replaceSpanWithDigest } from './sessions.js';
import { chatOnce } from '../agent/providers/index.js';
import { codegenDecoding } from '../agent/decoding.js';

/**
 * A-3 — compaction.
 *
 * A long session eventually exceeds the model's context. The naive fix is to
 * drop the oldest turns, which loses exactly the thing the agent is most often
 * asked for later: the sys_id of something built twenty turns ago.
 *
 * So the oldest span is SUMMARISED into a structured digest — artifacts and
 * their sys_ids, decisions, open threads — and spliced back as a system-side
 * note, while the last K turns stay verbatim.
 *
 * Budget note, specific to this build: gpt-oss:120b-cloud advertises a 131,072
 * token context but bills hidden REASONING tokens against the same budget, and
 * the adapter's specific-error ("the max_tokens budget was exhausted before any
 * output was produced") fires when they crowd out the completion. That error
 * must never fire during compaction — a failed compaction leaves the session
 * over budget and the next turn fails too, which is a loop, not a degradation.
 * The budget below is therefore a small fraction of the advertised window.
 */

/**
 * Characters per token. Deliberately pessimistic: 3.5 rather than the usual 4,
 * because tool results are JSON, and JSON tokenises worse than prose. Guessing
 * high on token count means compacting slightly early, which is cheap. Guessing
 * low means the request fails, which is not.
 */
const CHARS_PER_TOKEN = 3.5;

/** Leaves room for the system prompt, the fact ledger, tools, and reasoning. */
export const HISTORY_TOKEN_BUDGET = 24_000;

/** Turns always kept verbatim, however long they are. */
export const KEEP_LAST_TURNS = 8;

/** Never compact below this — with too little history a digest costs more than it saves. */
const MIN_TURNS_TO_COMPACT = 6;

/** Rough token estimate over the NEUTRAL history, before any provider translation. */
export function estimateTokens(history) {
  let chars = 0;
  for (const m of history || []) {
    if (!m) continue;
    if (m.text) chars += m.text.length;
    for (const tc of m.toolCalls || []) {
      chars += (tc.name?.length || 0) + JSON.stringify(tc.input ?? {}).length;
    }
    for (const r of m.results || []) {
      chars += (r.name?.length || 0) + (r.output?.length || 0);
    }
    chars += 8; // per-message envelope
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

const DIGEST_SYSTEM = `You compress the opening of a ServiceNow engineering conversation into a structured digest. It replaces those turns verbatim, so anything you leave out is GONE — the agent will not be able to answer a question about it later.

Respond with ONLY this shape, no prose outside it, no markdown fences:

ARTIFACTS BUILT OR CHANGED
- <name> — <type> — sys_id <the sys_id> — <state: active / deleted / failed>
(ONLY records this conversation CREATED, UPDATED or DELETED. These identifiers cannot be reconstructed and are what gets asked for later, so this section matters more than the rest combined. If none, write "none".)

RECORDS ONLY LOOKED AT
- <one line: how many, from which table, and what the query was for>
(Query RESULTS are transient. Summarise them as a COUNT — never list them. Twenty incident numbers from a search are noise; that a search for unassigned criticals returned twenty is the fact worth keeping.)

DECISIONS
- <what was decided, and why, in one line>
(choices the user made or approved, and constraints they set. If none, write "none".)

OPEN THREADS
- <what was still unfinished, and what the next step was>
(anything asked for and not yet delivered, anything that failed and was not retried. If none, write "none".)

RULES:
1. Copy every sys_id, record number and exact artifact name in the FIRST section CHARACTER FOR CHARACTER. A mistyped sys_id is worse than an omitted one — it will be used.
2. Never summarise an identifier as "the incident" or "the flow created earlier". Name it.
3. Do NOT enumerate records that were merely read. If a tool returned a list, give the count and the intent, nothing more. Listing them crowds out the identifiers that matter and is the one way this digest can fail while looking complete.
4. Record what FAILED as carefully as what succeeded, including the reason.
5. Do not add anything that is not in the transcript. If a section is empty, write "none".
6. Emit all four headings, in this order, always.`;

/** All four headings must be present, or the digest was cut off mid-generation. */
const REQUIRED_HEADINGS = ['ARTIFACTS BUILT OR CHANGED', 'RECORDS ONLY LOOKED AT', 'DECISIONS', 'OPEN THREADS'];

/**
 * The transcript text handed to the summariser.
 *
 * List-shaped tool results are collapsed to a count and one sample row. A live
 * run against gpt-oss showed why this belongs here rather than in the prompt:
 * handed 60 query results of 12 records each, the model dutifully copied 100+
 * record numbers, hit its token cap, and dropped the one flow sys_id that
 * actually mattered. Asking it not to is weaker than not showing it.
 */
function summariseOutput(output) {
  const text = String(output || '');
  if (text.length < 400) return text;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const sample = parsed.length ? JSON.stringify(parsed[0]).slice(0, 220) : '';
      return `[${parsed.length} rows returned; first row: ${sample}]`;
    }
  } catch { /* not JSON — fall through to a plain trim */ }
  return `${text.slice(0, 1200)}…[trimmed]`;
}

function renderSpan(entries) {
  const parts = [];
  for (const m of entries) {
    if (m.role === 'user') parts.push(`USER: ${m.text}`);
    else if (m.role === 'assistant') {
      if (m.text) parts.push(`ASSISTANT: ${m.text}`);
      for (const tc of m.toolCalls || []) {
        parts.push(`ASSISTANT CALLED ${tc.name}(${JSON.stringify(tc.input ?? {}).slice(0, 600)})`);
      }
    } else if (m.role === 'tool') {
      for (const r of m.results || []) {
        parts.push(`RESULT ${r.name}${r.isError ? ' [ERROR]' : ''}: ${summariseOutput(r.output)}`);
      }
    }
  }
  return parts.join('\n');
}

/**
 * Compact if over budget. Returns {compacted:false} when nothing was needed —
 * the common case, and it must stay cheap since this runs every iteration.
 */
export async function compactIfNeeded(
  sessionId,
  {
    budget = HISTORY_TOKEN_BUDGET,
    keepLast = KEEP_LAST_TURNS,
    // Injectable so the offline suite can exercise the real splice, budget
    // arithmetic and failure paths without an LLM. The default is the live one.
    summarize = null,
  } = {}
) {
  const history = loadHistory(sessionId);
  const before = estimateTokens(history);
  if (before <= budget) return { compacted: false, tokens: before, budget };
  if (history.length < MIN_TURNS_TO_COMPACT + keepLast) {
    // Over budget but too short to fold: the recent turns themselves are huge.
    // Say so rather than silently doing nothing — the next call may well fail.
    return {
      compacted: false,
      tokens: before,
      budget,
      warning:
        `This session is over the ${budget}-token history budget (~${before}) but has only ${history.length} ` +
        `entries, so there is nothing old enough to fold away. The recent turns are individually large — ` +
        `usually one very large tool result.`,
    };
  }

  const db = getDb();
  const rows = db.prepare('SELECT seq FROM messages WHERE session = ? ORDER BY seq ASC').all(sessionId);
  const cutIndex = Math.max(0, rows.length - keepLast);
  const span = rows.slice(0, cutIndex);
  if (!span.length) return { compacted: false, tokens: before, budget };

  const fromSeq = span[0].seq;
  const toSeq = span[span.length - 1].seq;
  const entries = history.slice(0, cutIndex);

  const transcript = renderSpan(entries);
  let digest;
  try {
    digest = summarize
      ? await summarize(transcript, entries)
      : await chatOnce({
          system: DIGEST_SYSTEM,
          user: `TRANSCRIPT TO COMPRESS (${entries.length} entries):\n\n${transcript}`,
          // Generous on purpose: this model spends hidden reasoning tokens from
          // the same budget, and a truncated digest silently loses identifiers.
          maxTokens: 6000,
          decoding: codegenDecoding(`compact:${sessionId}:${fromSeq}`, 1),
        });
  } catch (err) {
    // Loud, and non-destructive: the span is NOT deleted, so nothing is lost.
    // The session stays over budget and the caller can see why.
    return {
      compacted: false,
      tokens: before,
      budget,
      error: `Compaction failed, so no history was discarded: ${err.message}`,
    };
  }

  const text = String(digest || '').trim();
  if (text.length < 40) {
    return { compacted: false, tokens: before, budget, error: 'Compaction produced an empty digest; no history was discarded.' };
  }

  // A digest that ran out of tokens mid-generation looks perfectly fine — it is
  // well-formed text that simply stops, and the part it dropped is the tail.
  // Measured live: one run enumerated 100+ query-result record numbers, hit the
  // cap, and lost the flow sys_id entirely, while reporting success. Requiring
  // every heading turns that silent loss into a refusal.
  const missing = REQUIRED_HEADINGS.filter((h) => !text.includes(h));
  if (missing.length) {
    return {
      compacted: false,
      tokens: before,
      budget,
      error:
        `Compaction produced an incomplete digest — missing ${missing.join(', ')} — which means it was cut off ` +
        `before the end and would have silently dropped whatever came after. No history was discarded.`,
    };
  }

  replaceSpanWithDigest(sessionId, fromSeq, toSeq, text);
  const after = estimateTokens(loadHistory(sessionId));
  return { compacted: true, fromSeq, toSeq, entries: entries.length, tokensBefore: before, tokensAfter: after, budget };
}

/**
 * The digests, rendered for the system prompt. This is the "spliced as a
 * system-side note" half: the compressed past arrives as established context
 * rather than as a forged conversational turn nobody actually said.
 */
export function buildDigestNote(sessionId) {
  const digests = loadDigests(sessionId);
  if (!digests.length) return '';
  return (
    `EARLIER IN THIS SESSION — a compressed record of turns that are no longer quoted verbatim.\n` +
    `Treat the identifiers here as established fact; they were read off the instance during this session.\n\n` +
    digests.map((d) => d.text).join('\n\n---\n\n')
  );
}
