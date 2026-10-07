import type { Context } from "hono";

export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  /** GitHub OAuth App (see docs/deploy.md). The client id is public; the secret also keys the session cookie. */
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
      when it isn't set. A key pasted into the admin wins over both (env.ts currentAiKey). */
  AI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** secret: the token for a Meting API that asks for one, when 手帐设置 has none (`wrangler secret put METING_TOKEN`) */
  METING_TOKEN?: string;
  /** IANA zone the journal's days follow, e.g. Asia/Shanghai */
  TIMEZONE: string;
  /** Workers version metadata (wrangler.jsonc): the id of this deploy, part of the edge cache's keys (cache.ts) */
  CF_VERSION_METADATA?: { id: string };
  /** "1": a local `wrangler dev` uses the edge cache too (it builds every page each time otherwise) */
  CACHE_LOCAL?: string;
  /** rate limit for password guesses (wrangler.jsonc "ratelimits"); missing: no limit */
  UNLOCK_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
};
/** login: the GitHub account behind the admin session */
export type HonoEnv = { Bindings: Env; Variables: { login: string } };
export type C = Context<HonoEnv>;

export const bad = (c: C, status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 500, error: string) => c.json({ error }, status);

/** the journal's current day in env.TIMEZONE, with its [start, end) in epoch ms */
export function localDay(timeZone: string, now = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(now / 1000) * 1000;
  const start = Date.UTC(+p.year, +p.month - 1, +p.day) - offset;
  return { date: `${p.year}-${p.month}-${p.day}`, start, end: start + 86_400_000 };
}

/** the AI's key as a Worker secret */
export const aiKey = (env: Env) => env.AI_API_KEY || env.ANTHROPIC_API_KEY || "";

/* The AI's key can also be pasted into the admin (手帐设置 → AI). It sits in the settings table under its own
   row, outside SETTING_DEFAULTS, so loadSettings, /api/settings and the admin's settings never carry it:
   it is written by PUT /api/admin/ai/key and read only here. Pasted wins over the Worker secret. */
export const AI_KEY_ROW = "aiApiKey";
export async function savedAiKey(env: Env): Promise<string> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(AI_KEY_ROW).first<{ value: string }>();
  return r?.value || "";
}
/** the key the AI is asked with; "" = the AI features are off */
export const currentAiKey = async (env: Env) => (await savedAiKey(env)) || aiKey(env);
/** what the admin is told about the key: whether there is one, where it's from, and its last 4 characters */
export async function aiKeyStatus(env: Env): Promise<{ keySet: boolean; source: "admin" | "secret" | ""; tail: string }> {
  const saved = await savedAiKey(env), key = saved || aiKey(env);
  return { keySet: !!key, source: saved ? "admin" : key ? "secret" : "", tail: key.length > 12 ? key.slice(-4) : "" };
}
