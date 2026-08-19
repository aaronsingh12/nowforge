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
import {
  compactIfNeeded, buildDigestNote, historyBudgetFor, estimateTokens, REQUEST_TOKEN_CEILING,
} from '../memory/compaction.js';
import { recordVerificationFailure } from '../memory/facts.js';
import { indexMessage } from '../memory/recall.js';

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

/** "Shall I ...?", "Let me know if you want me to ...", "Confirm and I will ...". */
const ASKS_TO_PROCEED = /(\bshall i\b|\bwould you like me to\b|\bdo you want me to\b|\blet me know if\b|\bshould i (?:go ahead|proceed|create|update|delete|apply)\b|\bconfirm(?:\s+and)?\b[^.?!]*\bi(?:'ll| will)\b|\bplease confirm\b|\bgive me the go[- ]ahead\b|\bwaiting for your (?:approval|confirmation|go)\b)/i;

/** The user told us to do something, rather than asking about something. */
const IS_DIRECTIVE = /\b(make|create|add|set|update|change|remove|delete|rename|build|configure|hide|show|require|attach|enable|disable|reorder|fix)\b/i;

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
 *   { type: 'compacted', ... } | { type: 'done' } | { type: 'error', message }
 */
export async function runTurn(sessionId, userText, emit) {
  const state = liveState(sessionId);
  const { agent } = getSettings();

  if (!loadSessionRow(sessionId)) createSession({ id: sessionId });

  let stallNudged = false;
  let mutatingCallCount = 0;
  const userSeq = appendMessage(sessionId, { role: 'user', text: userText });
  indexMessage(sessionId, userSeq, 'user', userText);
  const info = providerInfo();
  emit({ type: 'meta', ...info });
  const turnStart = Date.now();
  log.info('agent', `turn start  session=${shortId(sessionId)} ${info.provider}/${info.model}`,
    { message: userText.slice(0, 200) });

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // A-3: fold the oldest span into a digest before it costs a turn. Runs
      // every iteration because a single turn's tool results can be what
      // pushes a session over budget, not just the next user message.
      //
      // The budget is computed from what this turn will ACTUALLY send: the
      // system prompt and the 37 tool schemas are ~11k tokens of fixed
      // overhead, and not subtracting them is what let a "24k" allowance ship
      // a 35k request that failed half the time (§28).
      const provisionalSystem = buildSystemPrompt({ sessionId, digestNote: buildDigestNote(sessionId) });
      const { budget, overhead } = historyBudgetFor({ system: provisionalSystem, tools: TOOLS });
      const compaction = await compactIfNeeded(sessionId, { budget });
      if (compaction.compacted) emit({ type: 'compacted', ...compaction });

      const history = loadHistory(sessionId);
      // Rebuilt after compaction, so a digest written just now is in the prompt.
      const system = buildSystemPrompt({ sessionId, digestNote: buildDigestNote(sessionId) });
      const requestTokens = overhead + estimateTokens(history);
      log.debug('llm', `request ~${requestTokens} tokens (overhead ${overhead}, history budget ${budget})`);
      if (requestTokens > REQUEST_TOKEN_CEILING) {
        // Compaction could not get under the line — the recent turns alone are
        // too big. Say so before the call rather than after it fails.
        log.warn('llm', `request ~${requestTokens} tokens is past the measured-reliable ${REQUEST_TOKEN_CEILING}; ` +
          'this backend gets unreliable above it (50% at ~28k)');
      }
      const callStart = Date.now();
      let res;
      try {
        res = await chatTurn({
          system,
          history,
          tools: TOOLS,
          maxTokens: 4096,
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

      // An assistant turn with no text AND no tool calls is not a turn — it is
      // the model having returned nothing. Storing it poisoned the session:
      // replayed, it became `content: null` with no tool_calls, which this
      // backend rejects outright, so every later turn failed at the wire with
      // an error naming neither the session nor the message. Report it here,
      // where the cause is still visible, and leave the history usable.
      if (!res.text && !res.toolCalls?.length) {
        throw new Error(
          `The model returned an empty turn — no text and no tool call (finish reason: ${res.stopReason || 'unknown'}). ` +
          'Nothing was written to the instance. Send the message again; if it keeps happening, ' +
          'the model in Settings may not be answering reliably.'
        );
      }

      const assistantSeq = appendMessage(sessionId, {
        role: 'assistant',
        text: res.text || '',
        toolCalls: res.toolCalls,
      });
      if (res.text) {
        indexMessage(sessionId, assistantSeq, 'assistant', res.text);
        emit({ type: 'assistant_text', text: res.text });
      }

      if (!res.toolCalls?.length) {
        // A6. One nudge per turn, carrying the one fact the model is missing.
        const stalled = !stallNudged && detectStalledTurn({
          assistantText: res.text, userText, mutatingCallCount,
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

        try {
          const raw = await tool.execute(call.input || {});
          const output = truncate(JSON.stringify(raw ?? null, null, 1));
          results.push({ id: call.id, name: call.name, output, isError: false });
          // The result is the audit trail's payload, not a nicety: the sys_id
          // of whatever was just created exists here and nowhere else.
          recordToolEvent(sessionId, {
            kind: 'tool_call', name: call.name, payload: call.input, result: output,
            resultStatus: 'ok', mutating: tool.mutating, approval,
          });
          // A-4 write path: a verification that FAILED is the most valuable
          // thing this agent ever learns about an instance, and it used to be
          // thrown away with the session.
          recordVerificationFailure(call.name, raw);
          log.info('tool', `${call.name} ok  ${ms(toolStart)}  ${output.length}ch`);
          emit({ type: 'tool_result', id: call.id, name: call.name, output, isError: false });
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
    emit({ type: 'done' });
  } catch (err) {
    log.error('agent', `turn failed  session=${shortId(sessionId)}  ${ms(turnStart)} — ${err.message}`, err);
    emit({ type: 'error', message: err.message });
  }
}
