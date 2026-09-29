import { UA } from "./ua";

/* 网易云 through Meting (手帐设置 → 接入服务 → 网易云音乐), asked by the Worker: a Meting API that wants a token
   gets it (the admin-only setting metingToken, or the secret METING_TOKEN: it never reaches a page), and nobody's
   browser minds where the API lives. What the API answers ([…], {data: […]}, {data: {…}}, {result: {songs: […]}}…)
   is taken down to one song's title, artist, cover, sound and words. A cover or a sound that is the API's own
   address again (…?type=url&id=…, which would want the token too) is followed here to where it leads (NetEase's
   servers); one that only comes with the token is handed out through /api/meting/file. What the song doesn't say
   is asked for (type=url, pic, lrc), and then of NetEase itself: a song NetEase won't play (a VIP one, one taken
   down) still has its name, its singer and its cover. */
/* No default address: the public Meting APIs have all stopped answering, so the journal's own is asked, and
   without one there is nothing to ask. */
export const NO_METING_API = "还没有配置 Meting 接口：在「手帐设置 → 接入服务 → 网易云音乐」填上你自己的（公共接口都失效了）";
export type Song = { title: string; artist: string; url: string; pic: string; lrc: string; why?: string };
export const metingUrl = (api: string, type: string, id: string) => {
  const base = api.trim();
  if (!base) throw new Error(NO_METING_API);
  return /:id/.test(base)
    ? base.replace(":server", "netease").replace(":type", type).replace(":id", encodeURIComponent(id)).replace(":r", String(Math.random()).slice(2))
    : base + (base.includes("?") ? "&" : "?") + "server=netease&type=" + type + "&id=" + encodeURIComponent(id);
};
export const metingHeaders = (token: string) => {
  const h: Record<string, string> = { accept: "application/json", "user-agent": UA["User-Agent"] };
  if (token) h.authorization = "Bearer " + token;
  return h;
};
/* the API asked; an address of the site rather than of its API (https://music.example/ for
   https://music.example/api, as some Meting servers have it) answers with its page, not a song: then …/api */
