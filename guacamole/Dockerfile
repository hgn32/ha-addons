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

# rootfs（nginx 設定・各種スクリプト・s6 サービス定義）を配置
COPY rootfs/ /

# スクリプト/サービスへ実行権限付与・必要ディレクトリ作成・既定 auth ヘッダ(クリア)生成。
# nginx / cron / restore は /etc/services.d 配下の s6 サービスとして起動する。
RUN find /usr/local/bin -type f -name '*.sh' -exec chmod +x {} \; \
    && find /etc/services.d -type f -name run -exec chmod +x {} \; \
    && mkdir -p /etc/nginx/includes /etc/crontabs /var/lib/nginx/tmp /run/nginx \
    && printf 'proxy_set_header X-WEBAUTH-USER "";\n' > /etc/nginx/includes/auth_header.conf

ENV TZ=UTC S6_LOGGING=0

# ベースの ENTRYPOINT(/init, s6-overlay) を HA 用ラッパに差し替える。
# ラッパは設定反映後、最後に /init を exec して s6 が全サービスを起動する。
ENTRYPOINT [ "/usr/local/bin/ha-run.sh" ]
