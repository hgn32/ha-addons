# Quake Panel
#
# 常時表示型の地震速報パネル (https://github.com/hgn32/quake-panel) を
# Home Assistant アドオンとして動かす。アプリ本体は上流リポジトリにあり、
# ここではビルドとアドオン設定の受け渡しだけを行う。
#
# 上流が private へ戻っても取得できるよう、ここでは clone しない。どのコミットを
# 使うかは upstream.env に書いてあり、GitHub Actions がトークン付きで取得して
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
# パネルの設定画面に出すバージョン表記の材料。中身は UPSTREAM_REF の 1 行だけで、
# 上流ソースとは別に置く (上流を入れ替えてもこの COPY のキャッシュが効くように)。
COPY upstream.env /tmp/upstream.env

# 上流自身の release/Dockerfile と同じく build だけを走らせる。
# 固定した ref がコンパイルできなければここで落ちるので、中身が動かない
# イメージが出来上がることはない。
#
# npm test は使わない。上流のテストに実行環境を選ぶものがあり、素の Docker
# ビルドでは通らないため (アプリの不具合ではない):
#   - server/test/shutdown.test.mjs : listen 直後に SIGTERM を送るので、
#     終了ハンドラの登録が間に合わずログが出ないことがある
# (staticRoot.test.mjs が /workspaces/server へ chdir していた件は、上流
#  a7d6c37 で os.tmpdir() へ移るよう直され、環境を選ばなくなった)
# テストは上流の CI で回すもので、アドオンのイメージ作成の役目ではない。
#
# COMMIT_HASH を渡すのは、パネルの設定画面が「バージョン: 開発版」になるのを
# 防ぐため。上流の client/vite.config.ts は環境変数 COMMIT_HASH か
# `git rev-parse` でハッシュを埋め込むが、ここではどちらも使えない
# (.dockerignore が upstream/.git を外しており、slim イメージに git も無い)。
# 上流の release/Dockerfile が build-arg で渡しているのと同じ扱いにする。
# ビルド日時 (BUILD_DATE) は渡さない。vite 側が JST の現在時刻で埋めるので、
# 「いつ焼いたイメージか」がそのまま出る。
RUN set -eu; \
    . /tmp/upstream.env; \
    export COMMIT_HASH="$(printf '%s' "${UPSTREAM_REF}" | cut -c1-7)"; \
    npm ci; \
    npm run build; \
    npm prune --omit=dev

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
# HA 連携。パネル本体とは別プロセスで動かす (HA-INTEGRATION.md)。
COPY ha-bridge.mjs /ha-bridge.mjs
COPY run.sh /run.sh
RUN chmod +x /run.sh

# ingress_port と同じ。直接アクセス用に config.json でも公開している。
EXPOSE 8080

CMD ["/run.sh"]
