import crypto from 'node:crypto';
import { chatTurn, providerInfo } from './providers/index.js';
import { TOOLS, toolMap } from './tools.js';
import { buildSystemPrompt } from './prompts.js';
import { getSettings } from '../config/store.js';

/**
 * The backbone, modeled on Claude Code / opencode:
 *   session state → provider-agnostic agent loop → tool registry →
 *   permission gate on mutations → streamed events to the UI.
 *
 * Neutral history format (translated per-provider by the adapters):
 *   { role: 'user', text }
 *   { role: 'assistant', text, toolCalls: [{id, name, input}] }
 *   { role: 'tool', results: [{id, name, output, isError}] }
 */

const sessions = new Map(); // sessionId -> { history, pending: Map<approvalId, resolver> }

export function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { history: [], pending: new Map() });
  return sessions.get(id);
}

export function resolveApproval(sessionId, approvalId, approved) {
  const s = sessions.get(sessionId);
  const resolver = s?.pending.get(approvalId);
  if (!resolver) return false;
  s.pending.delete(approvalId);
  resolver(Boolean(approved));
  return true;
}

const MAX_ITERATIONS = 15;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const RESULT_CHAR_LIMIT = 8000;

function truncate(str) {
  return str.length > RESULT_CHAR_LIMIT ? str.slice(0, RESULT_CHAR_LIMIT) + '\n…[truncated]' : str;
}

function awaitApproval(session, approvalId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.pending.delete(approvalId);
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);
    session.pending.set(approvalId, (approved) => {
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
 *   { type: 'done' } | { type: 'error', message }
 */
export async function runTurn(sessionId, userText, emit) {
  const session = getSession(sessionId);
  const { agent } = getSettings();
  session.history.push({ role: 'user', text: userText });
  emit({ type: 'meta', ...providerInfo() });

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await chatTurn({
        system: buildSystemPrompt(),
        history: session.history,
        tools: TOOLS,
        maxTokens: 4096,
      });

      session.history.push({ role: 'assistant', text: res.text || '', toolCalls: res.toolCalls });
      if (res.text) emit({ type: 'assistant_text', text: res.text });

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
        if (tool.mutating && !agent.autoApprove) {
          const approvalId = crypto.randomUUID();
          emit({ type: 'approval_required', approvalId, name: call.name, input: call.input });
          const approved = await awaitApproval(session, approvalId);
          emit({ type: 'approval_resolved', approvalId, approved });
          if (!approved) {
            const output = 'The user rejected this operation. Do not retry it; ask what they would like to change.';
            results.push({ id: call.id, name: call.name, output, isError: true });
            emit({ type: 'tool_result', id: call.id, name: call.name, output, isError: true });
            continue;
          }
        }

        try {
          const raw = await tool.execute(call.input || {});
          const output = truncate(JSON.stringify(raw ?? null, null, 1));
          results.push({ id: call.id, name: call.name, output, isError: false });
          emit({ type: 'tool_result', id: call.id, name: call.name, output, isError: false });
        } catch (err) {
          const output = `Error: ${err.message}${err.detail ? ` — ${JSON.stringify(err.detail).slice(0, 300)}` : ''}`;
          results.push({ id: call.id, name: call.name, output, isError: true });
          emit({ type: 'tool_result', id: call.id, name: call.name, output, isError: true });
        }
      }
      session.history.push({ role: 'tool', results });
    }
    emit({ type: 'assistant_text', text: '(Stopped: maximum agent iterations reached for this turn.)' });
    emit({ type: 'done' });
  } catch (err) {
    emit({ type: 'error', message: err.message });
  }
}
