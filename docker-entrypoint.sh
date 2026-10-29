#!/bin/sh
# 全栈镜像入口:GM_PATH 注入 nginx 配置 → 起 nginx(静态+反代) → 前台跑游戏后端
set -e

GM_PATH="${GM_PATH:-/gm}"
export GM_PATH

# 后端容器内端口(默认 8787);nginx 反代目标与后端 PORT 保持一致
PORT="${PORT:-8787}"
export PORT

# 生成 nginx 站点配置;GM_PATH 须为独立子路径,非法值由后端 gmPath() 兜底 /gm
sed -e "s|__GM_PATH__|${GM_PATH}|g" -e "s|__PORT__|${PORT}|g" /etc/nginx/conf.d/app.conf.template > /etc/nginx/conf.d/default.conf
rm -f /etc/nginx/sites-enabled/default

echo "[yunyin-docker] nginx :80 -> backend :${PORT}, gm path: ${GM_PATH}"

nginx

cd /app/server
exec ./node_modules/.bin/tsx src/index.ts
