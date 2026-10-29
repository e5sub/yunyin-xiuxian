# 云隐修仙录 Docker 部署指南

网游版全栈镜像：**nginx（静态站 + 反代）+ Node 游戏后端同容器**。单容器跑通注册登录、云存档、聊天、好友、排行榜、切磋与 GM 后台。

## 快速开始

### 方式一：使用预构建镜像（推荐）

每次推送到 `main` 或打 `v*.*.*` 标签，GitHub Actions 都会构建并推送多架构镜像（`linux/amd64` + `linux/arm64`）：

```bash
# 最新版本
docker run -d -p 8080:80 -v yunyin-data:/app/server/data ghcr.io/setube/yunyin-xiuxian:latest

# 指定版本号（取 package.json 的 version）
docker run -d -p 8080:80 -v yunyin-data:/app/server/data ghcr.io/setube/yunyin-xiuxian:<version>
```

若仓库配置了 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`，同一份镜像会额外推送到 Docker Hub 的 `<user>/yunyin-xiuxian`，标签一致。

### 方式二：docker compose（推荐自托管）

`docker-compose.yml` 已配好端口、数据卷、时区、资源限制与日志滚动：

```bash
docker compose up -d        # 启动
docker compose logs -f      # 日志
docker compose down         # 停止
```

启动后浏览器打开 <http://localhost:8080> 即可注册进入游戏。

### 方式三：本地构建镜像

```bash
docker build -t yunyin-xiuxian:latest .
```

## 镜像架构

- **前端构建**：`oven/bun:1-alpine`（本地 Dockerfile）；CI 走 `Dockerfile.ci`，`dist/` 由 runner 预构建后复制，多架构免在 QEMU 里重跑 `vue-tsc` 与 `vite`
- **运行时**：`node:22-bookworm-slim`（glibc，`better-sqlite3` 有 x64/arm64 预编译产物）+ nginx
- **进程**：entrypoint 起 nginx（`:80` 静态站 + 反代 `/api`、`/ws`、GM 后台到 `127.0.0.1:8787`），前台跑 Node 后端
- **端口**：80（容器内）→ 8080（宿主机）
- **健康检查**：每 30 秒探测 `/api/health`

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `GM_PATH` | `/gm` | GM 后台路径，可自定义（entrypoint 会同步注入 nginx 反代规则） |
| `DB_DRIVER` | `sqlite` | `sqlite` 或 `mysql` |
| `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` | — | MySQL 连接（`DB_DRIVER=mysql` 时必填） |
| `EMAIL_ENABLED` | `false` | `true` + `SMTP_*` 实发邮箱验证码 |
| `EMAIL_CODE_REQUIRED` | `false` | `true` 时注册强制邮箱验证码 |
| `SMTP_HOST/PORT/USER/PASS/FROM` | — | SMTP 配置（PORT 465 走隐式 TLS） |
| `PORT` | `8787` | 后端容器内端口（nginx 反代目标，一般不动） |
| `YUNYIN_JWT_SECRET` | 自动生成落盘 | JWT 密钥（≥16 字符；多实例部署必须统一） |

完整示例见 `server/.env.example`。

## 数据持久化

**务必挂载 `/app/server/data`**——SQLite 数据库（账号/云存档/聊天）与 JWT 密钥都在这里：

```bash
docker run -d -p 8080:80 -v yunyin-data:/app/server/data ghcr.io/setube/yunyin-xiuxian:latest
```

- 换用 MySQL（`DB_DRIVER=mysql`）时数据在外部库，可不挂卷
- 玩家浏览器 localStorage 只是缓存，云端为准；容器重建不影响账号与进度

## GM 后台

1. 进容器创建管理员：`docker exec -it yunyin-xiuxian sh -c "cd /app/server && ./node_modules/.bin/tsx src/scripts/create-admin.ts 道号 口令"`
2. 浏览器打开 `http://<host>:8080/gm`（自定义过 `GM_PATH` 则用对应路径），管理员登录
3. 功能：账号管理（搜索/封禁/重置口令/删除）、角色与存档查看、游戏参数（聊天限速/榜单条数等）、全服公告

## Android APK

`.github/workflows/build.yml` 在打 `v*.*.*` 标签时构建 Electron + Android APK 并发 GitHub Release；也支持 **Actions 页面手动触发**（产物只进 artifact，不发 Release）。

APK 内的后端地址在构建期写死：

- 仓库 **Settings → Secrets and variables → Actions → Variables** 新建 `VITE_API_BASE`（如 `https://api.example.com`），APK 即指向该地址
- 未配置时按同源编译（APK 内指向 `https://localhost`），只适合自建 WebView 拦截等特殊方案

## 反向代理与 HTTPS

外层反代（Traefik / Nginx Proxy Manager / Caddy）终止 SSL，把整站指到容器 `:80` 即可；`/api`、`/ws`、`/gm` 已在容器内 nginx 处理好，外层无需特殊重写。WebSocket 走 `/ws`，外层反代需支持 Upgrade 头。

## 故障排查

```bash
docker logs yunyin-xiuxian                                   # 看 nginx 与后端日志
docker exec yunyin-xiuxian wget -qO- http://localhost/api/health   # 后端探活
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
