# xxx.log · 手帐主页

一本可以一直写下去的网页手帐。封面默认合上，翻开是一页一页的方格纸：开头几页是手工排好的示例，之后是在后台写的日记。翻到一页时，字和插画一笔一笔写出来。每晚 Claude 会把当天的随手记写成一页草稿，第二天看过再发布。

跑在 Cloudflare Workers 上：页面是静态文件，日记存在 D1，照片存在 R2，后台用 GitHub 登录。

## 功能

**翻书**
- **立体的书**（three.js）：封板有厚度和圆角，纸比封皮小一圈；拖页角翻页，纸页从页角折起；有翻页声（导航里的 ♪ 可以关）。
- **平面翻页**（[StPageFlip](https://github.com/Nodlik/StPageFlip)）：更轻，手机默认用它；翻页声和 ♪ 开关也有。设备不支持 WebGL，或系统开了“减少动态效果”时，也会用它。
- 后台「手帐设置 → 阅读 → 翻页方式」可选：自动（手机平面，平板和电脑立体，默认）、始终立体、始终平面。网址加 `?book=3d` 或 `?book=flip` 可以临时强制一种。

**在书里找**
- 导航：← → 翻页；「封面」「时间线」直接翻过去；配了 Mapbox 时旁边还有📍足迹地图；🔍 放大看当前页（手机上看小字用，双击或双指缩放）；分享图标分享眼前这篇日记（封面、时间线、示例页上是灰的）；📅 日历，点有日记的日子翻过去；♪ 翻页声；☾/☀ 日夜切换。
- **时间线**：扉页后面的几页是目录，列出后台写的每一篇日记，按月分组，最新的在前，点一行翻到那一天；页脚的「整页看 →」打开卡片样式的时间线页 `/timeline/`，带摘要、插画和照片。页很多时一次只拿最新的 100 页，滚到底再拿更早的 100 页（也有「更早的日子」按钮）。
- **书架**（`/shelf/`）：日记里写过的书籍、影视、音乐卡片都收在这里，分「书 / 影 / 音」三格。书一本本立在木书架上，一年一层，书脊的颜色和竖排书名跟卡片上那本小书一样（有封面的封面朝外，在读的插着书签带）；电影是贴在墙上的白边海报；歌是露出半张唱片的唱片套。同一本书写过几天只算一本，点开是日记里那张卡片的原样，下面列出写到它的那几天，点一天翻过去。顶上统计一共几本、今年读了几本。
- **票夹**（`/tickets/`）：日记里的机票、车票和电影票，按月插在透明插袋里，最新的在前；每月一行小结（飞了几趟、火车几趟、看了几场电影），可以只看某一种。点一张看大图和写它的那天。
- **账本**（`/bills/`）：日记里的账单算好的账。顶上是本月、今年和今年平均每月花了多少；一根柱子一个月（最近 12 个月，悬停看金额，点一根看那个月）；选中的月份按「花在哪」列出来，每类一根横条、后面写金额和占比，下面是这个月的小票。花在哪：账单里的 `* 分组: ¥` 行；没有分组时用带金额的明细行；都没有就用账单标题。一张账单的金额看 `= 合计` 那行，没写就把各项加起来；分组加起来比合计少的，差额算「其他」。「按月看数字」里有每个月的表。这一页是公开的，谁都能看。
- 书架、票夹和账本都不收上了锁的页（除非这个浏览器已经打开过它）。它们和时间线、足迹地图顶上是同一排链接，书里时间线页的页脚也有。
- **足迹地图**（配了 Mapbox 后）：`/map/` 按写下的地点插图钉，同一个地方写过几页就显示数字；点图钉列出那些页，点一页翻过去。入口在导航里「时间线」旁边的📍、书里时间线页脚和 `/timeline/` 顶上。没配 token 时这些入口都不出现。
- **分享一页**：导航里的分享图标或「放大看」里的「分享」（手机上是系统分享面板，电脑上复制链接），或后台编辑页底部的「复制分享链接」，给出 `/p/<日记 id>`。微信、Telegram、推特等会显示这一页的分享卡片：左边是这一页本身，右边是标题、日期、开头几句和地点天气。卡片在后台发布时由浏览器画好传上去；没画过的页用第一张照片，都没有就用 `public/og.png`。打开链接直接翻到那一页。上了锁的页只显示「上了锁的一页」。
- 链接：`/#2026-09-27` 打开那一天（有几篇时打开第一篇），`/#e-<日记 id>` 打开某一篇（时间线用的就是它），`/#timeline` 打开时间线，`/#contact` 打开「写信给我」。找不到的网址会显示一张被撕下来的手帐页（`public/404.html`）。

**写**
- 正文用 Markdown，后台有工具栏和实时预览，见[写一页](#写一页)。
- **夜间书页**：系统是深色模式时，纸页也变暗（每种纸色有自己的夜间版），环衬换成封面的深色，封面封底和书板暗下来；贴上去的照片、票根、气泡保持原色。立体书翻页时的贴图也一样。导航里的 ☾/☀（`/timeline/`、`/map/` 右上角也有）让读者自己选白天或夜里，记在自己的浏览器里，选回和系统一样就重新跟随系统。「手帐设置 → 外观 → 纸张」可以关掉夜间书页，这时开关也不显示。
- 每页最多 3 张照片、2 个手绘小插画、一个印章字、一张便签、一句页脚引文，还有坐在角落的小咖（醒着或睡着）。
- 地点和天气：一键定位，自动查那一天的天气。
- 草稿和发布；白天记「随手记」，晚上自动写成一页草稿。
- 「✨ AI 补全空着的项」：根据正文补上标题、英文小注、页眉小字、印章、页脚引文和插画。

**上锁**
- 可以给整本手帐、某一天、或单独一页设口令。锁着的页只露出日期和一个封好的信封；读者输入口令后，这个浏览器标签页 12 小时内都能看（关掉标签页就忘了）。

## 技术栈

| 层 | 用的是 |
|---|---|
| 页面 | 原生 HTML / CSS / JS；立体的书用 [three.js](https://threejs.org)（esbuild 打包进 `public/assets/book3d.js`），平面翻页用 StPageFlip（已放在 `public/vendor/`） |
| 托管 | Cloudflare Workers 静态资源（`public/`） |
| API | Worker + [Hono](https://hono.dev)（`src/`，入口 `src/index.ts`） |
| 数据 | D1：`techo-db`（日记页、随手记、手帐设置、口令） |
| 照片 | R2：`techo-photos`，经 `/img/...` 读取；照片按日期放进文件夹 `p/年/月/日/<uuid>.jpg`（见下面「照片在 R2 里的位置」）；分享卡片也在这里（`cards/<id>.jpg`） |
| 地图 | [Mapbox](https://www.mapbox.com)（可选）：GL JS 从 Mapbox 的 CDN 加载，页上的小地图用 Static Images API，地名用 Geocoding v6 |
| 后台登录 | GitHub 登录（OAuth App），只放行 `ADMIN_GITHUB_LOGIN` 这一个账号 → 签名的 HttpOnly Cookie，30 天有效 |
| 部署 | GitHub Actions：push 到 `main` → 类型检查 → 检查生成文件 → `wrangler deploy` |
| AI | `src/compose.ts`：默认 Claude API 的 `claude-opus-5`（Anthropic SDK）；也可以在后台改成任何 Anthropic 兼容或 OpenAI 兼容（`/chat/completions`）的接口和模型 |

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

## 部署

### 1. Cloudflare 上的数据库和照片桶

`wrangler.jsonc` 里已经填好了 D1 数据库 `techo-db`（APAC）和 R2 存储桶 `techo-photos` 的 ID。线上的库已经是最新的表结构（三个升级文件都跑过了）。

在别的账号从头部署时：

```bash
npx wrangler d1 create techo-db            # 把输出的 database_id 填进 wrangler.jsonc
npx wrangler r2 bucket create techo-photos
npm run db:init:remote                     # 用 schema.sql 建表，新库不用再跑 migrations/
```

以后改表结构时，`schema.sql` 和 `migrations/` 要一起改：`schema.sql` 给新库，`migrations/` 给已经在用的旧库。见[数据库](#数据库)。

### 2. 用 GitHub Actions 部署

仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，加两个：

- `CLOUDFLARE_API_TOKEN`：Cloudflare 控制台 → 右上角头像 → **My Profile** → **API Tokens** → **Create Token** → 模板 **Edit Cloudflare Workers**（账户选你自己的）
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 控制台首页右侧的 **Account ID**

之后每次 push 到 `main`：装依赖 → 类型检查 → 重新生成页面，检查和 `public/` 里提交的一致 → `wrangler deploy`。合并请求只跑检查不部署。也可以在 Actions 页手动 **Run workflow**。

> 不要再在 Cloudflare 里连接 Workers Builds，否则每次 push 会部署两遍。

### 3. 设置 GitHub 登录

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

### 4. 绑定域名（可选）

Worker `techo` → **Settings** → **Domains & Routes** → **Add** → **Custom domain**，例如 `techo.你的域名`。不绑也能用 `techo.<你的子域>.workers.dev`。

### 5. 开始写

主页底部点「✎ 写一页」（或直接打开 `/admin/`），用 GitHub 登录，点「新写一页」。保存后刷新主页就能看到。

后台首页是「今天」：今天写了没有、随手记一句、等着发布的草稿（一键发布）。编辑页按「这一页 / 正文 / 照片 / 插画和小物」分组，不常用的「页脚引文 / 地点和天气 / 上锁」收着；保存按钮一直在底部，⌘/Ctrl+S 也能保存。手机上列表和编辑分开两屏，「预览」全屏看这一页。

## 写一页

后台编辑页的「正文」是 Markdown 编辑器：上面一排按钮（粗体、标题、列表、清单、便签、代码、链接、重点、漫画格……），⌘/Ctrl+B / I / K，列表和清单按回车会自动接着写，⌘/Ctrl+Z 能撤销。右边就是这一页在书里的样子。

| 写法 | 书里的样子 |
|---|---|
| `**粗体**` `*强调*` `~~划掉~~` `==重点==` `` `代码` `` `[文字](https://…)` | 红色晕染下划线、蓝绿色、红线划掉、荧光笔、小号等宽字、波浪下划线链接 |
| `#` / `##` / `###` 标题 | 毛笔大字 |
| `- 列表` / `1. 编号` | 手写列表 |
| `- [ ] 没做完` / `- [x] 做完了` | 红框清单，做完的打红叉 |
| `> 一句话` | 贴胶带的便签 |
| ` ``` ` 代码块 | 深色代码块 |
| `---` | 一条虚线 |
| `+++` | 换页：后面的从下一页写起 |
| ` ```账单 ` … ` ``` ` | 一张热敏小票：`# 标题`、`> 居中小字`、`---` 虚线、`= 合计: ¥128` 大金额、`* 分组: ¥` 粗体行、`- 明细: ¥` 缩进行、`名称: 内容` 普通行 |
| ` ```机票 ` … ` ``` ` | 登机牌：`航空`、`航班`、`从: PEK 北京首都`、`到: CDG 巴黎戴高乐`、`日期`、`起飞`、`到达`、`登机口`、`座位`、`舱位`、`乘客`，右边是撕开的票根和条形码 |
| ` ```车票 ` … ` ``` ` | 蓝色火车票：`车次`、`从: 北京南 Beijingnan`、`到`、`日期`、`发车`、`车厢`、`座位`、`席别`、`票价`、`乘客`、`检票`，红色票号自动生成 |
| ` ```电影票 ` … ` ``` ` | 电影票（追剧也行）：红色「入场券」存根带打孔，`片名`、`类型`、`日期`、`场次`、`影院 / 平台`、`影厅`、`座位`、`集数`、`导演`、`主演`、`评分`、`短评` |
| ` ```书籍 ` … ` ``` ` | 一本书：左边是一本小书（颜色随书名，中文书名竖排在封面上；写了 `封面` 就贴真的封面），右边 `书名`、`作者`、`出版社`、`年份`、`评分`（4.5 或 9/10）、`状态`（想读 / 在读 / 读过）、`进度`（132/360、65% 或 读完，画成进度条）、`简介`、`书摘`；卡片上垂一条书签带 |
| ` ```影视 ` … ` ``` ` | 一张海报卡：白边海报（`海报`，没有就按片名配色画一张），`片名`、`年份`、`类型`（写「剧集」「综艺」等算追剧）、`导演`、`主演`、`状态`（看过 / 在追 / 想看）、`评分`、`简介`、`短评` |
| ` ```音乐 ` … ` ``` ` | 一张唱片从封套里露出半截（颜色随专辑），`歌名`、`歌手`、`专辑`、`时长` 和 `听到`（画成播放进度）、`评分`、`歌词`、`封面`。写 `网易云: 歌曲链接` 就是一个能播的播放器（见下） |
| `@09:10 站会：今天修什么？ #laptop` | 漫画格：时间和在做什么、对话气泡、小插画（相邻几行排成一条） |

账单、机票、车票、电影票、书籍、影视、音乐每行写成「名称: 内容」（冒号后面空一格，或用中文冒号），编辑器工具栏的「📎 贴一张」会插入一份填好示例的，改掉内容就行；也可以写 ` ```receipt `、` ```flight `、` ```train `、` ```ticket `、` ```book `、` ```movie `、` ```music `。它们像贴上去的纸一样保留自己的颜色，夜里也一样。

- **胶带和回形针**：每张卡片用一两条彩色和纸胶带贴在页上（颜色和位置随内容变），小票用回形针夹住。
- **叠起来**：卡片连着写（中间不隔别的内容）就叠成一摞，每张往下错开一点、歪一点，露出上面一条（写着是什么）。点露出的那条，盖在它上面的卡片掀起来又落到它下面，它就在最上面了；离它越近的叠得越高，每张都留一点在外面，都点得到。右上角的「1/3」是最上面这张是从上往下第几张。手机、电脑、平面和立体的书都一样；最上面那张和纸一样，按住它照常翻页。一摞太高、这一页剩下的地方放不下时，卡片先挨得紧一点（最紧每张露出 44px，还看得见是什么）；还放不下，这一页有别的内容就整摞挪到下一页，一整页都放不下才拆成两摞，各自重新数「1/n」。
- **图片**：`封面` / `海报` 可以写 `https://` 开头的图片地址，或上传照片后得到的 `p/….jpg`。
- **网易云播放器**：正文里单独一行贴网易云的歌曲链接（`https://music.163.com/song?id=186016`）就是一个播放器。在编辑器里直接粘贴链接、或 App 里「分享 → 复制链接」得到的那段文字（包括 `163cn.tv` 短链接）都会自动变成这样一行；工具栏的「🎵 网易云」也能贴，还可以勾上「做成音乐卡片」，再写评分、听到哪、一句歌词。音乐卡片里写 `网易云: 链接或 ID` 也一样。歌名、歌手、封面没写的会自动填上；点 ▶ 播放，唱片转起来，进度条可以点着跳，歌词跟着走。进度条右边是音量：拖小滑块调大小，点喇叭静音 / 取消静音；所有播放器用同一个音量，这台浏览器会记住。同一时间只放一首。靠 [Meting API](https://github.com/metowolf/Meting) 取歌：公共的 Meting 接口都已经失效，要在「手帐设置 → 接入服务」填你自己的（见下），没填就放不了。VIP 和下架的歌放不了：卡片变灰，歌名、歌手、封面照样显示，下面写「在网易云放不了（VIP 或下架）」。
- **🔍 NeoDB**：编辑器工具栏的「🔍 NeoDB」按书名、片名、专辑名或 ISBN 在 [NeoDB](https://neodb.social)（开放的书影音数据库）里搜，也可以贴 NeoDB 上这一条的链接（最准）。点一个结果就插入填好的书籍、影视或音乐卡片，封面存到自己的 R2。按 ISBN 查书时 NeoDB 没有就查 [Open Library](https://openlibrary.org)。想用别的 NeoDB 实例，给 Worker 设环境变量 `NEODB_URL`（比如 `https://neodb.example.com`）。

空一行分段，段落里换行就是换行。没有照片时大约 250 字写满一页。

**一页写不下**：字先缩小一点（最小 16px）；还放不下就接到下一页，一篇可以占好几页（正文最多 8000 字）：
- 按段落、列表项、便签、漫画格一块块往后排。长段落在句号、问号处断开，列表和漫画格在两项之间断开，小标题不会落在页底。
- 标题和照片在第一页。后面每页顶上写「标题 · 续 2/3」，页脚是「接下页 →」。贴纸、小咖和页脚引文在最后一页。
- 时间线、日历和 `#e-<id>` 链接都指向第一页。
- 卡片（或一摞卡片）在一页剩下的地方放不下时，挪到下一页的最前面，它后面的文字和卡片先把这一页填满，不留大块空白（剩下不到 90px 就不调整；不越过 `+++`）。所以卡片后面的一两段字，可能排在卡片前面。
- 单独一行写 `+++` 可以自己换页，编辑器工具栏的 ⤓ 按钮会插入它。
- **贴页**：单独一行写 `+++ 贴页`，它后面的卡片（到下一个 `+++` 或结尾）单独贴在新的一页上：每张保持原来的样子和大小，微微歪着，左右错开，下一张压住上一张的一角；卡片多了一起缩小（最小到六成），还放不下就平分到几页。这一段里的文字排在卡片后面。正文写在左页时，贴页正好是对面那页。编辑器「📎 贴一张」菜单里的「📌 贴页」会插入这一行。
- 右边的预览按书里的样子分页，‹ › 翻着看。

- **照片**：存进 R2 的 `p/年/月/日/` 文件夹（用这一页的日期，拍摄日比今天早时用 EXIF 的拍摄日）。最多 3 张，每张有自己的说明。一张时贴在正文旁边，字绕着排；两三张时在标题下面错落排一排。上传前会先压到 1600px；从页上拿掉的照片会从 R2 删掉。
- **小插画**：点选，最多两个：晴天、多云、下雨、月亮、猫、书、电脑、bug、植物、吃面、公交、骑车、音乐、心、星星、来信、拍照。漫画格里 `#` 后面写的是它们的英文名（编辑器里「能写的格式」有对照表）。画在 `public/assets/render.js` 的 `STICKERS` 里（64×64 的线稿 SVG），新增一个要同时加到 `src/index.ts` 的 `STICKERS`。
- **地点和天气**：点「📍 获取位置和天气」，浏览器定位后自动填地名和这一页那天的天气，也可以手填。天气默认问**和风天气**（在「手帐设置 → 接入服务 → 天气」填 KEY 和 API Host；今天和往后一周用预报的白天 / 夜间，写成「多云转小雨」，最近 10 天用历史天气），没配、或者和风查不到的日子，用 **Open-Meteo**（免费、不用 key；先用中国气象局的 CMA GRAPES 模型，没有再用它默认的模型，很久以前的用 ERA5 存档）。Open-Meteo 的天气按那天逐小时的数据、照国内天气预报的说法来写：上午（6–13 点）和下午到晚上（14–21 点）各看大部分时候怎样，不一样就写「多云转小雨」；下了两个小时以上才算雨雪，雨量分小雨 / 中雨 / 大雨 / 暴雨，没下就按云量分晴 / 多云 / 阴。夜里下一阵毛毛雨，不会再把一个晴天写成「毛毛雨」。地名配了 Mapbox 时用 Mapbox（能到街道和地标），没配时用 BigDataCloud。配了 Mapbox 还可以点「🗺 在地图上选」，在地图上点一下或拖图钉。写在页眉右上角，鼠标停上去显示坐标；坐标只保留两位小数（大约 1 公里），因为手帐是公开的。有坐标的页会贴一张小地图（可在设置里关掉）。
- **照片自带的信息**：上传照片时读出拍摄时间和 GPS。新写的页如果日期还是今天，就改成拍摄那天；还没填地点的页，按照片的位置填坐标、地名和那天的天气。只填空着的项，改完不会自动保存。上传的照片都会重新压一遍，相机写进去的 EXIF（包括精确位置）不会留在公开的图片里。
- **AI 补全**：标题下面的「✨ AI 补全空着的项」根据正文补上还空着的标题、英文小注、页眉小字、印章、页脚引文（只用出处确定的名句，拿不准就留空）和插画。已经写了的不动，补完不会自动保存。
- **单独上锁**：编辑页最下面可以给这一页设口令；「随手记」里可以给今天整天设口令（这一天的所有页都锁上，包括还没写的）。

## 手帐设置

后台左边的菜单分三块：上面是「今天」「新写一页」「随手记」「文章管理」，中间是最近写的 6 页，下面是「手帐设置」。

**随手记**见[草稿与每晚自动写](#草稿与每晚自动写)。**文章管理**是所有页的列表：按标题、正文、地点、日期搜，按状态（已发布 / 草稿 / 上锁）和月份筛，按日期或最近改过排序，一次显示 60 页，往下可以再显示。勾选几页可以一起发布、改回草稿或删除（删除要再确认一次）。从这里打开的页，左上角的返回按钮回到文章管理。

「手帐设置」分成四部分（没改过的项保持原样；在几部分之间切换，没保存的改动会留着，最后点一次「保存设置」）：

**外观**
- **封面款式**：石板青布面（默认）、牛皮纸、黑皮烫金、米白亚麻、酒红绒面。封面、封底、环衬和立体书的书板一起换。
- **封面**：大字（第一个「.」是绿色小圆点）、下面那行字；原来的 5 个贴纸可以逐个隐藏；最多 4 张自己的图片当贴纸（透明 PNG 会保留透明背景，拿掉的图会从 R2 删除）。
- **纸张**：纹路（方格、横线、点阵、空白）和纸色（米白、雪白、旧黄、薄荷），手帐里每页纸和 `/timeline/` 的卡片都跟着变；夜间书页的开关也在这里。
- **扉页**：README 里的 whoami / cat role / ls ~/life / 开始记的日期，和小咖旁边那句话。
- **封底**：大字和下方小字（可换行）。

**阅读**
- **翻页方式**：自动 / 立体的书 / 平面翻页（见[功能](#功能)）。以前保存过设置的站点，这里存的是「立体的书」；想让手机用平面翻页，选一次「自动」。
- **示例页**：开头 9/25–9/29 的示例页可以隐藏；「写信给我」那一页会移到最后一篇日记后面，联系方式不会丢。示例页不进时间线；和日记同一天时，日期链接打开的是日记。
- **加密**：给整本手帐设口令（马上生效，不用点保存）。

**站点**
- **网站**：浏览器标题、一句介绍。Worker 在返回主页时直接写进 `<title>` 和 `<meta name="description">`，搜索和分享链接也看得到；已发布的页和设置一并内联进页面，主页不用再请求接口。
- **联系方式**：邮箱、GitHub。

**接入服务**
- **网易云音乐**：你自己的 Meting API 的地址（公共接口都已经失效，没有默认值；没填时歌曲卡片是灰的，「试一下」会提醒先填）。可以写成 `https://…/api?server=:server&type=:type&id=:id` 这种带占位符的形式，没有占位符时在后面加 `server=netease&type=song&id=`；只填了域名（`https://music.example/`）而那里是介绍页时，自动改问 `https://music.example/api`。「试一下」用填着的地址（和填着的 token，还没保存也行）取一首歌，走的路和读者看到的一样：都由 Worker 去问 Meting，页面里不会自己去连 Meting；能取到会显示歌名、封面和一个能播的小播放器。
  - **Meting token**：接口提示「需要 API Token，请使用 Authorization: Bearer <token>」时，把 token 填在这里（输入框默认遮住，可以点「显示」）。手帐里所有的 Meting 请求都经过 Worker（`/api/meting`），由 Worker 带上 `Authorization: Bearer` 去问；歌曲、封面地址如果又指回这个接口，Worker 会替浏览器跟到真正的地址（网易云的服务器），歌词直接取回文字；只有带着 token 才给的音频、图片，由 Worker 转过来（`/api/meting/file`）。接口的回答认几种常见格式（数组、`data`/`result` 里的对象），缺播放地址、封面、歌词时再按 `type=url` / `pic` / `lrc` 去问，还缺的问网易云自己（歌名、歌手、封面，以及免费歌的播放地址）。「试一下」取到歌但放不了时显示 △ 和原因（说明接口是通的，是这首歌的问题）；实在认不出接口的回答，会把回答的开头显示出来。token 和 AI 的设置一样只在后台，不会出现在 `/api/settings` 和网页里。不想存在设置里，也可以设成 Worker 密钥：`npx wrangler secret put METING_TOKEN`（设置里空着时用它）。
- **天气**：[和风天气](https://console.qweather.com) 的 KEY 和 API Host。注册后建一个项目、凭据选 API KEY；API Host 在控制台「设置」里，每个账号不一样（像 `abc123.re.qweatherapi.com`，留空用旧的 `devapi.qweather.com`）。两项都只在后台，Worker 带着 `X-QW-Api-Key` 去查（`/api/admin/weather`），不会出现在网页里。「试一下」查北京今天的天气。KEY 不对、额度用完、查不到的日子，编辑页会说一句和风的原因，然后用 Open-Meteo 的结果。
- **地图**：Mapbox 的 access token，要用公开的 `pk.` 开头的那种。在 [account.mapbox.com](https://account.mapbox.com/access-tokens/) 新建一个，URL restrictions 填你的域名，别人拿去也用不了。token 会出现在网页里，这是 Mapbox 公开 token 的正常用法。配上后才有足迹地图页、页上的小地图、后台的选点地图和 Mapbox 地名；「有坐标的日记页上贴一张小地图」可以单独关掉。
- **AI**：写草稿和补全用的接口格式、地址和模型（见[接哪个 AI](#接哪个-ai)）。

## 草稿与每晚自动写

- 每页有状态：`draft`（草稿，主页不显示）/ `published`（已发布）。后台用「发布这一页」「存为草稿」「改回草稿」切换。
- 后台「随手记」：白天随手记一句（⌘/Ctrl+Enter 记下），存在 `jots` 表里。下面是记过的所有句子，按天分组，新的在上：
  - 能搜（在服务器上搜，很早以前的也搜得到），能按「还没写进手帐 / 已写进手帐」筛，写进了哪一页就显示那一页的标题，点一下打开。
  - 一次显示 100 条，「再往前看」接着往前翻。
  - 删一条要点两下（第一下变成「确定删掉？」）；勾选几条或全选可以一起删，删之前再确认一次。
- 本机 Claude 桌面应用里有一个定时任务「每晚写一页手帐（草稿）」，每天 22:00 左右运行：读今天没用过的随手记和今天的 Claude Code 会话，写成一页**草稿**，挑 0–2 个插画，并把用过的随手记标记掉。当天已经有一页就不写。第二天到后台看过再发布。
  - 应用没开着时不会运行，下次打开时补跑。
  - 读不到 claude.ai 网页上的聊天。
  - 任务说明在 `~/.claude/scheduled-tasks/techo-nightly-page/SKILL.md`，改口吻或素材就改这里。
- 网站自己也会写（需要一个 AI 接口的 key，见下面的[接哪个 AI](#接哪个-ai)）：
  - 后台「随手记」里的「现在就用今天的随手记写一页」随时生成一页草稿。
  - 每天 23:30（Asia/Shanghai，`wrangler.jsonc` 的 `triggers`）Worker 检查今天还没有页、又有随手记，就自动写一页草稿，电脑没开的日子靠它兜底。
  - 只读随手记，读不到 Claude 聊天；当天已经有一页就不写。
  - 开启：拿到接口的 key 后运行 `npx wrangler secret put AI_API_KEY` 粘贴进去（只存在 Worker 密钥里，不进数据库；以前设过的 `ANTHROPIC_API_KEY` 也照样能用）。用 Claude 官方接口时在 [console.anthropic.com](https://console.anthropic.com) 建 key，按量计费，一页大约 $0.03。

### 接哪个 AI

后台「手帐设置 → 接入服务 → AI」里有三项，只给后台看，不会出现在主页和 `/api/settings` 里：

- **接口格式**
  - **Anthropic**：Claude 官方接口、中转，或者其他厂商的 Anthropic 兼容地址（比如 `https://api.deepseek.com/anthropic`）。地址填到 `/v1` 之前，留空是 Claude 官方；末尾多写的 `/v1/messages` 会自动去掉。
  - **OpenAI**：讲 `/chat/completions` 的接口，OpenAI、DeepSeek、通义千问、Kimi、各种中转都行。地址填到 `/v1`（比如 `https://api.openai.com/v1`、`https://api.deepseek.com`、`https://dashscope.aliyuncs.com/compatible-mode/v1`），留空是 OpenAI 官方；多写的 `/chat/completions` 会自动去掉。
- **接口地址**：见上。
- **模型**：Anthropic 格式留空是 `claude-opus-5`；换别的接口时填那边的模型名。

key 是 Worker 密钥 `AI_API_KEY`（没有时读 `ANTHROPIC_API_KEY`），换接口时换成那个接口的 key。改完先点「测试连接」：它用输入框里的设置问一句话，显示实际用的模型和回复；不对时会说是 key 错（401）、地址或模型不存在（404）、额度用完（429）还是连不上。

怎么问取决于接口：
- Claude 官方接口加 `claude-opus-5` / `claude-fable-5-1`：结构化输出（JSON schema）、`effort`，拒答时自动换模型（server-side fallbacks）。
- 其他 Anthropic 格式接口：先带 JSON schema 试一次，接口不认（400）就去掉再问。
- OpenAI 格式：先要求 `response_format: json_object`，接口不认（400）就去掉再问。

提示词里都要求只输出 JSON，读回答时也宽松（去掉代码块标记和多余的话），所以不支持结构化输出的模型也能用。


## 照片在 R2 里的位置

新上传的照片放在 `p/年/月/日/<uuid>.<ext>`（例如 `p/2026/09/28/….jpg`）：文件夹用这一页的日期；封面图和 NeoDB 封面没有页面日期，用上传那天。分享卡片仍在 `cards/<id>.jpg`。

**以前传的（`p/<uuid>.jpg`，全在 `p/` 下一层）不会被动，也不用动**：两种键读起来一样，页面、分享链接和缓存里的图都照常。上了锁的页的照片，两种地址都要口令（按键里的 UUID 找是哪一页）。

想把旧照片也搬进文件夹，在「手帐设置 → 照片文件夹」里按三步来（**不会自己运行**，只在你点了按钮之后才动）：

1. **预览**：只列出要搬的照片（`旧键 → 新键`）、总数，和 R2 里没有任何页用的旧对象数（只报告，不动），什么都不改。
2. **复制**：一次几页。每张先复制到新位置并核对大小，之后这一页才指向新的地址；旧对象还在。这一页中途被改过就跳过，下次再来。
3. **清理**：只删「已经没有页指向、新位置的文件在且大小一样」的旧对象。没有任何页用的对象不会被删。

复制和清理时页面上有进度条和「停止」：点停止，做完手上这一批就停（每一批都是完整的），再点一次接着来。

每一步都能重复、能中断后接着来；后台的按钮会分批循环直到做完。

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

```bash
npx wrangler d1 execute techo-db --remote --file=migrations/0003_place_weather.sql
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
| POST | `/api/admin/photos/migrate` | 把旧照片搬进日期文件夹：`{"step": "preview\|copy\|cleanup", "limit": 4}`，见「照片在 R2 里的位置」 |
| POST | `/api/admin/lookup` | 查书、影视、音乐（`{"q": "书名或链接", "kind": "book\|film\|music"}`，数据来自 NeoDB，ISBN 退到 Open Library）；贴链接时 NeoDB 还在抓会返回 `{"pending": true}` |
| POST | `/api/admin/cover` | 把一张远程封面存进 R2（`{"url": "https://…"}`，≤10MB 的图片），返回 `{"key": "p/….jpg"}` |
| GET | `/api/admin/meting?id=&api=` | 「试一下」：用还没保存的 Meting 地址（和请求头 `x-meting-token` 里的 token）取一首歌 |
| GET | `/api/admin/weather?date=&lat=&lon=` | 和风天气查那天的天气：`{"weather": "多云转小雨 15~25°"}`；没配 KEY 时 404 `{"off": true}`。「试一下」用请求头 `x-qweather-key` 和 `&host=` 带上还没保存的 KEY 和 Host |
| POST | `/api/admin/netease` | 认出一首网易云的歌（`{"q": "链接、App 分享的文字或 ID"}`，`163cn.tv` 短链接跟着跳转去认），返回 `{"id": "186016"}` |

## 友链

- [LINUX DO](https://linux.do/)

## 许可证

[MIT](LICENSE)。StPageFlip 和 three.js 同为 MIT（StPageFlip 的许可见 `public/vendor/page-flip.LICENSE.txt`，three.js 的许可在打包后的 `book3d.js` 末尾）。欢迎提 Issue 和 PR。
