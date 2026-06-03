# ---- Frontend build (Vite/React) ----
FROM node:20-slim AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Backend build (Express/TypeScript + Prisma) ----
FROM node:20-slim AS backend
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV DATABASE_URL=file:./build.db
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
RUN npx prisma generate && npm run build

# ---- Runtime ----
FROM node:20-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL=file:/config/stock-manager/stock.db

# Bring over installed deps (incl. generated Prisma client + engines) and build output.
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/dist ./dist
COPY --from=backend /app/prisma ./prisma
COPY --from=backend /app/package.json ./package.json
COPY --from=frontend /frontend/dist ./public
COPY backend/start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 8099
CMD ["./start.sh"]
