#!/usr/bin/env bash
# backup_pre: バックアップ直前に「設定だけ」を論理ダンプして
# /config/settings/guacamole_settings.sql.gz に保存する。
# 接続情報・ユーザ等の設定は PostgreSQL 内に保存されるため、これがバックアップ
# 対象の「設定」となる。履歴(ログ)テーブルのデータは除外する。
# postgres 本体(データディレクトリ)・拡張 jar・ログは backup_exclude で除外される。
#
# 注意: backup_pre が非 0 終了するとバックアップ自体が失敗するため、常に 0 で抜ける。
set -uo pipefail
# shellcheck source=/dev/null
source /usr/local/bin/guac-lib.sh
[ -f /etc/guacamole-ha.env ] && . /etc/guacamole-ha.env

mkdir -p /config/settings

# jq の `//` は false を空扱いするため使わない。false 指定のみ無効化扱いとする。
BACKUP_DB="$(jq -r '.backup_database' /data/options.json 2>/dev/null || echo true)"
[ "$BACKUP_DB" = "false" ] || BACKUP_DB=true
if [ "$BACKUP_DB" != "true" ]; then
    log "backup_database disabled; removing any previous settings dump"
    rm -f /config/settings/guacamole_settings.sql.gz /config/settings/guacamole_settings.version
    exit 0
fi

if ! wait_for_db 10 >/dev/null 2>&1; then
    log "backup_pre: database not reachable; keeping previous dump if present"
    exit 0
fi

log "backup_pre: dumping Guacamole settings (history/log tables excluded)"
tmp="/config/settings/.guacamole_settings.sql.gz.tmp"
if PGPASSWORD="$(guac_pw)" pg_dump -h 127.0.0.1 -p 5432 -U guacamole -d guacamole_db \
        --data-only --column-inserts --disable-triggers \
        --exclude-table-data=guacamole_connection_history \
        --exclude-table-data=guacamole_user_history \
        2>/tmp/guac_dump.err | gzip -c > "$tmp"; then
    mv -f "$tmp" /config/settings/guacamole_settings.sql.gz
    echo "${GUAC_VER:-unknown}" > /config/settings/guacamole_settings.version
    log "backup_pre: settings dump written ($(du -h /config/settings/guacamole_settings.sql.gz | cut -f1))"
else
    rm -f "$tmp"
    log "backup_pre: pg_dump failed; keeping previous dump if present"
    sed 's/^/[guacamole][dump] /' /tmp/guac_dump.err 2>/dev/null | tail -n 5 || true
fi
exit 0
