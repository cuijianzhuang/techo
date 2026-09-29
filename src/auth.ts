import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Next } from "hono";
import { b64url, hmac, sameText } from "./crypto";
import { type C, type Env, type HonoEnv, bad } from "./env";

export const pub = new Hono<HonoEnv>();
export const admin = new Hono<HonoEnv>();

/* ---------------- admin: GitHub login ---------------- */

export const SESSION_COOKIE = "techo_session";
const STATE_COOKIE = "techo_oauth";
const SESSION_DAYS = 30;
export const isLocal = (c: C) => ["localhost", "127.0.0.1"].includes(new URL(c.req.url).hostname);

export function authProblem(env: Env): string | null {
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

export async function sessionLogin(env: Env, token: string | undefined): Promise<string | null> {
  const m = /^((\d{13,})\.([A-Za-z0-9-]{1,39}))\.([\w-]+)$/.exec(token || "");
  if (!m || Number(m[2]) < Date.now()) return null;
  // the account must still be the allowed one, so changing ADMIN_GITHUB_LOGIN takes effect at once
  if (m[3].toLowerCase() !== env.ADMIN_GITHUB_LOGIN.toLowerCase()) return null;
  return sameText(b64url(await hmac(sessionKey(env), m[1])), m[4]) ? m[3] : null;
}

export async function requireLogin(c: C, next: Next) {
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

pub.get("/api/auth/github", (c) => {
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

pub.get("/api/auth/github/callback", async (c) => {
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

admin.get("/api/admin/me", (c) => c.json({ login: c.get("login") }));

admin.post("/api/admin/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: !isLocal(c) });
  return c.json({ ok: true });
});
