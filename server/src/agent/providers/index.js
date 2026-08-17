import { getSettings } from '../../config/store.js';
import * as anthropic from './anthropic.js';
import * as openaiCompat from './openaiCompat.js';

export function providerInfo() {
  const { llm } = getSettings();
  const model =
    llm.model ||
    (llm.provider === 'anthropic'
      ? anthropic.anthropicDefaults.model
      : (openaiCompat.openAiDefaults[llm.provider]?.model || openaiCompat.openAiDefaults.openai.model));
  return { provider: llm.provider, model };
}

/** Full agent turn with tool support. history uses the neutral format (see orchestrator). */
export async function chatTurn({ system, history, tools, maxTokens }) {
  const { llm } = getSettings();
  if (llm.provider === 'anthropic') {
    if (!llm.apiKey) throw new Error('Anthropic API key not set. Add it in Settings.');
    return anthropic.chat({ apiKey: llm.apiKey, model: llm.model, system, history, tools, maxTokens });
  }
  if (llm.provider === 'openai' || llm.provider === 'ollama') {
    if (llm.provider === 'openai' && !llm.apiKey) throw new Error('OpenAI API key not set. Add it in Settings.');
    return openaiCompat.chat({
      provider: llm.provider,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
      system,
      history,
      tools,
      maxTokens,
    });
  }
  throw new Error(`Unknown LLM provider: ${llm.provider}`);
}

/** One-shot text completion (no tools) — used by the flow blueprint designer. */
export async function chatOnce({ system, user, maxTokens = 2048 }) {
  const res = await chatTurn({
    system,
    history: [{ role: 'user', text: user }],
    tools: [],
    maxTokens,
  });
  return res.text;
}
