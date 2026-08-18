import crypto from 'node:crypto';
import { chatTurn, providerInfo } from './providers/index.js';
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
import { compactIfNeeded, buildDigestNote } from '../memory/compaction.js';
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

  const userSeq = appendMessage(sessionId, { role: 'user', text: userText });
  indexMessage(sessionId, userSeq, 'user', userText);
  emit({ type: 'meta', ...providerInfo() });

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // A-3: fold the oldest span into a digest before it costs a turn. Runs
      // every iteration because a single turn's tool results can be what
      // pushes a session over budget, not just the next user message.
      const compaction = await compactIfNeeded(sessionId);
      if (compaction.compacted) emit({ type: 'compacted', ...compaction });

      const history = loadHistory(sessionId);
      const res = await chatTurn({
        system: buildSystemPrompt({ sessionId, digestNote: buildDigestNote(sessionId) }),
        history,
        tools: TOOLS,
        maxTokens: 4096,
      });

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

        // Permission gate — the heart of the platform's safety model.
        let approval = null;
        if (tool.mutating && !agent.autoApprove) {
          const approvalId = crypto.randomUUID();
          emit({ type: 'approval_required', approvalId, name: call.name, input: call.input });
          const approved = await awaitApproval(state, approvalId);
          approval = approved ? 'approved' : 'rejected';
          emit({ type: 'approval_resolved', approvalId, approved });
          if (!approved) {
            const output = 'The user rejected this operation. Do not retry it; ask what they would like to change.';
            results.push({ id: call.id, name: call.name, output, isError: true });
            recordToolEvent(sessionId, {
              kind: 'tool_call', name: call.name, payload: call.input,
              resultStatus: 'rejected', mutating: true, approval,
            });
            emit({ type: 'tool_result', id: call.id, name: call.name, output, isError: true });
            continue;
          }
        } else if (tool.mutating) {
          approval = 'auto';
        }

        try {
          const raw = await tool.execute(call.input || {});
          const output = truncate(JSON.stringify(raw ?? null, null, 1));
          results.push({ id: call.id, name: call.name, output, isError: false });
          recordToolEvent(sessionId, {
            kind: 'tool_call', name: call.name, payload: call.input,
            resultStatus: 'ok', mutating: tool.mutating, approval,
          });
          // A-4 write path: a verification that FAILED is the most valuable
          // thing this agent ever learns about an instance, and it used to be
          // thrown away with the session.
          recordVerificationFailure(call.name, raw);
          emit({ type: 'tool_result', id: call.id, name: call.name, output, isError: false });
        } catch (err) {
          const output = `Error: ${err.message}${err.detail ? ` — ${JSON.stringify(err.detail).slice(0, 300)}` : ''}`;
          results.push({ id: call.id, name: call.name, output, isError: true });
          recordToolEvent(sessionId, {
            kind: 'tool_call', name: call.name, payload: call.input,
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
    emit({ type: 'error', message: err.message });
  }
}
