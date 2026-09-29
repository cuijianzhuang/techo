import { Hono } from "hono";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { ComposeError, composePage, pingAi, suggestFields, DEFAULT_MODEL, type AiConfig } from "./compose";
import { UA } from "./ua";
import { metingGet, metingHeaders, metingSong } from "./meting";
import { qweatherDay } from "./qweather";

type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  /** GitHub OAuth App (see README). The client id is public; the secret also keys the session cookie. */
  GITHUB_CLIENT_ID: string;
  /** secret: `wrangler secret put GITHUB_CLIENT_SECRET` */
  GITHUB_CLIENT_SECRET?: string;
  /** the one GitHub account let into the admin */
  ADMIN_GITHUB_LOGIN: string;
  /** "1" only in .dev.vars for local `wrangler dev` */
  DEV_BYPASS_AUTH?: string;
  /** 🔍 NeoDB: another NeoDB instance than neodb.social (NeoDB is federated) */
  NEODB_URL?: string;
  /** secret: the key for the AI set in 手帐设置 → AI (`wrangler secret put AI_API_KEY`); ANTHROPIC_API_KEY is read
      when it isn't set. Without either the AI features are off. */
  AI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** secret: the token for a Meting API that asks for one, when 手帐设置 has none (`wrangler secret put METING_TOKEN`) */
  METING_TOKEN?: string;
  /** IANA zone the journal's days follow, e.g. Asia/Shanghai */
  TIMEZONE: string;
  /** rate limit for password guesses (wrangler.jsonc "ratelimits"); missing: no limit */
  UNLOCK_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
};
/** login: the GitHub account behind the admin session */
type HonoEnv = { Bindings: Env; Variables: { login: string } };
type C = Context<HonoEnv>;

const app = new Hono<HonoEnv>();

/* ---------------- entries: validation & mapping ---------------- */

type Entry = {
  id: string; date: string; title: string; latin: string; stamp: string; aside: string;
  body: string; note: string; mood: "mug" | "sleep" | "none"; quote: string; quoteSrc: string;
  photoKey: string; photoCap: string; stickers: string[]; status: "draft" | "published";
  /** every photo on the page, in order (photoKey / photoCap are the first one's, for older readers) */
  photos: Photo[];
  /** where it was written: a place name, "lat,lon" (two decimals, about a kilometre), and that day's weather */
  place: string; geo: string; weather: string;
  createdAt: number; updatedAt: number;
};

/* doodles a page can carry; the drawings live in public/assets/render.js */
const STICKER_LABELS: Record<string, string> = {
  sun: "晴天", cloud: "多云", rain: "下雨", moon: "月亮/夜里", cat: "猫", book: "书/读书", laptop: "电脑/写代码",
  bug: "修 bug", plant: "植物", noodles: "吃饭", bus: "通勤/出门", bike: "骑车/运动", music: "音乐",
  heart: "开心/温暖", star: "好事/小成就", letter: "来信/消息", camera: "拍照",
};
const STICKERS = new Set(Object.keys(STICKER_LABELS));
const MAX_STICKERS = 2;

const LIMITS: Record<string, number> = {
  title: 30, latin: 60, stamp: 2, aside: 30, body: 8000, note: 60, quote: 120, quoteSrc: 60, photoCap: 30, place: 30, weather: 20,
};
const PHOTO_KEY = /^p\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
/* A page holds up to MAX_PHOTOS photos, kept in the columns that held one: photo_key is their keys joined by
   commas, photo_cap their captions one per line (so an older database needs no migration). */
type Photo = { key: string; cap: string };
const MAX_PHOTOS = 3;
const photoKeys = (col: unknown) => String(col || "").split(",").filter(Boolean);
function photosOf(keyCol: unknown, capCol: unknown): Photo[] {
  const caps = String(capCol || "").split("\n");
  return photoKeys(keyCol).map((key, i) => ({ key, cap: caps[i] || "" }));
}

