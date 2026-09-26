import { Hono } from "hono";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { ComposeError, composePage } from "./compose";

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
  /** secret: `wrangler secret put ANTHROPIC_API_KEY`; without it the Claude features are off */
  ANTHROPIC_API_KEY?: string;
  /** IANA zone the journal's days follow, e.g. Asia/Shanghai */
  TIMEZONE: string;
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
  title: 30, latin: 60, stamp: 2, aside: 30, body: 4000, note: 60, quote: 120, quoteSrc: 60, photoCap: 30,
};
const PHOTO_KEY = /^p\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;

function rowToEntry(r: Record<string, unknown>): Entry {
  return {
    id: String(r.id), date: String(r.date), title: String(r.title), latin: String(r.latin),
    stamp: String(r.stamp), aside: String(r.aside), body: String(r.body), note: String(r.note),
    mood: (r.mood as Entry["mood"]) || "mug", quote: String(r.quote), quoteSrc: String(r.quote_src),
    photoKey: String(r.photo_key), photoCap: String(r.photo_cap),
    stickers: String(r.stickers || "").split(",").filter((k) => STICKERS.has(k)),
    status: r.status === "draft" ? "draft" : "published",
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}

type EntryInput = Omit<Entry, "id" | "createdAt" | "updatedAt" | "status"> & { status?: Entry["status"] };

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
  const photoKey = str("photoKey");
  if (photoKey && !PHOTO_KEY.test(photoKey)) return { ok: false, error: "photoKey 无效" };
  const rawStk: unknown[] = Array.isArray(o.stickers) ? o.stickers : typeof o.stickers === "string" ? o.stickers.split(",") : [];
  const stickers = [...new Set(rawStk.map((k) => String(k).trim()).filter(Boolean))];
  if (stickers.some((k) => !STICKERS.has(k))) return { ok: false, error: "有不认识的插画" };
  if (stickers.length > MAX_STICKERS) return { ok: false, error: `插画最多 ${MAX_STICKERS} 个` };
  const status = str("status");
  if (status && status !== "draft" && status !== "published") return { ok: false, error: "status 只能是 draft / published" };
  return {
    ok: true,
    value: {
      date, title: v.title, latin: v.latin, stamp: v.stamp, aside: v.aside, body: v.body, note: v.note,
      mood: mood as Entry["mood"], quote: v.quote, quoteSrc: v.quoteSrc, photoKey, photoCap: v.photoCap,
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
};
/** max length (characters) per text setting */
const SETTING_MAX: Record<string, number> = {
  email: 120, github: 200, githubText: 60, siteTitle: 40, siteDesc: 120, coverTitle: 16, coverSub: 40,
  readmeName: 30, readmeRole: 40, readmeLife: 60, readmeSince: 20, readmeSign: 30, backTitle: 12, backImprint: 80,
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
  return { ok: true, value: v };
}

app.get("/api/entries", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ entries: await loadPublished(c.env) });
});

app.get("/api/settings", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ settings: await loadSettings(c.env) });
});

/* The book's page: title and description from the settings, and the data inlined so book.js needn't fetch it. */
app.get("/", async (c) => {
  const [page, settings, entries] = await Promise.all([c.env.ASSETS.fetch(c.req.raw), loadSettings(c.env), loadPublished(c.env)]);
  if (!page.ok) return page;
  // "<" escaped so nothing in a journal page can close the script tag
  const data = JSON.stringify({ entries, settings }).replace(/</g, "\\u003c");
  const res = new HTMLRewriter()
    .on("title", { element: (e) => { e.setInnerContent(settings.siteTitle || SETTING_DEFAULTS.siteTitle); } })
    .on('meta[name="description"]', { element: (e) => { e.setAttribute("content", settings.siteDesc); } })
    .on('script[src="/assets/book.js"]', { element: (e) => { e.before(`<script>window.TECHO_DATA=${data}</script>`, { html: true }); } })
    .transform(page);
  const h = new Headers(res.headers);
  h.set("Cache-Control", "no-cache");
  return new Response(res.body, { status: res.status, headers: h });
});

/* Photos from R2. Keys are random UUIDs and never reused, so they cache forever. */
app.get("/img/:dir/:name", async (c) => {
  const key = `${c.req.param("dir")}/${c.req.param("name")}`;
  if (!PHOTO_KEY.test(key)) return c.notFound();
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.notFound();
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("ETag", obj.httpEtag);
  h.set("Cache-Control", "public, max-age=31536000, immutable");
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
  const { results } = await c.env.DB.prepare("SELECT * FROM entries ORDER BY date ASC, created_at ASC").all();
  c.header("Cache-Control", "no-store");
  return c.json({ entries: results.map(rowToEntry) });
});

