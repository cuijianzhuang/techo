/* The Worker's routes (src/index.ts mounts the modules): what the login keeps out, and what a reader must never get */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers.mjs';

const app = await loadApp();

// a database that must not be touched (a route that reaches it without the login has got past the gate), or that
// holds the settings given
const noDb = { prepare() { throw new Error('the database was touched'); } };
const settingsDb = (rows) => ({ prepare: () => ({ all: async () => ({ results: rows }), first: async () => null, bind() { return this; } }) });
const env = (o = {}) => ({ GITHUB_CLIENT_ID: 'id', ADMIN_GITHUB_LOGIN: 'me', GITHUB_CLIENT_SECRET: 'secret', TIMEZONE: 'Asia/Shanghai', DB: noDb, ...o });
const call = (path, o = {}, e = env(), base = 'https://journal.example') => app.fetch(new Request(base + path, o), e);

const adminRoutes = app.routes.filter((r) => r.path.startsWith('/api/admin/') && r.method !== 'ALL').map((r) => [r.method, r.path.replace(':scope', 'book').replace(':id', 'x')]);

test('there are admin routes to check', () => {
  assert.ok(adminRoutes.length >= 20, String(adminRoutes.length));
  assert.ok(app.routes.some((r) => r.method === 'ALL' && r.path === '/api/admin/*'), 'the login gate is mounted');
});

test('every admin route is refused without the login, before it touches anything', async () => {
  for (const [method, path] of adminRoutes) {
    const r = await call(path, { method, body: method === 'GET' || method === 'DELETE' ? undefined : '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test('a made-up session is no login either', async () => {
  const r = await call('/api/admin/me', { headers: { cookie: 'techo_session=9999999999999.me.forged' } });
  assert.equal(r.status, 401);
});

test('the local bypass is for localhost only', async () => {
  const away = await call('/api/admin/me', {}, env({ DEV_BYPASS_AUTH: '1' }));
  assert.equal(away.status, 401);
  const local = await call('/api/admin/me', {}, env({ DEV_BYPASS_AUTH: '1' }), 'http://localhost:8787');
  assert.equal(local.status, 200);
  assert.deepEqual(await local.json(), { login: 'dev' });
});

test('an admin route left unconfigured says so instead of letting anyone in', async () => {
  const r = await call('/api/admin/me', {}, env({ GITHUB_CLIENT_SECRET: undefined }));
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /GITHUB_CLIENT_SECRET/);
});

const SECRETS = [{ key: 'metingToken', value: 'tok-123' }, { key: 'qweatherKey', value: 'qw-key' }, { key: 'qweatherHost', value: 'abc.re.qweatherapi.com' },
  { key: 'aiBaseUrl', value: 'https://ai.example' }, { key: 'siteTitle', value: '我的手帐' }];

test("the readers' settings never carry the admin's secrets", async () => {
  const r = await call('/api/settings', {}, env({ DB: settingsDb(SECRETS) }));
  assert.equal(r.status, 200);
  const text = await r.text();
  const { settings } = JSON.parse(text);
  assert.equal(settings.siteTitle, '我的手帐');
  for (const k of ['metingToken', 'qweatherKey', 'qweatherHost', 'aiBaseUrl', 'aiModel', 'aiFormat']) assert.ok(!(k in settings), k);
  for (const v of ['tok-123', 'qw-key', 'ai.example']) assert.ok(!text.includes(v), v);
});

test('the admin sees them', async () => {
  const r = await call('/api/admin/settings', {}, env({ DEV_BYPASS_AUTH: '1', DB: settingsDb(SECRETS) }), 'http://localhost:8787');
  const { settings } = await r.json();
  assert.equal(settings.metingToken, 'tok-123');
  assert.equal(settings.qweatherKey, 'qw-key');
});

test('an unknown API path is a JSON 404, not the assets', async () => {
  const r = await call('/api/nothing');
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: '没有这个接口' });
});

test("a song with no Meting address set says so, in the Worker's words", async () => {
  const res = await call('/api/meting?id=187745', {}, env({ DB: settingsDb([{ key: 'siteTitle', value: 'x' }]) }));
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /还没有配置 Meting 接口/);
});
