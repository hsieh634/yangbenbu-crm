# syntax=docker/dockerfile:1.7
#
# 養本簿 CRM：一個 Dockerfile、四個建置目標
#
#   docker build --target api    -t yangbenbu-api .
#   docker build --target worker -t yangbenbu-worker .
#   docker build --target web    -t yangbenbu-web --build-arg API_URL=http://api:4100 .
#   docker build --target demo   -t yangbenbu-demo .   # 單一容器示範站（API + Worker + 前端）
#
# 正式環境三個服務分開部署（可各自擴展）；示範站用 demo，免費方案只有一個服務也能跑。

ARG NODE_VERSION=22

# ── 共用基底 ───────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
# Prisma 引擎需要 OpenSSL
RUN apk add --no-cache openssl
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ── 套件清單（先只複製 package.json：程式碼改動時不必重新下載套件）──────
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/shared/package.json packages/shared/

# ── 建置（含開發用套件）────────────────────────────────────────────────
FROM manifests AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# 前端的建置期變數：/api 轉發目的地（Next.js 在建置時寫入路由設定）
ARG API_URL=http://127.0.0.1:4100
ENV API_URL=$API_URL
RUN pnpm turbo run build

# ── 正式環境套件（不含開發工具；Prisma CLI 保留給啟動時的 migrate deploy）──
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm install --frozen-lockfile --prod

# ── 執行環境：正式套件 + 建置產物 ─────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/packages/db/dist packages/db/dist
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/worker/dist apps/worker/dist
COPY --from=build --chown=node:node /app/apps/web/.next apps/web/.next
COPY --from=build --chown=node:node /app/apps/web/next.config.ts apps/web/
COPY --chown=node:node scripts/demo-start.mjs scripts/
RUN rm -rf apps/web/.next/cache
USER node

FROM runtime AS api
EXPOSE 4100
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS worker
CMD ["node", "apps/worker/dist/main.js"]

FROM runtime AS web
EXPOSE 3100
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "--port", "3100"]

FROM runtime AS demo
ENV DEMO_MODE=true
EXPOSE 3100
CMD ["node", "scripts/demo-start.mjs"]
