import { Hono } from "hono";
import { ComposeError, composePage } from "./compose";
import { type Entry, LIMITS, MAX_STICKERS, STICKERS, STICKER_LABELS, cleanEntry, rowToEntry } from "./entries";
import { type Env, type HonoEnv, bad, localDay } from "./env";
import { dayScope, loadLocks } from "./locks";
import { aiConfig } from "./ai";

export const admin = new Hono<HonoEnv>();

/* jots: loose lines written during the day, picked up by the nightly summary.
   Newest first, a page at a time (?limit, at most 200; ?before=<createdAt>.<id> for the page after), searched
   (?q, in the words) and filtered (?state=unused: not yet in a page, used: already in one). */
type JotRow = { id: string; text: string; created_at: number; used_in: string };
admin.get("/api/admin/jots", async (c) => {
  const q = (c.req.query("q") || "").trim().slice(0, 100);
  const state = c.req.query("state");
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const [bt, bid] = (c.req.query("before") || "").split(".");
  const where: string[] = [], args: (string | number)[] = [];
  if (q) { where.push("text LIKE ? ESCAPE '\\'"); args.push("%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%"); }
  if (state === "unused") where.push("used_in=''");
  else if (state === "used") where.push("used_in<>''");
  const matchedWhere = where.length ? " WHERE " + where.join(" AND ") : "", matchedArgs = [...args];
  if (Number(bt) > 0 && bid) { where.push("(created_at<? OR (created_at=? AND id<?))"); args.push(Number(bt), Number(bt), bid); }
  const w = where.length ? " WHERE " + where.join(" AND ") : "";
  const [page, all, matched] = await Promise.all([
    c.env.DB.prepare(`SELECT id, text, created_at, used_in FROM jots${w} ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...args, limit + 1).all<JotRow>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(used_in=''),0) AS unused FROM jots").first<{ n: number; unused: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM jots${matchedWhere}`).bind(...matchedArgs).first<{ n: number }>(),
  ]);
  const rows = page.results.slice(0, limit);
  c.header("Cache-Control", "no-store");
  // today's date where the journal lives, and whether today's page (written from these) will be locked
  const today = localDay(c.env.TIMEZONE || "Asia/Shanghai").date;
  const locks = await loadLocks(c.env);
  return c.json({
    jots: rows.map((r) => ({ id: r.id, text: r.text, createdAt: r.created_at, usedIn: r.used_in })),
    more: page.results.length > limit, total: all?.n || 0, unused: all?.unused || 0, matched: matched?.n || 0,
    today, todayLocked: locks.has(dayScope(today)),
  });
});

/* several at once: {ids: [...]} (at most 100 a time, D1's bound parameters) */
admin.post("/api/admin/jots/delete", async (c) => {
  const o = (await c.req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(o?.ids) ? [...new Set(o.ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))] : [];
  if (!ids.length) return bad(c, 400, "没有要删的");
  if (ids.length > 100) return bad(c, 400, "一次最多删 100 条");
  const r = await c.env.DB.prepare(`DELETE FROM jots WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).run();
  return c.json({ deleted: r.meta.changes || 0 });
});

admin.post("/api/admin/jots", async (c) => {
  const o = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof o?.text === "string" ? o.text.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return bad(c, 400, "写点什么再记");
  if ([...text].length > 1000) return bad(c, 400, "一条最多 1000 字");
  const id = crypto.randomUUID(), now = Date.now();
  await c.env.DB.prepare("INSERT INTO jots (id, text, created_at) VALUES (?,?,?)").bind(id, text, now).run();
  return c.json({ jot: { id, text, createdAt: now, usedIn: "" } }, 201);
});

admin.delete("/api/admin/jots/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM jots WHERE id=?").bind(c.req.param("id")).run();
  if (!r.meta.changes) return bad(c, 404, "这条不存在");
  return c.json({ ok: true });
});

/* ---------------- Claude: jots -> draft page ---------------- */

export class ComposeSkip extends Error {}

/** Writes today's unused jots into a draft page. Throws ComposeSkip when there is nothing to do. */
export async function composeToday(env: Env): Promise<Entry> {
  const ai = await aiConfig(env);
  const day = localDay(env.TIMEZONE || "Asia/Shanghai");
  const has = await env.DB.prepare("SELECT id FROM entries WHERE date=? LIMIT 1").bind(day.date).first();
  if (has) throw new ComposeSkip("今天已经有一页了");
  const { results: jots } = await env.DB.prepare(
    "SELECT id, text, created_at FROM jots WHERE used_in='' AND created_at>=? AND created_at<? ORDER BY created_at",
  ).bind(day.start, day.end).all<{ id: string; text: string; created_at: number }>();
  if (!jots.length) throw new ComposeSkip("今天还没有随手记");

  const page = await composePage(
    ai, day.date,
    jots.map((j) => ({ text: j.text, createdAt: j.created_at })),
    STICKER_LABELS, env.TIMEZONE || "Asia/Shanghai",
  );
  // the model's lengths are a request, not a guarantee: trim to what the page holds before the usual validation
  const cut = (v: unknown, k: string) => [...(typeof v === "string" ? v.trim() : "")].slice(0, LIMITS[k]).join("");
  const parsed = cleanEntry({
    date: day.date, title: cut(page.title, "title"), latin: cut(page.latin, "latin"), aside: cut(page.aside, "aside"),
    body: cut(page.body, "body"), note: cut(page.note, "note"), stamp: [...(page.stamp || "")].slice(0, 1).join(""),
    mood: page.mood === "sleep" ? "sleep" : "mug",
    stickers: (Array.isArray(page.stickers) ? page.stickers : []).filter((k) => STICKERS.has(k)).slice(0, MAX_STICKERS),
    status: "draft",
  });
  if (!parsed.ok) throw new ComposeError("模型写的内容不合格式：" + parsed.error);
  const e = parsed.value, now = Date.now(), id = crypto.randomUUID();
  const used = env.DB.prepare("UPDATE jots SET used_in=? WHERE id=? AND used_in=''");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO entries (id,date,title,latin,stamp,aside,body,note,mood,quote,quote_src,photo_key,photo_cap,stickers,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'','','','',?,'draft',?,?)`,
    ).bind(id, e.date, e.title, e.latin, e.stamp, e.aside, e.body, e.note, e.mood, e.stickers.join(","), now, now),
    ...jots.map((j) => used.bind(id, j.id)),
  ]);
  const row = await env.DB.prepare("SELECT * FROM entries WHERE id=?").bind(id).first();
  return rowToEntry(row!);
}

admin.post("/api/admin/compose", async (c) => {
  try {
    return c.json({ entry: await composeToday(c.env) }, 201);
  } catch (err) {
    if (err instanceof ComposeSkip) return bad(c, 409, err.message);
    console.error(err);
    return bad(c, 500, err instanceof ComposeError ? err.message : "没写成，稍后再试");
  }
});
