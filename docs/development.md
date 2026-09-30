# 开发文档

> 项目结构、本地开发、怎么改页面、缓存、数据库、安全和接口。部署见 [部署](deploy.md)，用法见 [使用说明](guide.md)。

## 项目结构

```
public/                 静态文件（部署的就是这个目录）
  index.html            手帐主页（生成）
  admin/index.html      后台（生成）
  timeline/index.html   卡片样式的时间线页
  map/index.html        足迹地图页
  og.png                分享时的默认图
  404.html              撕下来的一页
  assets/
    boot.js             选用哪种书
    render.js           两种书共用：拼页面、Markdown、写字动画、时间线、日历、放大看、上锁
    book.js             平面翻页的书
    book3d.js           立体的书（生成，源码在 src-build/book3d/）
    timeline.js         /timeline/ 的脚本
    map.js              /map/ 的脚本
    card.js             分享卡片（生成，源码在 src-build/card.js，后台用）
    paper.css           纸色和夜间书页（生成，源码在 src-build/paper.css）
    admin.js / admin.css 后台
    techo.css           样式（生成）
  vendor/               StPageFlip
src/index.ts            Worker 入口：把下面各部分的路由接起来（先是读者能访问的，再是 /api/admin/* 的登录关卡，再是后台的），每晚的定时任务
src/env.ts              环境类型、bad()、localDay()、aiKey()
src/entries.ts          日记页的字段、校验、读写、照片和卡片在 R2 里的键（`selectEntries`：各种视图和分段直接在 SQL 里挑，只读要的列、要的行，分段走日期索引）
src/settings.ts         设置（哪些只有后台看得到）、/api/settings、后台读写设置
src/ai.ts               AI：用哪个模型、测试连接、一键补全
src/locks.ts            口令：整本或某一天上锁、/api/entries（几种视图、分段、304）、/api/unlock
src/cache.ts            边缘缓存（数据版本、`bumpVersion`、`cached`）
src/etag.ts             ETag 和 304
src/text.ts             正文去掉标记后的一行字（时间线的摘要，和 render.js 的 plainText 一致）、有没有卡片
src/home.ts             书的首页（把日记内联进去，有自己的 ETag）
src/share.ts            /p/<id> 分享页、/card/、/img/
src/photos.ts           把旧的 `p/<uuid>.jpg` 搬进日期文件夹的迁移接口（手动、分步，不会自己运行）
src/auth.ts             GitHub 登录和后台登录关卡（requireLogin）
src/crypto.ts           登录和口令用的 HMAC、比较
src/admin-entries.ts    后台：页的增删改、分享卡片、传照片
src/drafts.ts           随手记、每晚（和「现在就写」）用 Claude 写草稿页
src/lookup.ts           NeoDB 查书 / 影视 / 专辑、存封面
src/music.ts            网易云：认歌、/api/meting、转发要 token 的音频
src/weather.ts          后台查天气的路由
src/meting.ts           取一首歌的全部逻辑（没有路由，测试直接用）
src/qweather.ts         和风天气（没有路由，测试直接用）
src/ua.ts               Worker 请求别的服务时用的名字
src/compose.ts          调 Claude 把随手记写成一页
src-build/              页面源文件和生成脚本
  design/               示例页、封面、扉页、封底的设计稿
  book3d/               立体的书的源码（index.js、raster.js、curl.mjs……）
  build.py              生成 index.html、admin/index.html、techo.css
schema.sql              D1 表结构（新建数据库用，可重复执行）
migrations/             旧数据库升级用的 SQL
tests/                  测试（`npm test`）：立体的书、Meting、和风天气、天气按小时的写法、账单、文件版本号、Worker 的路由
wrangler.jsonc          Worker 配置（D1 / R2 已填好 ID）
```

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars     # 本地跳过登录（只对 localhost 生效）
npm run db:init:local
npm run dev                        # http://localhost:8787 ，后台 http://localhost:8787/admin/
```

提交前跑一下 CI 会检查的几项：

```bash
npm run typecheck
npm test                          # tests/*.test.mjs：立体书的动作、Meting、和风天气、天气按小时的写法、账单
python3 src-build/build.py && npm run build:3d && git status   # public/ 不应该有没提交的改动
```

测试放在 `tests/`，文件名 `*.test.mjs`。Worker 里的逻辑（`src/meting.ts`、`src/qweather.ts`）用 `tests/helpers.mjs` 的 `loadTs` 直接跑，网络用 `withFetch` 换成假的；浏览器脚本里的函数（`halfDay`、`bill`）没有模块，用 `slice` 按前后标记从源文件里取出来，标记找不到时测试会直接报错，不会悄悄什么都没测。

## 改页面

- 示例页、封面、扉页、封底的内容在 `src-build/design/techo.html` 和 `src-build/index.tpl.html`，样式在 `src-build/design/extra.css` 和 `src-build/book-extra.css`。改完运行 `python3 src-build/build.py`，会重新生成 `public/index.html`、`public/admin/index.html`、`public/assets/techo.css` 和 `public/assets/paper.css`（纸色，书和 `/timeline/` 共用，源文件是 `src-build/paper.css`）。
- 立体的书的源码在 `src-build/book3d/`，改完运行 `npm run build:3d` 重新打包 `public/assets/book3d.js`。
- `public/assets/` 里其余的 js / css 和 `public/timeline/`、`public/404.html` 直接改。
- **文件版本号**：页面里引用 `/assets/*` 和 `/vendor/*` 的地方都带着 `?v=<十位>`（比如 `/assets/render.js?v=59b61e98ef`），由 `src-build/stamp.py` 按文件内容算出；一个文件引用了别的文件（`boot.js` 加载 `book3d.js`，它又读 `techo.css`），版本里也算进了那个文件的版本，所以改了 CSS，用到它的脚本和页面的地址也跟着变。`public/_headers` 让这两个目录缓存一年（`immutable`），回访的读者不再为每个文件问一遍服务器；新部署地址就变了，读到的一定是新的。页面本身（HTML）仍是每次向服务器确认。
  - **改了 `public/` 里的 js / css / html 之后运行 `python3 src-build/build.py`**（它最后会跑 `stamp.py`；`npm run build:3d` 也会）。忘了的话 `npm test` 和 CI 会报「版本不是现在算出来的」，不会带着旧版本上线。`npm run dev` 启动前会自动跑一遍，但开着 dev 时再改文件要手动跑，浏览器也要强制刷新（Ctrl/⌘+Shift+R），不然会拿到缓存里的旧文件。
  - 新写的引用要用引号、`(` 或 `=` 紧挨着写 `/assets/…`（`src="/assets/x.js"`、`import('/assets/x.js')`），`stamp.py` 才认得出来；Worker 里找 `boot.js` 用的是 `script[src^="/assets/boot.js"]`。
- 生成的文件要和源码一起提交，CI 会检查两边一致。
- 后台写的页面按日期排在示例页后面。

## 缓存

从浏览器到数据库分四层，每一层各管一样：

| 层 | 缓什么 | 怎么保证不读到旧的 |
|---|---|---|
| 浏览器：`/assets/*`、`/vendor/*` | 脚本和样式，一年（`public/_headers`，`immutable`） | 引用它们的地方带 `?v=<版本>`，文件或它引用的文件变了版本就变（`src-build/stamp.py`） |
| 浏览器：页面、首页、`/api/entries` | 存着，但每次先问（`no-cache`）；没变回 304，不用下载 | `ETag` 是回答内容的哈希（`src/etag.ts`） |
| 边缘（Workers Cache API，`src/cache.ts`）：首页、`/api/entries` 的每种视图和分段 | 不带口令的读者看到的那一份，数据库里只读一行 | 键里有部署 id 和数据版本，见下 |
| 浏览器和 CDN：`/p/`、`/card/`、`/img/` | 分享页 5 分钟、卡片 1 小时、图片一年 | 图片的键是随机 UUID，永远不重用；上了锁的页不缓存 |

**边缘缓存怎么工作**
- 键：`https://cache.internal/<名字>/<部署 id>/<数据版本>?<view、limit、before>`。别的查询参数不进键；出错的请求（400）不存。
- **数据版本**是 `settings` 表里 `key='_v'` 那一行（读者和后台都看不到，不用迁移）。每次请求先读它，键里带着它。**每次改了读者能看到的东西（新建 / 改 / 发布 / 取消发布 / 删除一页、上锁和改口令、保存设置），写完数据库之后 `bumpVersion` 写一个新的版本**，旧的缓存立刻作废，读者下一次刷新就是新的。每晚写的草稿和随手记读者看不到，不用升。`tests/cache.test.mjs` 会检查：所有写这几张表的文件都调了 `bumpVersion`。
- **部署 id**（`wrangler.jsonc` 的 `version_metadata`）：新部署换一批键，旧代码存的东西不会混进来。
- 带 `X-Techo-Keys` 的请求（打开过上了锁的页的读者）不走缓存，也不往里存，照旧现算，响应头 `X-Cache: BYPASS`。命中是 `HIT`，没命中是 `MISS`；本地 `wrangler dev` 默认不用（改了页面立刻能看到），想试就 `--var CACHE_LOCAL:1`。
- **兜底**：每份最多存 1 小时。绕开 Worker 改数据库（在 D1 里手动改数据、跑迁移、导入）之后，要么等一小时，要么在后台随便保存一次设置，要么 `UPDATE settings SET value = 'x' WHERE key = '_v'`（没有这一行就 `INSERT`）。
- **以后新加会改读者可见内容的写入，记得写完调 `bumpVersion(c.env)`**（`src/cache.ts`）。
- Cache API 每个数据中心各存各的，一次改动之后各地的第一个访问者各付一次「没命中」的代价；`workers.dev` 域名上用不了它（自定义域名可以），那时每次都是 `BYPASS`，只是没有加速。

## 数据库

| 表 | 存什么 |
|---|---|
| `entries` | 日记页：日期、标题、正文（Markdown）、照片（`photo_key` 是逗号分隔的最多 3 个 R2 key，`photo_cap` 每行一个说明）、插画、地点、坐标、天气、状态…… |
| `jots` | 随手记，`used_in` 记着被写进了哪一页 |
| `settings` | 手帐设置，一项一行 |
| `locks` | 口令（PBKDF2 哈希，不存明文），`scope` 是 `book`、`d-YYYY-MM-DD`（一整天）或某一页的 id |

新数据库用 `schema.sql`（`npm run db:init:remote`，本地是 `db:init:local`），里面已经是最新结构。之前建的数据库按顺序跑还没跑过的升级文件，每个只跑一次：

| 文件 | 加了什么 |
|---|---|
| `migrations/0001_drafts_stickers_jots.sql` | 草稿状态、小插画、随手记 |
| `migrations/0002_locks.sql` | 口令（可以重复跑） |
| `migrations/0003_place_weather.sql` | 地点、坐标、天气（没跑之前照常能写，只是不能填这几项） |
| `migrations/0004_font.sql` | 每一页可以单独选字体（没跑之前照常能写，只是选不了每页的字体） |

```bash
npx wrangler d1 execute techo-db --remote --file=migrations/0004_font.sql
```

不知道跑过哪些时，先看一眼表结构：`npx wrangler d1 execute techo-db --remote --command "PRAGMA table_info(entries)"`。

## 安全说明

- 主页、`/timeline/`、`/map/`、`/p/*`、`/card/*`、`/api/entries`、`/api/settings`、`/img/*` 是公开只读的。分享页和分享卡片只对已发布、没上锁的页有内容。
- 所有写操作都在 `/api/admin/*`，要带登录后的 Cookie。Cookie 是 `过期时间.GitHub用户名.HMAC`，用从 client secret 派生的密钥签名，HttpOnly + Secure + SameSite=Strict；没有、被改过、或用户名不是 `ADMIN_GITHUB_LOGIN` 都只会得到 401。
- GitHub 登录带 `state` 防 CSRF（10 分钟有效的 HttpOnly Cookie），只申请最小权限（读公开资料），不保存 GitHub token。
- 上了锁的页，没给口令的读者只拿得到日期，照片也要口令才能读。口令只存 PBKDF2 哈希；猜口令每个 IP 每分钟最多 10 次（`wrangler.jsonc` 的 `ratelimits`）。改口令会让已经打开过的读者失效。
- 正文按 Markdown 渲染成页面时只用文本节点，写进去的内容不会被当成 HTML；链接只允许 http/https。
- 坐标只保留两位小数（大约 1 公里）。
- 想彻底关掉 workers.dev 地址：在 `wrangler.jsonc` 加 `"workers_dev": false`。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/entries` | 已发布的日记页（按日期）；上了锁、没给口令的只有日期。口令令牌放在 `X-Techo-Keys` 请求头里。按页面需要给不同的量：`?view=index`（不带正文，只带前 100 个字的 `excerpt`：时间线用）、`?view=map`（只有带地点的页，只有地图要画的字段）、`?view=cards`（只有带卡片或网易云链接的页才带正文：书架、票夹、账本用），不写就是全部（书要排每一个字）。`?limit=100`（最多 500）只给一段，新的在前，`&before=<页的 id>` 给那一页之前的一段，另外带 `page: {total, days, first, last, more}` 说明整本是多少。带 `ETag`，没变时对 `If-None-Match` 回 304；`Cache-Control: private, no-cache`，`Vary: X-Techo-Keys` |
| POST | `/api/unlock` | 用口令换一个 12 小时有效的令牌（`{"scope", "password"}`） |
| GET | `/api/settings` | 手帐设置（没设置过的项返回默认值；不含 AI 三项） |
| GET | `/api/meting?id=` | 网易云歌曲（经 Meting，带上设置里的 token）：`{title, artist, url, pic, lrc}`；放不了的歌 `url` 为空，另有 `why` |
| GET | `/api/meting/file?id=&t=url\|pic` | 只有带 token 才给的音频 / 封面，由 Worker 转发（支持 `Range`） |
| GET | `/img/p/年/月/日/<uuid>.<ext>`（旧的 `/img/p/<uuid>.<ext>` 也认） | 照片；上了锁的页的照片要带 `?k=令牌` |
| GET | `/p/:id` | 一页的分享链接：带 Open Graph 标签的小页面，打开后跳到 `/#e-<id>` |
| GET | `/card/:id.jpg` | 一页的分享卡片（1200×630）；草稿和上了锁的页是 404 |
| GET | `/api/auth/github` | 跳到 GitHub 登录 |
| GET | `/api/auth/github/callback` | GitHub 登录回调，成功后下发 Cookie 并回到 `/admin/` |
| GET | `/api/admin/me` | 当前登录的 GitHub 用户名 |
| POST | `/api/admin/logout` | 退出 |
| GET | `/api/admin/entries` | 所有页，含草稿和上锁情况 |
| POST | `/api/admin/entries` | 新建一页（JSON；`photos` 是 `[{key, cap}]`，最多 3 张；`stickers` 数组；`status` 默认 `published`） |
| PUT | `/api/admin/entries/:id` | 整页覆盖更新（拿掉的照片会从 R2 删除） |
| DELETE | `/api/admin/entries/:id` | 删除（连同照片和分享卡片） |
| PUT | `/api/admin/entries/:id/card` | 上传这一页的分享卡片（请求体是 JPEG，≤1.5MB；后台发布时自动做） |
| PUT | `/api/admin/locks/:scope` | 设口令（`{"password": "…"}`，至少 4 个字符）；`{"password": null}` 去掉。`scope`：`book`、`d-YYYY-MM-DD` 或页的 id |
| GET | `/api/admin/settings` | 全部手帐设置（含 AI 三项）和是否配置了 AI 的 key |
| PUT | `/api/admin/settings` | 更新手帐设置（只改传了的项） |
| POST | `/api/admin/ai/test` | 测试连接（`{"aiFormat", "aiBaseUrl", "aiModel"}`，用给的设置问一句话） |
| POST | `/api/admin/ai/suggest` | AI 补全：按一页的内容（JSON，要有 `body`）建议标题、英文小注、页眉小字、印章、页脚引文和插画，不保存 |
| GET | `/api/admin/jots` | 随手记，新的在前：`?q=` 搜，`?state=unused\|used` 筛，`?limit=`（默认 100，最多 200），`?before=<createdAt>.<id>` 取下一页；还返回总数、没用过的数目、`more` |
| POST | `/api/admin/jots` | 记一句（`{"text": "..."}`，≤1000 字） |
| DELETE | `/api/admin/jots/:id` | 删一条随手记 |
| POST | `/api/admin/jots/delete` | 一次删几条（`{"ids": [...]}`，最多 100 条） |
| POST | `/api/admin/compose` | 用今天的随手记让 AI 写一页草稿（今天已有页或没有随手记时返回 409） |
| POST | `/api/admin/photos` | 上传照片（请求体为图片本身，≤10MB）；`?date=YYYY-MM-DD` 是放进哪天的文件夹（编辑器传这一页的日期），没带或不是真日期就用今天；返回 `{"key": "p/2026/09/28/<uuid>.jpg"}` |
| POST | `/api/admin/photos/migrate` | 把旧照片搬进日期文件夹：`{"step": "preview\|copy\|cleanup", "limit": 4}`，见[使用说明 · 照片在 R2 里的位置](guide.md#照片在-r2-里的位置) |
| POST | `/api/admin/lookup` | 查书、影视、音乐（`{"q": "书名或链接", "kind": "book\|film\|music"}`，数据来自 NeoDB，ISBN 退到 Open Library）；贴链接时 NeoDB 还在抓会返回 `{"pending": true}` |
| POST | `/api/admin/cover` | 把一张远程封面存进 R2（`{"url": "https://…"}`，≤10MB 的图片），返回 `{"key": "p/….jpg"}` |
| GET | `/api/admin/meting?id=&api=` | 「试一下」：用还没保存的 Meting 地址（和请求头 `x-meting-token` 里的 token）取一首歌 |
| GET | `/api/admin/weather?date=&lat=&lon=` | 和风天气查那天的天气：`{"weather": "多云转小雨 15~25°"}`；没配 KEY 时 404 `{"off": true}`。「试一下」用请求头 `x-qweather-key` 和 `&host=` 带上还没保存的 KEY 和 Host |
| POST | `/api/admin/netease` | 认出一首网易云的歌（`{"q": "链接、App 分享的文字或 ID"}`，`163cn.tv` 短链接跟着跳转去认），返回 `{"id": "186016"}` |
