# 云隐修仙录 Docker 部署指南

网游版镜像：**纯 Node 后端容器（无 nginx）**——REST + WebSocket + GM 后台 + 前端静态站同端口，实体机 nginx/Traefik 一层反代即可上线。单容器跑通注册登录、云存档、聊天、好友、排行榜、切磋与 GM 后台。

## 快速开始

### 方式一：使用预构建镜像（推荐）

每次推送到 `main` 或打 `v*.*.*` 标签，GitHub Actions 都会构建并推送多架构镜像（`linux/amd64` + `linux/arm64`）：

```bash
# 最新版本
docker run -d -p 8787:8787 -e PORT=8787 -v yunyin-data:/app/server/data ghcr.io/setube/yunyin-xiuxian:latest

# 指定版本号（取 package.json 的 version）
docker run -d -p 8787:8787 -e PORT=8787 -v yunyin-data:/app/server/data ghcr.io/setube/yunyin-xiuxian:<version>
```

若仓库配置了 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`，同一份镜像会额外推送到 Docker Hub 的 `<user>/yunyin-xiuxian`，标签一致。

### 方式二：docker compose（推荐自托管）

`docker-compose.yml` 已配好端口、数据卷、时区、资源限制与日志滚动。配置统一放**项目根目录 `.env`**（即 `server/.env.example` 的内容）：compose 读它做端口映射插值，并整体注入容器；旧的 `server/.env` 仍兼容（优先级更低，建议迁到根目录）：

```bash
cp server/.env.example .env          # 按需修改(可留空)
docker compose up -d                 # 启动
docker compose logs -f               # 日志
docker compose down                  # 停止
```

> 改 `.env` 后需 `docker compose up -d` 重启生效；运行期邮件/SMTP 与游戏参数可在 GM 后台热改。

启动后浏览器打开 <http://localhost:8787>（端口跟随 `.env` 的 `PORT`，内外一致）即可注册进入游戏。

### 方式三：本地构建镜像

```bash
docker build -t yunyin-xiuxian:latest .
```

## 镜像架构

- **前端构建**：`oven/bun:1-alpine`（本地 Dockerfile）；CI 走 `Dockerfile.ci`，`dist/` 由 runner 预构建后复制，多架构免在 QEMU 里重跑 `vue-tsc` 与 `vite`
- **运行时**：`node:22-bookworm-slim`（glibc，`better-sqlite3` 有 x64/arm64 预编译产物），**纯 Node 容器，无 nginx**
- **进程**：单进程 Node 后端，同端口托管 REST + WebSocket + GM 后台 + 前端静态站（`STATIC_DIR`）
- **端口**：由 `.env` 的 `PORT` 统一决定（默认 8787）——compose 端口映射与后端监听同源
- **健康检查**：每 30 秒探测 `/api/health`

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `GM_PATH` | `/gm` | GM 后台路径，可自定义（后端自读，改后重启生效） |
| `DB_DRIVER` | `sqlite` | `sqlite` 或 `mysql` |
| `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` | — | MySQL 连接（`DB_DRIVER=mysql` 时必填） |
| `EMAIL_ENABLED` / `EMAIL_CODE_REQUIRED` / `SMTP_HOST/PORT/USER/PASS/FROM/FROM_NAME` | — | 邮箱设置**首次建库的种子值**；运行期在 GM 后台「参数设置 → 邮件 / SMTP」页改，改后立即生效（开关最迟 30 秒）。`SMTP_FROM_NAME` 是发件人显示名（收件人信箱里地址前那串字），留空只显示地址 |
| `PORT` | `8787` | **内外统一端口**：后端监听与 compose 端口映射（`"${PORT}:${PORT}"`）同源，改这一处即可 |
| `STATIC_DIR` | 镜像内 `/app/server/public` | 前端静态站目录；不设则纯 API（本地 dev 如此） |
| `YUNYIN_JWT_SECRET` | 自动生成落盘 | JWT 密钥（≥16 字符；多实例部署必须统一） |

完整示例见 `server/.env.example`。

## 数据持久化

**务必挂载 `/app/server/data`**——SQLite 数据库（账号/云存档/聊天）与 JWT 密钥都在这里：

```bash
docker run -d -p 8787:8787 -e PORT=8787 -v yunyin-data:/app/server/data ghcr.io/setube/yunyin-xiuxian:latest
```

- 换用 MySQL（`DB_DRIVER=mysql`）时数据在外部库，可不挂卷
- 玩家浏览器 localStorage 只是缓存，云端为准；容器重建不影响账号与进度

## GM 后台

1. 进容器创建管理员：`docker exec -it yunyin-xiuxian sh -c "cd /app/server && ./node_modules/.bin/tsx src/scripts/create-admin.ts 道号 口令"`
2. 浏览器打开 `http://<host>:8787/gm`（自定义过 `GM_PATH` 则用对应路径），管理员登录
3. 功能：账号管理（搜索/封禁/重置口令/删除）、角色与存档查看、游戏参数（聊天限速/榜单条数等）、全服公告

## Android APK

`.github/workflows/build.yml` 在打 `v*.*.*` 标签时构建 Electron + Android APK 并发 GitHub Release；也支持 **Actions 页面手动触发**（产物只进 artifact，不发 Release）。

APK 内的后端地址在构建期写死：

- 默认指向官方服务器 `https://yy.071717.xyz`（生产构建未配置时自动生效，dev 不受影响）
- 仓库 **Settings → Secrets and variables → Actions → Variables** 新建 `VITE_API_BASE`（如 `https://api.example.com`）可覆盖默认地址，APK 即指向该地址

## 反向代理与 HTTPS

容器内已无 nginx——**实体机 nginx 直接反代整站**到容器端口，SSL 在实体机终止。`/ws` 需透传 Upgrade 头，示例：

```nginx
server {
    listen 80;
    server_name yy.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;   # 容器映射出来的端口(.env 的 PORT)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # WebSocket(/ws)
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 12m;                    # 云存档整包上传
    }
}
```

Traefik / Nginx Proxy Manager / Caddy 同理：整站转发 + 支持 WebSocket Upgrade 即可，无需路径重写。

## 故障排查

```bash
docker logs yunyin-xiuxian                                   # 后端日志
docker exec yunyin-xiuxian node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>console.log(r.status))"   # 后端探活
docker exec -it yunyin-xiuxian sh                            # 进容器
```

- **注册/登录报「网络不通」**：多为外层反代没转发 `/api`
- **聊天收不到**：外层反代需透传 `/ws` 的 WebSocket Upgrade
- **重启后所有人登录失效**：未挂载 data 卷导致 JWT 密钥重新生成

## CI/CD

`.github/workflows/yunyin.yml`：push `main` / 打 tag / 手动触发 → 前端与后端类型检查 + 单测 → `bun run build` → `Dockerfile.ci` 构建 `linux/amd64,linux/arm64` 全栈镜像 → 推送 GHCR（`latest` / 版本号 / commit sha）；配置 Docker Hub 凭据时同推一份。

`.github/workflows/build.yml`：tag 触发（或手动）→ Electron / Android APK 构建；tag 触发额外发 GitHub Release（版本闸门要求 tag 与 package.json 一致）。

## 许可证

本项目采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans) 许可协议。

允许自由共享和演绎，但 **未经作者书面授权，禁止用于任何商业目的**。详见 [LICENSE](LICENSE) 文件。
