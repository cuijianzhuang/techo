/* the page's side of a song (public/assets/render.js `meting`): it asks the Worker and shows the Worker's word */
import test from 'node:test';
import assert from 'node:assert/strict';
import { slice, withFetch, json } from './helpers.mjs';

const make = () => new Function('site', slice('public/assets/render.js', 'const metingCache', '// "[01:23.45]words" lines') + ';return meting;')({});
const song = { title: '晴天', artist: '周杰伦', url: 'https://m7.music.126.net/a.mp3', pic: '', lrc: '' };

test('a song comes from /api/meting, once, and is remembered', async () => {
  const meting = make();
  await withFetch(() => json(song), async (seen) => {
    assert.deepEqual(await meting('187745'), song);
    await meting('187745');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/api/meting?id=187745');
  });
});

test('a song NetEase will not play still has its name: it is an answer, not an error', async () => {
  const vip = { title: '稻香', artist: '周杰伦', url: '', pic: '', lrc: '', why: '在网易云放不了（VIP 或下架）' };
  await withFetch(() => json(vip), async () => assert.deepEqual(await make()('2222'), vip));
});

test("the Worker's word is what is shown, and the API is not tried from the browser", async () => {
  const meting = make();
  await withFetch(() => json({ error: 'Meting 接口要 token：在「手帐设置 → 接入服务 → 网易云音乐」填上' }, 500), async (seen) => {
    await assert.rejects(meting('187745'), /Meting 接口要 token/);
    assert.equal(seen.length, 1);
    assert.ok(seen.every((s) => s.url.startsWith('/api/')));
  });
});

test('an error is not remembered: the next ask goes out again', async () => {
  const meting = make();
  let n = 0;
  await withFetch(() => (++n === 1 ? json({ error: 'x' }, 500) : json(song)), async () => {
    await assert.rejects(meting('187745'));
    await new Promise((r) => setTimeout(r));
    assert.equal((await meting('187745')).title, '晴天');
  });
});

test('未保存的地址和 token（试一下）go to the admin route, the token in a header', async () => {
  const meting = make();
  await withFetch(() => json(song), async (seen) => {
    await meting('187745', 'https://m.example/api', 'abc');
    assert.equal(seen[0].url, '/api/admin/meting?id=187745&api=https%3A%2F%2Fm.example%2Fapi');
    assert.equal(seen[0].init.headers['x-meting-token'], 'abc');
  });
});

test('the Worker not answering at all is a failure, not a reason to ask the API from here', async () => {
  const meting = make();
  await withFetch(() => { throw new TypeError('Failed to fetch'); }, async (seen) => {
    await assert.rejects(meting('187745'), /Failed to fetch/);
    assert.equal(seen.length, 1);
  });
});
