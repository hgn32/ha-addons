#!/bin/sh
# 「設定だけ」を論理ダンプして <backup_path>/guacamole_settings.sql.gz に保存する。
# 接続情報・ユーザ等の設定は PostgreSQL 内に保存されるため、これがバックアップ
# 対象の「設定」となる。履歴(ログ)テーブルのデータは除外する。
# postgres 本体(データディレクトリ)・拡張 jar・ログは backup_exclude で除外される。
#
# 出力先(backup_path)はアドオン設定で変更でき、既定は /config/guacamole。
# cron(guac-backup.sh) と HA の backup_pre フックの双方から呼ばれる。
# 注意: backup_pre が非 0 終了するとバックアップ自体が失敗するため、常に 0 で抜ける。
set -u
# shellcheck source=/dev/null
. /usr/local/bin/guac-lib.sh
[ -f /etc/guacamole-ha.env ] && . /etc/guacamole-ha.env

BDIR="$(backup_dir)"
mkdir -p "$BDIR"

# jq の `//` は false を空扱いするため使わない。false 指定のみ無効化扱いとする。
BACKUP_DB="$(jq -r '.backup_database' /data/options.json 2>/dev/null || echo true)"
[ "$BACKUP_DB" = "false" ] || BACKUP_DB=true
if [ "$BACKUP_DB" != "true" ]; then
    log "dump: backup_database disabled; removing any previous settings dump"
    rm -f "$BDIR/guacamole_settings.sql.gz" "$BDIR/guacamole_settings.version"
    exit 0
fi

if ! wait_for_db 10 >/dev/null 2>&1; then
    log "dump: database not reachable; keeping previous dump if present"
    exit 0
fi

log "dump: writing Guacamole settings to ${BDIR} (history/log tables excluded)"
# プロセス毎の一時ファイル($$)へ書いてから atomic に mv する。
# cron と backup_pre が同時に走っても最終ファイルが壊れない。
tmp="${BDIR}/.guacamole_settings.sql.gz.$$.tmp"
trap 'rm -f "$tmp" 2>/dev/null || true' EXIT
if PGPASSWORD="$(guac_pw)" pg_dump -h 127.0.0.1 -p 5432 -U guacamole -d guacamole_db \
        --data-only --column-inserts --disable-triggers \
        --exclude-table-data=guacamole_connection_history \
        --exclude-table-data=guacamole_user_history \
        2>/tmp/guac_dump.err | gzip -c > "$tmp"; then
    mv -f "$tmp" "$BDIR/guacamole_settings.sql.gz"
    echo "${GUAC_VER:-unknown}" > "$BDIR/guacamole_settings.version"
    log "dump: settings written ($(du -h "$BDIR/guacamole_settings.sql.gz" | cut -f1))"
else
    log "dump: pg_dump failed; keeping previous dump if present"
    sed 's/^/[guacamole][dump] /' /tmp/guac_dump.err 2>/dev/null | tail -n 5 || true
fi
exit 0
