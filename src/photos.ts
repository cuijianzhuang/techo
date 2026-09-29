import { Hono } from "hono";
import { bumpVersion } from "./cache";
import { photoId } from "./entries";
import { type Env, type HonoEnv, bad, localDay } from "./env";

export const admin = new Hono<HonoEnv>();

/* Moving the photos that were put in R2 before there were day folders (p/<uuid>.jpg) into them
   (p/YYYY/MM/DD/<uuid>.jpg), by hand and in steps, from 手帐设置 → 照片文件夹. Nothing here runs by itself.

     preview  what would move, and how many objects sit loose under p/ (nothing is changed)
     copy     a few pages at a time: the photo is copied to its folder and checked, and only then does the page (or
              the cover) point at the new address; the old object stays
     cleanup  deletes an old object once the new one is there and the same size, and nothing points at the old any more

   A photo keeps its name (the uuid) in the new folder, so a page's lock finds it at either address (share.ts).
   Every step can be repeated, and stopped and taken up again. A photo that a page (or the cover) doesn't use is
   only counted, never moved or deleted. */

const OLD = /^p\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
const csv = (v: string) => v.split(",").filter(Boolean);
// (each photo costs an object read, a write and a database update: a Worker may make only so many of those a request)
const LIMITS = { preview: 0, copy: [4, 15], cleanup: [25, 100] } as const;

/** what points at photos: a page's photo_key, or the cover's list (settings.coverPhotos) */
type Group = { kind: "entry" | "cover"; id: string; value: string; keys: string[]; day?: string };

async function groups(env: Env): Promise<Group[]> {
  const out: Group[] = [];
  const { results } = await env.DB.prepare("SELECT id, date, photo_key FROM entries WHERE photo_key != '' ORDER BY date ASC, created_at ASC").all<{ id: string; date: string; photo_key: string }>();
  for (const r of results) {
    const keys = csv(r.photo_key).filter((k) => OLD.test(k));
    if (keys.length) out.push({ kind: "entry", id: r.id, value: r.photo_key, keys, day: /^20\d\d-\d\d-\d\d$/.test(r.date) ? r.date : undefined });
  }
  const cover = await env.DB.prepare("SELECT value FROM settings WHERE key='coverPhotos'").first<{ value: string }>();
  const keys = cover ? csv(cover.value).filter((k) => OLD.test(k)) : [];
  if (cover && keys.length) out.push({ kind: "cover", id: "cover", value: cover.value, keys });
  return out;
}

/** where a photo goes: its folder, and its own name */
const target = (day: string, from: string) => `p/${day.replace(/-/g, "/")}/${photoId(from)}${from.slice(from.lastIndexOf("."))}`;

/** the day a cover picture is filed under: when it was uploaded (no page has it) */
async function coverDay(env: Env, from: string): Promise<string | null> {
  const head = await env.PHOTOS.head(from);
  return head ? localDay(env.TIMEZONE || "Asia/Shanghai", head.uploaded.getTime()).date : null;
}

/** the objects loose directly under p/ (one call: the first thousand) */
async function loose(env: Env) {
  const l = await env.PHOTOS.list({ prefix: "p/", delimiter: "/", limit: 1000 });
  return { objects: l.objects.filter((o) => OLD.test(o.key)), truncated: l.truncated };
}

const pick = (v: unknown, [dflt, max]: readonly [number, number]) => {
  const n = v === undefined ? dflt : Number(v);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
};

