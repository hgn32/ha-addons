# Claude Session Opener
# 毎朝決まった時刻に最小トークンのタスクを送信し、Claude Pro/Max の
# 5時間セッションを起点にすることを狙うアドオン。
ARG BUILD_ARCH=amd64
ARG BUILD_FROM=ghcr.io/home-assistant/${BUILD_ARCH}-base:latest

# ---- 認証パネル (Vite + React + MUI) ----
# 画面は既製の UI コンポーネント (MUI) で組む。処理中のボタン無効化や
# 入力欄の扱いを自前の HTML 生成でやると、貼り付けが効かない・処理中でも
# 押せる、といった穴が開くため。
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 実行イメージ ----
FROM ${BUILD_FROM}

# util-linux-misc は `script`（疑似端末）用。`claude setup-token` は
# 端末が無いと動かないため、長期トークンの発行に必要。
RUN apk add --no-cache nodejs npm util-linux-misc \
    && npm install -g @anthropic-ai/claude-code \
    && npm cache clean --force

COPY run.sh /run.sh
COPY server.js /server.js
COPY --from=frontend /frontend/dist /public
RUN chmod +x /run.sh

CMD ["/run.sh"]
