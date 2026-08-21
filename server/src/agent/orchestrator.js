import crypto from 'node:crypto';
import { chatTurn, providerInfo } from './providers/index.js';
import { log, ms, shortId } from '../logging.js';
import { TOOLS, toolMap } from './tools.js';
import { buildSystemPrompt } from './prompts.js';
import { getSettings } from '../config/store.js';
import {
  createSession,
  getSession as loadSessionRow,
  appendMessage,
  loadHistory,
  recordToolEvent,
} from '../memory/sessions.js';
import { compactIfNeeded, buildDigestNote, estimateTokens } from '../memory/compaction.js';
import { computeBudget } from '../memory/budget.js';
import { sanitizeHistory, isBlankText } from '../memory/sanitize.js';
import { recordVerificationFailure } from '../memory/facts.js';
import { indexMessage } from '../memory/recall.js';
import { captureAfterTool, captureMark, reconcileTurn } from './capture.js';
import { openCaptureWindow, closeCaptureWindow } from '../servicenow/transport.js';
import { snapshotBefore, verifyMutation, attachVerification, isFailedWrite } from './mutation-pipeline.js';

/**
 * The backbone, modeled on Claude Code / opencode:
 *   session state → provider-agnostic agent loop → tool registry →
 *   permission gate on mutations → streamed events to the UI.
 *
 * Neutral history format (translated per-provider by the adapters):
 *   { role: 'user', text }
 *   { role: 'assistant', text, toolCalls: [{id, name, input}] }
 *   { role: 'tool', results: [{id, name, output, isError}] }
 *
 * History is PERSISTED (A-1): it is read from SQLite at the start of every turn
 * and written through as it is produced. Nothing about a conversation lives
 * only in this process any more, which is what makes "navigate away and back"
 * and "restart the server" lossless rather than merely unlikely to be noticed.
 *
 * The in-memory map now holds only what genuinely cannot be persisted: the
 * unresolved approval promises for turns currently in flight. A restart
 * legitimately abandons those — the tool never ran.
 */

const live = new Map(); // sessionId -> { pending: Map<approvalId, resolver> }

function liveState(id) {
  if (!live.has(id)) live.set(id, { pending: new Map() });
  return live.get(id);
}

/** Kept for API compatibility; the durable half now comes from SQLite. */
export function getSession(id) {
  if (!loadSessionRow(id)) createSession({ id });
  return { history: loadHistory(id), pending: liveState(id).pending };
}

export function resolveApproval(sessionId, approvalId, approved) {
  const resolver = live.get(sessionId)?.pending.get(approvalId);
  if (!resolver) return false;
  live.get(sessionId).pending.delete(approvalId);
  resolver(Boolean(approved));
  return true;
}

const MAX_ITERATIONS = 15;

/**
 * The completion budget per call. Named because the history budget subtracts
 * headroom for it — the two numbers have to agree, and a literal in two places
 * is how they stop agreeing.
 */
const MAX_OUTPUT_TOKENS = 4096;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const RESULT_CHAR_LIMIT = 8000;

function truncate(str) {
  return str.length > RESULT_CHAR_LIMIT ? str.slice(0, RESULT_CHAR_LIMIT) + '\n…[truncated]' : str;
}

function awaitApproval(state, approvalId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.pending.delete(approvalId);
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);
    state.pending.set(approvalId, (approved) => {
      clearTimeout(timer);
      resolve(approved);
    });
  });
}

/* ------------------------------------------------------------------ *
 * A6 — the stalled turn
 *
 * MEASURED on gpt-oss:120b-cloud, twice in three runs of the C-4 acceptance.
 * Asked to "make the justification field mandatory only when duration is
 * Permanent", the model resolved the item, read its variables, quoted the two
 * correct sys_ids and the correct choice value in a tidy table — and then
 * ended the turn with "Shall I create this UI Policy now?".
 *
 * Nothing was created, and nothing said so. From the outside a stalled turn
 * looks exactly like a completed one: prose arrives, the stream closes.
 *
 * Asking harder does not fix it. The system prompt already said the approval
 * gate IS the confirmation and to call the tool; the model asked anyway, which
 * is §20's lesson again — three attempts of prose had not moved this model, and
 * one dictionary listing moved it immediately. So this is a guard, and the
 * evidence it feeds back is the thing the model demonstrably did not have: the
 * fact that its question reached nobody.
 *
 * Deliberately narrow. It fires only when ALL of:
 *   - the turn is ending with no tool call at all,
 *   - the assistant's last line asks to proceed,
 *   - the user's own message was an instruction to change something,
 *   - and it has not already fired this turn.
 * A genuine clarifying question ("which of these two items did you mean?") does
 * not match, because it does not ask for permission to proceed.
 * ------------------------------------------------------------------ */

