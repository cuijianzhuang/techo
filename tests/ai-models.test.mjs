/* 获取模型 (POST /api/admin/ai/models): every model the key can use at the address as typed, from Anthropic's
   /v1/models (all pages) or an OpenAI-style /models; and what the admin is told when that doesn't work */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installHtmlRewriter, json, loadApp, sqliteD1, withFetch } from './helpers.mjs';

installHtmlRewriter();
const app = await loadApp();
const env = async (extra = {}) => ({ DB: await sqliteD1(), TIMEZONE: 'Asia/Shanghai', GITHUB_CLIENT_ID: 'i', ADMIN_GITHUB_LOGIN: 'me', GITHUB_CLIENT_SECRET: 's', DEV_BYPASS_AUTH: '1', AI_API_KEY: 'k-1', ...extra });
const models = async (e, body) => {
  const r = await app.fetch(new Request('http://localhost:8787/api/admin/ai/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), e);
  return { status: r.status, body: await r.json() };
};
const m = (id, name) => ({ type: 'model', id, display_name: name, created_at: '2026-01-01T00:00:00Z' });

test('Anthropic: every page of /v1/models, with the key, newest first as listed', async () => {
  const e = await env();
  await withFetch((url) => {
    const u = new URL(url);
    if (u.pathname !== '/v1/models') return json({ error: { type: 'not_found_error', message: 'no' } }, 404);
    return u.searchParams.get('after_id')
      ? json({ data: [m('claude-haiku-4-5', 'Claude Haiku 4.5')], has_more: false, first_id: 'claude-haiku-4-5', last_id: 'claude-haiku-4-5' })
      : json({ data: [m('claude-opus-5-5', 'Claude Opus 5.5'), m('claude-sonnet-5-5', 'Claude Sonnet 5.5')], has_more: true, first_id: 'claude-opus-5-5', last_id: 'claude-sonnet-5-5' });
  }, async (seen) => {
    const r = await models(e, { aiFormat: 'anthropic' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.models, [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    ]);
    assert.equal(seen.length, 2);
    assert.ok(seen.every((s) => s.url.startsWith('https://api.anthropic.com/v1/models')));
    const h = new Headers(seen[0].init.headers);
    assert.equal(h.get('x-api-key'), 'k-1');
  });
});

test('Anthropic-compatible relay: its own address, /v1 cut off as for messages', async () => {
  const e = await env();
  await withFetch(() => json({ data: [m('glm-5', '')], has_more: false }), async (seen) => {
    const r = await models(e, { aiFormat: 'anthropic', aiBaseUrl: 'https://relay.example.com/anthropic/v1' });
    assert.deepEqual(r.body.models, [{ id: 'glm-5', name: '' }]);
    assert.match(seen[0].url, /^https:\/\/relay\.example\.com\/anthropic\/v1\/models/);
  });
});

test('OpenAI-style: /models at the address, sorted, with the key as a bearer token', async () => {
  const e = await env();
  await withFetch(() => json({ object: 'list', data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }, { id: 'deepseek-chat' }, { nope: 1 }] }), async (seen) => {
    const r = await models(e, { aiFormat: 'openai', aiBaseUrl: 'https://api.deepseek.com/chat/completions' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.models.map((x) => x.id), ['deepseek-chat', 'deepseek-reasoner']);
    assert.equal(seen[0].url, 'https://api.deepseek.com/models');
    assert.equal(new Headers(seen[0].init.headers).get('authorization'), 'Bearer k-1');
  });
});

test('what the admin is told: a wrong key, no list at that address, no key at all', async () => {
  const e = await env();
  await withFetch(() => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401), async () => {
    const r = await models(e, { aiFormat: 'anthropic' });
    assert.equal(r.status, 500);
    assert.match(r.body.error, /401|key/);
  });
  await withFetch(() => json({ error: { message: 'Not Found' } }, 404), async () => {
    const r = await models(e, { aiFormat: 'openai', aiBaseUrl: 'https://relay.example.com/v1' });
    assert.match(r.body.error, /不提供模型列表/);
  });
  await withFetch(() => json({ data: [] }), async () => {
    assert.match((await models(e, { aiFormat: 'openai' })).body.error, /没有列出模型/);
  });
  const none = await env({ AI_API_KEY: undefined });
  assert.match((await models(none, { aiFormat: 'anthropic' })).body.error, /还没有 AI 的 key/);
  assert.equal((await models(e, { aiFormat: 'gemini' })).status, 400);
});
