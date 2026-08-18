const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

function toAnthropicMessages(history) {
  const out = [];
  for (const m of history) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
    } else if (m.role === 'assistant') {
      const content = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const tc of m.toolCalls || []) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      if (content.length) out.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: (m.results || []).map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.output,
          ...(r.isError ? { is_error: true } : {}),
        })),
      });
    }
  }
  return out;
}

export async function chat({ apiKey, model, system, history, tools, maxTokens = 4096, decoding }) {
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens,
    system,
    messages: toAnthropicMessages(history),
  };
  // A1 passthrough. This API has a temperature and no seed, so the seed is
  // dropped here rather than silently pretended at — `DECODING_SENT` records
  // that, so a caller can report what it actually got.
  if (decoding?.temperature !== undefined) body.temperature = decoding.temperature;
  if (tools?.length) {
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic API error (${res.status})`);
  }
  let text = '';
  const toolCalls = [];
  for (const block of data.content || []) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input });
  }
  return { text, toolCalls, stopReason: data.stop_reason };
}

export const anthropicDefaults = { model: DEFAULT_MODEL };
