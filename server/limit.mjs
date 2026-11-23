/* Cloudflare's rate limiting binding (UNLOCK_LIMIT: 10 tries a minute per address and lock), kept in memory: one
   VPS, one process. */
export function rateLimiter({ limit, period }) {
  const hits = new Map();
  return {
    async limit({ key }) {
      const now = Date.now(), from = now - period * 1000;
      const list = (hits.get(key) || []).filter((t) => t > from);
      if (list.length >= limit) { hits.set(key, list); return { success: false }; }
      list.push(now);
      hits.set(key, list);
      if (hits.size > 10000) for (const [k, v] of hits) if (!v.some((t) => t > from)) hits.delete(k);
      return { success: true };
    },
  };
}
