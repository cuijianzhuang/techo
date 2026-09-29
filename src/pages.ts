import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, authProblem, isLocal, sessionLogin } from "./auth";
import { CARD_KEY, ENTRY_ID, PHOTO_KEY, rowToEntry } from "./entries";
import { type Env, type HonoEnv } from "./env";
import { loadLocks, lockOf, openScopes, readerEntries } from "./locks";
import { SETTING_DEFAULTS, loadSettings, publicSettings } from "./settings";

export const pub = new Hono<HonoEnv>();

/* The book's page: title and description from the settings, and the data inlined so book.js needn't fetch it. */
pub.get("/", async (c) => {
  // (no tokens here: a reader's opened pages come later from /api/entries, their tab holds the keys)
  const [page, settings, reader] = await Promise.all([c.env.ASSETS.fetch(c.req.raw), loadSettings(c.env), readerEntries(c.env, [])]);
  if (!page.ok) return page;
  // "<" escaped so nothing in a journal page can close the script tag
  const data = JSON.stringify({ entries: reader.entries, lock: reader.lock, settings: publicSettings(settings) }).replace(/</g, "\\u003c");
  const res = new HTMLRewriter()
    .on("title", { element: (e) => { e.setInnerContent(settings.siteTitle || SETTING_DEFAULTS.siteTitle); } })
    .on('meta[name="description"]', { element: (e) => {
      e.setAttribute("content", settings.siteDesc);
      // shared as it is: the journal's name, its line, the default picture (a page is shared as /p/<id>)
      const o = new URL(c.req.url).origin, m = (k: string, v: string) => `<meta property="${k}" content="${escHtml(v)}">`;
      e.after(m("og:type", "website") + m("og:title", settings.siteTitle || SETTING_DEFAULTS.siteTitle) + m("og:description", settings.siteDesc) +
        m("og:image", o + "/og.png") + m("og:image:width", "1200") + m("og:image:height", "630") + '<meta name="twitter:card" content="summary_large_image">', { html: true });
    } })
    .on('script[src^="/assets/boot.js"]', { element: (e) => { e.before(`<script>window.TECHO_DATA=${data}</script>`, { html: true }); } })
    .transform(page);
  const h = new Headers(res.headers);
  h.set("Cache-Control", "no-cache");
  return new Response(res.body, { status: res.status, headers: h });
});

/* ---------------- sharing a page ----------------
   /p/<id> is a page's link for sharing: chat apps and social sites read its title, words and picture from
   the Open Graph tags (the book's own links are #e-<id>, which never reach the server), and a reader is sent
   straight on to the book at that page. The picture is the page's card (/card/<id>.jpg, drawn by the admin
   when the page is published), else its first photo, else /og.png. A locked page shares nothing but that
   it is one. */
const escHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
/** Markdown → a line of plain words (render.js plainText) */
const plainText = (md: string) => md.replace(/```[\s\S]*?```/g, " ").replace(/^\s*\+{3,}\s*(?:贴页|拼贴|collage)?\s*$/gim, " ")
  .replace(/^\s*(#{1,3}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?|[@＠]\d{1,2}[:：]\d{2}\s*)/gm, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|~~|==|`|\*)/g, "").replace(/[#＃][a-z]+/g, "").replace(/\s+/g, " ").trim();
/** a published page that isn't locked (the only kind with a card or a preview), or null */
async function sharedEntry(env: Env, id: string) {
  if (!ENTRY_ID.test(id)) return null;
  const row = await env.DB.prepare("SELECT * FROM entries WHERE id=? AND status='published'").bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const locked = !!lockOf(await loadLocks(env), { id, date: String(row.date) });
  return { entry: rowToEntry(row), locked };
}

pub.get("/p/:id", async (c) => {
  const id = c.req.param("id"), settings = await loadSettings(c.env), origin = new URL(c.req.url).origin;
  const found = await sharedEntry(c.env, id);
  const site = settings.siteTitle || SETTING_DEFAULTS.siteTitle;
  let title = site, desc = settings.siteDesc, image = origin + "/og.png";
  if (found && !found.locked) {
    const en = found.entry, d = en.date.replace(/-/g, ".");
    title = `${en.title || "（无题）"} · ${d}`;
    const words = [...plainText(en.body || "")];
    desc = [[en.place, en.weather].filter(Boolean).join(" · "), words.slice(0, 110).join("") + (words.length > 110 ? "…" : "")].filter(Boolean).join("｜") || desc;
    const card = await c.env.PHOTOS.head(CARD_KEY(id));
    if (card) image = `${origin}/card/${id}.jpg?v=${card.etag}`;
    else if (en.photos.length) image = `${origin}/img/${en.photos[0].key}`;
  } else if (found) title = `上了锁的一页 · ${site}`;
  const to = found ? `/#e-${id}` : "/";
  const m = (k: string, v: string) => `<meta property="${k}" content="${escHtml(v)}">`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title><meta name="description" content="${escHtml(desc)}">
${m("og:type", "article")}${m("og:site_name", site)}${m("og:title", title)}${m("og:description", desc)}${m("og:url", `${origin}/p/${id}`)}
${m("og:image", image)}${image.includes("/card/") || image.endsWith("/og.png") ? m("og:image:width", "1200") + m("og:image:height", "630") : ""}
<meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${escHtml(origin + to)}">
<meta http-equiv="refresh" content="0;url=${escHtml(to)}"><script>location.replace(${JSON.stringify(to).replace(/</g, "\\u003c")})</script>
</head><body><p><a href="${escHtml(to)}">翻开这一页</a></p></body></html>`;
  return c.html(html, 200, { "Cache-Control": "public, max-age=300" });
});

pub.get("/card/:file", async (c) => {
  const m = /^([\w-]{1,64})\.jpg$/.exec(c.req.param("file"));
  const found = m && (await sharedEntry(c.env, m[1]));
  if (!found || found.locked) return c.notFound();
  const obj = await c.env.PHOTOS.get(CARD_KEY(m[1]));
  if (!obj) return c.notFound();
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("ETag", obj.httpEtag);
  h.set("Cache-Control", "public, max-age=3600");
  return new Response(obj.body, { headers: h });
});

/* Photos from R2. Keys are random UUIDs and never reused, so they cache forever — except a locked page's:
   those need its key (?k=) or the admin's session, and are never kept by a shared cache. */
pub.get("/img/:dir/:name", async (c) => {
  const key = `${c.req.param("dir")}/${c.req.param("name")}`;
  if (!PHOTO_KEY.test(key)) return c.notFound();
  let locked = false;
  const locks = await loadLocks(c.env);
  if (locks.size) {
    // photo_key may list several photos: look for this one among them
    const row = await c.env.DB.prepare("SELECT id, date FROM entries WHERE photo_key=? OR instr(','||photo_key||',', ','||?||',')>0")
      .bind(key, key).first<{ id: string; date: string }>();
    const scope = row && lockOf(locks, row);
    if (scope) {
      locked = true;
      const admin = !authProblem(c.env) && (await sessionLogin(c.env, getCookie(c, SESSION_COOKIE)));
      const dev = c.env.DEV_BYPASS_AUTH === "1" && isLocal(c);
      if (!admin && !dev && !(await openScopes(locks, [c.req.query("k") || ""])).has(scope)) return c.notFound();
    }
  }
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.notFound();
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("ETag", obj.httpEtag);
  h.set("Cache-Control", locked ? "private, no-store" : "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers: h });
});
