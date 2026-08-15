# Quake Panel
#
# 常時表示型の地震速報パネル (https://github.com/hgn32/quake-panel) を
# Home Assistant アドオンとして動かす。アプリ本体は上流リポジトリにあり、
# ここではビルドとアドオン設定の受け渡しだけを行う。
#
# 上流は private なので、ここでは clone しない。どのコミットを使うかは
# upstream.env に書いてあり、GitHub Actions がトークン付きで取得して
# ビルドコンテキストの upstream/ へ置く。手元でビルドするときは
# 自分で clone して同じ場所に置くこと:
#
#   git clone https://github.com/hgn32/quake-panel.git quake-panel/upstream \
#     && git -C quake-panel/upstream checkout --detach <UPSTREAM_REF>
#
# ref を動かしたら config.json の version も必ず上げること
# (でないと HA が更新を検知しない)。

ARG NODE_VERSION="22"

# ---- stage 1: 置かれた上流のソースをビルド ----
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /src

COPY upstream/ ./

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
