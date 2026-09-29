import { Hono } from "hono";
import { UA } from "./ua";
import { metingGet, metingHeaders, metingSong } from "./meting";
import { type C, type Env, type HonoEnv, bad } from "./env";
import { loadSettings } from "./settings";

export const pub = new Hono<HonoEnv>();
export const admin = new Hono<HonoEnv>();

/* a NetEase share (the app's "分享…的单曲《…》: https://163cn.tv/xxxx (来自@网易云音乐)", or a music.163.com
   link) → the song's id. The short links only say where they go by redirecting, which a browser can't read
   across sites; only NetEase's own hosts are followed. */
const NETEASE_HOSTS = /^(?:163cn\.tv|163cn\.link|(?:y\.)?music\.163\.com)$/i;
const songIdOf = (u: string) => /music\.163\.com\/.*?(?:song\?id=|song\/)(\d+)/.exec(u)?.[1] || (/music\.163\.com/.test(u) ? /[?&]id=(\d+)/.exec(u)?.[1] : undefined);
admin.post("/api/admin/netease", async (c) => {
  const o = (await c.req.json().catch(() => null)) as { q?: unknown } | null;
  const q = typeof o?.q === "string" ? o.q.trim().slice(0, 500) : "";
  if (/^\d{3,12}$/.test(q)) return c.json({ id: q });
  let url = /https?:\/\/[^\s()（）]+/.exec(q)?.[0] || "";
  for (let hop = 0; url && hop < 4; hop++) {
    const id = songIdOf(url);
    if (id) return c.json({ id });
    let host = "";
    try { host = new URL(url).hostname; } catch { break; }
    if (!NETEASE_HOSTS.test(host)) break;
    const r = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA["User-Agent"] } }).catch(() => null);
    const next = r && r.headers.get("location");
    if (!next) break;
    url = new URL(next, url).toString();
  }
  return bad(c, 404, "没认出是哪首歌：贴网易云的歌曲链接、分享的那段文字，或者歌曲 ID");
});

const songReply = async (c: C, api: string, token: string) => {
  const id = (c.req.query("id") || "").trim();
  if (!/^\d{3,12}$/.test(id)) return bad(c, 400, "要网易云的歌曲 ID");
  try {
    const song = await metingSong(token, api, id);
    if (!song) return bad(c, 404, "这首歌放不了（VIP、下架，或者接口没找到）");
    // the sound's address from NetEase is good for a while, not for ever
    c.header("Cache-Control", "public, max-age=600");
    return c.json(song);
  } catch (e) {
    return bad(c, 500, e instanceof Error ? e.message : "Meting 接口连不上");
  }
};

const metingToken = (env: Env, s: Record<string, string>) => s.metingToken || env.METING_TOKEN || "";
pub.get("/api/meting", async (c) => { const s = await loadSettings(c.env); return songReply(c, s.metingApi || "", metingToken(c.env, s)); });
/* a sound or a cover that only comes with the token: fetched here from the journal's Meting API, a piece at a
   time as the player asks (Range) */
pub.get("/api/meting/file", async (c) => {
  const id = (c.req.query("id") || "").trim(), t = c.req.query("t") === "pic" ? "pic" : "url";
  if (!/^\d{3,12}$/.test(id)) return bad(c, 400, "要网易云的歌曲 ID");
  const s = await loadSettings(c.env), headers = metingHeaders(metingToken(c.env, s));
  delete headers.accept;
  const range = c.req.header("range");
  if (range) headers.range = range;
  const f = await metingGet(s.metingApi || "", t, id, headers).then((x) => x.r).catch(() => null);
  const type = f?.headers.get("content-type") || "";
  if (!f || !f.ok || !/^(audio|image|video)\/|octet-stream/.test(type)) { f?.body?.cancel(); return bad(c, 404, "这首歌放不了"); }
  const out = new Headers({ "content-type": type, "cache-control": "public, max-age=600" });
  for (const k of ["content-length", "content-range", "accept-ranges"]) { const v = f.headers.get(k); if (v) out.set(k, v); }
  return new Response(f.body, { status: f.status, headers: out });
});
/* 试一下 in 手帐设置: an address not saved yet (only for the one signed in: otherwise anyone could send the
   Worker anywhere) */
admin.get("/api/admin/meting", async (c) => {
  const api = (c.req.query("api") || "").trim();
  if (api && !/^https:\/\/[^\s]+$/i.test(api)) return bad(c, 400, "Meting API 要以 https:// 开头");
  // (with the token as typed, not saved yet, too)
  const s = await loadSettings(c.env), tok = (c.req.header("x-meting-token") || "").trim();
  return songReply(c, api || s.metingApi || "", tok || metingToken(c.env, s));
});
