import { Hono } from "hono";
import { ComposeError, listModels, pingAi, suggestFields, DEFAULT_MODEL, type AiConfig } from "./compose";
import { LIMITS, MAX_STICKERS, STICKERS, STICKER_LABELS } from "./entries";
import { type Env, type HonoEnv, aiKey, bad } from "./env";
import { cleanSettings, loadSettings } from "./settings";

export const admin = new Hono<HonoEnv>();

/** the AI as configured (the admin's settings, the Worker's key) */
export async function aiConfig(env: Env): Promise<AiConfig> {
  if (!aiKey(env)) throw new ComposeError("Worker 还没有 AI 的 key（运行 npx wrangler secret put AI_API_KEY）");
  const s = await loadSettings(env);
  return { apiKey: aiKey(env), baseURL: s.aiBaseUrl || "", model: s.aiModel || DEFAULT_MODEL, format: s.aiFormat === "openai" ? "openai" : "anthropic" };
}

/** the AI as about to be saved: format / base / model from the body, the Worker's key */
async function typedConfig(env: Env, o: Record<string, unknown>): Promise<AiConfig | string> {
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const parsed = cleanSettings({ aiFormat: s("aiFormat") || "anthropic", aiBaseUrl: s("aiBaseUrl"), aiModel: s("aiModel") });
  if (!parsed.ok) return parsed.error;
  return {
    ...(await aiConfig(env)), format: parsed.value.aiFormat === "openai" ? "openai" : "anthropic",
    baseURL: parsed.value.aiBaseUrl || "", model: parsed.value.aiModel || DEFAULT_MODEL,
  };
}

/* 测试连接: one short question with the AI as configured (or as about to be saved) */
admin.post("/api/admin/ai/test", async (c) => {
  const o = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const ai = await typedConfig(c.env, o);
    if (typeof ai === "string") return bad(c, 400, ai);
    return c.json(await pingAi(ai));
  } catch (err) {
    return bad(c, 500, err instanceof ComposeError ? err.message : "没连上，稍后再试");
  }
});

/* 获取模型: what the key can use at that address (the format and address as typed, saved or not) */
admin.post("/api/admin/ai/models", async (c) => {
  const o = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const ai = await typedConfig(c.env, o);
    if (typeof ai === "string") return bad(c, 400, ai);
    return c.json({ models: await listModels(ai) });
  } catch (err) {
    return bad(c, 500, err instanceof ComposeError ? err.message : "没取到模型列表，稍后再试");
  }
});

/* 一键补全: title, latin, aside, stamp, quote and doodles for a page, from what's written on it. The admin
   fills in only the parts still empty; nothing is saved here. */
admin.post("/api/admin/ai/suggest", async (c) => {
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
