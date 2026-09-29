/* 网易云 through Meting (src/meting.ts): whatever shape an API answers in, one song comes out */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, withFetch, json, redirect } from './helpers.mjs';

const { songIn, metingUrl, metingSong } = await loadTs('src/meting.ts');
const API = 'https://meting.example/api';
const self = (id, type) => `${API}?server=netease&id=${id}&type=${type}`;
const text = (body, type = 'text/plain') => new Response(body, { status: 200, headers: { 'content-type': type } });
const NETEASE_404 = () => redirect('https://music.163.com/404');

// a Meting API that wants the token "abc"; `song` answers type=song, `media` the rest (by type), NetEase the outer link
const api = ({ song, media = {}, outer = NETEASE_404, detail }) => (url, init) => {
  const u = new URL(url);
  if (u.hostname === 'music.163.com') return u.pathname.startsWith('/song/media/outer') ? outer() : (detail ? json(detail) : json({}, 404));
  if (u.pathname === '/' ) return text('<!doctype html><h1>Music API</h1>', 'text/html; charset=utf-8');
  if (init.headers.authorization !== 'Bearer abc') return json({ success: false, error: '需要 API Token，请使用 Authorization: Bearer <token>' }, 401);
  const type = u.searchParams.get('type');
  if (type === 'song') return song();
  return media[type] ? media[type]() : json({ success: false, error: 'no ' + type });
};
const ask = (route, id = '1111', base = API, token = 'abc') => withFetch(route, (seen) => metingSong(token, base, id).then((s) => [s, seen]));

test('urls: placeholders or a query are added', () => {
  assert.equal(metingUrl('https://x.example/api', 'song', '5'), 'https://x.example/api?server=netease&type=song&id=5');
  assert.equal(metingUrl('https://x.example/api?a=1', 'lrc', '5'), 'https://x.example/api?a=1&server=netease&type=lrc&id=5');
  assert.match(metingUrl('https://x.example/?server=:server&type=:type&id=:id', 'pic', '5'), /^https:\/\/x\.example\/\?server=netease&type=pic&id=5$/);
  assert.match(metingUrl('', 'song', '5'), /^https:\/\/api\.injahow\.cn\/meting\/\?server=netease&type=song&id=5$/);
});

test('songIn finds the song in an array, in data, in result, in a nest', () => {
  const s = { title: '晴天', url: 'https://a/b.mp3' };
  for (const j of [[s], { data: [s] }, { data: s }, { result: { songs: [s] } }, { success: true, data: { song: s } }]) assert.equal(songIn(j)?.title, '晴天');
  assert.equal(songIn({ ok: 1, weird: true }), null);
  assert.equal(songIn('nope'), null);
});

test('an array: its own urls are followed to NetEase, http becomes https, words are fetched', async () => {
  const [s] = await ask(api({
    song: () => json([{ name: '晴天', artist: '周杰伦', url: self('1111', 'url'), pic: self('1111', 'pic'), lrc: self('1111', 'lrc') }]),
    media: { url: () => redirect('http://m701.music.126.net/x/1111.mp3'), pic: () => redirect('https://p1.music.126.net/y.jpg'), lrc: () => text('[00:00.00]故事的小黄花') },
  }));
  assert.deepEqual(s, { title: '晴天', artist: '周杰伦', url: 'https://m701.music.126.net/x/1111.mp3', pic: 'https://p1.music.126.net/y.jpg', lrc: '[00:00.00]故事的小黄花' });
});

test('a song with no sound (VIP) still has its name and cover, and says why', async () => {
  const [s] = await ask(api({ song: () => json({ success: true, data: { name: '稻香', artist: '周杰伦', url: '', pic: self('2222', 'pic') } }), media: { pic: () => redirect('https://p1.music.126.net/y.jpg') } }), '2222');
  assert.equal(s.title, '稻香');
  assert.equal(s.url, '');
  assert.equal(s.pic, 'https://p1.music.126.net/y.jpg');
  assert.match(s.why, /VIP/);
});

test('a sound that only comes with the token goes through the Worker', async () => {
  const [s] = await ask(api({ song: () => json({ code: 200, data: { song: { title: '夜曲', author: '周杰伦', url: self('3333', 'url') } } }), media: { url: () => new Response('x', { headers: { 'content-type': 'audio/mpeg' } }) } }), '3333');
  assert.equal(s.url, '/api/meting/file?t=url&id=3333');
});

test('what the song lacks is asked for: type=url gives JSON with the address, artists come as a list', async () => {
  const [s] = await ask(api({
    song: () => json({ success: true, data: { name: '七里香', artist: ['周杰伦', '某人'] } }),
    media: { url: () => json({ success: true, data: { url: 'https://m8.music.126.net/z.mp3' } }), lrc: () => json({ success: true, data: { lrc: '[00:00.00]窗外的麻雀' } }) },
  }), '5555');
  assert.equal(s.artist, '周杰伦 / 某人');
  assert.equal(s.url, 'https://m8.music.126.net/z.mp3');
  assert.equal(s.lrc, '[00:00.00]窗外的麻雀');
});

test("NetEase's own link and details fill in the rest", async () => {
  const [s] = await ask(api({
    song: () => json({ data: { url: '' } }),
    outer: () => redirect('http://m10.music.126.net/free.mp3'),
    detail: { songs: [{ name: '免费的歌', artists: [{ name: '某歌手' }], album: { picUrl: 'http://p2.music.126.net/c.jpg' } }] },
  }));
  assert.deepEqual([s.title, s.artist, s.url, s.pic], ['免费的歌', '某歌手', 'https://m10.music.126.net/free.mp3', 'https://p2.music.126.net/c.jpg']);
});

test('an address of the site root asks its /api when the root is a page', async () => {
  const [s, seen] = await ask(api({ song: () => json([{ name: '晴天', artist: '周杰伦', url: 'https://m7.music.126.net/a.mp3' }]) }), '1111', 'https://meting.example/');
  assert.equal(s.title, '晴天');
  assert.match(seen[0].url, /^https:\/\/meting\.example\/\?/);      // asked at the root first
  assert.match(seen[1].url, /^https:\/\/meting\.example\/api\?/);   // then at /api
});

test('the token: wanted, wrong', async () => {
  const r = api({ song: () => json([]) });
  await assert.rejects(ask(r, '1111', API, ''), /要 token/);
  await assert.rejects(ask(r, '1111', API, 'wrong'), /不认这个 token/);
});

test('an answer not understood is shown as it came', async () => {
  await assert.rejects(ask(api({ song: () => json({ ok: 1, weird: true }) })), /没认出 Meting 接口的回答：\{"ok":1,"weird":true\}/);
});
