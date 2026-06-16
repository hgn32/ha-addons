# 軽量版 Guacamole アドオン
#
# 実体（guacd + Tomcat + 内蔵 PostgreSQL + 全拡張同梱）は upstream の
# abesnier/guacamole をそのまま利用し、Home Assistant 連携用の薄いレイヤ
# （ingress 用 nginx・設定読み取り・ログ削除 cron・設定バックアップ）だけを足す。
# alexbelgium 版の重いテンプレート（大量のデバイス割当・nginx-extras・syslog・
# automodules 等）は載せないことで軽量化している。
#
# ベースは s6-overlay(/init) を init として使う。本アドオンの追加プロセス
# （nginx / cron / restore）も supervisord ではなく /etc/services.d 配下の
# s6 サービスとして起動する。
FROM abesnier/guacamole:1.6.0-alpine-pg16

# HA 連携に必要な最小限のパッケージのみ追加。
# - nginx … ingress 用リバースプロキシ
# - jq    … アドオン設定(/data/options.json)の読み取り
# スクリプトは busybox ash(/bin/sh) で動作するため bash は不要。
RUN apk add --no-cache nginx jq

# 定期ログ削除/バックアップに busybox crond を使うため、存在をビルド時に確認する
RUN command -v crond >/dev/null || (echo "crond not found in base image" && exit 1)

# ビルド時に PostgreSQL クラスタ初期化 + Guacamole スキーマを事前適用したテンプレートを生成。
# 起動時に新規 DB が必要なとき cp するだけで済む（initdb+スキーマ ~10s → コピー ~1s）。
# COPY rootfs/ より前に置くことで、スクリプト変更時にこのレイヤが再実行されない。
RUN set -e; \
    export PATH="$PATH:/usr/libexec/postgresql16:/usr/libexec/postgresql"; \
    PGDATA=/app/guacamole-db-template; \
    mkdir -p "$PGDATA"; \
    chown postgres:postgres "$PGDATA"; \
    su-exec postgres initdb -D "$PGDATA" --locale=C --encoding=UTF8; \
    printf 'local all all trust\nhost all all 127.0.0.1/32 trust\n' \
        | su-exec postgres tee "$PGDATA/pg_hba.conf" > /dev/null; \
    su-exec postgres pg_ctl start -D "$PGDATA" \
        -o "-h 127.0.0.1 -p 5433 -k /tmp" -w -t 30; \
    psql -h 127.0.0.1 -p 5433 -U postgres \
        -c "CREATE ROLE guacamole WITH LOGIN PASSWORD 'guacamole'"; \
    psql -h 127.0.0.1 -p 5433 -U postgres \
        -c "CREATE DATABASE guacamole_db OWNER guacamole ENCODING 'UTF8'"; \
    ls /app/guacamole/schema/*.sql | sort | \
        xargs -I{} psql -h 127.0.0.1 -p 5433 -U guacamole -d guacamole_db -f {}; \
    su-exec postgres pg_ctl stop -D "$PGDATA" -m fast -w; \
    chmod 700 "$PGDATA"

# rootfs（nginx 設定・各種スクリプト・s6 サービス定義）を配置
COPY rootfs/ /

# スクリプト/サービスへ実行権限付与・必要ディレクトリ作成・既定 auth ヘッダ(クリア)生成。
# nginx / cron / restore は /etc/services.d 配下の s6 サービスとして起動する。
# syslogd 修正: HA コンテナは /dev が読み取り専用で /dev/log にバインドできない。
# alexbelgium と同じ手法で s6-socklog を /tmpsock/syslog へリダイレクト。
# 30-defaults の `cp -rn /app/guacamole /config` は busybox では `/.` 記法が使えず
# 既存ディレクトリでネストも起こすため無効化し、/config/guacamole への展開は
# ha-run.sh がエントリ単位で確実に行う。
RUN find /usr/local/bin -type f -name '*.sh' -exec chmod +x {} \; \
    && find /etc/services.d -type f -name run -exec chmod +x {} \; \
    && mkdir -p /etc/nginx/includes /etc/crontabs /var/lib/nginx/tmp /run/nginx \
    && printf 'proxy_set_header X-WEBAUTH-USER "";\n' > /etc/nginx/includes/auth_header.conf \
    && mkdir -p /tmpsock \
    && sed -i 's|s6-socklog -d3 -U -t3000|s6-socklog -d3 -U -t3000 -x /tmpsock/syslog|g' \
       /etc/s6-overlay/s6-rc.d/syslogd/run \
    && sed -i 's|cp -rn /app/guacamole /config|true|' /etc/cont-init.d/30-defaults.sh

ENV TZ=UTC

# ベースの ENTRYPOINT(/init, s6-overlay) を HA 用ラッパに差し替える。
# ラッパは設定反映後、最後に /init を exec して s6 が全サービスを起動する。
ENTRYPOINT [ "/usr/local/bin/ha-run.sh" ]
