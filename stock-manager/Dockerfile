# ---- Frontend build (Vite/React) ----
FROM node:22-slim AS frontend
ARG GIT_HASH=unknown
WORKDIR /frontend
RUN npm install -g npm@11.16.0
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
COPY config.json /config.json
# Use GIT_HASH build-arg if provided, otherwise fall back to addon version from config.json
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/* \
  && ADDON_VER=$(jq -r .version /config.json) \
  && EFFECTIVE_HASH=$([ "${GIT_HASH}" = "unknown" ] && echo "v${ADDON_VER}" || echo "${GIT_HASH}") \
  && echo "Building with EFFECTIVE_HASH=${EFFECTIVE_HASH}" \
  && GIT_HASH=${EFFECTIVE_HASH} npm run build

# ---- Backend build (Express/TypeScript + Prisma) ----
FROM node:22-slim AS backend
WORKDIR /app
# build-essential + python3 allow native modules (better-sqlite3) to compile
# if a prebuilt binary is unavailable for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates build-essential python3 \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g npm@11.16.0
ENV DATABASE_URL=file:./build.db
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
RUN npx prisma generate && npm run build

# ---- Runtime ----
FROM node:22-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates chromium fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g npm@11.16.0
ENV NODE_ENV=production
ENV DATABASE_URL=file:/config/stock_manager_3a30c8ec/stock.db

# Bring over installed deps (incl. generated Prisma client + engines) and build output.
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/dist ./dist
COPY --from=backend /app/prisma ./prisma
COPY --from=backend /app/prisma.config.ts ./prisma.config.ts
COPY --from=backend /app/package.json ./package.json
COPY --from=frontend /frontend/dist ./public
COPY backend/start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 8099
CMD ["./start.sh"]
