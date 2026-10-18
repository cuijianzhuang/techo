# 部署到 VPS

> 手帐有两种部署方式，用的是同一份代码：
>
> - **Cloudflare**（Workers + D1 + R2），见 [部署](deploy.md)。不用管服务器，全球都快。
> - **自己的 VPS**（这一篇）。一台 Linux 机器跑 Node，数据库是一个 SQLite 文件，照片放在一个文件夹里。
>
> 两种方式的功能完全一样：立体书、照片、上锁、分享卡片、字体、AI、每晚自动写草稿都有。

## 需要什么

- 一台 Linux VPS，1 核 1G 就够；能用 Docker 最省事
- 一个域名，A 记录（有 IPv6 的话再加 AAAA）指向这台 VPS，80 和 443 端口开着
- 一个 GitHub OAuth App，用来登录后台。做法见 [部署 §3](deploy.md#3-设置-github-登录)，回调地址填 `https://<你的域名>/api/auth/github/callback`

## 用 Docker 部署（推荐）

```bash
git clone https://github.com/<你>/techo.git && cd techo
cp .env.example .env
nano .env                 # 填 DOMAIN、GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET、ADMIN_GITHUB_LOGIN
docker compose up -d      # 第一次要构建镜像，大约 1–2 分钟
```

`docker compose up -d` 会起两个容器：

- **techo**：手帐本身，监听 8787 端口，不对外开放。数据库和照片都在 Docker 卷 `techo-data`（容器里的 `/data`）。
- **caddy**：对外开放 80 和 443，自动申请和续期 HTTPS 证书，压缩之后转发给 techo。

打开 `https://<你的域名>/admin/`，用 GitHub 登录，就可以开始写了。第一次启动时会自动建好所有表，不用手动初始化数据库。

### 升级

```bash
git pull && docker compose up -d --build
```

数据库要加的新列或新表，每次启动时会自动补上，不用手动跑 `migrations/`。

### 备份

数据都在卷 `techo-data` 里：

- `techo.db`：日记、随手记、设置、口令
- `photos/`：照片、分享卡片、上传的字体

```bash
# 1. 数据库：在运行中也能拿到完整的一份，存到 /data/backups/techo-<时间>.db
docker compose exec techo node --disable-warning=ExperimentalWarning dist/server.mjs backup
# 2. 整个卷（备份出来的库和照片）打包到当前目录
docker run --rm -v techo_techo-data:/data -v "$PWD":/b alpine tar czf /b/techo-$(date +%F).tgz -C /data backups photos
```

卷名前面的 `techo_` 是 compose 的项目名，也就是目录名。用 `docker volume ls` 可以查到。

恢复时，把 `techo.db` 和 `photos/` 放回卷里，再 `docker compose restart techo`。

## 不用 Docker

需要 Node 22.13 或更高版本。

```bash
npm ci
npm run build:server        # 打包成一个文件 dist/server.mjs
cp .env.example .env && nano .env
npm start                   # 读 .env，监听 8787，数据放在 ./data
```

**用 systemd 常驻**（`/etc/systemd/system/techo.service`）：

```ini
[Unit]
Description=techo
After=network.target

[Service]
WorkingDirectory=/srv/techo
ExecStart=/usr/bin/node --env-file=/srv/techo/.env --disable-warning=ExperimentalWarning dist/server.mjs
Restart=always
User=techo

[Install]
WantedBy=multi-user.target
```

然后运行 `systemctl enable --now techo`。

**前面放 nginx**（Caddy 可以直接用 `deploy/Caddyfile`，把 `techo:8787` 改成 `127.0.0.1:8787`）：

```nginx
server {
    server_name journal.example.com;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    # listen 443 ssl; 和证书用 certbot --nginx 配
}
```

**如果 Node 直接对外、前面没有代理**：在 `.env` 里写 `TRUST_PROXY=0`。否则读者可以伪造 `X-Forwarded-For`，绕过「输错口令一分钟 10 次」的限制。

## 环境变量

都写在 `.env` 里，完整列表见 `.env.example`。

| 变量 | 说明 |
|---|---|
| `DOMAIN` | 域名，Caddy 用它申请证书 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `ADMIN_GITHUB_LOGIN` | 后台登录 |
| `TIMEZONE` | 按哪个时区算“今天”，默认 `Asia/Shanghai` |
| `AI_API_KEY` | 可选。也可以在后台「手帐设置 → AI」里粘贴 |
| `NIGHTLY_CRON` | 每晚写草稿的时间，格式「分 时 * * *」，按 UTC。默认 `30 15 * * *`，即北京时间 23:30 |
| `PORT` / `DATA_DIR` | 监听端口和数据目录。默认 `8787` 和 `./data`，Docker 里是 `/data` |
| `TRUST_PROXY` | 默认 `1`，信任前面代理传来的地址和 https；Node 直接对外时设成 `0` |

Meting、和风天气、Mapbox 这些服务的密钥仍然在后台的「手帐设置」里填，存在数据库里。

## 从 Cloudflare 搬到 VPS

**1. 导出日记**（在本地电脑上，已经登录 wrangler）：

```bash
npx wrangler d1 export techo-db --remote --output=techo.sql
```

**2. 拷照片**。最方便的是用 [rclone](https://rclone.org/s3/#cloudflare-r2)：

1. 在 Cloudflare 后台 R2 → 管理 API 令牌，建一个只读令牌
2. 在 rclone 里配一个叫 `r2` 的远端（类型选 S3，提供商选 Cloudflare）
3. 运行：

```bash
rclone copy r2:techo-photos ./photos
```

**3. 导入 VPS**。把 `techo.sql` 和 `photos/` 传到 VPS 上：

```bash
# Docker：先建好卷，再用一次性的容器导入（库必须是空的）
docker compose run --rm -v "$PWD/techo.sql:/tmp/techo.sql:ro" techo node --disable-warning=ExperimentalWarning dist/server.mjs import-d1 /tmp/techo.sql
docker run --rm -v techo_techo-data:/data -v "$PWD/photos":/src alpine sh -c 'mkdir -p /data/photos && cp -a /src/. /data/photos/ && chown -R 1000:1000 /data/photos'
docker compose up -d

# 不用 Docker
node dist/server.mjs import-d1 techo.sql && cp -a photos ./data/photos
```

搬完之后，记得把 GitHub OAuth App 的回调地址改成新域名。

**反过来，从 VPS 搬回 Cloudflare**：

```bash
# 1. 在 VPS 上导出（Docker 里导到 /data，再从卷里拷出来）
node dist/server.mjs export-d1 techo.sql
# 2. 在本地导入 D1（表已经由部署建好也没关系，同一页会被覆盖）
npx wrangler d1 execute techo-db --remote --file=techo.sql
# 3. 照片
rclone copy ./data/photos r2:techo-photos
```

## 和 Cloudflare 版的差别

| | Cloudflare | VPS |
|---|---|---|
| 数据库 | D1 | `techo.db`（SQLite，WAL 模式） |
| 照片 | R2 | `photos/` 文件夹，路径和 R2 里的键相同 |
| 静态文件 | 边缘节点 | Node 直接发，`_headers` 里的缓存规则照样生效；Caddy 负责压缩 |
| 首页和 `/api/entries` 的缓存 | 边缘缓存 | 不缓存，每次现查。SQLite 在本机，一次也就几毫秒 |
| 每晚写草稿 | Cron Trigger | 进程里的定时器（`NIGHTLY_CRON`） |
| 输错口令的次数限制 | Rate Limiting | 进程内存里计数，重启后清零 |
| HTTPS | 自动 | Caddy 自动申请；用 nginx 的话自己配 |
| 备份 | D1 自带时间点恢复 | 自己备份（见上面的「备份」） |

`DEV_BYPASS_AUTH`（跳过登录）在服务器上永远不生效：它只给本机开发用。只有同时设置了 `TECHO_DEV=1`，而且请求的是 localhost 时才会生效。
