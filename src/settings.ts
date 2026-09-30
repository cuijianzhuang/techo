import { Hono } from "hono";
import { bumpVersion } from "./cache";
import { DEFAULT_MODEL } from "./compose";
import { PHOTO_KEY, validFont } from "./entries";
import { type Env, type HonoEnv, aiKey, bad } from "./env";

export const pub = new Hono<HonoEnv>();
export const admin = new Hono<HonoEnv>();

/* ---------------- settings: everything on the book that isn't a journal page ---------------- */

/** what the book shows until a setting is saved (the original hand-made content) */
export const SETTING_DEFAULTS: Record<string, string> = {
  email: "hello@example.com", github: "", githubText: "",
  siteTitle: "Cuijianzhuang 手帐", siteDesc: "Cuijianzhuang 的手帐：写代码的人，也记日记。",
  coverTitle: "cui.log", coverSub: "手帐 · 2026.09 → ∞",
  coverHide: "", coverPhotos: "",
  readmeName: "Cuijianzhuang", readmeRole: "Java 后端 · 保险业务系统", readmeLife: "nas/  photos/  trips/  notes/",
  readmeSince: "2026-09", readmeSign: "小咖在旁边看着",
  backTitle: "EOF", backImprint: "cui.log · build 2026.09.25\ndeployed on the edge",
  samples: "show",
  paperStyle: "grid",   // the paper's pattern: grid / lined / dots / plain
  paperTone: "cream",   // and its colour: cream / white / aged / mint
  nightPaper: "auto",   // 夜间书页: "auto" the paper darkens with the system's dark mode, "off" it stays as by day
  coverStyle: "slate",
  bookFont: "default",   // the book's font (entries.ts FONT_IDS, render.js FONTS); a page can have its own
  // Mapbox: a public token (pk.…, restricted to this site's URL in the Mapbox account) for the map page
  // (/map/), the little maps on the pages, the admin's map and its place names. Empty: no maps.
  mapboxToken: "", mapOnPage: "show",
  // 网易云 on the pages: a Meting API (any public one, or one's own; "" = the default in render.js)
  metingApi: "",
  // …and its token, for an API that wants one (sent by the Worker as Authorization: Bearer). Admin only
  // (PRIVATE_SETTINGS): never in /api/settings or the page. METING_TOKEN, a Worker secret, is used without it.
  metingToken: "",
  // 和风天气 (QWeather) for a page's weather: the key, and the account's API Host (console → 设置, e.g.
  // abc123.re.qweatherapi.com; "" = devapi.qweather.com). Admin only (PRIVATE_SETTINGS). Without a key the
  // admin asks Open-Meteo.
  qweatherKey: "", qweatherHost: "",
  // the cover's look: slate / kraft / leather / linen / wine (book-extra.css, cv-<style>)
  bookMode: "auto",     // how the home page turns: "auto" (phones flip, bigger screens 3D), "3d" (the three.js book) or "flip" (the flat page-flip book)
  // the AI: the format its endpoint speaks ("anthropic" Messages API or "openai" chat completions), the
  // endpoint ("" = Anthropic's own / OpenAI's own) and a model. The key is a Worker secret, never a setting.
  // Admin only (PRIVATE_SETTINGS).
  aiFormat: "anthropic", aiBaseUrl: "", aiModel: DEFAULT_MODEL,
};

const PAPER_STYLES = ["grid", "lined", "dots", "plain"], PAPER_TONES = ["cream", "white", "aged", "mint"];
const COVER_STYLES = ["slate", "kraft", "leather", "linen", "wine"];
/** settings only the admin sees: kept out of /api/settings and the page */
const PRIVATE_SETTINGS = new Set(["aiFormat", "aiBaseUrl", "aiModel", "metingToken", "qweatherKey", "qweatherHost"]);
export const publicSettings = (s: Record<string, string>) => Object.fromEntries(Object.entries(s).filter(([k]) => !PRIVATE_SETTINGS.has(k)));
/** max length (characters) per text setting */
const SETTING_MAX: Record<string, number> = {
  email: 120, github: 200, githubText: 60, siteTitle: 40, siteDesc: 120, coverTitle: 16, coverSub: 40,
  readmeName: 30, readmeRole: 40, readmeLife: 60, readmeSince: 20, readmeSign: 30, backTitle: 12, backImprint: 80,
  aiBaseUrl: 200, aiModel: 80, mapboxToken: 300, metingApi: 200, metingToken: 300,
  qweatherKey: 100, qweatherHost: 120,
};

const COVER_STICKERS = new Set(["mug", "nas", "cloud", "ticket", "film"]);
const MAX_COVER_PHOTOS = 4;
const csv = (v: string) => v.split(",").filter(Boolean);

export async function loadSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const settings = { ...SETTING_DEFAULTS };
  for (const r of results) if (r.key in SETTING_DEFAULTS) settings[r.key] = r.value;
  return settings;
}

