# 本地构建:容器内完成前端构建(bun),再进纯后端运行时(无 nginx,静态站由后端托管)
# 实体机已有 nginx 的场景:外层反代整站到容器 $PORT 即可(README.Docker.md 有示例配置)
# CI 走 Dockerfile.ci(dist 由 runner 预构建,配方一致)

FROM oven/bun:1-alpine AS web-builder

WORKDIR /app

COPY package.json bun.lock* ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

# 服务端动态加载的客户端共享模块打成 Node bundle:运行时镜像只复制 server/,没有 src/ 源码,
# 不打进去反作弊三层(归一化/复算/权威化)与突破结算会在容器里静默失效(1.57.1)。
# 直接点平台二进制:oven/bun 镜像无 node,跑不动 node_modules/.bin 的 shim。
RUN ESBUILD_BIN="$(ls node_modules/@esbuild/*/bin/esbuild | head -n 1)" && \
    "$ESBUILD_BIN" src/core/saveSanitize.ts src/core/saveAuthority.ts src/core/profileRecompute.ts src/core/breakthroughResolve.ts \
      --bundle --platform=node --format=esm --outdir=server/vendor --outbase=src/core \
      --out-extension:.js=.mjs --tsconfig=tsconfig.app.json --legal-comments=none && \
    ls -la server/vendor/

FROM node:22-bookworm-slim

ARG BUILD_DATE
ARG VERSION
ARG COMMIT_SHA

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends tzdata && \
    rm -rf /var/lib/apt/lists/* && \
    ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone

COPY --from=web-builder /app/dist /app/server/public
COPY server /app/server
# 共享模块 bundle 覆盖进运行时镜像(COPY server 不带 vendor:本机的落后产物不该混进镜像)
COPY --from=web-builder /app/server/vendor /app/server/vendor
WORKDIR /app/server
RUN npm install --omit=dev --no-fund --no-audit && npm cache clean --force

ENV PORT=8787 \
    STATIC_DIR=/app/server/public \
    GM_PATH=/gm \
    DB_DRIVER=sqlite

VOLUME ["/app/server/data"]

EXPOSE $PORT

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "src/index.ts"]
