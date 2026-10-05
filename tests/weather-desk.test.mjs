/* 桌面天气 (render.js weatherKind): what a page's written weather makes of the desk, and the switch for it */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installHtmlRewriter, loadApp, slice, sqliteD1 } from './helpers.mjs';

const weatherKind = new Function(slice('public/assets/render.js', '  function weatherKind(', '  /** the layer behind the book') + '; return weatherKind;')();

test('the weather written on a page, as the desk shows it', () => {
  const cases = {
    '晴 24°': 'sun', '晴转多云 18~26°': 'cloud', '多云': 'cloud', '阴': 'cloud',
    '小雨 15~20°': 'rain', '多云转小雨 15~25°': 'rain', '阵雨': 'rain', '雷阵雨': 'storm', '暴雨': 'storm',
    '小雪': 'snow', '雨夹雪': 'snow', '大雾': 'fog', '霾': 'fog', '扬沙': 'fog',
    'Sunny': 'sun', 'light rain': 'rain', 'Cloudy': 'cloud', 'Thunderstorm': 'storm',
  };
  for (const [text, kind] of Object.entries(cases)) assert.equal(weatherKind(text), kind, text);
  for (const none of ['', '   ', null, undefined, '15~25°', '大风']) assert.equal(weatherKind(none), '', String(none));
});

test('every kind the classifier gives has its part on the desk', () => {
  const css = readFileSync(new URL('../src-build/book-extra.css', import.meta.url), 'utf8');
  for (const k of ['storm', 'snow', 'rain', 'fog', 'cloud', 'sun']) assert.match(css, new RegExp(`\\.wx\\[data-wx="${k}"\\]`), k);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.wx>div/);
});

test('the switch is a setting: on by default, on or off', async () => {
  installHtmlRewriter();
  const app = await loadApp();
  const env = { DB: await sqliteD1(), TIMEZONE: 'Asia/Shanghai', GITHUB_CLIENT_ID: 'i', ADMIN_GITHUB_LOGIN: 'me', GITHUB_CLIENT_SECRET: 's', DEV_BYPASS_AUTH: '1' };
  const call = (method, path, body) => app.fetch(new Request('http://localhost:8787' + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }), env);
  assert.equal((await (await call('GET', '/api/settings')).json()).settings.deskWeather, 'on');
  assert.equal((await call('PUT', '/api/admin/settings', { deskWeather: 'off' })).status, 200);
  assert.equal((await (await call('GET', '/api/settings')).json()).settings.deskWeather, 'off');
  assert.equal((await call('PUT', '/api/admin/settings', { deskWeather: 'maybe' })).status, 400);
});
