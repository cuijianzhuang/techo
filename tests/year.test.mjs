/* The year in review (public/assets/year.js yearStats): what is counted, and that a locked page counts as a page and
   a day and nothing more. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { slice } from './helpers.mjs';

const R = 'public/assets/render.js';
// the parts of render.js and keep.js it uses, as the browser has them
const T = new Function([
  slice(R, 'function sortEntries(', '\n'),
  slice(R, 'const NETEASE_LINE=', '\n'),
  slice(R, 'function plainText(', 'function panel('),
  slice(R, '  const TICKET_NAMES=', '  // "PEK 北京首都"'),
  slice(R, '  const neteaseId=', '  const metingCache='),
  slice(R, '  const neteaseLine=', '  const cardNode='),
].join('\n') + '; return { sortEntries, plainText, cardsOf, ticketFields, neteaseId, kvOf };')();
const K = new Function('T', slice('public/assets/keep.js', 'const AMOUNT=', '  const dayOf=') + '; return { bill };')(T);
const { yearStats } = new Function('T', 'K', slice('public/assets/year.js', '  const pad=n=>', '  /* ---------- drawing ---------- */') + '; return { yearStats };')(T, K);

const en = (o) => ({ id: o.date + (o.n || ''), title: '一页', body: '', createdAt: 1, stickers: [], photos: [], ...o });
const card = (kind, ...lines) => '```' + kind + '\n' + lines.join('\n') + '\n```\n';
const pages = [
  en({ date: '2025-12-31', title: '去年', body: '不算在今年' }),
  en({ date: '2026-01-01', title: '元旦', body: '新年第一天。', place: '上海 · 徐汇', stickers: ['sun', 'cat'] }),
  en({ date: '2026-01-02', title: '第二天', body: '一二三四五六七八九十', place: '上海 · 静安', stickers: ['cat'], photos: [{ key: 'p/x.jpg' }, { key: 'p/y.jpg' }] }),
  en({ date: '2026-01-03', n: 'a', title: '第三天', body: card('书籍', '书名: 小王子', '作者: 圣埃克苏佩里') + '\n读完了。', place: '杭州 · 西湖' }),
  en({ date: '2026-01-03', n: 'b', title: '第三天又一页', body: card('书籍', '书名: 小王子', '作者: 圣埃克苏佩里') + card('电影', '片名: 千与千寻') }),
  en({ date: '2026-02-10', title: '出差', body: card('机票', '航班: MU5101') + card('车票', '车次: G1') + card('电影票', '片名: 某片') + card('账单', '# 午饭', '- 拉面: ¥28', '- 可乐: ¥5.5') }),
  en({ date: '2026-02-11', title: '锁着的', locked: true }),
  en({ date: '2026-03-01', title: '', body: card('账单', '= 合计: ¥100') }),
];
const st = yearStats(pages, 2026);

test('pages, days and the longest run, only of that year', () => {
  assert.equal(st.pages, 7);
  assert.equal(st.days, 6);
  assert.deepEqual(st.streak, { len: 3, from: '2026-01-01', to: '2026-01-03' });
  assert.deepEqual(st.months.slice(0, 4), [4, 2, 1, 0]);
  assert.equal(st.perDay.get('2026-01-03'), 2);
  assert.equal(yearStats(pages, 2025).pages, 1);
  assert.equal(yearStats(pages, 2024).pages, 0);
});

test('a locked page is a page and a day, and gives nothing else away', () => {
  assert.equal(st.locked, 1);
  assert.ok(st.perDay.has('2026-02-11'));
  assert.ok(!st.places.some(([p]) => /锁/.test(p)));
  assert.notEqual(st.last.title, '锁着的');
});

test('places and cities, the most first', () => {
  assert.deepEqual(st.cities, [['上海', 2], ['杭州', 1]]);
  assert.equal(st.places.length, 3);
});

test('books, films, music: once per title, however often written', () => {
  assert.deepEqual(st.books, ['小王子']);
  assert.deepEqual(st.films, ['千与千寻']);
  assert.deepEqual(st.music, []);
});

test('tickets and money', () => {
  assert.deepEqual(st.tickets, { flight: 1, train: 1, cinema: 1 });
  assert.equal(st.bills, 2);
  assert.equal(st.spent, 133.5);
});

test('doodles, photos, words, and the first, last and longest page', () => {
  assert.deepEqual(st.stickers, [['cat', 2], ['sun', 1]]);
  assert.equal(st.photos, 2);
  assert.equal(st.first.title, '元旦');
  assert.equal(st.last.title, '（无题）');                // (the 3-01 page has no title)
  assert.equal(st.longest.title, '第二天');
  assert.equal(st.longest.chars, 10);
  assert.ok(st.words > 10);
});

test('a year with no pages: zeros, nothing to point at', () => {
  const none = yearStats([], 2026);
  assert.equal(none.pages, 0);
  assert.equal(none.first, null);
  assert.equal(none.longest, null);
  assert.equal(none.streak.len, 0);
});
