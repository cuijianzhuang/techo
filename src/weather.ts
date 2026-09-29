import { Hono } from "hono";
import { qweatherDay } from "./qweather";
import { type HonoEnv, bad, localDay } from "./env";
import { loadSettings } from "./settings";

export const admin = new Hono<HonoEnv>();

admin.get("/api/admin/weather", async (c) => {
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
