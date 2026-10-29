#!/bin/sh
# 全栈镜像入口:GM_PATH 注入 nginx 配置 → 起 nginx(静态+反代) → 前台跑游戏后端
set -e

GM_PATH="${GM_PATH:-/gm}"
export GM_PATH

# 生成 nginx 站点配置;GM_PATH 须为独立子路径,非法值由后端 gmPath() 兜底 /gm
sed "s|__GM_PATH__|${GM_PATH}|g" /etc/nginx/conf.d/app.conf.template > /etc/nginx/conf.d/default.conf
rm -f /etc/nginx/sites-enabled/default

nginx

cd /app/server
exec ./node_modules/.bin/tsx src/index.ts
