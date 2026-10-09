/* The VPS server (server/): what stands in for Cloudflare there — D1 over a SQLite file, R2 over a folder, the static
   assets, the rate limit, the nightly cron — on their own, and the Worker run on them end to end */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openD1, migrate, statements } from '../server/d1.mjs';
import { fsBucket } from '../server/bucket.mjs';
import { staticAssets } from '../server/assets.mjs';
import { rateLimiter } from '../server/limit.mjs';
import { nextRun } from '../server/cron.mjs';
import { loadApp } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'techo-vps-'));

test('D1 on SQLite: first / all / run / batch as D1 answers them', async () => {
  const d1 = openD1(':memory:');
  migrate(d1, ROOT);
  await d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind('a', '1').run();
  assert.deepEqual(await d1.prepare('SELECT key, value FROM settings WHERE key=?').bind('a').first(), { key: 'a', value: '1' });
  assert.equal(await d1.prepare('SELECT value FROM settings WHERE key=?').bind('a').first('value'), '1');
  assert.equal(await d1.prepare('SELECT value FROM settings WHERE key=?').bind('nope').first(), null);
  const r = await d1.prepare("UPDATE settings SET value='2' WHERE key=?").bind('a').run();
  assert.equal(r.meta.changes, 1);
  assert.deepEqual((await d1.prepare("SELECT value FROM settings WHERE key='a'").all()).results, [{ value: '2' }]);
  // a batch is all or nothing
  const up = d1.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  await assert.rejects(d1.batch([up.bind('b', '1'), up.bind('a', 'again')]));
  assert.equal(await d1.prepare("SELECT value FROM settings WHERE key='b'").first(), null);
});

test('migrations: a new database gets the whole schema, an older one the columns it lacks, and again is nothing', async () => {
  const dir = tmp(), file = join(dir, 'old.db');
  const old = openD1(file);
  // a database from before 0003 / 0004 (no place, geo, weather, font)
  old.db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, latin TEXT NOT NULL DEFAULT '', stamp TEXT NOT NULL DEFAULT '', aside TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT 'mug', quote TEXT NOT NULL DEFAULT '', quote_src TEXT NOT NULL DEFAULT '', photo_key TEXT NOT NULL DEFAULT '', photo_cap TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  old.db.exec("INSERT INTO entries (id, date, title, created_at, updated_at) VALUES ('x', '2026-01-01', '旧的', 0, 0)");
  migrate(old, ROOT);
  migrate(old, ROOT);
  const cols = old.db.prepare('PRAGMA table_info(entries)').all().map((c) => c.name);
  for (const c of ['stickers', 'status', 'place', 'geo', 'weather', 'font']) assert.ok(cols.includes(c), c);
  assert.equal(old.db.prepare("SELECT title FROM entries WHERE id='x'").get().title, '旧的');
  for (const t of ['jots', 'locks', 'settings']) assert.ok(old.db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t), t);
  assert.deepEqual(statements("-- a; comment\nCREATE TABLE a (x TEXT); -- b\nSELECT 1;\n"), ['CREATE TABLE a (x TEXT)', 'SELECT 1']);
});

test('R2 on a folder: put, get, head, list, delete; a key never leaves the folder', async () => {
  const dir = tmp(), b = fsBucket(dir);
  const put = await b.put('p/2026/10/09/a.jpg', new Uint8Array([1, 2, 3]).buffer, { httpMetadata: { contentType: 'image/jpeg' } });
  assert.equal(put.size, 3);
  await b.put('p/2026/10/09/b.png', 'png');
  await b.put('p/old.jpg', 'x');
  await b.put('fonts/f.woff2', 'f');
  const got = await b.get('p/2026/10/09/a.jpg');
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), new Uint8Array([1, 2, 3]));
  const h = new Headers(); got.writeHttpMetadata(h);
  assert.equal(h.get('content-type'), 'image/jpeg');
  assert.match(got.httpEtag, /^"[0-9a-f]+-[0-9a-f]+"$/);
  assert.deepEqual(new Uint8Array(await new Response((await b.get('p/2026/10/09/a.jpg')).body).arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal((await b.head('p/2026/10/09/b.png')).httpMetadata.contentType, 'image/png');
  assert.equal(await b.get('p/none.jpg'), null);
  assert.equal(await b.head('p/2026'), null);   // a folder is not an object
  // the folders under p/ and what is right in it, as photos.ts lists them
  const l = await b.list({ prefix: 'p/', delimiter: '/' });
  assert.deepEqual(l.objects.map((o) => o.key), ['p/old.jpg']);
  assert.deepEqual(l.delimitedPrefixes, ['p/2026/']);
  const all = await b.list({ prefix: 'p/', limit: 2 });
  assert.equal(all.truncated, true);
  assert.deepEqual([...all.objects.map((o) => o.key), ...(await b.list({ prefix: 'p/', cursor: all.cursor })).objects.map((o) => o.key)],
    ['p/2026/10/09/a.jpg', 'p/2026/10/09/b.png', 'p/old.jpg']);
  await b.delete(['p/old.jpg', 'p/none.jpg']);
  await b.delete('fonts/f.woff2');
  assert.equal(await b.head('p/old.jpg'), null);
  assert.equal(await b.head('fonts/f.woff2'), null);
  for (const bad of ['../x.jpg', '/etc/passwd', 'p/../../x', 'p/.hidden', '']) await assert.rejects(b.put(bad, 'x'), bad);
  assert.ok(!readdirSync(join(dir, 'p/2026/10/09')).some((f) => f.endsWith('.part')));
});

