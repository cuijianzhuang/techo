import type { Context } from "hono";

export type Env = {
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

/** the key the AI is asked with (a Worker secret); without one the AI features are off */
export const aiKey = (env: Env) => env.AI_API_KEY || env.ANTHROPIC_API_KEY || "";
