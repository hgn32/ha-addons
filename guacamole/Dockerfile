# 軽量版 Guacamole アドオン
#
# 実体（guacd + Tomcat）は upstream の abesnier/guacamole をそのまま利用し、
# Home Assistant 連携用の薄いレイヤ（ingress 用 nginx・設定読み取り・ログ削除 cron）
# だけを足す。PostgreSQL は外部サーバを使用する（同梱しない）。
#
# ベースは s6-overlay(/init) を init として使う。本アドオンの追加プロセス
# （nginx / cron）も supervisord ではなく /etc/services.d 配下の
# s6 サービスとして起動する。
FROM abesnier/guacamole:1.6.0-alpine-pg16

# HA 連携に必要な最小限のパッケージのみ追加。
# - nginx … ingress 用リバースプロキシ
# - jq    … アドオン設定(/data/options.json)の読み取り
# スクリプトは busybox ash(/bin/sh) で動作するため bash は不要。
RUN apk add --no-cache nginx jq

# 定期ログ削除に busybox crond を使うため、存在をビルド時に確認する
RUN command -v crond >/dev/null || (echo "crond not found in base image" && exit 1)

# 内部 PostgreSQL を無効化する。
# ベースイメージの cont-init.d / services.d に含まれる postgres 関連スクリプトを
# ノーオペレーションに置き換え、/config/guacamole/postgres を参照する init が
# 走らないようにする。postgres という名前の s6 サービスも念のため無効化する。
RUN for f in $(find /etc/cont-init.d /etc/services.d /etc/s6-overlay/s6-rc.d -type f 2>/dev/null); do \
        grep -qE '(/config/guacamole/postgres|/run/postgresql)' "$f" 2>/dev/null || continue; \
        printf '#!/bin/sh\nexit 0\n' > "$f" && chmod +x "$f"; \
    done; \
    for d in /etc/services.d/postgres /etc/services.d/postgresql; do \
        [ -f "$d/run" ] && { printf '#!/bin/sh\nexec sleep inf\n' > "$d/run" && chmod +x "$d/run"; } || true; \
    done; \
    true

# rootfs（nginx 設定・各種スクリプト・s6 サービス定義）を配置
COPY rootfs/ /

# スクリプト/サービスへ実行権限付与・必要ディレクトリ作成・既定 auth ヘッダ(クリア)生成。
# nginx / cron は /etc/services.d 配下の s6 サービスとして起動する。
# syslogd 修正: HA コンテナは /dev が読み取り専用で /dev/log にバインドできない。
# alexbelgium と同じ手法で s6-socklog を /tmpsock/syslog へリダイレクト。
# 30-defaults の `cp -rn /app/guacamole /config` は busybox では `/.` 記法が使えず
# 既存ディレクトリでネストも起こすため無効化する。
RUN find /usr/local/bin -type f -name '*.sh' -exec chmod +x {} \; \
    && find /etc/services.d -type f -name run -exec chmod +x {} \; \
    && mkdir -p /etc/nginx/includes /etc/crontabs /var/lib/nginx/tmp /run/nginx \
    && printf 'proxy_set_header X-WEBAUTH-USER "";\n' > /etc/nginx/includes/auth_header.conf \
    && mkdir -p /tmpsock \
    && sed -i 's|s6-socklog -d3 -U -t3000|s6-socklog -d3 -U -t3000 -x /tmpsock/syslog|g' \
       /etc/s6-overlay/s6-rc.d/syslogd/run \
    && sed -i 's|cp -rn /app/guacamole /config|true|' /etc/cont-init.d/30-defaults.sh

# ベースの ENTRYPOINT(/init, s6-overlay) を HA 用ラッパに差し替える。
# ラッパは設定反映後、最後に /init を exec して s6 が全サービスを起動する。
ENTRYPOINT [ "/usr/local/bin/ha-run.sh" ]
