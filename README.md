# cui.log · 手帐主页

一本可以一直写下去的网页手帐：封面默认合上，拖动页角翻页，纸张会弯折；新写的页从后台保存，照片存在 R2。
每页可以贴两个手绘小插画，翻到时一笔一笔画出来；每晚 22:00 Claude 会把当天的随手记和聊天写成一页草稿。

## 技术栈

| 层 | 用的是 |
|---|---|
| 页面 | 原生 HTML / CSS / JS，翻页用 [StPageFlip](https://github.com/Nodlik/StPageFlip)（MIT，已放在 `public/vendor/`） |
| 托管 | Cloudflare Workers 静态资源（`public/`） |
| API | Worker + [Hono](https://hono.dev)（`src/index.ts`） |
| 数据 | D1：`techo-db`（日记页、随手记、联系方式） |
| 照片 | R2：`techo-photos`，经 `/img/...` 读取 |
| 后台登录 | GitHub 登录（OAuth App），只放行 `ADMIN_GITHUB_LOGIN` 这一个账号 → 签名的 HttpOnly Cookie，30 天有效 |
| 部署 | GitHub Actions（`.github/workflows/deploy.yml`）：push 到 main → 类型检查 → `wrangler deploy` |
| 写草稿 | Claude API（`@anthropic-ai/sdk`，`src/compose.ts`），模型 `claude-opus-5` |

```
public/              静态页面：/ 手帐、/admin/ 后台
  assets/            techo.css（生成）、render.js、book.js、admin.js、admin.css
  vendor/            page-flip.browser.js
src/index.ts         Worker：/api/*、/img/*、每晚的定时任务
src/compose.ts       调 Claude 把随手记写成一页
schema.sql           D1 表结构（可重复执行）
migrations/          旧库升级用的 SQL
src-build/           页面源文件与生成脚本（python3 src-build/build.py）
wrangler.jsonc       Worker 配置（D1 / R2 已填好 ID）
```

## 已经在你的 Cloudflare 账号里建好的

- D1 数据库 `techo-db`（APAC），表结构已初始化，ID 已写进 `wrangler.jsonc`
- 这个库建于草稿 / 插画 / 随手记之前，要先升级一次（只跑一次）：

  ```bash
  npx wrangler d1 execute techo-db --remote --file=migrations/0001_drafts_stickers_jots.sql
  ```
- R2 存储桶 `techo-photos`

## 部署步骤

### 1. 推到 GitHub

已推到 [cuijianzhuang/techo](https://github.com/cuijianzhuang/techo)，之后直接 `git push`。

### 2. 用 GitHub Actions 部署

仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，加两个：

- `CLOUDFLARE_API_TOKEN`：Cloudflare 控制台 → 右上角头像 → **My Profile** → **API Tokens** → **Create Token** → 模板 **Edit Cloudflare Workers**（账户选你自己的）
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 控制台首页右侧的 **Account ID**

之后每次 push 到 `main`：装依赖 → 类型检查 → 检查 `public/` 和 `src-build/` 一致 → `wrangler deploy`。PR 只跑检查不部署。也可以在 Actions 页手动 **Run workflow**。

> 不要再在 Cloudflare 里连接 Workers Builds，否则每次 push 会部署两遍。

### 3. 设置 GitHub 登录

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**：
   - Application name：`cui.log 后台`（随意）
   - Homepage URL：`https://techo.cuijianzhuang.workers.dev`（绑了域名就填域名）
   - Authorization callback URL：`https://techo.cuijianzhuang.workers.dev/api/auth/github/callback`
2. 创建后复制 **Client ID**，填进 `wrangler.jsonc` 的 `GITHUB_CLIENT_ID`（公开的，可以进仓库）。
3. 点 **Generate a new client secret**，存成 Worker 密钥（不进仓库）：

   ```bash
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

4. `ADMIN_GITHUB_LOGIN` 是唯一能进后台的 GitHub 用户名，默认 `cuijianzhuang`。

换 client secret 会让所有已登录的设备退出。换域名时记得同时改 OAuth App 的两个地址。

### 4. 绑定域名（可选）

Worker `techo` → **Settings** → **Domains & Routes** → **Add** → **Custom domain**，例如 `techo.你的域名`。不绑也能用 `techo.<你的子域>.workers.dev`。

### 5. 开始写

主页底部点「✎ 写一页」（或直接打开 `/admin/`），用 GitHub 登录，点「新写一页」。保存后刷新主页就能看到。

## 小插画

后台编辑页里点选，最多两个：晴天、多云、下雨、月亮、猫、书、电脑、bug、植物、吃面、公交、骑车、音乐、心、星星、来信、拍照。
画在 `public/assets/render.js` 的 `STICKERS` 里（64×64 的线稿 SVG）。新增一个要同时加到 `src/index.ts` 的 `STICKERS`。

## 草稿与每晚自动写

- 每页有状态：`draft`（草稿，主页不显示）/ `published`（已发布）。后台用「发布这一页」「存为草稿」「改回草稿」切换。
- 后台「随手记」：白天随手记一句，存在 `jots` 表里。
- 本机 Claude 桌面应用里有一个定时任务「每晚写一页手帐（草稿）」，每天 22:00 左右运行：读今天没用过的随手记和今天的 Claude Code 会话，写成一页**草稿**，挑 0–2 个插画，并把用过的随手记标记掉。当天已经有一页就不写。第二天到后台看过再发布。
  - 应用没开着时不会运行，下次打开时补跑。
  - 读不到 claude.ai 网页上的聊天。
  - 任务说明在 `~/.claude/scheduled-tasks/techo-nightly-page/SKILL.md`，改口吻或素材就改这里。
- 网站自己也会写（需要 Claude API Key）：
  - 后台「随手记」里的「现在就用今天的随手记写一页」随时生成一页草稿。
  - 每天 23:30（Asia/Shanghai，`wrangler.jsonc` 的 `triggers`）Worker 检查今天还没有页、又有随手记，就自动写一页草稿——电脑没开的日子靠它兜底。
  - 只读随手记，读不到 Claude 聊天；当天已经有一页就不写。
  - 开启：在 [console.anthropic.com](https://console.anthropic.com) 建一个 API Key，首次部署后运行 `npx wrangler secret put ANTHROPIC_API_KEY` 粘贴进去。按量计费，一页大约 $0.03。
  - 日期按 `wrangler.jsonc` 里的 `TIMEZONE` 算。

## 安全说明

- 主页、`/api/entries`、`/api/settings`、`/img/*` 是公开只读的。
- 所有写操作都在 `/api/admin/*`，要带登录后的 Cookie。Cookie 是 `过期时间.GitHub用户名.HMAC`，用从 client secret 派生的密钥签名，HttpOnly + Secure + SameSite=Strict；没有、被改过、或用户名不是 `ADMIN_GITHUB_LOGIN` 都只会得到 401。
- GitHub 登录带 `state` 防 CSRF（10 分钟有效的 HttpOnly Cookie），只申请最小权限（读公开资料），不保存 GitHub token。
- 想彻底关掉 workers.dev 地址：在 `wrangler.jsonc` 加 `"workers_dev": false`。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars     # 本地跳过登录（只对 localhost 生效）
npm run db:init:local
npm run dev                        # http://localhost:8787 ，后台 http://localhost:8787/admin/
```

## 改页面

- 开头 6 页（9/25–9/30）、封面、扉页、封底的内容在 `src-build/design/techo.html` 和 `src-build/index.tpl.html`。
- 改完运行 `python3 src-build/build.py`，会重新生成 `public/index.html`、`public/admin/index.html`、`public/assets/techo.css`。
- 后台写的页面会按日期排在这 6 页后面。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/entries` | 已发布的日记页（按日期） |
| GET | `/api/settings` | 联系方式 |
| GET | `/img/p/<uuid>.<ext>` | 照片 |
| GET | `/api/auth/github` | 跳到 GitHub 登录 |
| GET | `/api/auth/github/callback` | GitHub 登录回调，成功后下发 Cookie 并回到 `/admin/` |
| GET | `/api/admin/me` | 当前登录的 GitHub 用户名 |
| POST | `/api/admin/logout` | 退出 |
| GET | `/api/admin/entries` | 所有页，含草稿 |
| POST | `/api/admin/entries` | 新建一页（JSON；`stickers` 数组、`status` 默认 `published`） |
| PUT | `/api/admin/entries/:id` | 整页覆盖更新（换照片时自动删旧图） |
| DELETE | `/api/admin/entries/:id` | 删除（连同照片） |
| PUT | `/api/admin/settings` | 更新联系方式 |
| GET | `/api/admin/jots` | 最近 100 条随手记 |
| POST | `/api/admin/jots` | 记一句（`{"text": "..."}`，≤1000 字） |
| DELETE | `/api/admin/jots/:id` | 删一条随手记 |
| POST | `/api/admin/compose` | 用今天的随手记让 Claude 写一页草稿（今天已有页或没有随手记时返回 409） |
| POST | `/api/admin/photos` | 上传照片（请求体为图片本身，≤10MB；后台会先压到 1600px） |