test('static assets: folders, their slash, _headers, ETag, 404.html', async () => {
  const dir = tmp();
  mkdirSync(join(dir, 'timeline')); mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<h1>book</h1>');
  writeFileSync(join(dir, 'timeline/index.html'), 'tl');
  writeFileSync(join(dir, 'assets/a.js'), 'x');
  writeFileSync(join(dir, '404.html'), 'gone');
  writeFileSync(join(dir, '_headers'), '# kept\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  const a = staticAssets(dir), get = (p, h = {}) => a.fetch(new Request('https://j.example' + p, { headers: h }));
  assert.equal(await (await get('/')).text(), '<h1>book</h1>');
  assert.equal((await get('/')).headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await (await get('/timeline/')).text(), 'tl');
  const r = await get('/timeline?x=1');
  assert.equal(r.status, 307);
  assert.equal(r.headers.get('location'), '/timeline/?x=1');
  const js = await get('/assets/a.js');
  assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await get('/assets/a.js', { 'if-none-match': js.headers.get('etag') })).status, 304);
  for (const p of ['/nope', '/_headers', '/../package.json', '/%2e%2e/package.json']) {
    const n = await get(p);
    assert.equal(n.status, 404, p);
    assert.equal(await n.text(), 'gone', p);
  }
  assert.match(String(readdirSync(join(ROOT, 'public'))), /404\.html/);   // the real public/ has one
});

test('the rate limit and the nightly time', async () => {
  const l = rateLimiter({ limit: 2, period: 60 });
  assert.deepEqual([(await l.limit({ key: 'a' })).success, (await l.limit({ key: 'a' })).success, (await l.limit({ key: 'a' })).success, (await l.limit({ key: 'b' })).success], [true, true, false, true]);
  assert.equal(nextRun('30 15 * * *', new Date('2026-10-09T10:00:00Z')).toISOString(), '2026-10-09T15:30:00.000Z');
  assert.equal(nextRun('30 15 * * *', new Date('2026-10-09T15:30:00Z')).toISOString(), '2026-10-10T15:30:00.000Z');
  assert.throws(() => nextRun('*/5 * * * *', new Date()));
});