admin.post("/api/admin/photos/migrate", async (c) => {
  const o = ((await c.req.json().catch(() => null)) || {}) as { step?: unknown; limit?: unknown };
  const step = o.step === undefined ? "preview" : o.step;
  if (step !== "preview" && step !== "copy" && step !== "cleanup") return bad(c, 400, "step 只能是 preview / copy / cleanup");
  const env = c.env;
  c.header("Cache-Control", "no-store");
  const all = await groups(env);
  const points = all.reduce((n, g) => n + g.keys.length, 0);

  if (step === "preview") {
    const { objects, truncated } = await loose(env);
    const used = new Set(all.flatMap((g) => g.keys));
    const plan: { from: string; to: string | null; source: string }[] = [];
    for (const g of all) {
      for (const from of g.keys) {
        if (plan.length >= 30) break;
        const day = g.kind === "entry" ? g.day : await coverDay(env, from);
        plan.push({ from, to: day ? target(day, from) : null, source: g.kind === "cover" ? "cover" : `entry:${g.id}` });
      }
    }
    return c.json({ step, toMove: points, plan, loose: objects.length, looseTruncated: truncated, unused: objects.filter((x) => !used.has(x.key)).length });
  }

  if (step === "copy") {
    const limit = pick(o.limit, LIMITS.copy);
    if (limit === null) return bad(c, 400, `limit 是 1 到 ${LIMITS.copy[1]}`);
    let copied = 0, changed = false;
    const skipped: { key: string; why: string }[] = [];
    for (const g of all.slice(0, limit)) {
      const moved = new Map<string, string>();
      for (const from of g.keys) {
        const day = g.kind === "entry" ? g.day : await coverDay(env, from);
        if (!day) { skipped.push({ key: from, why: g.kind === "entry" ? "日期不对" : "R2 里没有这张" }); continue; }
        const to = target(day, from), src = await env.PHOTOS.get(from);
        if (!src) { skipped.push({ key: from, why: "R2 里没有这张" }); continue; }
        const buf = await src.arrayBuffer();
        const put = await env.PHOTOS.put(to, buf, { httpMetadata: src.httpMetadata, customMetadata: src.customMetadata });
        if (put.size !== buf.byteLength) { skipped.push({ key: from, why: "复制后大小对不上" }); continue; }
        moved.set(from, to);
      }
      if (!moved.size) continue;
      // the page (or the cover) points at the new addresses only now that they are there; if it was changed since it
      // was read, it is left as it is and taken up again next time
      const value = csv(g.value).map((k) => moved.get(k) ?? k).join(",");
      const done = g.kind === "entry"
        ? await env.DB.prepare("UPDATE entries SET photo_key=? WHERE id=? AND photo_key=?").bind(value, g.id, g.value).run()
        : await env.DB.prepare("UPDATE settings SET value=? WHERE key='coverPhotos' AND value=?").bind(value, g.value).run();
      if (done.meta && done.meta.changes === 0) { skipped.push({ key: g.keys.join(","), why: "中途被改过，下次再来" }); continue; }
      copied += moved.size; changed = true;
    }
    if (changed) await bumpVersion(env);
    const left = (await groups(env)).reduce((n, g) => n + g.keys.length, 0);
    return c.json({ step, copied, skipped, remaining: left });
  }

  // cleanup: a loose object goes once its page points at the same photo in a folder, that copy is there and the same size
  const limit = pick(o.limit, LIMITS.cleanup);
  if (limit === null) return bad(c, 400, `limit 是 1 到 ${LIMITS.cleanup[1]}`);
  const { objects, truncated } = await loose(env);
  const used = new Set(all.flatMap((g) => g.keys));   // still pointed at
  // what the pages point at now, by photo name
  const there = new Map<string, string>();
  const rows = await env.DB.prepare("SELECT photo_key FROM entries WHERE photo_key != ''").all<{ photo_key: string }>();
  const cover = await env.DB.prepare("SELECT value FROM settings WHERE key='coverPhotos'").first<{ value: string }>();
  for (const list of [...rows.results.map((r) => r.photo_key), cover?.value || ""]) for (const k of csv(list)) if (!OLD.test(k)) there.set(photoId(k), k);
  const gone: string[] = [], kept: { key: string; why: string }[] = [];
  let looked = 0;   // (only a look at the new copy costs a call to R2, and only those are counted against the limit)
  for (const obj of objects) {
    if (looked >= limit) break;
    if (used.has(obj.key)) { kept.push({ key: obj.key, why: "页面还在用" }); continue; }
    const next = there.get(photoId(obj.key));
    if (!next) { kept.push({ key: obj.key, why: "没有页面用它，不动" }); continue; }
    looked++;
    const head = await env.PHOTOS.head(next);
    if (!head || head.size !== obj.size) { kept.push({ key: obj.key, why: "新位置的文件不在或大小对不上" }); continue; }
    gone.push(obj.key);
  }
  if (gone.length) await env.PHOTOS.delete(gone);
  const rest = objects.length - gone.length;
  return c.json({ step, deleted: gone.length, kept: kept.slice(0, 30), keptCount: kept.length, loose: rest, looseTruncated: truncated });
});