app.post("/api/admin/entries", async (c) => {
  const parsed = cleanEntry(await c.req.json().catch(() => null));
  if (!parsed.ok) return bad(c, 400, parsed.error);
  const e = parsed.value, now = Date.now(), id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO entries (id,date,title,latin,stamp,aside,body,note,mood,quote,quote_src,photo_key,photo_cap,stickers,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, e.date, e.title, e.latin, e.stamp, e.aside, e.body, e.note, e.mood, e.quote, e.quoteSrc, e.photoKey, e.photoCap,
    e.stickers.join(","), e.status || "published", now, now).run();
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
  await c.env.DB.prepare(
    `UPDATE entries SET date=?,title=?,latin=?,stamp=?,aside=?,body=?,note=?,mood=?,quote=?,quote_src=?,photo_key=?,photo_cap=?,stickers=?,status=?,updated_at=? WHERE id=?`,
  ).bind(e.date, e.title, e.latin, e.stamp, e.aside, e.body, e.note, e.mood, e.quote, e.quoteSrc, e.photoKey, e.photoCap,
    e.stickers.join(","), e.status || old.status, Date.now(), id).run();
  if (old.photo_key && old.photo_key !== e.photoKey) c.executionCtx.waitUntil(c.env.PHOTOS.delete(old.photo_key));
  const row = await c.env.DB.prepare("SELECT * FROM entries WHERE id=?").bind(id).first();
  return c.json({ entry: rowToEntry(row!) });
});

app.delete("/api/admin/entries/:id", async (c) => {
  const id = c.req.param("id");
  const old = await c.env.DB.prepare("SELECT photo_key FROM entries WHERE id=?").bind(id).first<{ photo_key: string }>();
  if (!old) return bad(c, 404, "这一页不存在");
  await c.env.DB.prepare("DELETE FROM entries WHERE id=?").bind(id).run();
  if (old.photo_key) c.executionCtx.waitUntil(c.env.PHOTOS.delete(old.photo_key));
  return c.json({ ok: true });
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
  return c.json({ settings: await loadSettings(c.env) });
});

/* jots: loose lines written during the day, picked up by the nightly summary */
app.get("/api/admin/jots", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, text, created_at, used_in FROM jots ORDER BY created_at DESC LIMIT 100",
  ).all<{ id: string; text: string; created_at: number; used_in: string }>();
  c.header("Cache-Control", "no-store");
  return c.json({ jots: results.map((r) => ({ id: r.id, text: r.text, createdAt: r.created_at, usedIn: r.used_in })) });
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
  if (!env.ANTHROPIC_API_KEY) throw new ComposeError("Worker 未配置 ANTHROPIC_API_KEY");
  const day = localDay(env.TIMEZONE || "Asia/Shanghai");
  const has = await env.DB.prepare("SELECT id FROM entries WHERE date=? LIMIT 1").bind(day.date).first();
  if (has) throw new ComposeSkip("今天已经有一页了");
  const { results: jots } = await env.DB.prepare(
    "SELECT id, text, created_at FROM jots WHERE used_in='' AND created_at>=? AND created_at<? ORDER BY created_at",
  ).bind(day.start, day.end).all<{ id: string; text: string; created_at: number }>();
  if (!jots.length) throw new ComposeSkip("今天还没有随手记");

  const page = await composePage(
    env.ANTHROPIC_API_KEY, day.date,
    jots.map((j) => ({ text: j.text, createdAt: j.created_at })),
    STICKER_LABELS, env.TIMEZONE || "Asia/Shanghai",
  );
  // Claude's lengths are a request, not a guarantee: trim to what the page holds before the usual validation
  const cut = (v: unknown, k: string) => [...(typeof v === "string" ? v.trim() : "")].slice(0, LIMITS[k]).join("");
  const parsed = cleanEntry({
    date: day.date, title: cut(page.title, "title"), latin: cut(page.latin, "latin"), aside: cut(page.aside, "aside"),
    body: cut(page.body, "body"), note: cut(page.note, "note"), stamp: [...(page.stamp || "")].slice(0, 1).join(""),
    mood: page.mood === "sleep" ? "sleep" : "mug",
    stickers: (Array.isArray(page.stickers) ? page.stickers : []).filter((k) => STICKERS.has(k)).slice(0, MAX_STICKERS),
    status: "draft",
  });
  if (!parsed.ok) throw new ComposeError("Claude 写的内容不合格式：" + parsed.error);
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
    return bad(c, 500, err instanceof ComposeError ? err.message : "Claude 没写成，稍后再试");
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