export function cleanSettings(o: Record<string, unknown>): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const v: Record<string, string> = {};
  for (const k of Object.keys(SETTING_DEFAULTS)) {
    if (!(k in o)) continue;
    if (typeof o[k] !== "string") return { ok: false, error: `${k} 必须是文字` };
    const t = (o[k] as string).replace(/\r\n/g, "\n").trim();
    if (SETTING_MAX[k] && [...t].length > SETTING_MAX[k]) return { ok: false, error: `${k} 超过 ${SETTING_MAX[k]} 个字` };
    v[k] = t;
  }
  if (v.github && !/^https:\/\/[^\s]+$/i.test(v.github)) return { ok: false, error: "GitHub 地址要以 https:// 开头" };
  if (v.coverHide !== undefined && csv(v.coverHide).some((k) => !COVER_STICKERS.has(k))) return { ok: false, error: "coverHide 里有不认识的贴纸" };
  if (v.coverPhotos !== undefined) {
    const keys = csv(v.coverPhotos);
    if (keys.length > MAX_COVER_PHOTOS) return { ok: false, error: `封面图片最多 ${MAX_COVER_PHOTOS} 张` };
    if (keys.some((k) => !PHOTO_KEY.test(k))) return { ok: false, error: "封面图片无效" };
  }
  if (v.samples !== undefined && v.samples !== "show" && v.samples !== "hide") return { ok: false, error: "samples 只能是 show / hide" };
  if (v.paperStyle !== undefined && !PAPER_STYLES.includes(v.paperStyle)) return { ok: false, error: "paperStyle 只能是 " + PAPER_STYLES.join(" / ") };
  if (v.nightPaper !== undefined && v.nightPaper !== "auto" && v.nightPaper !== "off") return { ok: false, error: "nightPaper 只能是 auto / off" };
  if (v.paperTone !== undefined && !PAPER_TONES.includes(v.paperTone)) return { ok: false, error: "paperTone 只能是 " + PAPER_TONES.join(" / ") };
  if (v.mapboxToken && !/^pk\.[\w.-]+$/.test(v.mapboxToken)) return { ok: false, error: "Mapbox token 要用公开的那种（pk. 开头）" };
  if (v.metingApi && !/^https:\/\/[^\s]+$/i.test(v.metingApi)) return { ok: false, error: "Meting API 要以 https:// 开头" };
  if (v.metingToken && /\s/.test(v.metingToken)) return { ok: false, error: "Meting token 里不能有空格或换行" };
  if (v.qweatherKey && !/^[\w-]+$/.test(v.qweatherKey)) return { ok: false, error: "和风天气的 KEY 只有字母和数字" };
  if (v.qweatherHost) {
    // "https://abc.re.qweatherapi.com/…" or the host alone: the host
    v.qweatherHost = v.qweatherHost.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    if (!/^[a-z0-9.-]+\.(?:qweatherapi\.com|qweather\.com|qweather\.net)$/.test(v.qweatherHost)) return { ok: false, error: "和风天气的 API Host 像 abc123.re.qweatherapi.com（控制台 → 设置里有）" };
  }
  if (v.mapOnPage !== undefined && v.mapOnPage !== "show" && v.mapOnPage !== "hide") return { ok: false, error: "mapOnPage 只能是 show / hide" };
  if (v.coverStyle !== undefined && !COVER_STYLES.includes(v.coverStyle)) return { ok: false, error: "coverStyle 只能是 " + COVER_STYLES.join(" / ") };
  if (v.bookFont !== undefined && !validFont(v.bookFont)) return { ok: false, error: "bookFont 是不认识的字体" };
  if (v.bookMode !== undefined && !["auto", "3d", "flip"].includes(v.bookMode)) return { ok: false, error: "bookMode 只能是 auto / 3d / flip" };
  if (v.aiFormat !== undefined && !["anthropic", "openai"].includes(v.aiFormat)) return { ok: false, error: "aiFormat 只能是 anthropic / openai" };
  if (v.aiBaseUrl) {
    v.aiBaseUrl = v.aiBaseUrl.replace(/\/+$/, "");   // what follows (/v1, /chat/completions) depends on the format: compose.ts
    let u: URL | null = null;
    try { u = new URL(v.aiBaseUrl); } catch { /* checked below */ }
    const local = u && ["localhost", "127.0.0.1"].includes(u.hostname);
    if (!u || !(u.protocol === "https:" || (local && u.protocol === "http:"))) return { ok: false, error: "AI 接口地址要以 https:// 开头" };
  }
  if (v.aiModel !== undefined) {
    if (!v.aiModel) v.aiModel = DEFAULT_MODEL;
    if (!/^[\w.:/@-]+$/.test(v.aiModel)) return { ok: false, error: "模型名只能有字母、数字和 . _ - : / @" };
  }
  return { ok: true, value: v };
}

pub.get("/api/settings", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ settings: publicSettings(await loadSettings(c.env)) });
});

/* the admin's view of the settings: all of them, and whether the AI has its key */
const adminSettings = async (env: Env) => ({ settings: await loadSettings(env), ai: { keySet: !!aiKey(env) }, meting: { secretSet: !!env.METING_TOKEN } });
admin.get("/api/admin/settings", async (c) => c.json(await adminSettings(c.env)));

admin.put("/api/admin/settings", async (c) => {
  const o = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return bad(c, 400, "请求体必须是 JSON 对象");
  const parsed = cleanSettings(o);
  if (!parsed.ok) return bad(c, 400, parsed.error);
  const before = await loadSettings(c.env);
  const up = c.env.DB.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const pairs = Object.entries(parsed.value);
  if (pairs.length) await c.env.DB.batch(pairs.map(([k, v]) => up.bind(k, v)));
  await bumpVersion(c.env);
  // cover pictures taken off the cover aren't used anywhere else
  if (parsed.value.coverPhotos !== undefined) {
    const keep = new Set(csv(parsed.value.coverPhotos));
    const gone = csv(before.coverPhotos).filter((k) => !keep.has(k));
    if (gone.length) c.executionCtx.waitUntil(c.env.PHOTOS.delete(gone));
  }
  return c.json(await adminSettings(c.env));
});
