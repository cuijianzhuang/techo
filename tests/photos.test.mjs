/* Photos in R2: p/YYYY/MM/DD/<uuid>.<ext> (the day of the page), the older p/<uuid>.<ext> still good, a locked page's
   photos locked at either address, and the by-hand move of the old ones into the folders (src/photos.ts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeR2, loadApp, loadTs, sqliteD1 } from './helpers.mjs';

const app = await loadApp();
const { PHOTO_KEY, photoDay, photoKeyFor, photoId } = await loadTs('src/entries.ts');

const U = (n) => `0000000${n}-aaaa-bbbb-cccc-00000000000${n}`;           // a uuid-shaped name
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const row = (o) => ({ id: 'e1', date: '2026-05-06', title: '标题', body: '正文', mood: 'mug', stickers: '', status: 'published', photo_key: '', created_at: 1, updated_at: 1, ...o });

async function world({ entries = [], objects = {}, settings = {}, locks = [], onGet } = {}) {
  const DB = await sqliteD1({ entries, locks, settings });
  const PHOTOS = fakeR2(objects, { onGet: onGet && ((k) => onGet(k, DB)) });
  const env = { DB, PHOTOS, TIMEZONE: 'Asia/Shanghai', GITHUB_CLIENT_ID: 'i', ADMIN_GITHUB_LOGIN: 'me', GITHUB_CLIENT_SECRET: 's', DEV_BYPASS_AUTH: '1' };
  const admin = (method, path, body, headers = {}) => app.fetch(new Request('http://localhost:8787' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : (typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)) }), env);
  const reader = (path, headers = {}) => app.fetch(new Request('https://journal.example' + path, { headers }), env);
  const value = async (sql, ...a) => (await DB.prepare(sql).bind(...a).first());
  return { env, DB, PHOTOS, admin, reader, value };
}

// ---- the keys

test('a key is the old p/<uuid>.<ext> or the new p/YYYY/MM/DD/<uuid>.<ext>, nothing else', () => {
  for (const k of [`p/${U(1)}.jpg`, `p/2026/09/28/${U(1)}.png`, `p/2000/01/01/${U(2)}.webp`, `p/2099/12/31/${U(3)}.gif`]) assert.ok(PHOTO_KEY.test(k), k);
  for (const k of [`p/2026/13/01/${U(1)}.jpg`, `p/2026/00/10/${U(1)}.jpg`, `p/2026/09/32/${U(1)}.jpg`, `p/1999/09/28/${U(1)}.jpg`, `p/2026/09/${U(1)}.jpg`,
    `p/2026/09/28/x/${U(1)}.jpg`, `p/../${U(1)}.jpg`, 'p/2026/09/28/short.jpg', `p/2026/09/28/${U(1)}.exe`, `cards/${U(1)}.jpg`, `x/p/${U(1)}.jpg`, `p//${U(1)}.jpg`]) assert.ok(!PHOTO_KEY.test(k), k);
});

test('a photo is named the same wherever it is: photoId', () => {
  assert.equal(photoId(`p/${U(1)}.jpg`), U(1));
  assert.equal(photoId(`p/2026/09/28/${U(1)}.jpg`), U(1));
});

test('the day of a photo: the page\'s when it is a real date of this century, else today', () => {
  assert.equal(photoDay('2026-09-28', 'Asia/Shanghai'), '2026-09-28');
  for (const bad of [undefined, '', 'x', '2026-02-30', '2026-13-01', '1999-01-01', '2026-9-8', '2026-09-28T10:00', '../../etc']) assert.equal(photoDay(bad, 'Asia/Shanghai'), today(), String(bad));
  assert.match(photoKeyFor('2026-09-28', 'jpg'), /^p\/2026\/09\/28\/[0-9a-f-]{36}\.jpg$/);
  assert.ok(PHOTO_KEY.test(photoKeyFor('2026-01-02', 'webp')));
});

// ---- uploading

test('an upload goes into the folder of the page\'s day, and reads back there', async () => {
  const w = await world();
  const res = await w.admin('POST', '/api/admin/photos?date=2026-09-28', new Uint8Array([1, 2, 3]), { 'content-type': 'image/jpeg' });
  assert.equal(res.status, 201);
  const { key, url } = await res.json();
  assert.match(key, /^p\/2026\/09\/28\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(url, '/img/' + key);
  assert.deepEqual([...w.PHOTOS.kept.keys()], [key]);
  const back = await w.reader(url);
  assert.equal(back.status, 200);
  assert.deepEqual([...new Uint8Array(await back.arrayBuffer())], [1, 2, 3]);
  assert.equal(back.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('without a usable day it is today\'s folder; every image type is kept in its own extension', async () => {
  const w = await world();
  const keys = [];
  for (const [q, type, ext] of [['', 'image/png', 'png'], ['?date=2026-02-30', 'image/webp', 'webp'], ['?date=1999-01-01', 'image/gif', 'gif'], ['?date=zzz', 'image/jpeg', 'jpg']]) {
    const r = await w.admin('POST', '/api/admin/photos' + q, new Uint8Array([9]), { 'content-type': type });
    keys.push((await r.json()).key);
    assert.ok(keys.at(-1).startsWith('p/' + today().replace(/-/g, '/') + '/'), keys.at(-1));
    assert.ok(keys.at(-1).endsWith('.' + ext));
  }
});

test('what is not a photo, or is too big, or is empty, is refused', async () => {
  const w = await world();
  assert.equal((await w.admin('POST', '/api/admin/photos', new Uint8Array([1]), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await w.admin('POST', '/api/admin/photos', new Uint8Array(), { 'content-type': 'image/png' })).status, 400);
  assert.equal(w.PHOTOS.kept.size, 0);
});

// ---- reading

test('the older address and the new both serve; a key that is not one is a 404', async () => {
  const w = await world({ objects: { [`p/${U(1)}.jpg`]: { bytes: 'old' }, [`p/2026/05/06/${U(2)}.jpg`]: { bytes: 'new' } } });
  assert.equal(await (await w.reader(`/img/p/${U(1)}.jpg`)).text(), 'old');
  assert.equal(await (await w.reader(`/img/p/2026/05/06/${U(2)}.jpg`)).text(), 'new');
  for (const k of [`p/2026/13/06/${U(2)}.jpg`, `p/2026/05/06/x/${U(2)}.jpg`, `cards/${U(2)}.jpg`, `p/2026/05/06/${U(9)}.jpg`, 'p/%2e%2e/x']) assert.equal((await w.reader('/img/' + k)).status, 404, k);
});

test('a locked page\'s photo needs the key at either address: the folder and the older place', async () => {
  const id = U(3), oldKey = `p/${id}.jpg`, newKey = `p/2026/05/06/${id}.jpg`;
  // the page points at the new address; the object is at both (between the copy and the clean-up)
  const w = await world({ entries: [row({ id: 'e1', photo_key: newKey })], objects: { [oldKey]: { bytes: 'a' }, [newKey]: { bytes: 'a' } } });
  assert.equal((await w.reader('/img/' + newKey)).status, 200);            // (nothing locked yet)
  await w.admin('PUT', '/api/admin/locks/e1', { password: 'pass1234' });
  for (const k of [newKey, oldKey]) {
    const r = await w.reader('/img/' + k);
    assert.equal(r.status, 404, k);
    assert.equal((await w.reader('/img/' + k + '?k=nope')).status, 404, k);
  }
  const key = (await (await app.fetch(new Request('https://journal.example/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'e1', password: 'pass1234' }) }), w.env)).json()).token;
  for (const k of [newKey, oldKey]) {
    const r = await w.reader('/img/' + k + '?k=' + encodeURIComponent(key));
    assert.equal(r.status, 200, k);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal((await w.admin('GET', '/img/' + oldKey)).status, 200);      // (the admin sees it)
});

// ---- moving the older photos into the folders

const OLD1 = `p/${U(1)}.jpg`, OLD2 = `p/${U(2)}.png`, OLD3 = `p/${U(3)}.jpg`, COVER = `p/${U(4)}.png`, LOOSE = `p/${U(5)}.jpg`;
const NEW1 = `p/2026/05/06/${U(1)}.jpg`, NEW2 = `p/2026/05/06/${U(2)}.png`, NEW3 = `p/2026/06/07/${U(3)}.jpg`, NEWC = `p/2026/03/04/${U(4)}.png`;
const migration = () => world({
  entries: [row({ id: 'e1', date: '2026-05-06', photo_key: `${OLD1},${OLD2}` }), row({ id: 'e2', date: '2026-06-07', photo_key: OLD3, created_at: 2 }), row({ id: 'e3', date: '2026-07-08', photo_key: '', created_at: 3 })],
  objects: {
    [OLD1]: { bytes: 'one' }, [OLD2]: { bytes: 'two', type: 'image/png' }, [OLD3]: { bytes: 'three' },
    [COVER]: { bytes: 'cover', type: 'image/png', uploaded: new Date('2026-03-04T02:00:00Z') }, [LOOSE]: { bytes: 'lost' },
  },
  settings: { coverPhotos: COVER },
});
const migrate = (w, step, limit) => w.admin('POST', '/api/admin/photos/migrate', limit ? { step, limit } : { step }).then((r) => r.json());
const keys = (w) => [...w.PHOTOS.kept.keys()].sort();

test('preview says what would move and changes nothing', async () => {
  const w = await migration();
  const before = keys(w);
  const r = await migrate(w, 'preview');
  assert.equal(r.toMove, 4);
  assert.deepEqual(r.plan.map((m) => [m.from, m.to]), [[OLD1, NEW1], [OLD2, NEW2], [OLD3, NEW3], [COVER, NEWC]]);
  assert.deepEqual([r.loose, r.unused], [5, 1]);          // (the loose object nothing uses is only counted)
  assert.deepEqual(keys(w), before);
  assert.equal((await w.value("SELECT photo_key FROM entries WHERE id='e1'")).photo_key, `${OLD1},${OLD2}`);
  assert.equal(await w.value("SELECT value FROM settings WHERE key='_v'"), null);
  assert.equal((await w.admin('POST', '/api/admin/photos/migrate', {})).status, 200);   // (preview is the default step)
});

test('copy: a page at a time, the new copy first and the page after; the old stays; a cover by its upload day', async () => {
  const w = await migration();
  let r = await migrate(w, 'copy', 1);                   // one page (two photos)
  assert.deepEqual([r.copied, r.remaining, r.skipped], [2, 2, []]);
  assert.equal((await w.value("SELECT photo_key FROM entries WHERE id='e1'")).photo_key, `${NEW1},${NEW2}`);
  assert.equal((await w.value("SELECT photo_key FROM entries WHERE id='e2'")).photo_key, OLD3);   // (not yet)
  for (const k of [OLD1, OLD2, NEW1, NEW2]) assert.ok(w.PHOTOS.kept.has(k), k);
  assert.equal(new TextDecoder().decode(w.PHOTOS.kept.get(NEW2).buf), 'two');
  assert.equal(w.PHOTOS.kept.get(NEW2).type, 'image/png');
  assert.ok((await w.value("SELECT value FROM settings WHERE key='_v'")).value, 'the data version moved');
  r = await migrate(w, 'copy', 5);
  assert.deepEqual([r.copied, r.remaining], [2, 0]);
  assert.equal((await w.value("SELECT photo_key FROM entries WHERE id='e2'")).photo_key, NEW3);
  assert.equal((await w.value("SELECT value FROM settings WHERE key='coverPhotos'")).value, NEWC);
  assert.ok(w.PHOTOS.kept.has(NEWC) && w.PHOTOS.kept.has(COVER));
  assert.equal((await migrate(w, 'copy')).copied, 0);    // (again: nothing left, nothing done twice)
  assert.deepEqual((await migrate(w, 'preview')).toMove, 0);
});

test('the pages still show their photos all the way through', async () => {
  const w = await migration();
  const shown = async () => (await w.reader('/api/entries')).json().then((j) => j.entries.filter((e) => e.photos?.length).flatMap((e) => e.photos.map((p) => p.key)));
  for (const step of ['copy', 'cleanup']) {
    await migrate(w, step, 15);
    for (const k of await shown()) assert.equal((await w.reader('/img/' + k)).status, 200, `${step}: ${k}`);
  }
  assert.deepEqual((await shown()).sort(), [NEW1, NEW2, NEW3]);
});

test('cleanup only deletes an old object that is unused, whose new copy is there and the same size', async () => {
  const w = await migration();
  let r = await migrate(w, 'cleanup');
  assert.equal(r.deleted, 0);                            // (nothing copied yet: the pages still use the old ones)
  assert.ok(keys(w).includes(OLD1) && keys(w).includes(LOOSE));
  await migrate(w, 'copy', 15);
  // one new copy is damaged (another size): its old object must stay
  w.PHOTOS.kept.get(NEW2).buf = new TextEncoder().encode('damaged!');
  r = await migrate(w, 'cleanup', 25);
  assert.equal(r.deleted, 3);                            // OLD1, OLD3, COVER
  assert.ok(w.PHOTOS.kept.has(OLD2), 'the one whose new copy is wrong stays');
  assert.ok(w.PHOTOS.kept.has(LOOSE), 'a photo no page uses is never touched');
  assert.ok(r.kept.some((k) => k.key === LOOSE) && r.kept.some((k) => k.key === OLD2));
  assert.deepEqual(keys(w), [LOOSE, OLD2, NEW1, NEW2, NEW3, NEWC].sort());
});

test('a page changed while it was being moved is left as it is and taken up again', async () => {
  let touched = false;
  const w = await world({
    entries: [row({ id: 'e1', date: '2026-05-06', photo_key: OLD1 })], objects: { [OLD1]: { bytes: 'one' } },
    onGet: async (k, DB) => { if (k === OLD1 && !touched) { touched = true; await DB.prepare("UPDATE entries SET photo_key='' WHERE id='e1'").run(); } },
  });
  const r = await migrate(w, 'copy');
  assert.equal(r.copied, 0);
  assert.match(r.skipped[0].why, /改过/);
  assert.equal((await w.value("SELECT photo_key FROM entries WHERE id='e1'")).photo_key, '');   // (as the other change left it)
});

test('a photo that R2 has lost is reported, and the others go on', async () => {
  const w = await migration();
  w.PHOTOS.kept.delete(OLD1);
  const r = await migrate(w, 'copy', 5);
  assert.equal(r.copied, 3);
  assert.deepEqual(r.skipped.map((s) => s.key), [OLD1]);
  assert.equal((await w.value("SELECT photo_key FROM entries WHERE id='e1'")).photo_key, `${OLD1},${NEW2}`);   // (only what was copied points at the new)
});

test('the steps and limits are checked', async () => {
  const w = await migration();
  assert.equal((await w.admin('POST', '/api/admin/photos/migrate', { step: 'all' })).status, 400);
  for (const limit of [0, 16, -1, 1.5, 'x']) assert.equal((await w.admin('POST', '/api/admin/photos/migrate', { step: 'copy', limit })).status, 400, String(limit));
  assert.equal((await w.admin('POST', '/api/admin/photos/migrate', { step: 'cleanup', limit: 101 })).status, 400);
  assert.equal(keys(w).length, 5);
});

test('a locked page\'s photo stays locked all through the move', async () => {
  const w = await migration();
  await w.admin('PUT', '/api/admin/locks/e2', { password: 'pass1234' });
  const at = async (k) => (await w.reader('/img/' + k)).status;
  assert.equal(await at(OLD3), 404);
  await migrate(w, 'copy', 15);
  assert.deepEqual([await at(OLD3), await at(NEW3)], [404, 404]);    // (both addresses, before the old goes)
  await migrate(w, 'cleanup', 25);
  assert.deepEqual([await at(OLD3), await at(NEW3)], [404, 404]);
});