function rowToEntry(r: Record<string, unknown>): Entry {
  return {
    id: String(r.id), date: String(r.date), title: String(r.title), latin: String(r.latin),
    stamp: String(r.stamp), aside: String(r.aside), body: String(r.body), note: String(r.note),
    place: String(r.place ?? ""), geo: String(r.geo ?? ""), weather: String(r.weather ?? ""),
    mood: (r.mood as Entry["mood"]) || "mug", quote: String(r.quote), quoteSrc: String(r.quote_src),
    ...(() => { const photos = photosOf(r.photo_key, r.photo_cap); return { photos, photoKey: photos[0]?.key || "", photoCap: photos[0]?.cap || "" }; })(),
    stickers: String(r.stickers || "").split(",").filter((k) => STICKERS.has(k)),
    status: r.status === "draft" ? "draft" : "published",
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}

type EntryInput = Omit<Entry, "id" | "createdAt" | "updatedAt" | "status"> & { status?: Entry["status"] };
/** the two columns the photos are kept in */
const photoCols = (photos: Photo[]) => [photos.map((p) => p.key).join(","), photos.map((p) => p.cap).join("\n")];

function cleanEntry(input: unknown): { ok: true; value: EntryInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "请求体必须是 JSON 对象" };
  const o = input as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "").replace(/\r\n/g, "\n");
  const v: Record<string, string> = {};
  for (const k of Object.keys(LIMITS)) {
    const s = k === "body" ? str(k).trim() : str(k).trim();
    if ([...s].length > LIMITS[k]) return { ok: false, error: `${k} 超过 ${LIMITS[k]} 个字` };
    v[k] = s;
  }
  const date = str("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z")))
    return { ok: false, error: "日期格式应为 YYYY-MM-DD" };
  if (!v.title) return { ok: false, error: "标题不能为空" };
  const mood = str("mood") || "mug";
  if (!["mug", "sleep", "none"].includes(mood)) return { ok: false, error: "mood 只能是 mug / sleep / none" };
  // photos: [{key, cap}] (up to MAX_PHOTOS), or the single photoKey / photoCap older clients send
  const rawPhotos: unknown[] = Array.isArray(o.photos) ? o.photos : str("photoKey") ? [{ key: str("photoKey"), cap: v.photoCap }] : [];
  if (rawPhotos.length > MAX_PHOTOS) return { ok: false, error: `照片最多 ${MAX_PHOTOS} 张` };
  const photos: Photo[] = [];
  for (const ph of rawPhotos) {
    const q = (ph && typeof ph === "object" ? ph : {}) as Record<string, unknown>;
    const key = typeof q.key === "string" ? q.key : "";
    const cap = (typeof q.cap === "string" ? q.cap : "").replace(/\s+/g, " ").trim();
    if (!PHOTO_KEY.test(key)) return { ok: false, error: "照片无效" };
    if ([...cap].length > LIMITS.photoCap) return { ok: false, error: `照片说明超过 ${LIMITS.photoCap} 个字` };
    if (photos.some((p) => p.key === key)) continue;
    photos.push({ key, cap });
  }
  const rawStk: unknown[] = Array.isArray(o.stickers) ? o.stickers : typeof o.stickers === "string" ? o.stickers.split(",") : [];
  const stickers = [...new Set(rawStk.map((k) => String(k).trim()).filter(Boolean))];
  if (stickers.some((k) => !STICKERS.has(k))) return { ok: false, error: "有不认识的插画" };
  if (stickers.length > MAX_STICKERS) return { ok: false, error: `插画最多 ${MAX_STICKERS} 个` };
  // coordinates: kept to two decimals (about a kilometre), the book being public
  let geo = "";
  const g = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(str("geo"));
  if (str("geo").trim()) {
    const lat = g ? Number(g[1]) : NaN, lon = g ? Number(g[2]) : NaN;
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return { ok: false, error: "坐标应为「纬度,经度」，比如 31.23,121.47" };
    geo = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  }
  const status = str("status");
  if (status && status !== "draft" && status !== "published") return { ok: false, error: "status 只能是 draft / published" };
  return {
    ok: true,
    value: {
      date, title: v.title, latin: v.latin, stamp: v.stamp, aside: v.aside, body: v.body, note: v.note,
      place: v.place, geo, weather: v.weather,
      mood: mood as Entry["mood"], quote: v.quote, quoteSrc: v.quoteSrc, photos, photoKey: photos[0]?.key || "", photoCap: photos[0]?.cap || "",
      stickers, status: (status || undefined) as Entry["status"] | undefined,
    },
  };
}

