import { Hono } from "hono";
import { b64url, enc, hmac, sameText } from "./crypto";
import { type Entry, loadPublished } from "./entries";
import { type C, type Env, type HonoEnv, bad } from "./env";

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
/** published pages as a reader may see them: a locked page they haven't opened is only its date */
export async function readerEntries(env: Env, tokens: string[]) {
  const [entries, locks] = await Promise.all([loadPublished(env), loadLocks(env)]);
  const open = await openScopes(locks, tokens);
  const out: (Entry & { lock?: string } | LockedStub)[] = entries.map((e) => {
    const scope = lockOf(locks, e);
    if (!scope) return e;
    if (!open.has(scope)) return { id: e.id, date: e.date, locked: scope === "book" ? "book" : "day", scope };
    return { ...e, lock: scope };       // open: the page says which key opened it (for its photo)
  });
  return { entries: out, lock: { book: locks.has("book"), open: [...open] } };
}

pub.get("/api/entries", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await readerEntries(c.env, keysOf(c)));
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
      return c.json({ scope, locked: false });
    }
    const pw = typeof o?.password === "string" ? o.password : "";
    if ([...pw].length < 4 || pw.length > 128) return bad(c, 400, "口令至少 4 个字符");
    await c.env.DB.prepare("INSERT INTO locks (scope,hash,updated_at) VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET hash=excluded.hash, updated_at=excluded.updated_at")
      .bind(scope, await hashPassword(pw), Date.now()).run();
    return c.json({ scope, locked: true });
  } catch (e) {
    if (/no such table/i.test(String(e))) return bad(c, 500, "数据库还没有 locks 表：运行 migrations/0002_locks.sql");
    throw e;
  }
});
