import { Hono } from "hono";
import { b64url, enc, hmac, sameText } from "./crypto";
import { type EntriesView, rowToEntry, selectEntries } from "./entries";
import { type C, type Env, type HonoEnv, bad } from "./env";
import { bumpVersion, cached } from "./cache";
import { excerpt } from "./text";

export const pub = new Hono<HonoEnv>();
export const admin = new Hono<HonoEnv>();

/* ---------------- locks: the whole book, or one day, behind a password ----------------
   A 口令 gate, checked here: a locked page leaves the Worker only as its date until the reader has given the
   password. Passwords are kept as PBKDF2 hashes in `locks`, by scope: an entry id (that page, locked on its
   own), 'd-YYYY-MM-DD' (every page of that day — set from 随手记 before the day's page is even written) or
   'book'. A page is kept by the first of those it has; a page with its own or its day's lock needs that
   password even when the book is open. Giving the right password
   earns a signed token, keyed by the lock's hash (so changing the password retires it); the reader's tab
   keeps it in sessionStorage and sends it back in X-Techo-Keys (or ?k= for a photo). */

const LOCK_ITER = 10_000;               // Workers count CPU time; the rate limit does the real work
const UNLOCK_HOURS = 12;
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iter: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${LOCK_ITER}$${b64url(salt.buffer as ArrayBuffer)}$${b64url(await pbkdf2(password, salt, LOCK_ITER))}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const m = /^pbkdf2-sha256\$(\d+)\$([\w-]+)\$([\w-]+)$/.exec(stored);
  if (!m) return false;
  return sameText(b64url(await pbkdf2(password, unb64(m[2]), Number(m[1]))), m[3]);
}
/** scope → hash. Before the locks table exists (migration not run yet) nothing is locked. */
export async function loadLocks(env: Env): Promise<Map<string, string>> {
  try {
    const { results } = await env.DB.prepare("SELECT scope, hash FROM locks").all<{ scope: string; hash: string }>();
    return new Map(results.map((r) => [r.scope, r.hash]));
  } catch { return new Map(); }
}
/** "<scope>.<expiry ms>.<hmac>" */
async function unlockToken(scope: string, hash: string): Promise<string> {
  const body = `${scope}.${Date.now() + UNLOCK_HOURS * 3_600_000}`;
  return `${body}.${b64url(await hmac("unlock:" + hash, body))}`;
}
/** the scopes these tokens open */
export async function openScopes(locks: Map<string, string>, tokens: string[]): Promise<Set<string>> {
  const open = new Set<string>();
  for (const t of tokens.slice(0, 64)) {
    const m = /^(([\w-]{1,64})\.(\d{13,}))\.([\w-]+)$/.exec(t);
    if (!m || Number(m[3]) < Date.now()) continue;
    const hash = locks.get(m[2]);
    if (hash && sameText(b64url(await hmac("unlock:" + hash, m[1])), m[4])) open.add(m[2]);
  }
  return open;
}

const keysOf = (c: C) => (c.req.header("x-techo-keys") || "").split(/[\s,]+/).filter(Boolean);
/** which lock keeps this entry: its own, else its day's, else the book's */
export const dayScope = (date: string) => "d-" + date;
export const lockOf = (locks: Map<string, string>, e: { id: string; date: string }) =>
  locks.has(e.id) ? e.id : locks.has(dayScope(e.date)) ? dayScope(e.date) : locks.has("book") ? "book" : null;

type LockedStub = { id: string; date: string; locked: "book" | "day"; scope: string };

/* What a page of the site needs of the pages, so it needn't be sent all of them whole (and what is asked of the
   database for each: entries.ts selectEntries):
   "full" every field (the book: it lays out every word), "index" the pages without their words, but for a line of
   them (the timeline), "map" only the pages with a place, and only what the map draws, "cards" the words only of
   pages that hold a card or a NetEase link, and the date and title of the rest (the shelf, the ticket folder and
   the bills, which read the cards). A locked page is only its date in every view. */
export const isView = (v: string): v is EntriesView => v === "full" || v === "index" || v === "map" || v === "cards";
type Row = Record<string, unknown>;
function shape(r: Row, view: EntriesView, lockScope?: string) {
  const lock = lockScope ? { lock: lockScope } : {};
  const id = String(r.id), date = String(r.date), title = String(r.title), createdAt = Number(r.created_at);
  if (view === "map") return { id, date, title, place: String(r.place ?? ""), geo: String(r.geo ?? ""), weather: String(r.weather ?? ""), createdAt, ...lock };
  if (view === "cards") return { id, date, title, createdAt, body: String(r.body ?? ""), ...lock };
  const e = rowToEntry(r);
  if (view === "full") return { ...e, ...lock };
  return {
    id, date, title, latin: e.latin, stamp: e.stamp, place: e.place, geo: e.geo, weather: e.weather,
    stickers: e.stickers, photoKey: e.photoKey, photoCap: e.photoCap, createdAt, excerpt: excerpt(e.body), ...lock,
  };
}

