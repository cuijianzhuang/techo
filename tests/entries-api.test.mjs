/* /api/entries: what each page of the site is sent (full, index, cards), that a locked page is only its date in
   all of them, and that an unchanged answer is a 304 (and the home page's too: its data is inlined) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installHtmlRewriter, loadApp, loadTs, sqliteD1 } from './helpers.mjs';

installHtmlRewriter();
const app = await loadApp();
const { plainText, excerpt, hasCards } = await loadTs('src/text.ts');

const row = (o) => ({ id: 'e1', date: '2026-09-01', title: '标题', latin: '', stamp: '记', aside: '', body: '', note: '', mood: 'mug', quote: '', quote_src: '', photo_key: '', photo_cap: '',
  stickers: 'cat', status: 'published', place: '上海', geo: '31.23,121.47', weather: '多云', created_at: 1, updated_at: 2, ...o });
const ROWS = [
  row({ id: 'plain', date: '2026-09-01', body: '# 今天\n\n**风**很大，[链接](https://x.example)在这。\n\n```代码\nsecret\n```\n\n这一句在代码后面。' + '啊'.repeat(400), photo_key: 'p/00000000-0000-0000-0000-000000000000.jpg', photo_cap: '一张' }),
  row({ id: 'card', date: '2026-09-02', body: '看的书：\n\n```书籍\n书名: 小王子\n```' }),
  row({ id: 'song', date: '2026-09-03', body: '循环：\n\nhttps://music.163.com/song?id=186016' }),
  row({ id: 'words', date: '2026-09-05', body: '只有几句话，没有卡片。' }),
  row({ id: 'secret', date: '2026-09-04', title: '不给看的', body: '这是私密的正文', place: '私密的地方' }),
];
// the real thing: SQLite with the schema, holding ROWS (as they are now) and the locks given
const env = async (locks = []) => ({ DB: await sqliteD1({ entries: ROWS, locks }), TIMEZONE: 'Asia/Shanghai', GITHUB_CLIENT_ID: 'i', ADMIN_GITHUB_LOGIN: 'me', GITHUB_CLIENT_SECRET: 's' });
const get = async (path, headers = {}, locks) => app.fetch(new Request('https://journal.example' + path, { headers }), await env(locks));
const entries = async (view, locks) => (await (await get('/api/entries' + (view ? '?view=' + view : ''), {}, locks)).json()).entries;
const by = (list, id) => list.find((e) => e.id === id);

test('full: every field, as before', async () => {
  const e = by(await entries(), 'plain');
  assert.match(e.body, /secret/);
  assert.equal(e.note, '');
  assert.deepEqual(e.photos, [{ key: 'p/00000000-0000-0000-0000-000000000000.jpg', cap: '一张' }]);
});

test('index: no words, but a line of them; what the timeline and the map draw', async () => {
  const e = by(await entries('index'), 'plain');
  assert.equal(e.body, undefined);
  assert.ok(e.excerpt.startsWith('今天 风很大，链接在这。 这一句在代码后面。'));
  assert.equal([...e.excerpt].length, 100);
  assert.equal(e.excerpt.includes('secret'), false);
  assert.deepEqual([e.title, e.date, e.geo, e.place, e.weather, e.stickers, e.photoKey, e.photoCap, e.stamp], ['标题', '2026-09-01', '31.23,121.47', '上海', '多云', ['cat'], 'p/00000000-0000-0000-0000-000000000000.jpg', '一张', '记']);
});

test('map: only the pages with a place, and only what the map draws', async () => {
  const list = await entries('map');
  assert.equal(list.length, ROWS.length);   // (every test row has a place)
  assert.deepEqual(Object.keys(by(list, 'plain')).sort(), ['createdAt', 'date', 'geo', 'id', 'place', 'title', 'weather']);
});

test('map: a page without a place is left out', async () => {
  ROWS.push(row({ id: 'nowhere', date: '2026-09-06', geo: '', place: '' }));
  try { assert.equal(by(await entries('map'), 'nowhere'), undefined); assert.ok(by(await entries('index'), 'nowhere')); }
  finally { ROWS.pop(); }
});

test('cards: the words only of a page with a card or a song', async () => {
  const list = await entries('cards');
  assert.match(by(list, 'card').body, /书籍/);
  assert.match(by(list, 'song').body, /music\.163\.com/);
  assert.match(by(list, 'plain').body, /secret/);   // (a ``` block: it may be a card)
  assert.equal(by(list, 'words').body, '');
  assert.equal(by(list, 'words').title, '标题');
  assert.equal(by(list, 'words').geo, undefined);
});

test('a locked page is only its date, in every view', async () => {
  for (const view of [undefined, 'index', 'cards']) {
    const locked = by(await entries(view, [{ scope: 'secret', hash: 'h' }]), 'secret');
    assert.deepEqual(locked, { id: 'secret', date: '2026-09-04', locked: 'day', scope: 'secret' }, String(view));
  }
  const whole = await entries('index', [{ scope: 'book', hash: 'h' }]);
  assert.ok(whole.every((e) => e.locked === 'book' && Object.keys(e).length === 4));
});

test('a stretch: newest first, the one before it after `before`, and what the whole list is', async () => {
  const rows = ROWS.length;
  const page = async (q) => (await (await get('/api/entries?view=index&' + q)).json());
  const first = await page('limit=2');
  assert.deepEqual(first.entries.map((e) => e.id), ['words', 'secret']);   // the newest two (by date)
  assert.deepEqual(first.page, { total: rows, days: rows, first: '2026-09-01', last: '2026-09-05', more: true });
  const next = await page('limit=2&before=' + first.entries[1].id);
  assert.deepEqual(next.entries.map((e) => e.id), ['song', 'card']);
  assert.equal(next.page.more, true);
  const last = await page('limit=2&before=' + next.entries[1].id);
  assert.deepEqual(last.entries.map((e) => e.id), ['plain']);
  assert.equal(last.page.more, false);
  assert.equal((await page('limit=2&before=nope')).entries.length, 0);   // a page taken down: nothing, not an error
  assert.equal((await page('limit=2&before=' + first.entries[1].id)).page.total, rows);
  // without a limit there is no stretch: everything, in the order the book has it
  assert.deepEqual((await entries('index')).map((e) => e.id), ['plain', 'card', 'song', 'secret', 'words']);
});

test('a stretch keeps the locks: a locked page in it is only its date', async () => {
  const r = await (await get('/api/entries?view=index&limit=5', {}, [{ scope: 'secret', hash: 'h' }])).json();
  assert.deepEqual(by(r.entries, 'secret'), { id: 'secret', date: '2026-09-04', locked: 'day', scope: 'secret' });
});

test('limit is a number from 1 to 500', async () => {
  for (const q of ['limit=0', 'limit=501', 'limit=abc', 'limit=-1']) assert.equal((await get('/api/entries?view=index&' + q)).status, 400, q);
  assert.equal((await get('/api/entries?view=index&limit=500')).status, 200);
});

test('a view that is not one is refused', async () => {
  assert.equal((await get('/api/entries?view=all')).status, 400);
});

test('the same answer is a 304, and it is private and varies by the keys', async () => {
  const first = await get('/api/entries?view=index');
  const etag = first.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{24}"$/);
  assert.equal(first.headers.get('cache-control'), 'private, no-cache');
  assert.equal(first.headers.get('vary'), 'x-techo-keys');
  const again = await get('/api/entries?view=index', { 'if-none-match': etag });
  assert.equal(again.status, 304);
  assert.equal((await again.text()), '');
  assert.equal(again.headers.get('etag'), etag);
  // another view, or a page that changed, is another answer
  assert.notEqual((await get('/api/entries?view=cards')).headers.get('etag'), etag);
  assert.equal((await get('/api/entries?view=index', { 'if-none-match': '"stale"' })).status, 200);
});

test("the home page has its own ETag, and does not answer 304 to the static page's", async () => {
  const assets = { fetch: async (req) => {
    // what the assets do: a copy with the page's own ETag is a 304
    if (req.headers.get('if-none-match') === '"static-page"') return new Response(null, { status: 304 });
    return new Response('<!doctype html><html><head><title>t</title><meta name="description" content="d"></head><body><script src="/assets/boot.js?v=0123456789"></script></body></html>', { headers: { 'content-type': 'text/html', etag: '"static-page"' } });
  } };
  const call = async (headers = {}) => app.fetch(new Request('https://journal.example/', { headers }), { ...(await env()), ASSETS: assets });
  const first = await call();
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.notEqual(etag, '"static-page"');
  assert.match(await first.text(), /window\.TECHO_DATA=/);
  assert.equal(first.headers.get('cache-control'), 'no-cache');
  // a browser holding only the static page's ETag still gets the page with its data
  assert.equal((await call({ 'if-none-match': '"static-page"' })).status, 200);
  // one holding this answer's gets 304
  assert.equal((await call({ 'if-none-match': etag })).status, 304);
});

test('the excerpt is the timeline\'s plainText, word for word', async () => {
  const { slice } = await import('./helpers.mjs');
  const src = slice('public/assets/render.js', 'const NETEASE_LINE=', '\n') + '\n' + slice('public/assets/render.js', 'function plainText(', 'function panel(');
  const client = new Function(src + ';return plainText;')();
  const samples = ['# 标题\n\n- 一\n- [x] 二\n1. 三\n> 引用\n\n**粗** ~~划~~ ==重点== `码` #cat [链](https://a.b)', '```书籍\n书名: X\n```\n\n之后\n\n+++ 贴页\n\n还有', 'https://music.163.com/song?id=186016\n\n听歌', '@09:10 站会：修 bug #laptop\n\n结束', ''];
  for (const s of samples) assert.equal(plainText(s), client(s), JSON.stringify(s));
  assert.equal(excerpt('啊'.repeat(300)).length, 100);
  assert.equal(excerpt('啊'.repeat(300), 7).length, 7);
  assert.equal(hasCards('x'), false);
  assert.equal(hasCards('a ```b``` c'), true);
  assert.equal(hasCards('163cn.tv/abc'), true);
});

// ---- what the database is asked for

// the same database, told what it was asked and how many rows it handed over
const watched = async (locks = []) => { const log = []; return { log, DB: await sqliteD1({ entries: ROWS, locks, log }) }; };
const many = (n, o = {}) => Array.from({ length: n }, (_, i) => row({ id: 'm' + String(i).padStart(4, '0'), date: '2025-' + String(1 + Math.floor(i / 28) % 12).padStart(2, '0') + '-' + String(1 + i % 28).padStart(2, '0'), created_at: 1000 + i, body: '第 ' + i + ' 篇', ...o }));

test('a stretch reads a stretch: the date index and a LIMIT, not the table', async () => {
  const saved = ROWS.splice(0, ROWS.length, ...many(600));
  try {
    const w = await watched();
    const r = await app.fetch(new Request('https://journal.example/api/entries?view=index&limit=20'), { DB: w.DB, TIMEZONE: 'Asia/Shanghai' });
    const body = await r.json();
    assert.equal(body.entries.length, 20);
    assert.equal(body.page.total, 600);
    const list = w.log.find((q) => /FROM entries/.test(q.sql) && /LIMIT/.test(q.sql));
    assert.ok(list, 'a LIMIT query');
    assert.ok(list.rows <= 21, `${list.rows} rows read for 20`);
    assert.ok(!w.log.some((q) => /FROM entries/.test(q.sql) && !/LIMIT|COUNT/.test(q.sql)), 'no query for the whole table');
  } finally { ROWS.splice(0, ROWS.length, ...saved); }
});

test('the map and the cards views leave the words in the database unless they are wanted', async () => {
  const saved = ROWS.splice(0, ROWS.length, ...many(50, { body: '很长的正文。'.repeat(500) }));
  try {
    const w = await watched();
    const call = (q) => app.fetch(new Request('https://journal.example/api/entries?view=' + q), { DB: w.DB, TIMEZONE: 'Asia/Shanghai' }).then((r) => r.text());
    const map = await call('map'), cards = await call('cards');
    assert.ok(map.length < 20_000, 'map ' + map.length);
    assert.ok(cards.length < 20_000, 'cards ' + cards.length);   // 50 pages of 3000 characters each would be far over
    assert.ok(w.log.filter((q) => /FROM entries/.test(q.sql)).every((q) => !/SELECT \*/.test(q.sql)));
  } finally { ROWS.splice(0, ROWS.length, ...saved); }
});

