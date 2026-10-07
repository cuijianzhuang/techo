/* The edge cache (src/cache.ts): a reader without keys is answered from it with one row read from the database
   (the data version); anything a reader can see being written starts it over; a reader with keys never touches it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installCaches, installHtmlRewriter, loadApp, sqliteD1 } from './helpers.mjs';

installHtmlRewriter();
const app = await loadApp();

const row = (o) => ({ id: 'e1', date: '2026-09-01', title: '标题', body: '正文', mood: 'mug', stickers: '', status: 'published', place: '', geo: '', weather: '', created_at: 1, updated_at: 1, ...o });
const PAGE = '<!doctype html><html><head><title>t</title><meta name="description" content="d"></head><body><script src="/assets/boot.js?v=0123456789"></script></body></html>';

// a world: the database (with a log of what it was asked), the static assets (counting), the cache
async function world(o = {}) {
  const log = [], cache = installCaches();
  const DB = await sqliteD1({ entries: o.entries || [row({ id: 'a', date: '2026-09-01' }), row({ id: 'b', date: '2026-09-02' })], log });
  const fetched = [];
  const env = { DB, TIMEZONE: 'Asia/Shanghai', GITHUB_CLIENT_ID: 'i', ADMIN_GITHUB_LOGIN: 'me', GITHUB_CLIENT_SECRET: 's', DEV_BYPASS_AUTH: '1', CF_VERSION_METADATA: { id: o.deploy || 'deploy-1' },
    ASSETS: { fetch: async (req) => { fetched.push(new URL(req.url).pathname); return new Response(PAGE, { headers: { 'content-type': 'text/html', etag: '"static"' } }); } } };
  // readers come from somewhere else; the admin from localhost (where the dev login works)
  const reader = (path, headers = {}, e = env) => app.fetch(new Request('https://journal.example' + path, { headers }), e);
  const admin = (method, path, body) => app.fetch(new Request('http://localhost:8787' + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const asked = (n = 0) => log.slice(n).map((q) => q.sql);
  return { env, log, cache, fetched, reader, admin, asked };
}
const ids = async (res) => (await res.json()).entries.map((e) => e.id);

test('a reader is answered from the cache the second time, and the database is asked for one row', async () => {
  const w = await world();
  const first = await w.reader('/api/entries?view=index');
  assert.equal(first.headers.get('x-cache'), 'MISS');
  assert.ok(w.asked().some((q) => /FROM entries/.test(q)));
  const seen = w.log.length;
  const second = await w.reader('/api/entries?view=index');
  assert.equal(second.headers.get('x-cache'), 'HIT');
  assert.deepEqual(w.asked(seen), ["SELECT value FROM settings WHERE key='_v'"]);
  assert.deepEqual(await ids(first), await ids(second));
  assert.equal(w.cache.size(), 1);
});

test('what the reader is sent by the cache is what it is sent without: the same headers', async () => {
  const w = await world();
  const miss = await w.reader('/api/entries');
  const hit = await w.reader('/api/entries');
  for (const h of ['content-type', 'cache-control', 'vary', 'etag']) assert.equal(hit.headers.get(h), miss.headers.get(h), h);
  assert.equal(hit.headers.get('cache-control'), 'private, no-cache');
  assert.equal(await hit.text(), await miss.text());
});

test('a copy the reader already has is a 304, from the cache too', async () => {
  const w = await world();
  const etag = (await w.reader('/api/entries')).headers.get('etag');
  const seen = w.log.length;
  const r = await w.reader('/api/entries', { 'if-none-match': etag });
  assert.equal(r.status, 304);
  assert.equal(r.headers.get('x-cache'), 'HIT');
  assert.equal(await r.text(), '');
  assert.equal(w.asked(seen).length, 1);
});

test('the home page is kept too: the assets and the pages are not asked for again', async () => {
  const w = await world();
  const first = await w.reader('/');
  assert.equal(first.headers.get('x-cache'), 'MISS');
  assert.match(await first.text(), /window\.TECHO_DATA=/);
  const seen = w.log.length, assets = w.fetched.length;
  const second = await w.reader('/');
  assert.equal(second.headers.get('x-cache'), 'HIT');
  assert.match(await second.text(), /window\.TECHO_DATA=/);
  assert.deepEqual(w.asked(seen), ["SELECT value FROM settings WHERE key='_v'"]);
  assert.equal(w.fetched.length, assets);
  assert.equal(second.headers.get('cache-control'), 'no-cache');
});

test('writing a page starts it over: new, edited, taken down', async () => {
  const w = await world();
  const home = async () => (await (await w.reader('/')).text());
  await w.reader('/api/entries'); await w.reader('/');
  assert.equal((await w.reader('/api/entries')).headers.get('x-cache'), 'HIT');
  // a new page
  const made = await (await w.admin('POST', '/api/admin/entries', { date: '2026-09-03', title: '新的一页', body: 'x' })).json();
  let r = await w.reader('/api/entries');
  assert.equal(r.headers.get('x-cache'), 'MISS');
  assert.deepEqual(await ids(r), ['a', 'b', made.entry.id]);
  assert.match(await home(), /新的一页/);
  // edited
  assert.equal((await w.reader('/api/entries')).headers.get('x-cache'), 'HIT');
  await w.admin('PUT', '/api/admin/entries/' + made.entry.id, { date: '2026-09-03', title: '改过的标题', body: 'x' });
  r = await w.reader('/api/entries');
  assert.equal(r.headers.get('x-cache'), 'MISS');
  assert.equal((await r.json()).entries.at(-1).title, '改过的标题');
  // taken down
  assert.equal((await w.reader('/api/entries')).headers.get('x-cache'), 'HIT');
  await w.admin('DELETE', '/api/admin/entries/' + made.entry.id);
  r = await w.reader('/api/entries');
  assert.equal(r.headers.get('x-cache'), 'MISS');
  assert.deepEqual(await ids(r), ['a', 'b']);
});

test('a draft is not seen, so it is not new; publishing it is', async () => {
  const w = await world();
  await w.reader('/api/entries');
  const made = await (await w.admin('POST', '/api/admin/entries', { date: '2026-09-03', title: '草稿', body: 'x', status: 'draft' })).json();
  assert.deepEqual(await ids(await w.reader('/api/entries')), ['a', 'b']);      // (the version moved, the answer is the same)
  await w.admin('PUT', '/api/admin/entries/' + made.entry.id, { date: '2026-09-03', title: '草稿', body: 'x', status: 'published' });
  assert.deepEqual(await ids(await w.reader('/api/entries')), ['a', 'b', made.entry.id]);
});

test('a lock and the settings start it over; jots, which readers cannot see, do not', async () => {
  const w = await world();
  await w.reader('/'); await w.reader('/api/entries');
  await w.admin('POST', '/api/admin/jots', { text: '随手记一句' });
  assert.equal((await w.reader('/api/entries')).headers.get('x-cache'), 'HIT');
  await w.admin('PUT', '/api/admin/locks/a', { password: 'pass1234' });
  let r = await w.reader('/api/entries');
  assert.equal(r.headers.get('x-cache'), 'MISS');
  assert.deepEqual((await r.json()).entries[0], { id: 'a', date: '2026-09-01', locked: 'day', scope: 'a' });   // (the copy kept has only its date)
  assert.deepEqual((await (await w.reader('/api/entries')).json()).entries[0], { id: 'a', date: '2026-09-01', locked: 'day', scope: 'a' });
  await w.admin('PUT', '/api/admin/locks/a', { password: null });
  assert.equal((await (await w.reader('/api/entries')).json()).entries[0].title, '标题');
  await w.reader('/');
  assert.equal((await w.reader('/')).headers.get('x-cache'), 'HIT');
  await w.admin('PUT', '/api/admin/settings', { siteTitle: '换了名字的手帐' });
  r = await w.reader('/');
  assert.equal(r.headers.get('x-cache'), 'MISS');
});

test('a reader with keys is never answered from the cache, and never puts anything in it', async () => {
  const w = await world();
  await w.admin('PUT', '/api/admin/locks/a', { password: 'pass1234' });
  const anon = await w.reader('/api/entries');
  assert.equal((await anon.json()).entries[0].locked, 'day');
  const unlock = await app.fetch(new Request('https://journal.example/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'a', password: 'pass1234' }) }), w.env);
  const key = (await unlock.json()).token;
  assert.ok(key, 'a key');
  const kept = w.cache.size();
  const keyed = await w.reader('/api/entries', { 'x-techo-keys': key });
  assert.equal(keyed.headers.get('x-cache'), 'BYPASS');
  assert.equal((await keyed.json()).entries[0].title, '标题');      // it sees the page it opened
  assert.equal(w.cache.size(), kept);
  // and the reader without keys still sees only the date
  assert.equal((await (await w.reader('/api/entries')).json()).entries[0].locked, 'day');
});

test('the deploy is part of the key', async () => {
  const w = await world({ deploy: 'deploy-1' });
  await w.reader('/api/entries');
  assert.equal((await w.reader('/api/entries')).headers.get('x-cache'), 'HIT');
  const other = await w.reader('/api/entries', {}, { ...w.env, CF_VERSION_METADATA: { id: 'deploy-2' } });
  assert.equal(other.headers.get('x-cache'), 'MISS');
  assert.equal(w.cache.size(), 2);
});

test('the key has the view, the limit and the page before, and nothing else', async () => {
  const w = await world();
  await w.reader('/api/entries?view=index&limit=5&utm=1&zzz=a');
  assert.equal((await w.reader('/api/entries?zzz=b&limit=5&view=index')).headers.get('x-cache'), 'HIT');
  assert.equal((await w.reader('/api/entries?view=index&limit=6')).headers.get('x-cache'), 'MISS');
  assert.equal((await w.reader('/api/entries?view=map')).headers.get('x-cache'), 'MISS');
  assert.equal(w.cache.size(), 3);
  // what is refused is not kept
  assert.equal((await w.reader('/api/entries?view=nope')).status, 400);
  assert.equal(w.cache.size(), 3);
});

test('a database with no version yet, or none readable, still answers', async () => {
  const w = await world();
  assert.equal((await w.reader('/api/entries')).status, 200);   // (no '_v' row: version "0")
  const broken = { ...w.env, DB: { prepare: () => { throw new Error('no such table: settings'); } } };
  const r = await w.reader('/api/entries?view=map', {}, broken).catch((e) => e);
  assert.ok(r instanceof Error || r.status === 500);              // (the entries themselves can't be read either: an error, not a stale answer)
});

test('without a cache to use (a local dev server, a runtime without one) every page is built and answered', async () => {
  const w = await world();
  delete globalThis.caches;
  const r = await w.reader('/api/entries');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-cache'), 'BYPASS');
  assert.ok(r.headers.get('etag'));
  const local = installCaches();
  const l = await app.fetch(new Request('http://localhost:8787/api/entries'), w.env);
  assert.equal(l.headers.get('x-cache'), 'BYPASS');     // (a local server builds every time)
  const tried = await app.fetch(new Request('http://localhost:8787/api/entries'), { ...w.env, CACHE_LOCAL: '1' });
  assert.equal(tried.headers.get('x-cache'), 'MISS');
  assert.equal(local.size(), 1);
});

// The rule the design leans on: whoever writes what a reader can see says so afterwards.
test('every file that writes pages, locks or settings bumps the data version', () => {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const writes = /(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(entries|locks|settings)\b/i;
  // entries.ts: writeEntry runs the SQL its callers give it (admin-entries.ts, which bumps); drafts.ts writes drafts
  // and jots, which a reader never sees; cache.ts writes the version itself; ai.ts writes only the AI's key (a row of
  // its own that no reader's answer is made from)
  const exempt = new Set(['entries.ts', 'drafts.ts', 'cache.ts', 'ai.ts']);
  const bad = readdirSync(dir).filter((f) => f.endsWith('.ts') && !exempt.has(f) && writes.test(readFileSync(dir + f, 'utf8')) && !/bumpVersion\(/.test(readFileSync(dir + f, 'utf8')));
  assert.deepEqual(bad, []);
  // and where it does, one bump per write path: locks (2), entries (3: new, edited, taken down), settings (1)
  const count = (f) => (readFileSync(dir + f, 'utf8').match(/await bumpVersion\(/g) || []).length;
  assert.deepEqual([count('locks.ts'), count('admin-entries.ts'), count('settings.ts')], [2, 3, 1]);
});
