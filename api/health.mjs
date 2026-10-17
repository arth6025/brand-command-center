/** Vercel function: GET /api/health → 200 when Ask has Anthropic credentials, 503 otherwise (the app then answers locally). */
import { askConfigured } from '../server/ask-core.mjs';

export default function handler(_req, res) {
  const ok = askConfigured();
  return res.status(ok ? 200 : 503).json({ ok });
}
