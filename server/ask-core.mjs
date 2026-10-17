/**
 * Shared Ask logic for the local proxy (server/ask-proxy.mjs) and the Vercel
 * functions (api/*.mjs). The model answers only from the computed numbers it
 * is given; the API key never leaves the server.
 */
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are the finance analyst inside a D2C brand's operating dashboard.
Answer ONLY from the JSON of computed numbers you are given. Never invent a number, never estimate one that is not in the data, and never write SQL.
If the data cannot answer the question, say which number is missing and which screen or connector would provide it.
Lead with the answer in one or two sentences, then the supporting numbers. Use Indian notation (₹, L, Cr). Keep it under 120 words.
End with "Sources:" and the screen names you used.`;

let client;

/** True when the server holds Anthropic credentials (otherwise the app answers locally). */
export function askConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ASK_USE_PROFILE);
}

/** @returns {Promise<{ status: number, body: object }>} */
export async function answer(payload) {
  const { question, context } = payload ?? {};
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
    return { status: 400, body: { error: 'question required (≤ 2000 chars)' } };
  }
  client ??= new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Computed numbers:\n${JSON.stringify(context)}\n\nQuestion: ${question}` }],
    });
    if (response.stop_reason === 'refusal') return { status: 200, body: { answer: 'The assistant declined this question.', model: response.model } };
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return { status: 200, body: { answer: text, model: response.model } };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { status: 401, body: { error: 'Anthropic credentials missing or invalid on the server' } };
    if (err instanceof Anthropic.RateLimitError) return { status: 429, body: { error: 'Rate limited, retry shortly' } };
    if (err instanceof Anthropic.APIError) return { status: 502, body: { error: `Claude API error ${err.status}` } };
    return { status: 500, body: { error: 'Ask proxy failed' } };
  }
}
