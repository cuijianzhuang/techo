import { Hono } from "hono";
import { UA } from "./ua";
import { IMAGE_TYPES, MAX_PHOTO } from "./entries";
import { type HonoEnv, bad } from "./env";

export const admin = new Hono<HonoEnv>();

/* ---------------- 🔍 NeoDB: a book, a film or an album, looked up ----------------
   In NeoDB (neodb.social), an open catalogue of books, films and music: a link (NeoDB's own, or a page it
   knows how to take in: Goodreads, IMDb, Spotify …) is fetched from it, anything else searched in it. An ISBN
   NeoDB doesn't know is tried at Open Library. What comes back is the few fields the page's cards use. */
const NEODB = "https://neodb.social";
type Found = { kind: "book" | "film" | "music"; title: string; year?: string; author?: string; publisher?: string; isbn?: string;
  director?: string; cast?: string; genre?: string; artist?: string; rating?: number; brief?: string; cover?: string; url?: string; series?: boolean };
const names = (v: unknown, n = 3) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(typeof x === "object" && x ? (x as { name?: string }).name ?? "" : x)).filter(Boolean).slice(0, n).join(" / ");
function fromNeodb(x: Record<string, unknown>, base = NEODB): Found | null {
  const cat = String(x.category || x.type || "").toLowerCase();
  const kind = /book|edition/.test(cat) ? "book" : /movie|tv|season|episode/.test(cat) ? "film" : /music|album/.test(cat) ? "music" : null;
  if (!kind) return null;
  const s = (k: string) => (x[k] == null ? "" : String(x[k]).trim());
  const brief = s("description") || s("brief");
  const url = s("url"), abs = /^https?:/.test(url) ? url : url ? base + url : s("id");
  return {
    kind, title: s("display_title") || s("title"), year: s("year") || s("pub_year") || s("release_date").slice(0, 4) || undefined,
    author: names(x.author) || undefined, publisher: s("pub_house") || undefined, isbn: s("isbn") || undefined,
    director: names(x.director) || undefined, cast: names(x.actor) || undefined, genre: names(x.genre) || undefined,
    artist: names(x.artist) || undefined, rating: typeof x.rating === "number" ? Math.round(x.rating * 10) / 10 : undefined,
    brief: brief ? [...brief.replace(/\s+/g, " ")].slice(0, 120).join("") : undefined, cover: s("cover_image_url") || undefined, url: abs || undefined,
    series: /tv|season|episode/.test(cat) || undefined,
  };
}

admin.post("/api/admin/lookup", async (c) => {
  const o = (await c.req.json().catch(() => null)) as { q?: unknown; kind?: unknown } | null;
  const q = typeof o?.q === "string" ? o.q.trim().slice(0, 300) : "";
  const kind = o?.kind === "film" || o?.kind === "music" ? o.kind : "book";
  if (!q) return bad(c, 400, "写书名 / 片名 / 专辑名，或者 NeoDB 链接");
  const neodb = (c.env.NEODB_URL || NEODB).replace(/\/+$/, "");
  try {
    if (/^https?:\/\//i.test(q)) {
      const r = await fetch(`${neodb}/api/catalog/fetch?url=${encodeURIComponent(q)}`, { headers: UA });
      if (r.status === 202) return c.json({ items: [], pending: true, message: "NeoDB 正在收录这一条，过十几秒再点一次查找" });
      if (!r.ok) return bad(c, 404, `NeoDB 没认出这个链接（${r.status}）`);
      const it = fromNeodb((await r.json()) as Record<string, unknown>, neodb);
      return c.json({ items: it ? [it] : [] });
    }
    // (films: searched in everything, then the films and series kept — movie and tv are two categories there)
    const r = await fetch(`${neodb}/api/catalog/search?query=${encodeURIComponent(q)}${kind === "film" ? "" : "&category=" + kind}&page=1`, { headers: UA });
    const items = (r.ok ? (((await r.json()) as { data?: Record<string, unknown>[] }).data || []).map((x) => fromNeodb(x, neodb)) : [])
      .filter((x): x is Found => !!x && x.kind === kind).slice(0, 8);
    // an ISBN NeoDB doesn't have: Open Library
    const isbn = q.replace(/[-\s]/g, "");
    if (!items.length && kind === "book" && /^(\d{9}[\dX]|\d{13})$/i.test(isbn)) {
      const ol = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, { headers: UA });
      if (ol.ok) {
        const b = (await ol.json()) as { title?: string; publishers?: string[]; publish_date?: string };
        items.push({ kind: "book", title: b.title || isbn, isbn, publisher: (b.publishers || [])[0], year: (b.publish_date || "").match(/\d{4}/)?.[0],
          cover: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, url: `https://openlibrary.org/isbn/${isbn}` });
      }
    }
    return c.json({ items });
  } catch (e) {
    console.error("lookup", e);
    return bad(c, 500, "查的时候出错了（NeoDB 连不上？），稍后再试");
  }
});
/* a cover found by 🔍 NeoDB, kept as the journal's own picture (p/<uuid>) so the page doesn't lean on another site */
admin.post("/api/admin/cover", async (c) => {
  const o = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof o?.url === "string" ? o.url.trim() : "";
  if (!/^https:\/\/[^\s]+$/i.test(url)) return bad(c, 400, "封面地址要以 https:// 开头");
  const r = await fetch(url, { headers: { "User-Agent": UA["User-Agent"] } }).catch(() => null);
  if (!r || !r.ok) return bad(c, 404, "封面没取到");
  const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(), ext = IMAGE_TYPES[type];
  if (!ext) return bad(c, 415, "封面不是图片");
  const buf = await r.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_PHOTO) return bad(c, 413, "封面太大了");
  const key = `p/${crypto.randomUUID()}.${ext}`;
  await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key }, 201);
});
