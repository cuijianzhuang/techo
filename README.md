# xxx.log · 手帐主页

一本可以一直写下去的网页手帐。封面默认合上，翻开是一页一页的方格纸：开头几页是手工排好的示例，之后是在后台写的日记。翻到一页时，字和插画一笔一笔写出来。每晚 Claude 会把当天的随手记写成一页草稿，第二天看过再发布。

可以部署在 Cloudflare Workers 上（页面是静态文件，日记存在 D1，照片存在 R2），也可以放在自己的 VPS 上（Node + SQLite + 本地文件夹，一条 `docker compose up -d`），两种方式用的是同一份代码。后台用 GitHub 登录。

## 特点

- **翻书**：立体的书（three.js）和平面翻页（手机默认）两种，拖页角翻页，有翻页声，纸页会随系统变成夜间版。
- **写**：Markdown 正文，后台有工具栏和实时预览；每页最多 3 张照片、手绘小插画、印章、便签；照片自带的拍摄时间和位置会自动填；可以从 NeoDB 一键填书、影视、音乐卡片，贴网易云歌曲。
- **随手记和 AI**：白天记一句，晚上自动写成一页草稿，第二天看过再发布；「✨ AI 补全」补上标题、小注、印章和插画（Claude，或任何兼容的接口）。
- **找**：时间线、书架、票夹、账本、足迹地图，都是从日记里长出来的；每一页有自己的分享链接和分享卡片。
- **上锁**：整本、某一天或单独一页都可以设口令。

完整的功能和用法见 [使用说明](docs/guide.md)。

## 技术栈

| 层 | 用的是 |
|---|---|
| 页面 | 原生 HTML / CSS / JS；立体的书用 [three.js](https://threejs.org)（esbuild 打包进 `public/assets/book3d.js`），平面翻页用 StPageFlip（已放在 `public/vendor/`） |
| 托管 | Cloudflare Workers 静态资源（`public/`）；或 VPS：Node（`server/`，打包成 `dist/server.mjs`）+ Caddy，见 [部署到 VPS](docs/deploy-vps.md) |
| API | Worker + [Hono](https://hono.dev)（`src/`，入口 `src/index.ts`） |
| 数据 | D1：`techo-db`（日记页、随手记、手帐设置、口令） |
| 照片 | R2：`techo-photos`，经 `/img/...` 读取；照片按日期放进文件夹 `p/年/月/日/<uuid>.jpg`（见[使用说明](docs/guide.md#照片在-r2-里的位置)）；分享卡片也在这里（`cards/<id>.jpg`） |
| 地图 | [Mapbox](https://www.mapbox.com)（可选）：GL JS 从 Mapbox 的 CDN 加载，页上的小地图用 Static Images API，地名用 Geocoding v6 |
| 后台登录 | GitHub 登录（OAuth App），只放行 `ADMIN_GITHUB_LOGIN` 这一个账号 → 签名的 HttpOnly Cookie，30 天有效 |
| 部署 | Cloudflare：GitHub Actions，push 到 `main` → 类型检查 → 检查生成文件 → `wrangler deploy`；VPS：`docker compose up -d` |
| AI | `src/compose.ts`：默认 Claude API 的 `claude-opus-5`（Anthropic SDK）；也可以在后台改成任何 Anthropic 兼容或 OpenAI 兼容（`/chat/completions`）的接口和模型 |

## 快速开始

```bash
npm install
cp .dev.vars.example .dev.vars     # 本地跳过登录（只对 localhost 生效）
npm run db:init:local
npm run dev                        # http://localhost:8787 ，后台 http://localhost:8787/admin/
```

提交前跑一下 CI 会检查的几项：

```bash
npm run typecheck
npm test
python3 src-build/build.py && npm run build:3d && git status   # public/ 不应该有没提交的改动
```

## 文档

| 文档 | 内容 |
|---|---|
| [部署](docs/deploy.md) | 部署到 Cloudflare：数据库和桶、GitHub Actions、GitHub 登录、域名；fork 到新账号要改什么；升级旧数据库 |
| [部署到 VPS](docs/deploy-vps.md) | 部署到自己的服务器：Docker + Caddy 或 systemd + nginx、环境变量、备份、和 Cloudflare 之间互相搬数据 |
| [使用说明](docs/guide.md) | 功能一览、怎么写一页、手帐设置、随手记和 AI、照片在 R2 里的位置 |
| [开发文档](docs/development.md) | 项目结构、本地开发、怎么改页面、缓存、数据库、安全、接口 |

## 友链

- [LINUX DO](https://linux.do/)

## 许可证

[MIT](LICENSE)。StPageFlip 和 three.js 同为 MIT（StPageFlip 的许可见 `public/vendor/page-flip.LICENSE.txt`，three.js 的许可在打包后的 `book3d.js` 末尾）。欢迎提 Issue 和 PR。
