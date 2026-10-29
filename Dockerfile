# 本地全栈构建:容器内完成前端构建(bun),再进全栈运行时(nginx + Node 后端)
# CI 走 Dockerfile.ci(dist 由 runner 预构建,配方一致)

FROM oven/bun:1-alpine AS web-builder

WORKDIR /app

COPY package.json bun.lock* ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

FROM node:22-bookworm-slim

ARG BUILD_DATE
ARG VERSION
ARG COMMIT_SHA

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx tzdata && \
    rm -rf /var/lib/apt/lists/* && \
    ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone

COPY --from=web-builder /app/dist /usr/share/nginx/html
COPY nginx-docker.conf.template /etc/nginx/conf.d/app.conf.template
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && rm -f /etc/nginx/sites-enabled/default

COPY server /app/server
WORKDIR /app/server
RUN npm install --omit=dev --no-fund --no-audit && npm cache clean --force

ENV PORT=8787 \
    GM_PATH=/gm \
    DB_DRIVER=sqlite

VOLUME ["/app/server/data"]

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
