import { Hono } from "hono";
import { bumpVersion } from "./cache";
import { FONT_FILE, type UploadedFont, TYPES, fontKind, parseFonts } from "./fontfile";
import { type HonoEnv, bad } from "./env";
import { loadSettings } from "./settings";

export const pub = new Hono<HonoEnv>();
export const admin = new Hono<HonoEnv>();

/* Fonts the owner uploads (手帐设置 → 外观 → 字体): kept in R2 as fonts/<uuid>.<woff2|woff|ttf|otf>, listed in the
   setting customFonts (JSON: [{id, name, key, size}], id being u-<uuid>), and read by anybody at /font/<uuid>.<ext>.
   A font is picked, as the built-in ones are, by its id (entries.ts validFont).

   Small on purpose: the 3D book draws a page as a picture, and for that the fonts the page uses go into the
   picture whole (a Google font is cut into slices by character; a file of one's own isn't). A whole Chinese font is
   ten megabytes and more; one cut down to the common characters (a subset, woff2) is one or two. */

export const MAX_FONT = 3 * 1024 * 1024;
export const MAX_FONTS = 8;
const save = (c: { env: HonoEnv["Bindings"] }, list: UploadedFont[]) =>
  c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('customFonts', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(list)).run();

admin.post("/api/admin/fonts", async (c) => {
  const list = parseFonts((await loadSettings(c.env)).customFonts);
  if (list.length >= MAX_FONTS) return bad(c, 400, `最多上传 ${MAX_FONTS} 个字体，先删掉一个`);
  if (Number(c.req.header("content-length") || 0) > MAX_FONT) return bad(c, 413, "字体超过 3MB：请先只留常用字（子集化）再传");
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return bad(c, 400, "空文件");
  if (buf.byteLength > MAX_FONT) return bad(c, 413, "字体超过 3MB：请先只留常用字（子集化）再传");
  const ext = fontKind(new Uint8Array(buf));
  if (!ext) return bad(c, 415, "只支持 woff2 / woff / ttf / otf 字体文件");
  const name = [...(c.req.query("name") || "").replace(/\s+/g, " ").trim()].slice(0, 30).join("") || "字体";
  const uuid = crypto.randomUUID(), key = `fonts/${uuid}.${ext}`;
  await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: TYPES[ext] } });
  const font: UploadedFont = { id: `u-${uuid}`, name, key, size: buf.byteLength };
  const next = [...list, font];
  await save(c, next);
  await bumpVersion(c.env);
  return c.json({ font, customFonts: JSON.stringify(next) }, 201);
});

admin.delete("/api/admin/fonts/:id", async (c) => {
  const id = c.req.param("id");
  const s = await loadSettings(c.env);
  const list = parseFonts(s.customFonts), gone = list.find((f) => f.id === id);
  if (!gone) return bad(c, 404, "没有这个字体");
  const next = list.filter((f) => f.id !== id);
  await save(c, next);
  // whatever was written in it goes back to the default: the book, and the pages that had it for their own
  if (s.bookFont === id) await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('bookFont', 'default') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  try { await c.env.DB.prepare("UPDATE entries SET font='' WHERE font=?").bind(id).run(); } catch { /* the font column is not there yet: no page has a font */ }
  await bumpVersion(c.env);
  c.executionCtx.waitUntil(c.env.PHOTOS.delete(gone.key));
  return c.json({ customFonts: JSON.stringify(next) });
});

pub.get("/font/:file", async (c) => {
  const file = c.req.param("file");
  if (!FONT_FILE.test(file)) return c.text("没有这个字体", 404);
  const obj = await c.env.PHOTOS.get(`fonts/${file}`);
  if (!obj) return c.text("没有这个字体", 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": TYPES[file.slice(file.lastIndexOf(".") + 1)],
      // a font's name (its uuid) is never used for another file
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
