/* 那年今日 and 找 (render.js onThisDay / searchEntries): which pages a reader is shown, in what order, and that a
   locked page gives nothing of its words away. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { slice } from './helpers.mjs';

const R = 'public/assets/render.js';
const src = [
  slice(R, 'function sortEntries(', '\n'),
  slice(R, 'const NETEASE_LINE=', '\n'),
  slice(R, 'function plainText(', 'function panel('),
  slice(R, '  function onThisDay(', '  const FIND_SVG='),
].join('\n');
const { onThisDay, searchEntries } = new Function(src + '; return { onThisDay, searchEntries };')();

const en = (o) => ({ id: o.date + (o.n || ''), title: '一页', body: '', createdAt: 1, ...o });

test('那年今日: the same day in the years before, newest first; not today, not other days', () => {
  const list = [
    en({ date: '2024-10-04', title: '两年前' }), en({ date: '2025-10-04', title: '去年' }), en({ date: '2026-10-04', title: '今天' }),
    en({ date: '2025-10-05', title: '去年明天' }), en({ date: '2025-11-04', title: '去年下个月' }), en({ date: '2027-10-04', title: '明年' }),
  ];
  const got = onThisDay(list, '2026-10-04');
  assert.deepEqual(got.map((r) => [r.title, r.years]), [['去年', 1], ['两年前', 2]]);
  assert.deepEqual(onThisDay(list, '2026-03-01'), []);
  assert.deepEqual(onThisDay([], '2026-10-04'), []);
});

test('那年今日: a locked page is there, as a locked page (only its date)', () => {
  const got = onThisDay([en({ date: '2025-10-04', title: '', locked: true })], '2026-10-04');
  assert.deepEqual(got, [{ id: '2025-10-04', date: '2025-10-04', title: '上了锁的一页', locked: true, years: 1 }]);
});

const pages = [
  en({ date: '2026-01-02', title: '湖边', body: '今天去了**西湖**，风很大。' }),
  en({ date: '2026-03-04', title: '加班', body: '修了一个 Bug，在公司待到很晚。', place: '上海 · 徐汇' }),
  en({ date: '2026-05-06', title: '周末', body: '和朋友去湖边野餐，[照片](https://x.example)很好看。\n\n```代码\n西湖\n```' }),
  en({ date: '2026-07-08', title: '锁着', body: '', locked: true }),
  en({ date: '2026-07-09', title: '秘密', body: '只写给自己的话 西湖', locked: true }),
];

test('找: every word must be there; the title first, then the newest', () => {
  assert.deepEqual(searchEntries(pages, '湖边').map((r) => r.title), ['湖边', '周末']);
  assert.deepEqual(searchEntries(pages, '湖边 野餐').map((r) => r.title), ['周末']);
  assert.deepEqual(searchEntries(pages, 'bug').map((r) => r.title), ['加班']);     // (any case)
  assert.deepEqual(searchEntries(pages, '徐汇').map((r) => r.title), ['加班']);    // (the place too)
  assert.deepEqual(searchEntries(pages, '').length, 0);
  assert.deepEqual(searchEntries(pages, '   ').length, 0);
  assert.deepEqual(searchEntries(pages, '没有这个词').length, 0);
});

test('找: the words as the page shows them (no Markdown, no code, no link addresses)', () => {
  assert.deepEqual(searchEntries(pages, '西湖').map((r) => r.title), ['湖边']);   // (the code block's 西湖 isn't on the page)
  assert.equal(searchEntries(pages, 'x.example').length, 0);
  assert.equal(searchEntries(pages, '**').length, 0);
});

test('找: a locked page is never found, not even by what it says', () => {
  assert.equal(searchEntries(pages, '锁着').length, 0);
  assert.equal(searchEntries(pages, '秘密').length, 0);
  assert.equal(searchEntries(pages, '只写给自己').length, 0);
});

test('找: the words around the match, cut at its ends', () => {
  const [hit] = searchEntries([en({ date: '2026-01-01', title: '长', body: '一二三四五六七八九十'.repeat(5) + '目标' + '甲乙丙丁戊己庚辛壬癸'.repeat(5) })], '目标');
  assert.equal(hit.snip[1], '目标');
  assert.ok(hit.snip[0].startsWith('…') && hit.snip[2].endsWith('…'));
  assert.ok([...hit.snip[0]].length <= 15 && [...hit.snip[2]].length <= 27);
  const [low] = searchEntries([en({ date: '2026-01-01', title: 'x', body: 'Hello World' })], 'world');
  assert.equal(low.snip[1], 'World');                                                // (as written, not as typed)
});

test('找: at most so many', () => {
  const many = Array.from({ length: 60 }, (_, i) => en({ date: `2026-01-${String(i % 28 + 1).padStart(2, '0')}`, n: i, body: '同一个词' }));
  assert.equal(searchEntries(many, '同一个词').length, 40);
  assert.equal(searchEntries(many, '同一个词', 10).length, 10);
});