const bad = (c: C, status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 500, error: string) => c.json({ error }, status);

/* ---------------- public API ---------------- */



/* ---------------- settings: everything on the book that isn't a journal page ---------------- */

/** what the book shows until a setting is saved (the original hand-made content) */
const SETTING_DEFAULTS: Record<string, string> = {
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
const publicSettings = (s: Record<string, string>) => Object.fromEntries(Object.entries(s).filter(([k]) => !PRIVATE_SETTINGS.has(k)));
/** the AI as configured (the admin's settings, the Worker's key) */
const aiKey = (env: Env) => env.AI_API_KEY || env.ANTHROPIC_API_KEY || "";
async function aiConfig(env: Env): Promise<AiConfig> {
  if (!aiKey(env)) throw new ComposeError("Worker 还没有 AI 的 key（运行 npx wrangler secret put AI_API_KEY）");
  const s = await loadSettings(env);
  return { apiKey: aiKey(env), baseURL: s.aiBaseUrl || "", model: s.aiModel || DEFAULT_MODEL, format: s.aiFormat === "openai" ? "openai" : "anthropic" };
}
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

async function loadSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const settings = { ...SETTING_DEFAULTS };
  for (const r of results) if (r.key in SETTING_DEFAULTS) settings[r.key] = r.value;
  return settings;
}
async function loadPublished(env: Env): Promise<Entry[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM entries WHERE status='published' ORDER BY date ASC, created_at ASC",
  ).all();
  return results.map(rowToEntry);
}

function cleanSettings(o: Record<string, unknown>): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
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
async function loadLocks(env: Env): Promise<Map<string, string>> {
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
async function openScopes(locks: Map<string, string>, tokens: string[]): Promise<Set<string>> {
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
const dayScope = (date: string) => "d-" + date;
const lockOf = (locks: Map<string, string>, e: { id: string; date: string }) =>
  locks.has(e.id) ? e.id : locks.has(dayScope(e.date)) ? dayScope(e.date) : locks.has("book") ? "book" : null;

type LockedStub = { id: string; date: string; locked: "book" | "day"; scope: string };
/** published pages as a reader may see them: a locked page they haven't opened is only its date */
async function readerEntries(env: Env, tokens: string[]) {
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

app.get("/api/entries", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await readerEntries(c.env, keysOf(c)));
});

/* the password for the book ('book') or a day (its entry id): right → a token; 10 guesses a minute */
app.post("/api/unlock", async (c) => {
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

app.get("/api/settings", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ settings: publicSettings(await loadSettings(c.env)) });
});

