/* techo on a VPS (Node 22+): the same Worker (src/index.ts) behind a Node HTTP server, with what Cloudflare gives it
   made here: D1 → a SQLite file, R2 → a folder, static assets → public/, the rate limit → memory, the nightly cron →
   a timer. Built to dist/server.mjs (npm run build:server); docs/deploy-vps.md says how to run it.

     node dist/server.mjs                       serve (PORT, default 8787)
     node dist/server.mjs import-d1 <dump.sql>  a fresh database from `wrangler d1 export` (moving off Cloudflare)
     node dist/server.mjs export-d1 <out.sql>   the database as SQL for `wrangler d1 execute --file` (moving to Cloudflare)
     node dist/server.mjs backup                a copy of the database, whole even while it is being written to,
                                                as data/backups/techo-<time>.db (the photos are files: copy them)
*/
import { serve } from '@hono/node-server';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.ts';
import { openD1, migrate, dumpSql } from './d1.mjs';
import { fsBucket } from './bucket.mjs';
import { staticAssets } from './assets.mjs';
import { rateLimiter } from './limit.mjs';
import { nextRun } from './cron.mjs';
import { asWorkerRequest } from './request.mjs';

// (the Workers runtime has crypto.subtle.timingSafeEqual, Node keeps it in node:crypto)
if (!crypto.subtle.timingSafeEqual) crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a.buffer ?? a, a.byteOffset ?? 0, a.byteLength), Buffer.from(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength));

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // dist/ or server/, one level down
const cfg = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  data: resolve(process.env.DATA_DIR || join(ROOT, 'data')),
  public: resolve(process.env.PUBLIC_DIR || join(ROOT, 'public')),
  // behind Caddy / nginx: the address and the https the reader used come in X-Forwarded-* (set it to 0 when the
  // server faces the internet itself, so a reader can't make them up)
  trustProxy: (process.env.TRUST_PROXY ?? '1') !== '0',
  // when the nightly draft is written: a cron line, minute and hour in UTC (wrangler.jsonc has the same)
  nightly: process.env.NIGHTLY_CRON || '30 15 * * *',
};

const DB = openD1(join(cfg.data, 'techo.db'));

if (process.argv[2] === 'import-d1') {
  const file = process.argv[3];
  if (!file || !existsSync(file)) { console.error('用法：node dist/server.mjs import-d1 <wrangler d1 export 导出的 .sql>'); process.exit(2); }
  const has = DB.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n;
  if (has) { console.error(`${join(cfg.data, 'techo.db')} 里已经有表了：导入要一个空的库（换一个空的 DATA_DIR，或者先把它移走）`); process.exit(1); }
  DB.db.exec(readFileSync(file, 'utf8'));
  migrate(DB, ROOT);
  const n = DB.db.prepare('SELECT count(*) AS n FROM entries').get().n;
  console.log(`导入完成：${n} 页。照片另外拷到 ${join(cfg.data, 'photos')}（见 docs/deploy-vps.md）`);
  process.exit(0);
}

migrate(DB, ROOT);

if (process.argv[2] === 'export-d1') {
  const file = process.argv[3];
  if (!file) { console.error('用法：node dist/server.mjs export-d1 <输出的 .sql>'); process.exit(2); }
  writeFileSync(file, dumpSql(DB.db));
  console.log(`导出完成：${file}。导入 Cloudflare：npx wrangler d1 execute techo-db --remote --file=${file}`);
  process.exit(0);
}

if (process.argv[2] === 'backup') {
  const dir = join(cfg.data, 'backups'), file = join(dir, `techo-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}.db`);
  mkdirSync(dir, { recursive: true });
  DB.db.prepare('VACUUM INTO ?').run(file);
  console.log('数据库备份：' + file);
  process.exit(0);
}

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string')),
  DB,
  PHOTOS: fsBucket(join(cfg.data, 'photos')),
  ASSETS: staticAssets(cfg.public),
  UNLOCK_LIMIT: rateLimiter({ limit: 10, period: 60 }),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Shanghai',
};
// the login is never skipped on a server: DEV_BYPASS_AUTH is for one's own computer (`wrangler dev`, or this with
// TECHO_DEV=1), and even then only for a request to localhost
if (env.TECHO_DEV !== '1') delete env.DEV_BYPASS_AUTH;
for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ADMIN_GITHUB_LOGIN']) if (!env[k]) console.warn(`没有设置 ${k}：后台登录不了（见 .env.example）`);

/** waitUntil: the work after an answer is sent (deleting old photos…), kept so a shutdown waits for it */
const pending = new Set();
const ctx = () => ({
  waitUntil(p) { const q = Promise.resolve(p).catch((e) => console.error('waitUntil:', e)).finally(() => pending.delete(q)); pending.add(q); },
  passThroughOnException() {},
  props: {},
});

const server = serve({
  hostname: cfg.host, port: cfg.port,
  fetch: (req, bindings) => worker.fetch(asWorkerRequest(req, { trustProxy: cfg.trustProxy, remoteAddress: bindings?.incoming?.socket?.remoteAddress }), env, ctx()),
}, (info) => console.log(`techo: http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${info.port}  数据：${cfg.data}`));

// the nightly draft, as Cloudflare's cron trigger would
let timer;
const schedule = () => {
  const at = nextRun(cfg.nightly, new Date());
  timer = setTimeout(async () => {
    const c = ctx();
    try { await worker.scheduled({ cron: cfg.nightly, scheduledTime: at.getTime(), noRetry() {} }, env, c); await Promise.all(pending); }
    catch (e) { console.error('nightly:', e); }
    schedule();
  }, Math.max(1000, at.getTime() - Date.now()));
  timer.unref?.();
};
schedule();

const stop = async () => {
  clearTimeout(timer);
  server.close();
  await Promise.allSettled([...pending]);
  DB.db.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
