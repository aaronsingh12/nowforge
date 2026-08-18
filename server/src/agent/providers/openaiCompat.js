/**
 * One adapter, two providers: OpenAI and Ollama both speak the
 * /chat/completions wire format. Ollama exposes it at http://localhost:11434/v1
 * (tool calling requires a tool-capable local model, e.g. llama3.1, qwen2.5).
 */

const DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
};

function toOpenAiMessages(system, history) {
  const out = [{ role: 'system', content: system }];
  for (const m of history) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || null };
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
        out.push({ role: 'tool', tool_call_id: r.id, content: r.output });
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
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || `${provider} API error (${res.status})`);
  }
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
