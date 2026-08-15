# Quake Panel
#
# 常時表示型の地震速報パネル (https://github.com/hgn32/quake-panel) を
# Home Assistant アドオンとして動かす。アプリ本体は上流リポジトリにあり、
# ここではビルドとアドオン設定の受け渡しだけを行う。
#
# 上流は QUAKE_PANEL_REF で固定する。ここを動かしたら config.json の
# version も必ず上げること (でないと HA が更新を検知しない)。

ARG NODE_VERSION="22"
ARG QUAKE_PANEL_REPO="https://github.com/hgn32/quake-panel.git"
# 観測点の拾い方を直したコミット (上流 main)
ARG QUAKE_PANEL_REF="4f02e1dc0f71ba6c9e0aeeb99d08bd23ce80a8e4"

# ---- stage 1: 上流を取得してビルド ----
FROM node:${NODE_VERSION}-bookworm-slim AS build

ARG QUAKE_PANEL_REPO
ARG QUAKE_PANEL_REF

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# ブランチ名ではなくコミットで固定する。どのブランチに乗っていても
# 取り出せるよう、いったん全体を取得してから detach する。
RUN git clone --no-checkout "${QUAKE_PANEL_REPO}" . \
    && git checkout --detach "${QUAKE_PANEL_REF}" \
    && git --no-pager log -1 --format='built from quake-panel %H (%ad) %s'

# npm test はビルドを含む。固定した ref が壊れていればここで落ちるので、
# 中身が動かないイメージが出来上がることはない。
RUN npm ci && npm test && npm prune --omit=dev

# ---- stage 2: 実行イメージ ----
FROM node:${NODE_VERSION}-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/public \
    TZ=Asia/Tokyo

WORKDIR /app

COPY --from=build /src/node_modules node_modules/
COPY --from=build /src/package.json package.json
COPY --from=build /src/shared/package.json shared/package.json
COPY --from=build /src/shared/dist shared/dist/
COPY --from=build /src/server/package.json server/package.json
COPY --from=build /src/server/dist server/dist/
COPY --from=build /src/client/dist public/

COPY options-env.mjs /options-env.mjs
COPY run.sh /run.sh
RUN chmod +x /run.sh

# ingress_port と同じ。直接アクセス用に config.json でも公開している。
EXPOSE 8080

CMD ["/run.sh"]
