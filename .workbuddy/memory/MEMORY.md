# 项目长期备忘

## 架构现状(2026-10-28 起)

- 游戏已从单机改网游:进度存云端(server/),localStorage 只是缓存;本地导入导出存档已删除。
- 后端在 `server/`(Node + Express + ws + better-sqlite3 + JWT,:8787);数据在 server/data/yunyin.db(gitignore)。
- 云端档应用走 `core/save.ts applySavePayload`(与旧导入同一条校验/迁移/原子写盘链)。
- auth store 持久化但不进 PERSISTED_STORES(清档不清登录、云上传不带 token)。

## 工具链/环境(本机)

- 本机无 bun(仓库规范用 bun);沙箱里用 npm/pnpm 代替,pnpm 装依赖已验证可用。
- husky commit-msg 需要 bunx;沙箱内用垫片(/tmp/shims/bunx → npx 转发)让真 commitlint 跑过,不要 --no-verify。
- vue-tsc 必须用 bun.lock 锁的 3.3.11:升到 3.3.13 会对原代码报假错(Record 索引/undefined)。
- vite 代理目标写 127.0.0.1,不要写 localhost(解析 ::1 连不上)。
- npm 缓存 EPERM 时换 --cache 临时目录,但沙箱 safe-delete 会拦 npm 缓存清理 → 直接用 pnpm。

## 待办

- 真实浏览器 UI 走查(smoke / layout-check 未跑)。
- 切磋/排行榜信任客户端快照,无反作弊;如要上线需服务端权威化。
- 生产部署:后端需反代(同域 /api + /ws)或前端设 VITE_API_BASE。
