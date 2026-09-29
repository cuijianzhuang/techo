import { isLocal } from "./auth";
import type { C, Env } from "./env";
import { etagOf, hasCopy } from "./etag";

/* The edge cache: what a reader who holds no keys is sent (the book's page, /api/entries), kept in the Workers
   Cache API so that a request the cache can answer asks the database for one row (the data version) instead of
   the whole table.

   The key is the deploy (a new deploy is new code and new file versions), the data version and the request:
   https://cache.internal/<name>/<deploy>/<version>?<view, limit, before>
   The version is a row of `settings` (key '_v': loadSettings only reads the keys it knows, so nobody sees it),
   made new by bumpVersion after every write that a reader can see (pages, locks, settings). A copy is kept for
   an hour at most, whatever happens to the version, for what changes the database behind the Worker's back.
   Requests that carry keys (a reader who opened a locked page) are answered as ever, and not kept: what they
   see depends on the keys. */

const TTL = 3600;

/** what the readers' data is at now; "0" for a database that has never been written to (or can't be read) */
export async function dataVersion(env: Env): Promise<string> {
  try {
    const r = await env.DB.prepare("SELECT value FROM settings WHERE key='_v'").first<{ value: string }>();
    return r?.value || "0";
  } catch { return "0"; }
}

/** after a write a reader can see: every copy kept so far is out of date. Failing to say so is logged, not thrown:
    the write happened, and the copies are gone within the hour anyway. */
export async function bumpVersion(env: Env): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('_v', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).run();
  } catch (e) { console.error("cache: the data version was not changed, cached pages may be an hour old:", e); }
}

export type Built = { body: string | ArrayBuffer; headers: Headers; status?: number };

function answer(req: Request, body: string | ArrayBuffer, headers: Headers, etag: string, how: string): Response {
  headers.set("ETag", etag);
  headers.set("X-Cache", how);
  headers.delete("content-length");
  if (hasCopy(req, etag)) {
    headers.delete("content-type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

/** `build` makes the answer (or a Response that is sent as it is and never kept); `name` and `params` say which
    answer it is (params: only what changes it, in a fixed order) */
export async function cached(c: C, name: string, params: string, build: () => Promise<Built | Response>): Promise<Response> {
  const req = c.req.raw;
  const store = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  // (a local `wrangler dev` builds every time, so an edited page is seen at once; CACHE_LOCAL=1 tries the cache there)
  const usable = store && !c.req.header("x-techo-keys") && (!isLocal(c) || c.env.CACHE_LOCAL === "1");
  if (!usable) {
    const made = await build();
    if (made instanceof Response) return made;
    return answer(req, made.body, made.headers, await etagOf(made.body), "BYPASS");
  }
  const key = new Request(`https://cache.internal/${name}/${c.env.CF_VERSION_METADATA?.id || "dev"}/${await dataVersion(c.env)}?${params}`);
  const hit = await store.match(key);
  if (hit) {
    const headers = new Headers(JSON.parse(decodeURIComponent(hit.headers.get("x-client-headers") || "[]")) as [string, string][]);
    return answer(req, await hit.arrayBuffer(), headers, hit.headers.get("etag") || "", "HIT");
  }
  const made = await build();
  if (made instanceof Response) return made;
  const etag = await etagOf(made.body);
  if ((made.status ?? 200) === 200) {
    const copy = new Response(made.body, {
      headers: {
        "content-type": made.headers.get("content-type") || "application/octet-stream",
        etag,
        "cache-control": `public, max-age=${TTL}`,
        "x-client-headers": encodeURIComponent(JSON.stringify([...made.headers, ["etag", etag]])),
      },
    });
    const put = store.put(key, copy).catch((e) => console.error("cache: not kept:", e));
    try { c.executionCtx.waitUntil(put); } catch { await put; }
  }
  return answer(req, made.body, made.headers, etag, "MISS");
}