/**
 * "Shall I ...?", "Let me know ...", "If you're happy with this, I'll ...".
 *
 * Widened after a measured miss (§32, A3): the model produced a complete flow
 * design and closed with "If you're happy with this design, I'll create the
 * flow on the instance. Let me know!" — every bit as stalled as the shape this
 * guard was written for, and matched by none of its patterns. "let me know IF"
 * required an "if" the model did not write, and an offer phrased as a promise
 * ("I'll create ...") was not covered at all.
 *
 * Widening is safe precisely because the guard also requires the turn to have
 * changed NOTHING: "Created it. Let me know if you want anything else" carries
 * a mutation and never reaches these patterns.
 */
const ASKS_TO_PROCEED = new RegExp(
  [
    String.raw`\bshall i\b`,
    String.raw`\bwould you like me to\b`,
    String.raw`\bdo you want me to\b`,
    String.raw`\blet me know\b`,
    String.raw`\bshould i (?:go ahead|proceed|create|update|delete|apply)\b`,
    String.raw`\bconfirm(?:\s+and)?\b[^.?!]*\bi(?:'ll| will)\b`,
    String.raw`\bplease confirm\b`,
    String.raw`\bgive me the go[- ]ahead\b`,
    String.raw`\bwaiting for your (?:approval|confirmation|go)\b`,
    // An offer phrased as a promise. Only reachable when nothing was changed.
    String.raw`\bif you(?:'re| are)? ?(?:happy|ok|okay|good)\b`,
    String.raw`\bi(?:'ll| will) (?:then )?(?:create|build|add|update|deploy|apply|set up|go ahead|proceed)\b`,
    String.raw`\bjust say the word\b`,
    String.raw`\bready to (?:create|build|deploy|proceed)\b`,
  ].join('|'),
  'i'
);

/**
 * The user told us to do something, rather than asking about something.
 *
 * Also widened by the same measurement. "When a P1 incident is UPDATED to state
 * On Hold ... escalate to the duty manager" is as directive as a sentence gets,
 * and it matched nothing: \bupdate\b does not match "updated", and none of the
 * automation verbs a flow request is actually phrased with were listed. A request
 * for automation is usually written as a RULE ("when X, do Y") rather than as an
 * order, so the verbs of the DO half have to be here too.
 */
const DIRECTIVE_VERBS = [
  'make', 'create', 'add', 'set', 'update', 'change', 'remove', 'delete', 'rename', 'build',
  'configure', 'hide', 'show', 'require', 'attach', 'enable', 'disable', 'reorder', 'fix',
  'escalate', 'notify', 'assign', 'route', 'send', 'email', 'trigger', 'close', 'reopen',
  'generate', 'deploy', 'schedule', 'approve',
];
// Some of these are also ordinary nouns ("the email", "the trigger"), so this
// list alone would over-match. It never fires alone: the assistant must ALSO
// have asked to proceed and changed nothing. When it is wrong the cost is one
// extra iteration carrying a nudge; when it was too narrow the cost was a whole
// acceptance run that designed a flow and built nothing. "log" is deliberately
// absent — it is a noun far more often than a verb here.
const IS_DIRECTIVE = new RegExp(`\\b(?:${DIRECTIVE_VERBS.join('|')})(?:s|d|es|ed|ing)?\\b`, 'i');

export function detectStalledTurn({ assistantText, userText, mutatingCallCount = 0 }) {
  // The test is whether the turn CHANGED anything, not whether it called
  // anything. Measured: the guard first counted calls in the closing iteration,
  // so a turn that resolved the item, created the policy and then signed off
  // with "let me know if you want anything else" was nudged into a pointless
  // extra read. Reads before a stall are the common shape of the real failure —
  // the model gathers everything it needs and then asks permission anyway — so
  // only a mutation clears the guard.
  if (mutatingCallCount > 0) return null;
  const text = String(assistantText || '');
  if (!text.trim()) return null;
  if (!ASKS_TO_PROCEED.test(text)) return null;
  if (!IS_DIRECTIVE.test(String(userText || ''))) return null;
  const asked = text.match(ASKS_TO_PROCEED)[0];
  return { asked };
}

