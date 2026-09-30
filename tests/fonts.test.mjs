/* The fonts of the book (settings.bookFont) and of a single page (entry.font): what the server accepts, that a
   database from before migrations/0004_font.sql still saves pages, and that the list of ids the server knows is
   the list the browser has faces for (render.js FONTS). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeR2, installHtmlRewriter, loadApp, loadTs, slice, sqliteD1 } from './helpers.mjs';

installHtmlRewriter();
const app = await loadApp();
const { FONT_IDS, validFont, cleanEntry } = await loadTs('src/entries.ts');
const fontsModule = await loadTs('src/fontfile.ts');

const world = async (schema) => {
  const pending = [];
  const env = { DB: await sqliteD1({ schema }), PHOTOS: fakeR2(), TIMEZONE: 'Asia/Shanghai', GITHUB_CLIENT_ID: 'i', ADMIN_GITHUB_LOGIN: 'me', GITHUB_CLIENT_SECRET: 's', DEV_BYPASS_AUTH: '1' };
  const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException() {} };
  const call = (method, path, body, headers = {}) => app.fetch(new Request('http://localhost:8787' + path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)),
  }), env, ctx);
  return { env, call, settle: () => Promise.all(pending) };
};
const page = (o = {}) => ({ date: '2026-09-29', title: '一页', body: '正文', ...o });

test('the ids the server accepts are the fonts the browser has faces for', () => {
  const list = slice('public/assets/render.js', 'const FONTS=[', '];');
  const ids = [...list.matchAll(/\{id:'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, FONT_IDS);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], 'default');            // (what the book has always worn: no override)
});

test('a font is a built-in id or an uploaded one, nothing else', () => {
  for (const id of FONT_IDS) assert.ok(validFont(id), id);
  assert.ok(validFont('u-0123abcd-0123-4567-89ab-0123456789ab'));
  for (const id of ['', 'Comic', 'u-x', 'u-0123abcd-0123-4567-89ab-0123456789ab.ttf', 'DEFAULT', '../x', 'p/2026/09/29/x']) assert.ok(!validFont(id), id);
});

test('a page takes a font, or none (the book\'s), and refuses one it doesn\'t know', () => {
  assert.equal(cleanEntry(page({ font: 'kuaile' })).value.font, 'kuaile');
  assert.equal(cleanEntry(page({ font: '  songti ' })).value.font, 'songti');
  assert.equal(cleanEntry(page()).value.font, '');
  assert.equal(cleanEntry(page({ font: '' })).value.font, '');
  const bad = cleanEntry(page({ font: 'Comic Sans' }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /字体/);
});

test('saved, a page keeps its font and readers are sent it; another save can take it away', async () => {
  const { call } = await world();
  const made = await (await call('POST', '/api/admin/entries', page({ font: 'liujian' }))).json();
  assert.equal(made.entry.font, 'liujian');
  const list = (await (await call('GET', '/api/entries')).json()).entries;
  assert.equal(list.find((e) => e.id === made.entry.id).font, 'liujian');
  const back = await (await call('PUT', '/api/admin/entries/' + made.entry.id, page({ font: '' }))).json();
  assert.equal(back.entry.font, '');
  assert.equal((await call('POST', '/api/admin/entries', page({ font: 'nope' }))).status, 400);
});

test('the book\'s font is a setting, checked', async () => {
  const { call } = await world();
  assert.equal((await (await call('GET', '/api/settings')).json()).settings.bookFont, 'default');
  assert.equal((await call('PUT', '/api/admin/settings', { bookFont: 'xiaowei' })).status, 200);
  assert.equal((await (await call('GET', '/api/settings')).json()).settings.bookFont, 'xiaowei');
  assert.equal((await call('PUT', '/api/admin/settings', { bookFont: 'nope' })).status, 400);
  assert.equal((await (await call('GET', '/api/settings')).json()).settings.bookFont, 'xiaowei');
});

// ---- a database from before the migration
const without = (...cols) => (sql) => sql.split('\n').filter((l) => !cols.some((c) => new RegExp(`^\\s+${c}\\s`).test(l))).join('\n');

test('before 0004 (no font column): pages save as they did; asking for a font says what to run', async () => {
  const { call } = await world(without('font'));
  const ok = await call('POST', '/api/admin/entries', page({ place: '上海', weather: '多云' }));
  assert.equal(ok.status, 201);
  const made = (await ok.json()).entry;
  assert.equal(made.place, '上海');          // (the place columns are there: they are kept)
  assert.equal(made.font, '');
  const no = await call('PUT', '/api/admin/entries/' + made.id, page({ font: 'kuaile' }));
  assert.equal(no.status, 500);
  assert.match((await no.json()).error, /0004_font\.sql/);
  assert.equal((await call('PUT', '/api/admin/entries/' + made.id, page({ place: '北京' }))).status, 200);
});

test('before 0003 and 0004 (no place, weather or font): pages save; a place or a font says what to run', async () => {
  const { call } = await world(without('font', 'place', 'geo', 'weather'));
  assert.equal((await call('POST', '/api/admin/entries', page())).status, 201);
  const place = await call('POST', '/api/admin/entries', page({ place: '上海' }));
  assert.equal(place.status, 500);
  assert.match((await place.json()).error, /0003_place_weather\.sql/);
  const font = await call('POST', '/api/admin/entries', page({ font: 'kuaile' }));
  assert.equal(font.status, 500);
  assert.match((await font.json()).error, /0004_font\.sql/);
});

test('the migration and the schema add the same column', () => {
  assert.match(readFileSync(new URL('../migrations/0004_font.sql', import.meta.url), 'utf8'), /ALTER TABLE entries ADD COLUMN font TEXT NOT NULL DEFAULT ''/);
  assert.match(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'), /^\s+font\s+TEXT NOT NULL DEFAULT ''/m);
});

// ---- uploaded fonts
const font = (tag = 'wOF2', size = 64) => { const b = new Uint8Array(size); b.set(new TextEncoder().encode(tag)); return b; };
const upload = (call, bytes, name = '我的字体', type = 'application/octet-stream') => call('POST', '/api/admin/fonts?name=' + encodeURIComponent(name), bytes, { 'content-type': type });
const fonts = async (call) => JSON.parse((await (await call('GET', '/api/settings')).json()).settings.customFonts);

test('a font file is known by its first bytes: woff2, woff, otf, ttf', () => {
  const { fontKind } = fontsModule;
  assert.equal(fontKind(font('wOF2')), 'woff2');
  assert.equal(fontKind(font('wOFF')), 'woff');
  assert.equal(fontKind(font('OTTO')), 'otf');
  assert.equal(fontKind(font('true')), 'ttf');
  assert.equal(fontKind(Uint8Array.from([0, 1, 0, 0, ...new Array(20).fill(7)])), 'ttf');
  for (const junk of [new TextEncoder().encode('<html>not a font at all</html>'), Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...new Array(20).fill(0)]), new Uint8Array(3)]) assert.equal(fontKind(junk), null);
});

test('uploading a font: kept in R2, listed for readers, served at /font/', async () => {
  const { call, env } = await world();
  const res = await upload(call, font('wOF2', 500), '  手写   体 ');
  assert.equal(res.status, 201);
  const { font: made } = await res.json();
  assert.match(made.id, /^u-[0-9a-f-]{36}$/);
  assert.equal(made.name, '手写 体');
  assert.match(made.key, /^fonts\/[0-9a-f-]{36}\.woff2$/);
  assert.equal(made.size, 500);
  assert.ok(env.PHOTOS.kept.has(made.key));
  assert.deepEqual((await fonts(call)).map((f) => f.id), [made.id]);
  const got = await call('GET', '/font/' + made.key.slice('fonts/'.length));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'font/woff2');
  assert.match(got.headers.get('cache-control'), /immutable/);
  assert.equal(got.headers.get('access-control-allow-origin'), '*');
  assert.equal((await got.arrayBuffer()).byteLength, 500);
  // pages and the book can be written in it now
  assert.equal((await call('PUT', '/api/admin/settings', { bookFont: made.id })).status, 200);
  assert.equal((await call('POST', '/api/admin/entries', page({ font: made.id }))).status, 201);
});

test('what is not a font, is empty, or is too big is refused; so is a ninth', async () => {
  const { call, env } = await world();
  assert.equal((await upload(call, new TextEncoder().encode('<html>hello, i am not a font</html>'))).status, 415);
  assert.equal((await upload(call, new Uint8Array(0))).status, 400);
  const big = await upload(call, font('wOF2', 3 * 1024 * 1024 + 1));
  assert.equal(big.status, 413);
  assert.match((await big.json()).error, /3MB/);
  assert.equal(env.PHOTOS.kept.size, 0);           // (nothing was kept)
  for (let i = 0; i < 8; i++) assert.equal((await upload(call, font('wOF2', 100 + i))).status, 201);
  const ninth = await upload(call, font());
  assert.equal(ninth.status, 400);
  assert.match((await ninth.json()).error, /最多/);
  assert.equal((await fonts(call)).length, 8);
});

test('the list of fonts is only changed by uploading and deleting, not by saving the settings', async () => {
  const { call } = await world();
  const { font: made } = await (await upload(call, font())).json();
  const forged = JSON.stringify([{ id: 'u-00000000-0000-0000-0000-000000000000', name: 'x', key: 'fonts/../secret.ttf', size: 1 }]);
  assert.equal((await call('PUT', '/api/admin/settings', { customFonts: forged, siteTitle: '新标题' })).status, 200);
  assert.deepEqual((await fonts(call)).map((f) => f.id), [made.id]);
  const s = (await (await call('GET', '/api/settings')).json()).settings;
  assert.equal(s.siteTitle, '新标题');                // (the rest of the same save went through)
});

test('a list that was tampered with in the database gives no font it should not', () => {
  const { parseFonts } = fontsModule;
  const ok = { id: 'u-0123abcd-0123-4567-89ab-0123456789ab', name: 'a', key: 'fonts/0123abcd-0123-4567-89ab-0123456789ab.ttf', size: 3 };
  assert.deepEqual(parseFonts(JSON.stringify([ok, { ...ok, id: 'default' }, { ...ok, key: 'fonts/../x.ttf' }, { ...ok, key: 'p/0123abcd-0123-4567-89ab-0123456789ab.jpg' }, null, 5])), [ok]);
  for (const junk of [undefined, '', 'not json', '{"a":1}', '5']) assert.deepEqual(parseFonts(junk), []);
});

test('/font/ serves fonts and nothing else', async () => {
  const { call, env } = await world();
  await env.PHOTOS.put('fonts/0123abcd-0123-4567-89ab-0123456789ab.ttf', font('true'), {});
  await env.PHOTOS.put('p/0123abcd-0123-4567-89ab-0123456789ab.jpg', new Uint8Array([1, 2, 3]), {});
  assert.equal((await call('GET', '/font/0123abcd-0123-4567-89ab-0123456789ab.ttf')).status, 200);
  for (const name of ['0123abcd-0123-4567-89ab-0123456789ab.jpg', '0123abcd-0123-4567-89ab-0123456789ab.exe', 'evil.ttf', '..%2Fp%2Fx.ttf', '00000000-0000-0000-0000-000000000000.ttf'])
    assert.equal((await call('GET', '/font/' + name)).status, 404, name);
});

test('deleting a font: gone from R2 and the list; the book and the pages written in it go back to the default', async () => {
  const { call, env, settle } = await world();
  const { font: keep } = await (await upload(call, font('OTTO'), '留着')).json();
  const { font: gone } = await (await upload(call, font(), '要删')).json();
  await call('PUT', '/api/admin/settings', { bookFont: gone.id });
  const mine = (await (await call('POST', '/api/admin/entries', page({ font: gone.id }))).json()).entry;
  const other = (await (await call('POST', '/api/admin/entries', page({ title: '另一页', font: keep.id }))).json()).entry;
  assert.equal((await call('DELETE', '/api/admin/fonts/' + gone.id)).status, 200);
  await settle();
  assert.ok(!env.PHOTOS.kept.has(gone.key));
  assert.ok(env.PHOTOS.kept.has(keep.key));
  assert.deepEqual((await fonts(call)).map((f) => f.id), [keep.id]);
  assert.equal((await (await call('GET', '/api/settings')).json()).settings.bookFont, 'default');
  const list = (await (await call('GET', '/api/entries')).json()).entries;
  assert.equal(list.find((e) => e.id === mine.id).font, '');
  assert.equal(list.find((e) => e.id === other.id).font, keep.id);
  assert.equal((await call('GET', '/font/' + gone.key.slice(6))).status, 404);
  assert.equal((await call('DELETE', '/api/admin/fonts/' + gone.id)).status, 404);
  assert.equal((await call('DELETE', '/api/admin/fonts/default')).status, 404);
});
