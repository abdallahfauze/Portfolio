// Visit counter for the portfolio footer dial.
//
// Runs as a Vercel Function on the portfolio's own domain, so the counter no
// longer depends on a third-party counting service (which was slow, failed
// often and is blocked by many ad blockers, leaving the dial hidden).
//
// Storage: Upstash Redis over its REST API, added to the Vercel project from
// the Marketplace (Storage > Upstash for Redis). The integration injects the
// URL/token below as environment variables; no npm package is needed.
//
//   POST /api/visits -> counts this visit and returns {"value": <new total>}
//   GET  /api/visits -> returns {"value": <current total>} without counting
//
// The first request seeds the count with VISITS_SEED (the total carried over
// from the old counter) if the key doesn't exist yet; after that it is never
// touched again.

const KEY = 'portfolio:visits';
const DEFAULT_SEED = 434;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function pipeline(cfg, commands) {
  const r = await fetch(cfg.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error('Redis HTTP ' + r.status);
  const out = await r.json();
  const failed = out.find((x) => x && x.error);
  if (failed) throw new Error('Redis: ' + failed.error);
  return out.map((x) => x.result);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cfg = redisConfig();
  if (!cfg) return res.status(503).json({ error: 'Counter storage is not configured' });

  const seed = String(parseInt(process.env.VISITS_SEED, 10) || DEFAULT_SEED);
  try {
    const results = await pipeline(cfg, [
      ['SET', KEY, seed, 'NX'],
      req.method === 'POST' ? ['INCR', KEY] : ['GET', KEY],
    ]);
    const value = parseInt(results[1], 10);
    if (!Number.isFinite(value)) throw new Error('Unexpected counter value');
    return res.status(200).json({ value });
  } catch (err) {
    console.error('visit counter failed:', err.message);
    return res.status(502).json({ error: 'Counter unavailable' });
  }
};
