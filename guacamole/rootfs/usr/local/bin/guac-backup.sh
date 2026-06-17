#!/bin/sh
# HA の backup_pre フックで呼ばれる。外部 PostgreSQL を pg_dump し
# /config/backup/guacamole_db.dump に保存する（pg_dump カスタム形式）。
# backup_pre は非 0 終了するとバックアップ全体が失敗するため常に 0 で抜ける。
set -u
# shellcheck source=/dev/null
. /usr/local/bin/guac-lib.sh
[ -f /etc/guacamole-ha.env ] && . /etc/guacamole-ha.env

jqget() { jq -r --arg k "$1" 'if (.[$k] != null) then .[$k] else "" end' /data/options.json 2>/dev/null; }
BACKUP_ENABLED="$(jqget backup_enabled)"; [ -z "$BACKUP_ENABLED" ] && BACKUP_ENABLED="true"
VACUUM_LOGS="$(jqget vacuum_logs_on_backup)"; [ -z "$VACUUM_LOGS" ] && VACUUM_LOGS="false"

if [ "$BACKUP_ENABLED" = "false" ]; then
    log "backup: disabled (backup_enabled=false); skipping"
    exit 0
fi

BDIR="/config/backup"
mkdir -p "$BDIR"

if ! wait_for_db 10 >/dev/null 2>&1; then
    log "backup: database not reachable; keeping previous dump if present"
    exit 0
fi

if [ "$VACUUM_LOGS" = "true" ]; then
    log "backup: clearing connection history before dump..."
    for tbl in guacamole_connection_history guacamole_user_history; do
        if guac_psql -tAc "SELECT to_regclass('public.${tbl}') IS NOT NULL" 2>/dev/null | grep -q t; then
            if guac_psql -c "TRUNCATE ${tbl}" 2>/tmp/guac_truncate.err; then
                log "backup:   truncated ${tbl}"
            else
                log "backup:   WARN: failed to truncate ${tbl}: $(head -1 /tmp/guac_truncate.err 2>/dev/null)"
            fi
        fi
    done
fi

log "backup: dumping ${PG_DATABASE} @ ${PG_HOST}:${PG_PORT} -> ${BDIR}/guacamole_db.dump"
tmp="${BDIR}/.guacamole_db.dump.$$.tmp"
trap 'rm -f "$tmp" 2>/dev/null || true' EXIT

if PGPASSWORD="$PG_PASSWORD" pg_dump \
        -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" \
        --no-owner --no-acl --format=custom \
        --file="$tmp" 2>/tmp/guac_dump.err; then
    mv -f "$tmp" "${BDIR}/guacamole_db.dump"
    log "backup: done ($(du -h "${BDIR}/guacamole_db.dump" | cut -f1))"
else
    log "backup: pg_dump failed; keeping previous dump if present"
    sed 's/^/[guacamole][backup] /' /tmp/guac_dump.err 2>/dev/null | tail -n 5 || true
fi
exit 0
