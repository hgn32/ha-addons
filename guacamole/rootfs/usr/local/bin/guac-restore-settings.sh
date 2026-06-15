#!/usr/bin/env bash
# 新規/空の DB に対してのみ、バックアップした設定ダンプを取り込む。
# ha-run.sh が /tmp/guac_do_restore を作成したときだけ起動される。
# 安全装置: 既存の接続定義が1件でもあれば何もしない（データ消失防止）。
set -uo pipefail
# shellcheck source=/dev/null
. /usr/local/bin/guac-lib.sh
[ -f /etc/guacamole-ha.env ] && . /etc/guacamole-ha.env

BDIR="$(backup_dir)"
DUMP="$BDIR/guacamole_settings.sql.gz"
VERF="$BDIR/guacamole_settings.version"

# ha-run.sh が「新規 DB かつダンプあり」と判断したときだけフラグを立てる
[ -f /tmp/guac_do_restore ] || { exit 0; }
[ -f "$DUMP" ] || { log "restore: no dump file; nothing to do"; exit 0; }

log "restore: waiting for database to become ready..."
if ! wait_for_db 180; then
    log "restore: database did not become ready; aborting"
    exit 0
fi

# スキーマ(abesnier が起動後に適用)ができるまで待つ
tries=120
until guac_psql -tAc "SELECT to_regclass('public.guacamole_connection') IS NOT NULL" 2>/dev/null | grep -q t; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then log "restore: schema not initialized in time; aborting"; exit 0; fi
    sleep 2
done

# 安全装置: 実データがある DB には絶対に上書きしない
cnt="$(guac_psql -tAc "SELECT count(*) FROM guacamole_connection" 2>/dev/null || echo 999)"
cnt="$(echo "$cnt" | tr -d '[:space:]')"
if [ "${cnt:-999}" != "0" ]; then
    log "restore: DB already contains ${cnt} connection(s); skipping auto-restore (no data loss)"
    exit 0
fi

# バージョン差異があれば自動リストアは見送り（手動を案内）
if [ -f "$VERF" ]; then
    dumpver="$(cat "$VERF" 2>/dev/null || echo "")"
    if [ -n "$dumpver" ] && [ -n "${GUAC_VER:-}" ] && [ "$dumpver" != "$GUAC_VER" ]; then
        log "restore: dump version (${dumpver}) != current Guacamole (${GUAC_VER}); skipping auto-restore."
        log "restore: import manually if desired (see DOCS)."
        exit 0
    fi
fi

log "restore: importing settings into the fresh database..."
tables="$(guac_psql -tAc "SELECT string_agg(quote_ident(tablename), ', ') FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'guacamole\\_%'" 2>/dev/null)"
tables="$(echo "$tables" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
if [ -z "$tables" ]; then
    log "restore: no guacamole_* tables found; aborting"
    exit 0
fi

# 単一トランザクションで TRUNCATE -> ロード（失敗時は丸ごとロールバック）
if {
        echo "BEGIN;"
        echo "TRUNCATE ${tables} RESTART IDENTITY CASCADE;"
        gunzip -c "$DUMP"
        echo "COMMIT;"
    } | guac_psql -v ON_ERROR_STOP=1 >/tmp/guac_restore.log 2>&1; then
    log "restore: settings restored successfully from backup"
else
    log "restore: FAILED — database left with default content (login: guacadmin/guacadmin)."
    tail -n 20 /tmp/guac_restore.log 2>/dev/null | sed 's/^/[guacamole][restore] /' || true
fi
exit 0