/**
 * Run one user turn. `emit(event)` streams progress to the client:
 *   { type: 'meta', provider, model }
 *   { type: 'assistant_text', text }
 *   { type: 'tool_use', id, name, input, mutating }
 *   { type: 'approval_required', approvalId, name, input }
 *   { type: 'approval_resolved', approvalId, approved }
 *   { type: 'tool_result', id, name, output, isError }
 *   { type: 'compacted', ... } | { type: 'done' } | { type: 'error', message, retryable }
 *
 * `retry` re-issues a turn whose previous attempt died before writing anything
 * — an empty completion, or the upstream falling over. The user's message is
 * already the last row in history, so appending it again would duplicate it and
 * quietly change the conversation the model sees. Everything else is identical:
 * same history, same tools, same gate.
 */
export async function runTurn(sessionId, userText, emit, { retry = false } = {}) {
  const state = liveState(sessionId);
  const { agent } = getSettings();

  if (!loadSessionRow(sessionId)) createSession({ id: sessionId });

  let stallNudged = false;
  let compactedThisTurn = false;
  let mutatingCallCount = 0;
  if (!retry) {
    const userSeq = appendMessage(sessionId, { role: 'user', text: userText });
    indexMessage(sessionId, userSeq, 'user', userText);
  }
  const info = providerInfo();
  emit({ type: 'meta', ...info });
  const turnStart = Date.now();
  // Taken before any tool runs, so end-of-turn reconciliation can see
  // everything the turn produced — including rows no tool reported.
  const turnCaptureMark = captureMark();
  const sessionTitle = loadSessionRow(sessionId)?.title || null;
  // Declare this session's capture window so a CONCURRENT captured session
  // cannot claim rows this one produced, and vice versa (AD-4).
  openCaptureWindow(sessionId, turnCaptureMark);
  log.info('agent', `turn ${retry ? 'RETRY' : 'start'}  session=${shortId(sessionId)} ${info.provider}/${info.model}`,
    { message: userText.slice(0, 200) });

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      /*
       * D-7 — AT MOST ONE COMPACTION PER USER TURN.
       *
       * This used to run on every iteration of the loop, with the reasoning
       * that a single turn's tool results can be what pushes a session over
       * budget. True, and it produced the defect: one long spec compacted
       * THREE times inside one turn (9,629 -> 4,308, 7,209 -> 3,774,
       * 6,298 -> 2,476), because each fold landed just under a budget that a
       * single further tool result immediately pushed back over. Three LLM
       * calls, three spans of verbatim history destroyed, to end up where it
       * started.
       *
       * Compacting once is not a compromise. If one fold cannot get the turn
       * under budget, a second will not either — the recent turns are the
       * weight, and those are the ones compaction is not allowed to touch. The
       * honest outcome is to proceed and let the size warning say so.
       */
      const provisionalSystem = buildSystemPrompt({ sessionId, digestNote: buildDigestNote(sessionId) });
      const budgets = await computeBudget({ system: provisionalSystem, tools: TOOLS, maxTokens: MAX_OUTPUT_TOKENS });
      if (i === 0) {
        // The three numbers, at meta time, every turn. Previously the budget
        // was a constant nobody could see was wrong.
        log.info('llm',
          `budget: model context ${budgets.modelCtx} (${budgets.modelCtxSource}), capped at ${budgets.ceiling}, ` +
          `fixed overhead ${budgets.fixed} (system + ${TOOLS.length} tool schemas), output headroom ${budgets.headroom} ` +
          `=> history budget ${budgets.budget}`);
        emit({ type: 'budget', ...budgets });
      }

      if (!compactedThisTurn) {
        const compaction = await compactIfNeeded(sessionId, { budget: budgets.budget });
        if (compaction.compacted) {
          compactedThisTurn = true;
          emit({ type: 'compacted', ...compaction });
        } else if (compaction.warning || compaction.error) {
          // Not compacting is a decision with consequences for this turn, so
          // it is reported rather than inferred from the absence of a digest.
          log.warn('memory', compaction.warning || compaction.error);
        }
      }

      /*
       * The history that will actually be sent, with anything unsendable
       * removed. This is also the migration: a session written before D-7 can
       * hold blank assistant rows in SQLite, and they are repaired on read
       * here rather than in a one-shot script that only helps whoever runs it.
       */
      const raw = loadHistory(sessionId);
      const { history, dropped, reasons } = sanitizeHistory(raw);
      if (dropped) {
        log.warn('memory', `sanitized ${dropped} unsendable message(s) out of session ${shortId(sessionId)} before sending`,
          { reasons: [...new Set(reasons)] });
      }

      // Rebuilt after compaction, so a digest written just now is in the prompt.
      const system = buildSystemPrompt({ sessionId, digestNote: buildDigestNote(sessionId) });
      const requestTokens = budgets.fixed + estimateTokens(history);
      log.debug('llm', `request ~${requestTokens} tokens (fixed ${budgets.fixed}, history budget ${budgets.budget})`);
      if (requestTokens > budgets.ceiling) {
        log.warn('llm', `request ~${requestTokens} tokens is over the ${budgets.ceiling}-token self-imposed cap ` +
          `(model window is ${budgets.modelCtx}); sending anyway — compaction could not fold enough to help.`);
      }
      const callStart = Date.now();
      let res;
      try {
        res = await chatTurn({
          system,
          history,
          tools: TOOLS,
          maxTokens: MAX_OUTPUT_TOKENS,
        });
      } catch (err) {
        // The message shape is the usual cause of a provider 400, and it is
        // invisible from the error alone — so name it here rather than making
        // someone read the database to find out.
        log.error('llm', `iteration ${i + 1} failed after ${ms(callStart)} — ${err.message}`, {
          historyEntries: history.length,
          shapes: history.map((m) => (m.role === 'assistant'
            ? `assistant(text=${m.text ? 'str' : 'EMPTY'},calls=${m.toolCalls?.length || 0})`
            : m.role === 'tool' ? `tool(${(m.results || []).length})` : m.role)),
        });
        throw err;
      }
      log.debug('llm', `iteration ${i + 1}  ${ms(callStart)}  stop=${res.stopReason || '—'}  ` +
        `text=${res.text ? res.text.length + 'ch' : 'none'}  calls=${res.toolCalls?.length || 0}`);

      /*
       * D-7 — AN EMPTY COMPLETION IS AN ERROR PATH, NEVER A MESSAGE.
       *
       * §29 already rejected `!res.text && !res.toolCalls?.length`. That guard
       * is truthiness, and "
" is truthy — so a whitespace-only completion,
       * which this model emits when reasoning eats the budget, walked straight
       * past it. It became a real assistant row, rendered as a blank bubble,
       * and rode along in every subsequent request for the rest of the session.
       * That is the shape behind the blank rows in the incident screenshot.
       *
       * The adapter now normalises whitespace to '' and this checks emptiness
       * rather than falsiness, so the two agree on what "nothing" means. And
       * the outcome is unchanged in kind but stricter in fact: nothing is
       * appended, nothing is rendered, and the turn fails loudly.
       */
      if (isBlankText(res.text) && !res.toolCalls?.length) {
        // The adapter already retried this three times, warming the model up
        // between attempts when the finish reason said it was still loading.
        // Reaching here means it kept happening, so the message says so rather
        // than suggesting one more go at something already attempted.
        const err = new Error(
          `The model returned nothing — no text and no tool call (finish reason: ${res.stopReason || 'unknown'}), ` +
          'three times in a row. Nothing was written to the instance. This is usually a transient load on ' +
          "Ollama's side rather than a problem with your request."
        );
        // Tells the UI to offer Retry: the history is intact and unmodified, so
        // re-issuing this turn against it is a safe, meaningful thing to do.
        err.retryable = true;
        throw err;
      }

      // Whitespace never becomes stored text. Past this point res.text is
      // either real content or '', and '' is only legal beside a tool call.
      const assistantText = isBlankText(res.text) ? '' : res.text;
      const assistantSeq = appendMessage(sessionId, {
        role: 'assistant',
        text: assistantText,
        toolCalls: res.toolCalls,
      });
      if (assistantText) {
        indexMessage(sessionId, assistantSeq, 'assistant', assistantText);
        emit({ type: 'assistant_text', text: assistantText });
      }

      if (!res.toolCalls?.length) {
        // A6. One nudge per turn, carrying the one fact the model is missing.
        const stalled = !stallNudged && detectStalledTurn({
          assistantText, userText, mutatingCallCount,
        });
        if (stalled) {
          stallNudged = true;
          const note =
            `SYSTEM: that turn ended without calling a tool, so nothing happened on the instance and your ` +
            `question ("${stalled.asked.trim()}") was not shown to the user as a prompt they can answer. ` +
            `Approval is not requested in prose — it is requested BY calling the tool, which pauses and shows ` +
            `the user an approve/reject card carrying the exact arguments. You already have what you need. ` +
            `Call the tool now with the values you just described. If you are genuinely missing a value, call a ` +
            `read-only tool to get it instead of asking.`;
          appendMessage(sessionId, { role: 'user', text: note });
          emit({ type: 'nudged', reason: 'stalled', asked: stalled.asked.trim() });
          recordToolEvent(sessionId, {
            kind: 'guard', name: 'a6_stalled_turn', payload: { asked: stalled.asked.trim() },
            resultStatus: 'nudged', mutating: false, approval: null,
          });
          continue;
        }
        // Reconcile before 'done': the per-call sweeps were keyed on ids the
        // tools reported, and a composite builder or an SDK install produces
        // rows nothing named.
        if (mutatingCallCount > 0) {
          const reconciled = await reconcileTurn({ sessionId, sessionTitle, since: turnCaptureMark });
          if (reconciled) emit(reconciled);
        }
        log.info('agent', `turn done  session=${shortId(sessionId)}  ${ms(turnStart)}`);
        emit({ type: 'done' });
        return;
      }

      const results = [];
      for (const call of res.toolCalls) {
        const tool = toolMap.get(call.name);
        if (!tool) {
          results.push({ id: call.id, name: call.name, output: `Unknown tool: ${call.name}`, isError: true });
          continue;
        }
        emit({ type: 'tool_use', id: call.id, name: call.name, input: call.input, mutating: tool.mutating });
        const toolStart = Date.now();
        log.info('tool', `${call.name}${tool.mutating ? ' (mutating)' : ''}`, call.input);

        // Permission gate — the heart of the platform's safety model.
        let approval = null;
        if (tool.mutating && !agent.autoApprove) {
          const approvalId = crypto.randomUUID();
          emit({ type: 'approval_required', approvalId, name: call.name, input: call.input });
          log.warn('gate', `approval required: ${call.name} — waiting for the user`);
          const approved = await awaitApproval(state, approvalId);
          approval = approved ? 'approved' : 'rejected';
          log.info('gate', `${call.name} ${approved ? 'APPROVED' : 'REJECTED'} by the user`);
          emit({ type: 'approval_resolved', approvalId, approved });
          if (!approved) {
            const output = 'The user rejected this operation. Do not retry it; ask what they would like to change.';
            results.push({ id: call.id, name: call.name, output, isError: true });
            recordToolEvent(sessionId, {
              kind: 'tool_call', name: call.name, payload: call.input, result: output,
              resultStatus: 'rejected', mutating: true, approval,
            });
            emit({ type: 'tool_result', id: call.id, name: call.name, output, isError: true });
            continue;
          }
        } else if (tool.mutating) {
          approval = 'auto';
          log.warn('gate', `${call.name} ran UNGATED — auto-approve is on, nobody saw it`);
        }
        if (tool.mutating) mutatingCallCount += 1;

        const callCaptureMark = tool.mutating ? captureMark() : null;

        /*
         * WI-1 — what is this tool about to write, and what did the record hold
         * before it?
         *
         * `describeWrite` is called twice: once here with no result, to learn
         * the table and sys_id so the pre-write snapshot can be taken, and
         * again after execution to pick up the sys_id of anything created. A
         * tool without the hook skips both and is reported as self-verifying.
         */
        let preDescriptor = null;
        let beforeRecord = null;
        if (tool.mutating && typeof tool.describeWrite === 'function') {
          try { preDescriptor = tool.describeWrite(call.input || {}, null); }
          catch (err) { log.debug?.('verify', `describeWrite failed for ${call.name}: ${err.message}`); }
          beforeRecord = await snapshotBefore(preDescriptor);
        }

        try {
          const raw = await tool.execute(call.input || {});

          // The write landed on the instance. Whether it landed as REQUESTED is
          // a different question, and until this the answer was never asked.
          let verification = null;
          if (tool.mutating) {
            try {
              const descriptor = typeof tool.describeWrite === 'function'
                ? tool.describeWrite(call.input || {}, raw)
                : null;
              verification = await verifyMutation({ descriptor, result: raw, before: beforeRecord, toolName: call.name });
            } catch (err) {
              log.error('verify', `verification threw after ${call.name}: ${err.message}`, err);
              verification = {
                verified: false, status: 'unverified',
                summary: `the write could not be verified: ${err.message}`,
                applied: [], dropped: [], transformed: [],
                unverifiable: [{ field: '(all)', reason: err.message }], noOpSignal: null,
              };
            }
          }

          // A dropped field is not an exception — the call reached the instance
          // — but it must not read as plain success, or the model narrates a
          // write that did not happen. That is the defect, exactly.
          const failedWrite = isFailedWrite(verification);
          const output = attachVerification(truncate(JSON.stringify(raw ?? null, null, 1)), verification);
          results.push({ id: call.id, name: call.name, output, isError: failedWrite });
          // The result is the audit trail's payload, not a nicety: the sys_id
          // of whatever was just created exists here and nowhere else.
          recordToolEvent(sessionId, {
            kind: 'tool_call', name: call.name, payload: call.input, result: output,
            resultStatus: verification && verification.status !== 'applied' && verification.status !== 'self-verified'
              ? verification.status
              : 'ok',
            mutating: tool.mutating, approval,
          });
          // A-4 write path: a verification that FAILED is the most valuable
          // thing this agent ever learns about an instance, and it used to be
          // thrown away with the session.
          recordVerificationFailure(call.name, raw);
          if (failedWrite) {
            log.warn('tool', `${call.name} ${verification.status.toUpperCase()}  ${ms(toolStart)} — ${verification.summary}`);
          } else {
            log.info('tool', `${call.name} ok  ${ms(toolStart)}  ${output.length}ch`);
          }
          // The renderer derives its glyph from `verification`, never from the
          // absence of an exception (WI-6).
          emit({
            type: 'tool_result', id: call.id, name: call.name, output, isError: failedWrite,
            verification: verification && {
              status: verification.status, summary: verification.summary,
              dropped: verification.dropped, transformed: verification.transformed,
              unverifiable: verification.unverifiable, verifiedBy: verification.verifiedBy || null,
            },
          });

          // Transport capture. AFTER the result is emitted, because the change
          // has already landed and the user should see it succeed whether or
          // not it could be captured. Never throws — see agent/capture.js.
          if (tool.mutating) {
            const captured = await captureAfterTool({
              sessionId, sessionTitle, toolName: call.name,
              input: call.input || {}, result: raw, since: callCaptureMark,
            });
            if (captured) emit({ ...captured, id: call.id });
          }
        } catch (err) {
          const output = `Error: ${err.message}${err.detail ? ` — ${JSON.stringify(err.detail).slice(0, 300)}` : ''}`;
          log.error('tool', `${call.name} failed  ${ms(toolStart)} — ${err.message}`, err.detail || err);
          results.push({ id: call.id, name: call.name, output, isError: true });
          recordToolEvent(sessionId, {
            kind: 'tool_call', name: call.name, payload: call.input, result: output,
            resultStatus: 'error', mutating: tool.mutating, approval,
          });
          emit({ type: 'tool_result', id: call.id, name: call.name, output, isError: true });
        }
      }
      appendMessage(sessionId, { role: 'tool', results });
    }
    const stopped = '(Stopped: maximum agent iterations reached for this turn.)';
    appendMessage(sessionId, { role: 'assistant', text: stopped });
    emit({ type: 'assistant_text', text: stopped });
    // A turn that ran out of iterations still changed the instance, and its
    // changes still have to be captured.
    if (mutatingCallCount > 0) {
      const reconciled = await reconcileTurn({ sessionId, sessionTitle, since: turnCaptureMark });
      if (reconciled) emit(reconciled);
    }
    emit({ type: 'done' });
  } catch (err) {
    log.error('agent', `turn failed  session=${shortId(sessionId)}  ${ms(turnStart)} — ${err.message}`, err);
    // `retryable` means the history is intact and re-issuing the turn against
    // it is safe. The UI turns that into a Retry button; without the flag it
    // shows the error alone, because retrying a malformed request or a
    // rejected mutation just fails again more slowly.
    emit({ type: 'error', message: err.message, retryable: Boolean(err.retryable) });
  } finally {
    // ALWAYS — a window left open by a crashed turn would make every later
    // session's rows look contested, and the guard would stop capturing
    // anything at all.
    closeCaptureWindow(sessionId);
  }
}
