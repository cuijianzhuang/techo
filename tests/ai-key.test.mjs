/* The AI's key pasted into the admin (PUT / DELETE /api/admin/ai/key): kept out of every settings answer, used
   before the Worker secret, and a key typed but not saved can be tried first */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installHtmlRewriter, json, loadApp, sqliteD1, withFetch } from './helpers.mjs';

installHtmlRewriter();
const app = await loadApp();
const KEY = 'sk-ant-api03-pasted-0123456789-wxyz';
const env = async (extra = {}) => ({ DB: await sqliteD1(), TIMEZONE: 'Asia/Shanghai', GITHUB_CLIENT_ID: 'i', ADMIN_GITHUB_LOGIN: 'me', GITHUB_CLIENT_SECRET: 's', DEV_BYPASS_AUTH: '1',
  ASSETS: { fetch: async () => new Response('<!doctype html><html><head></head><body><main id="static"></main></body></html>', { headers: { 'content-type': 'text/html' } }) }, ...extra });
const call = async (e, method, path, payload) => {
  const r = await app.fetch(new Request('http://localhost:8787' + path, { method, headers: { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) }), e);
  const text = await r.text();
  let body = null; try { body = JSON.parse(text || 'null'); } catch { /* the home page */ }
  return { status: r.status, text, body };
};
const list = () => json({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false });

test('saved, it is used, and never handed back', async () => {
  const e = await env({ AI_API_KEY: 'sk-secret-from-worker-9999' });
  assert.deepEqual((await call(e, 'GET', '/api/admin/settings')).body.ai, { keySet: true, source: 'secret', tail: '9999' });

  const put = await call(e, 'PUT', '/api/admin/ai/key', { key: '  ' + KEY + '\n' });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.ai, { keySet: true, source: 'admin', tail: 'wxyz' });

  for (const path of ['/api/admin/settings', '/api/settings', '/']) {
    const r = await call(e, 'GET', path);
    assert.equal(r.status, 200, path);
    assert.ok(!r.text.includes(KEY) && !r.text.includes('aiApiKey'), path);
  }
  // saving the settings (the admin sends them all back) neither writes nor clears it
  assert.equal((await call(e, 'PUT', '/api/admin/settings', { aiApiKey: 'sk-other-key-000000', aiModel: 'claude-opus-5-5' })).status, 200);
  assert.ok(!(await call(e, 'PUT', '/api/admin/settings', {})).text.includes(KEY));

  await withFetch(list, async (seen) => {
    assert.equal((await call(e, 'POST', '/api/admin/ai/models', { aiFormat: 'anthropic' })).status, 200);
    assert.equal(new Headers(seen[0].init.headers).get('x-api-key'), KEY);   // pasted wins over the secret
  });

  const del = await call(e, 'DELETE', '/api/admin/ai/key');
  assert.deepEqual(del.body.ai, { keySet: true, source: 'secret', tail: '9999' });
  await withFetch(list, async (seen) => {
    await call(e, 'POST', '/api/admin/ai/models', { aiFormat: 'anthropic' });
    assert.equal(new Headers(seen[0].init.headers).get('x-api-key'), 'sk-secret-from-worker-9999');
  });
});

test('a key typed but not saved: tried by 获取模型 / 测试连接, and the only key there is', async () => {
  const e = await env();
  assert.deepEqual((await call(e, 'GET', '/api/admin/settings')).body.ai, { keySet: false, source: '', tail: '' });
  assert.match((await call(e, 'POST', '/api/admin/ai/models', { aiFormat: 'openai' })).body.error, /还没有 AI 的 key/);
  await withFetch(() => json({ data: [{ id: 'gpt-5' }] }), async (seen) => {
    const r = await call(e, 'POST', '/api/admin/ai/models', { aiFormat: 'openai', aiApiKey: 'sk-typed-123456789' });
    assert.deepEqual(r.body.models, [{ id: 'gpt-5', name: '' }]);
    assert.equal(new Headers(seen[0].init.headers).get('authorization'), 'Bearer sk-typed-123456789');
  });
  assert.equal((await call(e, 'GET', '/api/admin/settings')).body.ai.keySet, false);   // trying isn't saving
  assert.equal((await call(e, 'POST', '/api/admin/ai/test', { aiApiKey: 'has space in it' })).status, 400);
});

test('what is not a key', async () => {
  const e = await env();
  for (const key of ['', '   ', 'short', 'sk ant with spaces', 'sk-密钥-123456', 'x'.repeat(401), 42]) {
    assert.equal((await call(e, 'PUT', '/api/admin/ai/key', { key })).status, 400, String(key).slice(0, 20));
  }
  assert.equal((await call(e, 'GET', '/api/admin/settings')).body.ai.keySet, false);
});