/* The book's page: title and description from the settings, and the data inlined so book.js needn't fetch it. */
app.get("/", async (c) => {
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
const CARD_KEY = (id: string) => `cards/${id}.jpg`;
const ENTRY_ID = /^[\w-]{1,64}$/;
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
app.get("/p/:id", async (c) => {
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
app.get("/card/:file", async (c) => {
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
app.get("/img/:dir/:name", async (c) => {
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

/* ---------------- admin: GitHub login ---------------- */

const SESSION_COOKIE = "techo_session";
const STATE_COOKIE = "techo_oauth";
const SESSION_DAYS = 30;
const enc = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(msg));
}
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sameText = (a: string, b: string) => {
  const x = enc.encode(a), y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
};
const isLocal = (c: C) => ["localhost", "127.0.0.1"].includes(new URL(c.req.url).hostname);

function authProblem(env: Env): string | null {
  if (!env.GITHUB_CLIENT_ID || !env.ADMIN_GITHUB_LOGIN) return "Worker 未配置 GITHUB_CLIENT_ID / ADMIN_GITHUB_LOGIN（见 wrangler.jsonc）";
  if (!env.GITHUB_CLIENT_SECRET) return "Worker 未配置 GITHUB_CLIENT_SECRET（运行 npx wrangler secret put GITHUB_CLIENT_SECRET）";
  return null;
}
/** its own key, derived from the client secret: rotating the secret logs everyone out */
const sessionKey = (env: Env) => "session:" + env.GITHUB_CLIENT_SECRET;

/** "<expiry ms>.<github login>.<hmac>" — no server-side state to keep */
async function makeSession(env: Env, login: string): Promise<string> {
  const body = `${Date.now() + SESSION_DAYS * 86_400_000}.${login}`;
  return `${body}.${b64url(await hmac(sessionKey(env), body))}`;
}
async function sessionLogin(env: Env, token: string | undefined): Promise<string | null> {
  const m = /^((\d{13,})\.([A-Za-z0-9-]{1,39}))\.([\w-]+)$/.exec(token || "");
  if (!m || Number(m[2]) < Date.now()) return null;
  // the account must still be the allowed one, so changing ADMIN_GITHUB_LOGIN takes effect at once
  if (m[3].toLowerCase() !== env.ADMIN_GITHUB_LOGIN.toLowerCase()) return null;
  return sameText(b64url(await hmac(sessionKey(env), m[1])), m[4]) ? m[3] : null;
}

async function requireLogin(c: C, next: Next) {
  if (c.env.DEV_BYPASS_AUTH === "1" && isLocal(c)) {
    c.set("login", "dev");
    return next();
  }
  const problem = authProblem(c.env);
  if (problem) return bad(c, 500, problem);
  const login = await sessionLogin(c.env, getCookie(c, SESSION_COOKIE));
  if (!login) return bad(c, 401, "请先登录");
  c.set("login", login);
  return next();
}

const callbackUrl = (c: C) => new URL("/api/auth/github/callback", c.req.url).toString();
const backToAdmin = (c: C, err?: string) => c.redirect("/admin/" + (err ? "?login=" + err : ""), 302);

app.get("/api/auth/github", (c) => {
  const problem = authProblem(c.env);
  if (problem) return bad(c, 500, problem);
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)).buffer as ArrayBuffer);
  // Lax, not Strict: it has to come back on GitHub's redirect to the callback
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: !isLocal(c), sameSite: "Lax", path: "/api/auth", maxAge: 600 });
  const u = new URL("https://github.com/login/oauth/authorize");
  u.search = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID, redirect_uri: callbackUrl(c), state, scope: "", allow_signup: "false",
  }).toString();
  return c.redirect(u.toString(), 302);
});

app.get("/api/auth/github/callback", async (c) => {
  const problem = authProblem(c.env);
  if (problem) return bad(c, 500, problem);
  const state = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth", secure: !isLocal(c) });
  const code = c.req.query("code"), got = c.req.query("state");
  if (c.req.query("error")) return backToAdmin(c, "cancelled");
  if (!code || !state || !got || !sameText(state, got)) return backToAdmin(c, "expired");

  const tok = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET, code, redirect_uri: callbackUrl(c),
    }),
  }).then((r) => r.json() as Promise<{ access_token?: string }>).catch(() => ({} as { access_token?: string }));
  if (!tok.access_token) return backToAdmin(c, "failed");
  const user = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "techo-admin" },
  }).then((r) => (r.ok ? (r.json() as Promise<{ login?: string }>) : null)).catch(() => null);
  if (!user?.login) return backToAdmin(c, "failed");
  if (user.login.toLowerCase() !== c.env.ADMIN_GITHUB_LOGIN.toLowerCase()) return backToAdmin(c, "denied");

  setCookie(c, SESSION_COOKIE, await makeSession(c.env, user.login), {
    httpOnly: true, secure: !isLocal(c), sameSite: "Strict", path: "/", maxAge: SESSION_DAYS * 86_400,
  });
  return backToAdmin(c);
});

app.use("/api/admin/*", requireLogin);

app.get("/api/admin/me", (c) => c.json({ login: c.get("login") }));

app.post("/api/admin/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: !isLocal(c) });
  return c.json({ ok: true });
});

/* drafts included */
app.get("/api/admin/entries", async (c) => {
  const [{ results }, locks] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM entries ORDER BY date ASC, created_at ASC").all(), loadLocks(c.env)]);
  c.header("Cache-Control", "no-store");
  return c.json({
    entries: results.map((r) => ({ ...rowToEntry(r), locked: locks.has(String(r.id)), dayLocked: locks.has(dayScope(String(r.date))) })),
    bookLocked: locks.has("book"),
  });
});

/* set, change or take off a password: scope 'book', 'd-YYYY-MM-DD' or an entry id; password null takes the
   lock off */