test('the Worker on them: a page with a photo written, read, locked and taken down', async () => {
  const app = await loadApp();
  const dir = tmp(), DB = openD1(join(dir, 'techo.db'));
  migrate(DB, ROOT);
  const PHOTOS = fsBucket(join(dir, 'photos')), ASSETS = staticAssets(join(ROOT, 'public'));
  const base = { DB, PHOTOS, ASSETS, UNLOCK_LIMIT: rateLimiter({ limit: 10, period: 60 }), TIMEZONE: 'Asia/Shanghai', GITHUB_CLIENT_ID: 'i', GITHUB_CLIENT_SECRET: 's', ADMIN_GITHUB_LOGIN: 'me' };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException() {}, props: {} };
  const admin = (method, path, body, type = 'application/json') => app.fetch(new Request('http://localhost' + path, {
    method, headers: { 'content-type': type }, body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
  }), { ...base, DEV_BYPASS_AUTH: '1' }, ctx);
  const reader = (path) => app.fetch(new Request('https://j.example' + path), base, ctx);

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const up = await admin('POST', '/api/admin/photos?date=2026-10-09', png, 'image/png');
  assert.equal(up.status, 201);
  const { key } = await up.json();
  assert.match(key, /^p\/2026\/10\/09\/[0-9a-f-]{36}\.png$/);
  const made = await admin('POST', '/api/admin/entries', { date: '2026-10-09', title: '在 VPS 上', body: '一台小机器', photos: [{ key, cap: '' }] });
  assert.equal(made.status, 201);
  const { entry } = await made.json();

  const home = await reader('/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /window\.TECHO_DATA=.*在 VPS 上/);
  assert.match(html, /<meta property="og:title"/);
  const img = await reader('/img/' + key);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), png);
  assert.equal((await reader('/timeline/')).status, 200);

  // locked: the photo is a reader's no more
  assert.equal((await admin('PUT', '/api/admin/locks/' + entry.id, { password: 'abcd1234' })).status, 200);
  assert.equal((await reader('/img/' + key)).status, 404);
  const tries = [];
  for (let i = 0; i < 11; i++) tries.push((await app.fetch(new Request('https://j.example/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: JSON.stringify({ scope: entry.id, password: 'wrong' }) }), base, ctx)).status);
  assert.deepEqual([tries[0], tries.at(-1)], [403, 429]);

  // taken down: its photo goes too (after the answer, as on Cloudflare)
  assert.equal((await admin('DELETE', '/api/admin/entries/' + entry.id)).status, 200);
  await Promise.all(pending);
  assert.equal(await PHOTOS.head(key), null);
  DB.db.close();
});

test('the request the Worker sees: the reader\'s address and IP, from the proxy or the connection', async () => {
  const { asWorkerRequest } = await import('../server/request.mjs');
  const behind = asWorkerRequest(new Request('http://techo:8787/api/auth/github?x=1', { headers: {
    'x-forwarded-proto': 'https', 'x-forwarded-host': 'j.example.com', 'x-forwarded-for': '6.6.6.6, 1.2.3.4', 'cf-connecting-ip': '9.9.9.9',
  } }), { trustProxy: true, remoteAddress: '172.18.0.3' });
  assert.equal(behind.url, 'https://j.example.com/api/auth/github?x=1');
  assert.equal(behind.headers.get('cf-connecting-ip'), '1.2.3.4');   // what Caddy saw, not what the reader wrote
  const odd = asWorkerRequest(new Request('http://techo:8787/', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'j.example.com:8443' } }), { trustProxy: true });
  assert.equal(odd.url, 'https://j.example.com:8443/');
  const bad = asWorkerRequest(new Request('http://techo:8787/', { headers: { 'x-forwarded-host': 'evil/path' } }), { trustProxy: true });
  assert.equal(new URL(bad.url).host, 'techo:8787');
  // facing the internet itself: X-Forwarded-* are a reader's to write, so not read
  const direct = asWorkerRequest(new Request('http://j.example.com/', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '6.6.6.6', 'cf-connecting-ip': '9.9.9.9' } }), { trustProxy: false, remoteAddress: '::ffff:5.5.5.5' });
  assert.equal(direct.url, 'http://j.example.com/');
  assert.equal(direct.headers.get('cf-connecting-ip'), '5.5.5.5');
  // a body goes through
  const post = asWorkerRequest(new Request('http://techo:8787/api/x', { method: 'POST', body: '{"a":1}' }), { trustProxy: true });
  assert.equal(await post.text(), '{"a":1}');
});

test('export-d1: the database as SQL that goes back in, onto tables already made', async () => {
  const { dumpSql } = await import('../server/d1.mjs');
  const a = openD1(':memory:');
  migrate(a, ROOT);
  a.db.prepare("INSERT INTO entries (id, date, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run('e1', '2026-10-09', "it's \"quoted\"", '第一行\n第二行 -- 不是注释;', 1, 2);
  a.db.prepare("INSERT INTO settings (key, value) VALUES ('email', 'me@example.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  const sql = dumpSql(a.db);
  assert.doesNotMatch(sql, /^(BEGIN|COMMIT|PRAGMA)/m);
  const b = openD1(':memory:');
  migrate(b, ROOT);   // as a Cloudflare deploy leaves it: the tables made, the default settings in
  b.db.exec(sql);
  assert.deepEqual({ ...b.db.prepare("SELECT title, body FROM entries WHERE id='e1'").get() }, { title: "it's \"quoted\"", body: '第一行\n第二行 -- 不是注释;' });
  assert.equal(b.db.prepare("SELECT value FROM settings WHERE key='email'").get().value, 'me@example.com');
});
