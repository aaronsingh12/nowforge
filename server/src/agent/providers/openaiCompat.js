/**
 * One adapter, two providers: OpenAI and Ollama both speak the
 * /chat/completions wire format. Ollama exposes it at http://localhost:11434/v1
 * (tool calling requires a tool-capable local model, e.g. llama3.1, qwen2.5).
 */

import { withRetry, retryable, isRetryableStatus } from './retry.js';

const DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
};

/**
 * Neutral history -> /chat/completions messages.
 *
 * Every `content` is a STRING, never null, and that is not defensive tidying —
 * it is the fix for a session that could brick itself permanently. Measured
 * against gpt-oss:120b-cloud through Ollama's /v1 shim:
 *
 *   assistant content:null, WITH tool_calls   200
 *   assistant content:null, NO tool_calls     400  invalid message content
 *                                                  type: <nil>
 *   assistant content:'',   NO tool_calls     200
 *
 * The OpenAI spec allows a null content beside tool_calls, and Ollama honours
 * that — but it rejects a bare null outright. So one stored assistant turn
 * with no text and no tool calls made EVERY later turn in that session fail at
 * the wire, with an error naming neither the session nor the message. Coercing
 * here repairs histories that already contain one.
 */
function toOpenAiMessages(system, history) {
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const out = [{ role: 'system', content: str(system) }];
  for (const m of history) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: str(m.text) });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: str(m.text) };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool') {
      for (const r of m.results || []) {
        out.push({ role: 'tool', tool_call_id: r.id, content: str(r.output) });
      }
    }
  }
  return out;
}

export async function chat({ provider, apiKey, baseUrl, model, system, history, tools, maxTokens = 4096, decoding }) {
  const d = DEFAULTS[provider] || DEFAULTS.openai;
  const url = `${(baseUrl || d.baseUrl).replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: model || d.model,
    max_tokens: maxTokens,
    messages: toOpenAiMessages(system, history),
  };
  // A1 passthrough. Both knobs exist on this wire format, so both are sent.
  // Whether the backend HONOURS them is a separate question with a measured
  // answer — see agent/decoding.js. Nothing here may assume it did.
  if (decoding?.temperature !== undefined) body.temperature = decoding.temperature;
  if (decoding?.seed !== undefined) body.seed = decoding.seed;
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    body.tool_choice = 'auto';
  }
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const payload = JSON.stringify(body);
  const data = await withRetry(`${provider} chat`, async () => {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: payload });
    } catch (err) {
      // Nothing came back at all — the daemon is down, or the network blinked.
      throw retryable(new Error(`${provider} unreachable at ${url}: ${err.message}`));
    }
    const parsed = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(parsed?.error?.message || `${provider} API error (${res.status})`);
      err.status = res.status;
      // A 4xx is our malformed request; retrying it three times only makes a
      // clear bug slower to find.
      if (isRetryableStatus(res.status)) err.retryable = true;
      throw err;
    }
    return parsed;
  });

  const choice = data.choices?.[0];
  const msg = choice?.message || {};
  const toolCalls = (msg.tool_calls || []).map((tc) => {
    let input = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { /* keep {} */ }
    return { id: tc.id, name: tc.function?.name, input };
  });
  const text = msg.content || '';
  // Reasoning models (gpt-oss, o-series, deepseek-r1...) spend the max_tokens
  // budget on hidden reasoning tokens before emitting any content. When the
  // budget runs out first the API still answers 200 with an empty string, which
  // would otherwise surface as "the model returned nothing" much further down.
  if (!text && !toolCalls.length && choice?.finish_reason === 'length') {
    const reasoned = typeof msg.reasoning === 'string' && msg.reasoning.length > 0;
    throw new Error(
      `${provider} returned no content: the max_tokens budget (${maxTokens}) was exhausted before any output was produced` +
      (reasoned ? ' — the model spent it on reasoning tokens.' : '.') +
      ' Raise max_tokens, or pick a non-reasoning model in Settings.'
    );
  }
  return { text, toolCalls, stopReason: choice?.finish_reason };
}

export const openAiDefaults = DEFAULTS;
