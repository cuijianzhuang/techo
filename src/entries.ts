import { type Env } from "./env";

/* ---------------- entries: validation & mapping ---------------- */

export type Entry = {
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
export const STICKER_LABELS: Record<string, string> = {
  sun: "晴天", cloud: "多云", rain: "下雨", moon: "月亮/夜里", cat: "猫", book: "书/读书", laptop: "电脑/写代码",
  bug: "修 bug", plant: "植物", noodles: "吃饭", bus: "通勤/出门", bike: "骑车/运动", music: "音乐",
  heart: "开心/温暖", star: "好事/小成就", letter: "来信/消息", camera: "拍照",
};

export const STICKERS = new Set(Object.keys(STICKER_LABELS));
export const MAX_STICKERS = 2;

export const LIMITS: Record<string, number> = {
  title: 30, latin: 60, stamp: 2, aside: 30, body: 8000, note: 60, quote: 120, quoteSrc: 60, photoCap: 30, place: 30, weather: 20,
};

export const PHOTO_KEY = /^p\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
/* what is kept in R2: a photo (up to MAX_PHOTO, of these types) and the card drawn for a page (the picture it is shared as) */
export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
export const MAX_PHOTO = 10 * 1024 * 1024;
export const CARD_KEY = (id: string) => `cards/${id}.jpg`;
export const ENTRY_ID = /^[\w-]{1,64}$/;

/* A page holds up to MAX_PHOTOS photos, kept in the columns that held one: photo_key is their keys joined by
   commas, photo_cap their captions one per line (so an older database needs no migration). */
type Photo = { key: string; cap: string };
const MAX_PHOTOS = 3;
export const photoKeys = (col: unknown) => String(col || "").split(",").filter(Boolean);
function photosOf(keyCol: unknown, capCol: unknown): Photo[] {
  const caps = String(capCol || "").split("\n");
  return photoKeys(keyCol).map((key, i) => ({ key, cap: caps[i] || "" }));
}

export function rowToEntry(r: Record<string, unknown>): Entry {
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

export type EntryInput = Omit<Entry, "id" | "createdAt" | "updatedAt" | "status"> & { status?: Entry["status"] };
/** the two columns the photos are kept in */
export const photoCols = (photos: Photo[]) => [photos.map((p) => p.key).join(","), photos.map((p) => p.cap).join("\n")];

export function cleanEntry(input: unknown): { ok: true; value: EntryInput } | { ok: false; error: string } {
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

/* What a view needs of the published pages, taken out of the database as such, so the Worker never holds (or
   parses) more of them than it sends:
   full / index  every column (index only ever for a stretch of a hundred or so, or the rare ask for them all),
   map           the pages with a place, and only what the map draws,
   cards         id, date, title, and the words only of pages that hold a card or a NetEase link (the same test
                 as hasCards in text.ts, done here where the words are);
   with `page`, a stretch: `limit` of them newest first, older than the page `before`, read through the date index
   (LIMIT, not the whole table), and what the whole list is (how many, how many days, first, last, more before). */
export type EntriesView = "full" | "index" | "map" | "cards";
const COLS: Record<EntriesView, string> = {
  full: "*", index: "*",
  map: "id, date, title, place, geo, weather, created_at",
  cards: "id, date, title, created_at, CASE WHEN instr(body, '```') > 0 OR instr(body, 'music.163.com') > 0 OR instr(body, '163cn.tv') > 0 THEN body ELSE '' END AS body",
};
export type PageMeta = { total: number; days: number; first: string; last: string; more: boolean };
export async function selectEntries(env: Env, view: EntriesView, page?: { limit: number; before?: string }): Promise<{ rows: Record<string, unknown>[]; meta?: PageMeta }> {
  const where = "status='published'" + (view === "map" ? " AND geo != ''" : "");
  if (!page) {
    const { results } = await env.DB.prepare(`SELECT ${COLS[view]} FROM entries WHERE ${where} ORDER BY date ASC, created_at ASC, rowid ASC`).all();
    return { rows: results };
  }
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT date) AS d, MIN(date) AS f, MAX(date) AS l FROM entries WHERE ${where}`)
    .first<{ n: number; d: number; f: string | null; l: string | null }>();
  const meta = { total: total?.n ?? 0, days: total?.d ?? 0, first: total?.f || "", last: total?.l || "", more: false };
  let after = "";
  const args: unknown[] = [];
  if (page.before) {
    // (date, created_at, rowid) is the order of the date index: the stretch is read from where the last one was
    const at = await env.DB.prepare(`SELECT date, created_at, rowid AS rid FROM entries WHERE id = ? AND ${where}`).bind(page.before).first<{ date: string; created_at: number; rid: number }>();
    if (!at) return { rows: [], meta };            // a page taken down since: nothing before it to show
    after = " AND (date, created_at, rowid) < (?, ?, ?)";
    args.push(at.date, at.created_at, at.rid);
  }
  const { results } = await env.DB.prepare(`SELECT ${COLS[view]} FROM entries WHERE ${where}${after} ORDER BY date DESC, created_at DESC, rowid DESC LIMIT ?`)
    .bind(...args, page.limit + 1).all();
  return { rows: results.slice(0, page.limit), meta: { ...meta, more: results.length > page.limit } };
}

/* place / geo / weather live in columns added by migrations/0003_place_weather.sql. Until that has run a page
   still saves, without them; one that has them says what to run. */
const PLACE_COLS = ["place", "geo", "weather"] as const;
const missingColumn = (e: unknown) => /no (such )?column|has no column named/i.test(String(e));
export async function writeEntry(sql: (cols: string[]) => D1PreparedStatement, e: EntryInput) {
  try { return await sql([...PLACE_COLS]).run(); }
  catch (err) {
    if (!missingColumn(err)) throw err;
    if (PLACE_COLS.some((k) => e[k])) throw new HttpError(500, "数据库还没有地点和天气这几列：运行 migrations/0003_place_weather.sql");
    return await sql([]).run();
  }
}

export class HttpError extends Error { constructor(public status: 500, message: string) { super(message); } }
