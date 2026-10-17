/**
 * Local Ask proxy for development. Vite proxies /api to it.
 * Credentials: ANTHROPIC_API_KEY, or an `ant auth login` profile (set ASK_USE_PROFILE=1).
 *
 *   npm run ask-server        # listens on :8787
 */
import http from 'node:http';
import { answer, askConfigured } from './ask-core.mjs';

const PORT = Number(process.env.PORT ?? 8787);

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
  if (req.method === 'GET' && req.url === '/api/health') return send(askConfigured() ? 200 : 503, { ok: askConfigured() });
  if (req.method !== 'POST' || req.url !== '/api/ask') return send(404, { error: 'not found' });
  try {
    const r = await answer(await readBody(req));
    return send(r.status, r.body);
  } catch {
    return send(400, { error: 'invalid JSON' });
  }
});

server.listen(PORT, () => console.log(`Ask proxy on http://localhost:${PORT}${askConfigured() ? '' : ' (no Anthropic credentials: /api/health reports 503)'}`));
