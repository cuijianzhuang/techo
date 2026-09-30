# 部署

> 这份文档讲怎么把手帐部署到 Cloudflare。功能和用法见 [使用说明](guide.md)，开发和接口见 [开发文档](development.md)。

## 换到新账号（fork）要改什么

| 要改的 | 在哪 | 说明 |
|---|---|---|
| `d1_databases[0].database_id` | `wrangler.jsonc` | 换成新账号里 `npx wrangler d1 create techo-db` 得到的 id（原来的 id 只在原账号里有，别的账号会报 `D1 binding 'DB' … not found`） |
| `vars.GITHUB_CLIENT_ID` | `wrangler.jsonc` | 新站自己的 GitHub OAuth App 的 Client ID |
| `vars.ADMIN_GITHUB_LOGIN` | `wrangler.jsonc` | 唯一能进后台的 GitHub 用户名 |
| `GITHUB_CLIENT_SECRET` | Worker 密钥 | `npx wrangler secret put GITHUB_CLIENT_SECRET` |
| `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` | 仓库的 Actions Secrets | 必须是同一个（新）账号的；Token 要有 Workers、D1、R2 的编辑权限 |

桶和表由部署自动建（下面第 1 步；Token 要有 D1 和 R2 的编辑权限，没有的话这一步会跳过并在日志里给出警告，部署照常进行，桶和表就要手动建），新账号第一次部署前还要在 Cloudflare 的 Workers & Pages 里设一个 `workers.dev` 子域名。`TIMEZONE` 想按别的时区算“今天”时再改；`ratelimits`、`triggers`、`version_metadata` 不用动。Meting、和风天气、Mapbox、AI 的密钥都存在数据库的设置里，在新站后台的「手帐设置」里重新填。新库是空的，旧站的日记和照片不会跟过去。

## 1. Cloudflare 上的数据库和照片桶

`wrangler.jsonc` 里已经填好了 D1 数据库 `techo-db`（APAC）和 R2 存储桶 `techo-photos` 的 ID。线上的库已经是最新的表结构（三个升级文件都跑过了）。

在别的账号从头部署时，只要手动建一次数据库，把输出的 `database_id` 填进 `wrangler.jsonc`（换掉原来的）：

```bash
npx wrangler d1 create techo-db
```

照片桶和表由部署自己建：部署前 `scripts/bootstrap.sh` 会在桶不存在时建 `techo-photos`，在数据库明确报“没有这张表”（`no such table`）时用 `schema.sql` 建表。已经在用的库不会被动；检查不了（比如 Token 没有 D1 权限）就跳过并给警告，不会让部署失败。想在部署之外手动建，也可以：

```bash
npx wrangler r2 bucket create techo-photos
npm run db:init:remote                     # 用 schema.sql 建表，新库不用再跑 migrations/
```

以后改表结构时，`schema.sql` 和 `migrations/` 要一起改：`schema.sql` 给新库，`migrations/` 给已经在用的旧库。见[开发文档 · 数据库](development.md#数据库)。

## 2. 用 GitHub Actions 部署

仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，加两个：

- `CLOUDFLARE_API_TOKEN`：Cloudflare 控制台 → 右上角头像 → **My Profile** → **API Tokens** → **Create Token** → 模板 **Edit Cloudflare Workers**（账户选你自己的）
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 控制台首页右侧的 **Account ID**

之后每次 push 到 `main`：装依赖 → 类型检查 → 重新生成页面，检查和 `public/` 里提交的一致 → `wrangler deploy`。合并请求只跑检查不部署。也可以在 Actions 页手动 **Run workflow**。

> 不要再在 Cloudflare 里连接 Workers Builds，否则每次 push 会部署两遍。

## 3. 设置 GitHub 登录

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**：
   - Application name：`xxx.log 后台`（随意）
   - Homepage URL：`https://techo.cuijianzhuang.workers.dev`（绑了域名就填域名）
   - Authorization callback URL：`https://techo.cuijianzhuang.workers.dev/api/auth/github/callback`
2. 创建后复制 **Client ID**，填进 `wrangler.jsonc` 的 `GITHUB_CLIENT_ID`（公开的，可以进仓库）。
3. 点 **Generate a new client secret**，存成 Worker 密钥（不进仓库）：

   ```bash
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

4. `ADMIN_GITHUB_LOGIN` 是唯一能进后台的 GitHub 用户名，默认 `cuijianzhuang`。

换 client secret 会让所有已登录的设备退出。换域名时记得同时改 OAuth App 的两个地址。

## 4. 绑定域名（可选）

Worker `techo` → **Settings** → **Domains & Routes** → **Add** → **Custom domain**，例如 `techo.你的域名`。不绑也能用 `techo.<你的子域>.workers.dev`。

## 5. 开始写

主页底部点「✎ 写一页」（或直接打开 `/admin/`），用 GitHub 登录，点「新写一页」。保存后刷新主页就能看到。

后台首页是「今天」：今天写了没有、随手记一句、等着发布的草稿（一键发布）。编辑页按「这一页 / 正文 / 照片 / 插画和小物」分组，不常用的「页脚引文 / 地点和天气 / 上锁」收着；保存按钮一直在底部，⌘/Ctrl+S 也能保存。手机上列表和编辑分开两屏，「预览」全屏看这一页。
## 升级已经在用的数据库

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
