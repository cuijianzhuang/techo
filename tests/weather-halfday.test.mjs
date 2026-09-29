/* Open-Meteo's day is read from its hours, the way a Chinese forecast says it (public/assets/admin.js) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { slice } from './helpers.mjs';

const halfDay = new Function(slice('public/assets/admin.js', 'function halfDay', 'async function weatherOn') + ';return halfDay;')();
const hours = (from, to, code, mm = 0, cloud = 0) => Array.from({ length: to - from + 1 }, (_, i) => ({ at: from + i, code, mm, cloud }));

test('a sunny morning is 晴, whatever its cloud code', () => {
  assert.equal(halfDay(hours(6, 13, 1, 0, 15)), '晴');
});

test('by the clouds: under 35% 晴, under 75% 多云, else 阴', () => {
  assert.equal(halfDay(hours(6, 13, 2, 0, 34)), '晴');
  assert.equal(halfDay(hours(6, 13, 2, 0, 50)), '多云');
  assert.equal(halfDay(hours(6, 13, 3, 0, 90)), '阴');
});

test('an hour of drizzle does not make the half-day rainy', () => {
  const h = hours(6, 13, 1, 0, 15);
  h[3] = { at: 9, code: 51, mm: 0.1, cloud: 15 };
  assert.equal(halfDay(h), '晴');
});

test('rain for two hours or more counts, by how much came down', () => {
  const rain = (n, mm, code = 61) => { const h = hours(14, 21, 3, 0, 90); for (let i = 0; i < n; i++) h[i] = { at: 14 + i, code, mm, cloud: 90 }; return h; };
  assert.equal(halfDay(rain(5, 0.5)), '小雨');       // 2.5 mm
  assert.equal(halfDay(rain(5, 2)), '中雨');         // 10 mm
  assert.equal(halfDay(rain(5, 4)), '大雨');         // 20 mm
  assert.equal(halfDay(rain(5, 8)), '暴雨');         // 40 mm
  assert.equal(halfDay(rain(3, 0.1, 53)), '毛毛雨'); // all drizzle, under 1 mm
  assert.equal(halfDay(rain(4, 0.5, 80)), '阵雨');
  assert.equal(halfDay(rain(2, 1, 95)), '雷阵雨');
});

test('snow, and fog that lay three hours', () => {
  const snow = hours(6, 13, 3, 0, 90); for (let i = 0; i < 4; i++) snow[i] = { at: 6 + i, code: 73, mm: 0.8, cloud: 90 };
  assert.equal(halfDay(snow), '中雪');
  const fog = hours(6, 13, 2, 0, 60); for (let i = 0; i < 3; i++) fog[i] = { at: 6 + i, code: 45, mm: 0, cloud: 100 };
  assert.equal(halfDay(fog), '雾');
  const thin = hours(6, 13, 2, 0, 20); for (let i = 0; i < 2; i++) thin[i] = { at: 6 + i, code: 45, mm: 0, cloud: 100 };
  assert.notEqual(halfDay(thin), '雾');
});
