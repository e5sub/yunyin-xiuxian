# 项目长期备忘

## 架构现状(2026-10-28 起)

- 游戏已从单机改网游:进度存云端(server/),localStorage 只是缓存;本地导入导出存档已删除。
- 后端在 `server/`(Node + Express + ws + better-sqlite3 + JWT,:8787);数据在 server/data/yunyin.db(gitignore)。
- 云端档应用走 `core/save.ts applySavePayload`(与旧导入同一条校验/迁移/原子写盘链)。
- auth store 持久化但不进 PERSISTED_STORES(清档不清登录、云上传不带 token)。
- 数据库双方言:`DB_DRIVER=sqlite`(默认)/`mysql`;查询统一走 `server/src/db.ts` 的 `all/get/run/exec`(`?` 占位、异步),upsert 用 `REPLACE INTO`。
- GM 后台路径 `GM_PATH`(默认 /gm),单页 `server/gm/index.html`;管理员 `cd server && npm run admin -- 道号 口令`;游戏参数在 `game_config` 表(30s 缓存),后台可改聊天限速/榜单条数/公告等。
- 注册必填用户名+邮箱;`EMAIL_CODE_REQUIRED=true` 强制验证码(预留);`EMAIL_ENABLED=true`+`SMTP_*` 实发邮件,否则验证码打控制台。找回密码走 `/api/auth/forgot` + `/api/auth/reset`。
- MySQL 分支尚未在真实 MySQL 上跑过(本机无 MySQL/Docker),首次部署须验证 initDb 建表。

## 工具链/环境(本机)

- 本机无 bun(仓库规范用 bun);沙箱里用 npm/pnpm 代替,pnpm 装依赖已验证可用。
- husky commit-msg 需要 bunx;沙箱内用垫片(/tmp/shims/bunx → npx 转发)让真 commitlint 跑过,不要 --no-verify。
- vue-tsc 必须用 bun.lock 锁的 3.3.11:升到 3.3.13 会对原代码报假错(Record 索引/undefined)。
- vite 代理目标写 127.0.0.1,不要写 localhost(解析 ::1 连不上)。
- npm 缓存 EPERM 时换 --cache 临时目录,但沙箱 safe-delete 会拦 npm 缓存清理 → 直接用 pnpm。
- Git Bash(MSYS) 会把 `/xxx` 形式的环境变量值转成盘符路径:传 GM_PATH 之类路径参数不要带前导斜杠。

## 待办

- 真实浏览器 UI 走查(smoke / layout-check 未跑)。
- 切磋/排行榜信任客户端快照,无反作弊;如要上线需服务端权威化。
- 生产部署:后端需反代(同域 /api + /ws)或前端设 VITE_API_BASE。
