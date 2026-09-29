import { Hono } from "hono";
import { CARD_KEY, ENTRY_ID, IMAGE_TYPES, MAX_PHOTO, type EntryInput, HttpError, cleanEntry, photoCols, photoDay, photoKeyFor, photoKeys, rowToEntry, writeEntry } from "./entries";
import { bumpVersion } from "./cache";
import { type HonoEnv, bad } from "./env";
import { dayScope, loadLocks } from "./locks";

export const admin = new Hono<HonoEnv>();

/* drafts included */
admin.get("/api/admin/entries", async (c) => {
  const [{ results }, locks] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM entries ORDER BY date ASC, created_at ASC").all(), loadLocks(c.env)]);
  c.header("Cache-Control", "no-store");
  return c.json({
    entries: results.map((r) => ({ ...rowToEntry(r), locked: locks.has(String(r.id)), dayLocked: locks.has(dayScope(String(r.date))) })),
    bookLocked: locks.has("book"),
  });
});

admin.post("/api/admin/entries", async (c) => {
  const parsed = cleanEntry(await c.req.json().catch(() => null));
  if (!parsed.ok) return bad(c, 400, parsed.error);
  const e = parsed.value, now = Date.now(), id = crypto.randomUUID();
  try {
    await writeEntry((cols) => c.env.DB.prepare(
      `INSERT INTO entries (id,date,title,latin,stamp,aside,body,note,mood,quote,quote_src,photo_key,photo_cap,stickers,status,created_at,updated_at${cols.map((k) => "," + k).join("")})
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?${",?".repeat(cols.length)})`,
    ).bind(id, e.date, e.title, e.latin, e.stamp, e.aside, e.body, e.note, e.mood, e.quote, e.quoteSrc, ...photoCols(e.photos),
      e.stickers.join(","), e.status || "published", now, now, ...cols.map((k) => e[k as keyof EntryInput] as string)), e);
  } catch (err) { if (err instanceof HttpError) return bad(c, err.status, err.message); throw err; }
  await bumpVersion(c.env);
  const row = await c.env.DB.prepare("SELECT * FROM entries WHERE id=?").bind(id).first();
  return c.json({ entry: rowToEntry(row!) }, 201);
});

admin.put("/api/admin/entries/:id", async (c) => {
  const id = c.req.param("id");
  const old = await c.env.DB.prepare("SELECT photo_key, status FROM entries WHERE id=?").bind(id).first<{ photo_key: string; status: string }>();
  if (!old) return bad(c, 404, "这一页不存在");
  const parsed = cleanEntry(await c.req.json().catch(() => null));
  if (!parsed.ok) return bad(c, 400, parsed.error);
  const e = parsed.value;
  try {
    await writeEntry((cols) => c.env.DB.prepare(
      `UPDATE entries SET date=?,title=?,latin=?,stamp=?,aside=?,body=?,note=?,mood=?,quote=?,quote_src=?,photo_key=?,photo_cap=?,stickers=?,status=?,updated_at=?${cols.map((k) => "," + k + "=?").join("")} WHERE id=?`,
    ).bind(e.date, e.title, e.latin, e.stamp, e.aside, e.body, e.note, e.mood, e.quote, e.quoteSrc, ...photoCols(e.photos),
      e.stickers.join(","), e.status || old.status, Date.now(), ...cols.map((k) => e[k as keyof EntryInput] as string), id), e);
  } catch (err) { if (err instanceof HttpError) return bad(c, err.status, err.message); throw err; }
  await bumpVersion(c.env);
  // photos taken off the page aren't used anywhere else
  const keep = new Set(e.photos.map((p) => p.key)), gone = photoKeys(old.photo_key).filter((k) => !keep.has(k));
  if (gone.length) c.executionCtx.waitUntil(c.env.PHOTOS.delete(gone));
  const row = await c.env.DB.prepare("SELECT * FROM entries WHERE id=?").bind(id).first();
  return c.json({ entry: rowToEntry(row!) });
});

/* a page's share card (drawn in the admin's browser: 1200×630 JPEG) */
admin.put("/api/admin/entries/:id/card", async (c) => {
  const id = c.req.param("id");
  if (!ENTRY_ID.test(id)) return bad(c, 404, "这一页不存在");
  if ((c.req.header("content-type") || "") !== "image/jpeg") return bad(c, 415, "分享图要是 JPEG");
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 1_500_000) return bad(c, 413, "分享图太大了");
  const row = await c.env.DB.prepare("SELECT id FROM entries WHERE id=?").bind(id).first();
  if (!row) return bad(c, 404, "这一页不存在");
  await c.env.PHOTOS.put(CARD_KEY(id), body, { httpMetadata: { contentType: "image/jpeg" } });
  return c.json({ ok: true });
});

admin.delete("/api/admin/entries/:id", async (c) => {
  const id = c.req.param("id");
  const old = await c.env.DB.prepare("SELECT photo_key FROM entries WHERE id=?").bind(id).first<{ photo_key: string }>();
  if (!old) return bad(c, 404, "这一页不存在");
  await c.env.DB.prepare("DELETE FROM entries WHERE id=?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM locks WHERE scope=?").bind(id).run().catch(() => {});
  await bumpVersion(c.env);
  c.executionCtx.waitUntil(c.env.PHOTOS.delete([...(old.photo_key ? photoKeys(old.photo_key) : []), CARD_KEY(id)]));
  return c.json({ ok: true });
});


admin.post("/api/admin/photos", async (c) => {
  const type = (c.req.header("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) return bad(c, 415, "只支持 JPEG / PNG / WebP / GIF 图片");
  const len = Number(c.req.header("content-length") || 0);
  if (len > MAX_PHOTO) return bad(c, 413, "图片超过 10MB");
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return bad(c, 400, "空文件");
  if (buf.byteLength > MAX_PHOTO) return bad(c, 413, "图片超过 10MB");
  // filed under the day of the page it is for (?date=), else today
  const key = photoKeyFor(photoDay(c.req.query("date"), c.env.TIMEZONE), ext);
  await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key, url: `/img/${key}` }, 201);
});
