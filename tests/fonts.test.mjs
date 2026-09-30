/* The fonts of the book (settings.bookFont) and of a single page (entry.font): what the server accepts, that a
   database from before migrations/0004_font.sql still saves pages, and that the list of ids the server knows is
   the list the browser has faces for (render.js FONTS). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installHtmlRewriter, loadApp, loadTs, slice, sqliteD1 } from './helpers.mjs';

installHtmlRewriter();
const app = await loadApp();
const { FONT_IDS, validFont, cleanEntry } = await loadTs('src/entries.ts');

const world = async (schema) => {
  const env = { DB: await sqliteD1({ schema }), TIMEZONE: 'Asia/Shanghai', GITHUB_CLIENT_ID: 'i', ADMIN_GITHUB_LOGIN: 'me', GITHUB_CLIENT_SECRET: 's', DEV_BYPASS_AUTH: '1' };
  const call = (method, path, body) => app.fetch(new Request('http://localhost:8787' + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { env, call };
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