app.put("/api/admin/locks/:scope", async (c) => {
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

/* place / geo / weather live in columns added by migrations/0003_place_weather.sql. Until that has run a page
   still saves, without them; one that has them says what to run. */
const PLACE_COLS = ["place", "geo", "weather"] as const;
const missingColumn = (e: unknown) => /no (such )?column|has no column named/i.test(String(e));
async function writeEntry(sql: (cols: string[]) => D1PreparedStatement, e: EntryInput) {
  try { return await sql([...PLACE_COLS]).run(); }
  catch (err) {
    if (!missingColumn(err)) throw err;
    if (PLACE_COLS.some((k) => e[k])) throw new HttpError(500, "数据库还没有地点和天气这几列：运行 migrations/0003_place_weather.sql");
    return await sql([]).run();
  }
}
class HttpError extends Error { constructor(public status: 500, message: string) { super(message); } }

app.post("/api/admin/entries", async (c) => {
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
  const row = await c.env.DB.prepare("SELECT * FROM entries WHERE id=?").bind(id).first();
  return c.json({ entry: rowToEntry(row!) }, 201);
});

app.put("/api/admin/entries/:id", async (c) => {
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
  // photos taken off the page aren't used anywhere else
  const keep = new Set(e.photos.map((p) => p.key)), gone = photoKeys(old.photo_key).filter((k) => !keep.has(k));
  if (gone.length) c.executionCtx.waitUntil(c.env.PHOTOS.delete(gone));
  const row = await c.env.DB.prepare("SELECT * FROM entries WHERE id=?").bind(id).first();
  return c.json({ entry: rowToEntry(row!) });
});

/* a page's share card (drawn in the admin's browser: 1200×630 JPEG) */
app.put("/api/admin/entries/:id/card", async (c) => {
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

app.delete("/api/admin/entries/:id", async (c) => {
  const id = c.req.param("id");
  const old = await c.env.DB.prepare("SELECT photo_key FROM entries WHERE id=?").bind(id).first<{ photo_key: string }>();
  if (!old) return bad(c, 404, "这一页不存在");
  await c.env.DB.prepare("DELETE FROM entries WHERE id=?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM locks WHERE scope=?").bind(id).run().catch(() => {});
  c.executionCtx.waitUntil(c.env.PHOTOS.delete([...(old.photo_key ? photoKeys(old.photo_key) : []), CARD_KEY(id)]));
  return c.json({ ok: true });
});

/* the admin's view of the settings: all of them, and whether the AI has its key */
const adminSettings = async (env: Env) => ({ settings: await loadSettings(env), ai: { keySet: !!aiKey(env) }, meting: { secretSet: !!env.METING_TOKEN } });
app.get("/api/admin/settings", async (c) => c.json(await adminSettings(c.env)));

/* 测试连接: one short question with the AI as configured (or as about to be saved: format / base / model in the body) */
app.post("/api/admin/ai/test", async (c) => {
  const o = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const parsed = cleanSettings({ aiFormat: s("aiFormat") || "anthropic", aiBaseUrl: s("aiBaseUrl"), aiModel: s("aiModel") });
  if (!parsed.ok) return bad(c, 400, parsed.error);
  try {
    const ai = await aiConfig(c.env);
    return c.json(await pingAi({
      ...ai, format: parsed.value.aiFormat === "openai" ? "openai" : "anthropic",
      baseURL: parsed.value.aiBaseUrl || "", model: parsed.value.aiModel || DEFAULT_MODEL,
    }));
  } catch (err) {
    return bad(c, 500, err instanceof ComposeError ? err.message : "没连上，稍后再试");
  }
});

/* 一键补全: title, latin, aside, stamp, quote and doodles for a page, from what's written on it. The admin
   fills in only the parts still empty; nothing is saved here. */
app.post("/api/admin/ai/suggest", async (c) => {
  const o = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return bad(c, 400, "请求体必须是 JSON 对象");
  const s = (k: string, max = 4000) => [...(typeof o[k] === "string" ? (o[k] as string).trim() : "")].slice(0, max).join("");
  const body = s("body", 8000);
  if (!body) return bad(c, 400, "先写几句正文，再让 AI 补全");
  try {
    const ai = await aiConfig(c.env);
    const got = await suggestFields(ai, {
      date: s("date", 10), title: s("title", 60), latin: s("latin", 120), aside: s("aside", 60), body, note: s("note", 120),
      stamp: s("stamp", 2), quote: s("quote", 200), quoteSrc: s("quoteSrc", 120), place: s("place", 60), weather: s("weather", 40),
      stickers: (Array.isArray(o.stickers) ? o.stickers : []).filter((k): k is string => typeof k === "string" && STICKERS.has(k)),
    }, STICKER_LABELS);
    // the model's lengths are a request, not a guarantee: cut to what the page holds
    const cut = (v: string, k: string) => [...v.trim()].slice(0, LIMITS[k]).join("");
    return c.json({ suggestion: {
      title: cut(got.title, "title"), latin: cut(got.latin, "latin"), aside: cut(got.aside, "aside"),
      stamp: [...got.stamp.trim()].slice(0, 1).join(""), quote: cut(got.quote, "quote"), quoteSrc: cut(got.quoteSrc, "quoteSrc"),
      stickers: [...new Set(got.stickers.filter((k) => STICKERS.has(k)))].slice(0, MAX_STICKERS),
    } });
  } catch (err) {
    console.error(err);
    return bad(c, 500, err instanceof ComposeError ? err.message : "没补全成，稍后再试");
  }
});

app.put("/api/admin/settings", async (c) => {
  const o = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return bad(c, 400, "请求体必须是 JSON 对象");
  const parsed = cleanSettings(o);
  if (!parsed.ok) return bad(c, 400, parsed.error);
  const before = await loadSettings(c.env);
  const up = c.env.DB.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const pairs = Object.entries(parsed.value);
  if (pairs.length) await c.env.DB.batch(pairs.map(([k, v]) => up.bind(k, v)));
  // cover pictures taken off the cover aren't used anywhere else
  if (parsed.value.coverPhotos !== undefined) {
    const keep = new Set(csv(parsed.value.coverPhotos));
    const gone = csv(before.coverPhotos).filter((k) => !keep.has(k));
    if (gone.length) c.executionCtx.waitUntil(c.env.PHOTOS.delete(gone));
  }
  return c.json(await adminSettings(c.env));
});

/* jots: loose lines written during the day, picked up by the nightly summary.
   Newest first, a page at a time (?limit, at most 200; ?before=<createdAt>.<id> for the page after), searched
   (?q, in the words) and filtered (?state=unused: not yet in a page, used: already in one). */
type JotRow = { id: string; text: string; created_at: number; used_in: string };
app.get("/api/admin/jots", async (c) => {
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
app.post("/api/admin/jots/delete", async (c) => {
  const o = (await c.req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(o?.ids) ? [...new Set(o.ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))] : [];
  if (!ids.length) return bad(c, 400, "没有要删的");
  if (ids.length > 100) return bad(c, 400, "一次最多删 100 条");
  const r = await c.env.DB.prepare(`DELETE FROM jots WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).run();
  return c.json({ deleted: r.meta.changes || 0 });
});

app.post("/api/admin/jots", async (c) => {
  const o = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof o?.text === "string" ? o.text.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return bad(c, 400, "写点什么再记");
  if ([...text].length > 1000) return bad(c, 400, "一条最多 1000 字");
  const id = crypto.randomUUID(), now = Date.now();
  await c.env.DB.prepare("INSERT INTO jots (id, text, created_at) VALUES (?,?,?)").bind(id, text, now).run();
  return c.json({ jot: { id, text, createdAt: now, usedIn: "" } }, 201);
});

app.delete("/api/admin/jots/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM jots WHERE id=?").bind(c.req.param("id")).run();
  if (!r.meta.changes) return bad(c, 404, "这条不存在");
  return c.json({ ok: true });
});

/* ---------------- Claude: jots -> draft page ---------------- */

/** the journal's current day in env.TIMEZONE, with its [start, end) in epoch ms */
function localDay(timeZone: string, now = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(now / 1000) * 1000;
  const start = Date.UTC(+p.year, +p.month - 1, +p.day) - offset;
  return { date: `${p.year}-${p.month}-${p.day}`, start, end: start + 86_400_000 };
}

class ComposeSkip extends Error {}

/** Writes today's unused jots into a draft page. Throws ComposeSkip when there is nothing to do. */
async function composeToday(env: Env): Promise<Entry> {
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

app.post("/api/admin/compose", async (c) => {
  try {
    return c.json({ entry: await composeToday(c.env) }, 201);
  } catch (err) {
    if (err instanceof ComposeSkip) return bad(c, 409, err.message);
    console.error(err);
    return bad(c, 500, err instanceof ComposeError ? err.message : "没写成，稍后再试");
  }
});

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX_PHOTO = 10 * 1024 * 1024;

app.post("/api/admin/photos", async (c) => {
  const type = (c.req.header("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) return bad(c, 415, "只支持 JPEG / PNG / WebP / GIF 图片");
  const len = Number(c.req.header("content-length") || 0);
  if (len > MAX_PHOTO) return bad(c, 413, "图片超过 10MB");
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return bad(c, 400, "空文件");
  if (buf.byteLength > MAX_PHOTO) return bad(c, 413, "图片超过 10MB");
  const key = `p/${crypto.randomUUID()}.${ext}`;
  await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key, url: `/img/${key}` }, 201);
});

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
app.post("/api/admin/lookup", async (c) => {
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
app.post("/api/admin/cover", async (c) => {
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

/* a NetEase share (the app's "分享…的单曲《…》: https://163cn.tv/xxxx (来自@网易云音乐)", or a music.163.com
   link) → the song's id. The short links only say where they go by redirecting, which a browser can't read
   across sites; only NetEase's own hosts are followed. */
const NETEASE_HOSTS = /^(?:163cn\.tv|163cn\.link|(?:y\.)?music\.163\.com)$/i;
const songIdOf = (u: string) => /music\.163\.com\/.*?(?:song\?id=|song\/)(\d+)/.exec(u)?.[1] || (/music\.163\.com/.test(u) ? /[?&]id=(\d+)/.exec(u)?.[1] : undefined);
app.post("/api/admin/netease", async (c) => {
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
app.get("/api/meting", async (c) => { const s = await loadSettings(c.env); return songReply(c, s.metingApi || "", metingToken(c.env, s)); });
/* a sound or a cover that only comes with the token: fetched here from the journal's Meting API, a piece at a
   time as the player asks (Range) */
app.get("/api/meting/file", async (c) => {
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
app.get("/api/admin/meting", async (c) => {
  const api = (c.req.query("api") || "").trim();
  if (api && !/^https:\/\/[^\s]+$/i.test(api)) return bad(c, 400, "Meting API 要以 https:// 开头");
  // (with the token as typed, not saved yet, too)
  const s = await loadSettings(c.env), tok = (c.req.header("x-meting-token") || "").trim();
  return songReply(c, api || s.metingApi || "", tok || metingToken(c.env, s));
});

app.get("/api/admin/weather", async (c) => {
  const date = c.req.query("date") || "", lat = Number(c.req.query("lat")), lon = Number(c.req.query("lon"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return bad(c, 400, "要日期和坐标");
  const s = await loadSettings(c.env);
  // 试一下 in 手帐设置: a key and a host not saved yet
  const key = (c.req.header("x-qweather-key") || "").trim() || s.qweatherKey;
  const host = (c.req.query("host") || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase() || s.qweatherHost;
  if (!key) return c.json({ error: "没配和风天气", off: true }, 404);
  if (host && !/^[a-z0-9.-]+\.(?:qweatherapi\.com|qweather\.com|qweather\.net)$/.test(host)) return bad(c, 400, "和风天气的 API Host 像 abc123.re.qweatherapi.com");
  try {
    return c.json({ weather: await qweatherDay(key, host, date, lat, lon, localDay(c.env.TIMEZONE || "Asia/Shanghai").date), source: "和风天气" });
  } catch (e) {
    return bad(c, 500, e instanceof Error ? e.message : "和风天气连不上");
  }
});

app.all("/api/*", (c) => bad(c, 404, "没有这个接口"));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "服务器出错了，稍后再试" }, 500);
});

// Anything else falls through to static assets.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  // nightly fallback (wrangler.jsonc triggers): if the desktop task hasn't written today's page, write it from the jots
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      composeToday(env).then(
        (e) => console.log("nightly draft written:", e.date, e.title),
        (err) => (err instanceof ComposeSkip ? console.log("nightly skipped:", err.message) : console.error("nightly failed:", err)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