/** published pages as a reader may see them: a locked page they haven't opened is only its date. With `page`, a
    stretch of them, newest first: `limit` of them, those before the page `before` (the last one of the stretch
    before), and what the whole list is (how many, how many days, from when to when, whether more come before) */
export async function readerEntries(env: Env, tokens: string[], view: EntriesView = "full", page?: { limit: number; before?: string }) {
  const [{ rows, meta }, locks] = await Promise.all([selectEntries(env, view, page), loadLocks(env)]);
  const open = await openScopes(locks, tokens);
  const out = rows.map((r): Row | LockedStub => {
    const id = String(r.id), date = String(r.date), scope = lockOf(locks, { id, date });
    if (!scope) return shape(r, view);
    if (!open.has(scope)) return { id, date, locked: scope === "book" ? "book" : "day", scope };
    return shape(r, view, scope);       // open: the page says which key opened it (for its photo)
  });
  return { entries: out, lock: { book: locks.has("book"), open: [...open] }, ...(meta ? { page: meta } : {}) };
}

/* what the reader sees, and that it can be kept: the answer is private (it depends on the keys the tab sends) and
   the browser asks before using its copy, which is a 304 while nothing has been written or locked */
pub.get("/api/entries", async (c) => {
  const view = c.req.query("view") || "full";
  if (!isView(view)) return bad(c, 400, "view 只能是 index、map 或 cards");
  // ?limit=100 (at most 500) makes it a stretch, newest first; &before=<id> the stretch before that page
  const limit = c.req.query("limit"), before = c.req.query("before") || undefined;
  if (limit !== undefined && !/^\d{1,3}$/.test(limit)) return bad(c, 400, "limit 是 1 到 500");
  const n = limit === undefined ? (before ? 100 : 0) : Number(limit);
  if (limit !== undefined && (n < 1 || n > 500)) return bad(c, 400, "limit 是 1 到 500");
  const h = new Headers({ "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "private, no-cache", Vary: "x-techo-keys" });
  const page = n ? { limit: n, before } : undefined;
  // kept at the edge for a reader without keys: the answer is the view and the stretch asked for (and nothing else)
  const params = new URLSearchParams({ view, ...(n ? { limit: String(n) } : {}), ...(n && before ? { before } : {}) }).toString();
  return cached(c, "entries", params, async () => ({ body: JSON.stringify(await readerEntries(c.env, keysOf(c), view, page)), headers: h }));
});

/* the password for the book ('book') or a day (its entry id): right → a token; 10 guesses a minute */
pub.post("/api/unlock", async (c) => {
  const o = (await c.req.json().catch(() => null)) as { scope?: unknown; password?: unknown } | null;
  const scope = typeof o?.scope === "string" ? o.scope : "", password = typeof o?.password === "string" ? o.password : "";
  if (!/^[\w-]{1,64}$/.test(scope) || !password || password.length > 128) return bad(c, 400, "请输入口令");
  if (c.env.UNLOCK_LIMIT) {
    const ip = c.req.header("cf-connecting-ip") || "local";
    const { success } = await c.env.UNLOCK_LIMIT.limit({ key: `${ip}:${scope}` });
    if (!success) return c.json({ error: "试得太多了，过一分钟再来" }, 429);
  }
  const hash = (await loadLocks(c.env)).get(scope);
  if (!hash) return bad(c, 404, "这里没有上锁");
  if (!(await checkPassword(password, hash))) return bad(c, 403, "口令不对");
  c.header("Cache-Control", "no-store");
  return c.json({ scope, token: await unlockToken(scope, hash) });
});

/* set, change or take off a password: scope 'book', 'd-YYYY-MM-DD' or an entry id; password null takes the
   lock off */
admin.put("/api/admin/locks/:scope", async (c) => {
  const scope = c.req.param("scope");
  if (scope !== "book" && !/^d-\d{4}-\d{2}-\d{2}$/.test(scope)) {
    const row = await c.env.DB.prepare("SELECT id FROM entries WHERE id=?").bind(scope).first();
    if (!row) return bad(c, 404, "这一页不存在");
  }
  const o = (await c.req.json().catch(() => null)) as { password?: unknown } | null;
  try {
    if (o?.password === null) {
      await c.env.DB.prepare("DELETE FROM locks WHERE scope=?").bind(scope).run();
      await bumpVersion(c.env);
      return c.json({ scope, locked: false });
    }
    const pw = typeof o?.password === "string" ? o.password : "";
    if ([...pw].length < 4 || pw.length > 128) return bad(c, 400, "口令至少 4 个字符");
    await c.env.DB.prepare("INSERT INTO locks (scope,hash,updated_at) VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET hash=excluded.hash, updated_at=excluded.updated_at")
      .bind(scope, await hashPassword(pw), Date.now()).run();
    await bumpVersion(c.env);
    return c.json({ scope, locked: true });
  } catch (e) {
    if (/no such table/i.test(String(e))) return bad(c, 500, "数据库还没有 locks 表：运行 migrations/0002_locks.sql");
    throw e;
  }
});
