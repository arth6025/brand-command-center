/** Vercel function: POST /api/ask → Claude, answering only from the posted numbers. */
import { answer } from '../server/ask-core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const r = await answer(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body);
  return res.status(r.status).json(r.body);
}