export async function metingGet(api: string, type: string, id: string, headers: Record<string, string>) {
  let r = await fetch(metingUrl(api, type, id), { headers });
  const base = api.trim();
  let root = false;
  try { root = !/:id/.test(base) && new URL(base).pathname === "/"; } catch { /* not a URL: said by fetch */ }
  if (root && (r.status === 404 || (r.ok && /html/.test(r.headers.get("content-type") || "")))) {
    r.body?.cancel();
    api = new URL(base).origin + "/api";
    r = await fetch(metingUrl(api, type, id), { headers });
  }
  return { r, api };
}
// the song in an answer, however it's wrapped
const SONG_KEYS = ["url", "title", "name", "pic", "cover", "lrc", "author", "artist"];
export function songIn(j: unknown, depth = 0): Record<string, unknown> | null {
  if (!j || typeof j !== "object" || depth > 4) return null;
  if (Array.isArray(j)) return songIn(j[0], depth + 1);
  const o = j as Record<string, unknown>;
  if (SONG_KEYS.filter((k) => typeof o[k] === "string" && o[k]).length >= 2) return o;
  for (const k of ["data", "result", "songs", "song", "list", "items"]) { const x = songIn(o[k], depth + 1); if (x) return x; }
  return SONG_KEYS.some((k) => typeof o[k] === "string" && o[k]) ? o : null;
}
const str = (x: Record<string, unknown> | null, ...ks: string[]) => {
  for (const k of ks) {
    const v = x?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    // artist: ["周杰伦"] or [{name: "周杰伦"}]
    if (Array.isArray(v)) { const n = v.map((a) => (typeof a === "string" ? a : (a as { name?: unknown })?.name)).filter((a) => typeof a === "string" && a); if (n.length) return n.join(" / "); }
  }
  return "";
};
export async function metingSong(token: string, asked: string, id: string): Promise<Song | null> {
  const headers = metingHeaders(token);
  const { r, api } = await metingGet(asked, "song", id, headers), u = metingUrl(api, "song", id);
  if (!r.ok) {
    // what it says, if it says: {"success":false,"error":"需要 API Token…"}
    const said = await r.json().then((j) => { const o = (j || {}) as { error?: unknown; message?: unknown }; return String(o.error || o.message || ""); }).catch(() => "");
    const asks = r.status === 401 || /token/i.test(said);
    throw new Error(asks ? (token ? "Meting 接口不认这个 token" : "Meting 接口要 token：在「手帐设置 → 接入服务 → 网易云音乐」填上")
      : "Meting 接口拒绝了请求（" + r.status + (said ? "：" + said.slice(0, 80) : "") + "）" + (r.status === 403 ? "，可能不让 Cloudflare 访问，换一个接口试试" : ""));
  }
  const text = await r.text().catch(() => "");
  let j: unknown = null;
  try { j = JSON.parse(text); } catch { /* not JSON: said below */ }
  const x = songIn(j);
  const own = (v: string) => { try { return new URL(v).origin === new URL(u).origin; } catch { return false; } };
  /* a sound or a cover: where the API's own address leads; what it answers with, if that's a link; handed out
     through the Worker if it's the thing itself (it wanted the token) */
  const media = async (v: string, t: "url" | "pic", hop = 0): Promise<string> => {
    if (!v || !/^https?:\/\//.test(v)) return "";
    if (!own(v)) return v;
    const f = await fetch(v, { headers, redirect: "manual" }).catch(() => null);
    if (!f) return "";
    const to = f.headers.get("location");
    // NetEase's servers answer https too: a page on https won't play or show them over http
    if (to) return new URL(to, v).toString().replace(/^http:\/\/(?=[^/]*\.(?:126|163)\.net\/)/, "https://");
    if (!f.ok) return "";
    const type = f.headers.get("content-type") || "";
    if (/json/.test(type)) {
      const y = songIn(await f.json().catch(() => null));
      const w = str(y, t === "url" ? "url" : "pic", ...(t === "pic" ? ["cover"] : []));
      return hop < 1 && w !== v ? media(w, t, hop + 1) : "";
    }
    f.body?.cancel();
    return /^(audio|image|video)\/|octet-stream/.test(type) ? "/api/meting/file?t=" + t + "&id=" + id : "";
  };
  const words = async (v: string) => {
    if (!v) return "";
    if (!/^https?:/.test(v)) return v;
    if (!own(v)) return v;
    const f = await fetch(v, { headers }).catch(() => null);
    if (!f || !f.ok) return "";
    const t = (await f.text()).slice(0, 20000);
    if (/^\s*[[{]/.test(t) && !/^\s*\[\d/.test(t)) { try { const y = JSON.parse(t) as Record<string, unknown>, w = str(songIn(y) || y, "lrc", "lyric"); return /^https?:/.test(w) ? "" : w; } catch { return ""; } }
    return /\[\d+:\d/.test(t) ? t : "";
  };
  let [url, pic, lrc] = await Promise.all([media(str(x, "url"), "url"), media(str(x, "pic", "cover"), "pic"), words(str(x, "lrc", "lyric"))]);
  // what the song didn't say: asked for one by one
  [url, pic, lrc] = await Promise.all([
    url || media(metingUrl(api, "url", id), "url"),
    pic || media(metingUrl(api, "pic", id), "pic"),
    lrc || words(metingUrl(api, "lrc", id)),
  ]);
  let title = str(x, "title", "name"), artist = str(x, "author", "artist", "artists", "ar");
  // and then of NetEase: its own link to the sound (which leads to its 404 page when it won't play), its details
  if (!url) {
    const f = await fetch("https://music.163.com/song/media/outer/url?id=" + id + ".mp3", { headers: { "user-agent": UA["User-Agent"] }, redirect: "manual" }).catch(() => null);
    const to = f?.headers.get("location") || "";
    if (/^https?:\/\//.test(to) && !/music\.163\.com\/(?:#\/)?404/.test(to)) url = to.replace(/^http:/, "https:");
  }
  if (!title || !pic) {
    const d = await fetch("https://music.163.com/api/song/detail/?id=" + id + "&ids=%5B" + id + "%5D", { headers: { "user-agent": UA["User-Agent"], referer: "https://music.163.com/" } })
      .then((f) => (f.ok ? f.json() : null)).catch(() => null) as { songs?: { name?: string; artists?: { name?: string }[]; album?: { picUrl?: string } }[] } | null;
    const n = d?.songs?.[0];
    if (n) {
      title ||= n.name || "";
      artist ||= (n.artists || []).map((a) => a.name).filter(Boolean).join(" / ");
      pic ||= (n.album?.picUrl || "").replace(/^http:/, "https:");
    }
  }
  if (!url && !title) {
    if (x) return null;
    // an answer not understood: what it was, for 试一下
    throw new Error("没认出 Meting 接口的回答：" + (text.trim().slice(0, 120) || "（空的）"));
  }
  return { title, artist, url, pic, lrc, ...(url ? {} : { why: "在网易云放不了（VIP 或下架）" }) };
}
