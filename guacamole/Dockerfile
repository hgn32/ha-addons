# 軽量版 Guacamole アドオン
#
# 実体（guacd + Tomcat + 内蔵 PostgreSQL + 全拡張同梱）は upstream の
# abesnier/guacamole をそのまま利用し、Home Assistant 連携用の薄いレイヤ
# （ingress 用 nginx・設定読み取り・ログ削除 cron・設定バックアップ）だけを足す。
# alexbelgium 版の重いテンプレート（大量のデバイス割当・nginx-extras・syslog・
# automodules 等）は載せないことで軽量化している。
FROM abesnier/guacamole:1.6.0-alpine-pg16

# HA 連携に必要な最小限のパッケージのみ追加（cron は busybox crond が同梱済み）
RUN apk add --no-cache nginx jq

# 定期ログ削除に busybox crond を使うため、存在することをビルド時に確認する
RUN command -v crond >/dev/null || (echo "crond not found in base image" && exit 1)

# rootfs（nginx 設定・各種スクリプト・supervisor 追加プログラム）を配置
COPY rootfs/ /

# スクリプトへ実行権限付与・必要ディレクトリ作成・既定 auth ヘッダ(クリア)生成、
# および nginx / cron / restore を supervisord 管理下へ追加する。
RUN find /usr/local/bin -type f -name '*.sh' -exec chmod +x {} \; \
    && mkdir -p /etc/nginx/includes /etc/crontabs /config/settings \
    && printf 'proxy_set_header X-WEBAUTH-USER "";\n' > /etc/nginx/includes/auth_header.conf \
    && printf '\n[include]\nfiles = /etc/supervisor/conf.d/*.conf\n' >> /etc/supervisord.conf

ENV TZ=UTC

# abesnier の ENTRYPOINT(/startup.sh) を HA 用ラッパに差し替える。
# ラッパは設定反映後に最後で /startup.sh を exec する。
ENTRYPOINT [ "/usr/local/bin/ha-run.sh" ]