test('pages that share a date and a moment are neither lost nor doubled between stretches', async () => {
  const saved = ROWS.splice(0, ROWS.length, ...['a', 'b', 'c', 'd', 'e'].map((id) => row({ id, date: '2026-01-01', created_at: 5 })), row({ id: 'z', date: '2026-01-02', created_at: 1 }));
  try {
    for (const limit of [1, 2, 4]) {
      const seen = []; let before = '';
      for (let i = 0; i < 20; i++) {
        const r = await (await get(`/api/entries?view=index&limit=${limit}` + (before ? '&before=' + before : ''))).json();
        seen.push(...r.entries.map((e) => e.id)); before = r.entries.at(-1)?.id;
        if (!r.page.more) break;
      }
      assert.deepEqual([...seen].sort(), ['a', 'b', 'c', 'd', 'e', 'z'], `limit ${limit}: ${seen}`);
    }
  } finally { ROWS.splice(0, ROWS.length, ...saved); }
});

test('the cards view keeps the words of exactly the pages hasCards says have a card', async () => {
  const bodies = ['没有卡片', '```账单\n= 合计: ¥5\n```', '听 https://music.163.com/song?id=1', '短链 https://163cn.tv/abc', '```', 'music 163', ''];
  const saved = ROWS.splice(0, ROWS.length, ...bodies.map((body, i) => row({ id: 'b' + i, date: '2026-02-0' + (i + 1), body })));
  try {
    const list = await entries('cards');
    bodies.forEach((body, i) => assert.equal(by(list, 'b' + i).body, hasCards(body) ? body : '', JSON.stringify(body)));
  } finally { ROWS.splice(0, ROWS.length, ...saved); }
});
