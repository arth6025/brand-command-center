/**
 * Ask proxy: forwards a question plus the page's computed numbers to Claude.
 * The API key stays server-side (ANTHROPIC_API_KEY or an `ant auth login`
 * profile). The model is told to answer only from the numbers it is given.
 *
 *   npm run ask-server        # listens on :8787, Vite proxies /api to it
 */
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT ?? 8787);
const client = new Anthropic();

const SYSTEM = `You are the finance analyst inside a D2C brand's operating dashboard.
Answer ONLY from the JSON of computed numbers you are given. Never invent a number, never estimate one that is not in the data, and never write SQL.
If the data cannot answer the question, say which number is missing and which screen or connector would provide it.
Lead with the answer in one or two sentences, then the supporting numbers. Use Indian notation (₹, L, Cr). Keep it under 120 words.
End with "Sources:" and the screen names you used.`;

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/api/health') return send(200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/api/ask') return send(404, { error: 'not found' });
  try {
    const { question, context } = await readBody(req);
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) return send(400, { error: 'question required (≤ 2000 chars)' });
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Computed numbers:\n${JSON.stringify(context)}\n\nQuestion: ${question}` }],
    });
    if (response.stop_reason === 'refusal') return send(200, { answer: 'The assistant declined this question.', model: response.model });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return send(200, { answer: text, model: response.model });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return send(401, { error: 'Anthropic credentials missing or invalid on the server' });
    if (err instanceof Anthropic.RateLimitError) return send(429, { error: 'Rate limited, retry shortly' });
    if (err instanceof Anthropic.APIError) return send(502, { error: `Claude API error ${err.status}` });
    return send(500, { error: 'Ask proxy failed' });
  }
});

server.listen(PORT, () => console.log(`Ask proxy on http://localhost:${PORT}`));
