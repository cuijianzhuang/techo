/* 和风天气: a page's day as a Chinese forecast says it (src/qweather.ts) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, withFetch, json } from './helpers.mjs';

const { qweatherDay } = await loadTs('src/qweather.ts');
const HOST = 'abc.re.qweatherapi.com', TODAY = '2026-09-28';
const hourly = (day) => Array.from({ length: 24 }, (_, i) => ({ time: `${day}T${String(i).padStart(2, '0')}:00+08:00`, text: i < 14 ? '晴' : i < 18 ? '阵雨' : '多云' }));

// what the service answers, by path
const service = (o = {}) => (url, init) => {
  const u = new URL(url);
  if (init.headers['X-QW-Api-Key'] !== 'k1') return json({ code: '401' });
  if (u.pathname === '/v7/weather/7d') return o.no7d ? json({ code: '403' }) : json({ code: '200', daily: [{ fxDate: '2026-09-28', textDay: '多云', textNight: '小雨', tempMax: '25', tempMin: '15' }, { fxDate: '2026-09-29', textDay: '晴', textNight: '晴', tempMax: '24', tempMin: '13' }] });
  if (u.pathname === '/v7/weather/3d') return json({ code: '200', daily: [{ fxDate: '2026-09-28', textDay: '阴', textNight: '阴', tempMax: '22', tempMin: '18' }] });
  if (u.pathname.endsWith('/city/lookup')) return json({ code: '200', location: [{ id: '101010600' }] });
  if (u.pathname === '/v7/historical/weather') return json({ code: '200', weatherDaily: { tempMax: '26', tempMin: '16' }, weatherHourly: hourly('2026-09-25') });
  return json({ code: '404' });
};
const day = (date, o, key = 'k1', host = HOST) => withFetch(service(o), (seen) => qweatherDay(key, host, date, 39.9, 116.62, TODAY).then((w) => [w, seen]));

test("today: the forecast's day and night, 转 when they differ", async () => {
  const [w, seen] = await day('2026-09-28');
  assert.equal(w, '多云转小雨 15~25°');
  assert.match(seen[0].url, /^https:\/\/abc\.re\.qweatherapi\.com\/v7\/weather\/7d\?location=116\.62,39\.90$/);   // (longitude first)
});

test('one word when day and night agree', async () => {
  assert.equal((await day('2026-09-29'))[0], '晴 13~24°');
});

test('a plan without the 7-day forecast falls back to 3 days', async () => {
  assert.equal((await day('2026-09-28', { no7d: true }))[0], '阴 18~22°');
});

test('the last days come from the historical hours: morning and afternoon each by what most of it was', async () => {
  const [w, seen] = await day('2026-09-25');
  assert.equal(w, '晴转阵雨 16~26°');
  assert.deepEqual(seen.map((s) => new URL(s.url).pathname), ['/geo/v2/city/lookup', '/v7/historical/weather']);   // the LocationID first
  assert.match(seen[1].url, /location=101010600&date=20260925$/);
});

test('the older public host asks geoapi and datasetapi', async () => {
  const [, seen] = await day('2026-09-25', {}, 'k1', '');
  assert.deepEqual(seen.map((s) => new URL(s.url).host), ['geoapi.qweather.com', 'datasetapi.qweather.com']);
});

test('what it cannot say is said', async () => {
  await assert.rejects(day('2026-09-08'), /最近 10 天/);
  await assert.rejects(day('2026-10-20'), /太远/);
  await assert.rejects(day('2026-09-28', {}, 'bad'), /KEY 不对/);
});
