#!/bin/sh
# PostgreSQL 内に蓄積される Guacamole のログ(履歴)を定期削除する。
# 対象: guacamole_connection_history（接続履歴）, guacamole_user_history（ログイン履歴）
# 実行タイミング(cron)と保持日数はアドオン設定で保持される。
set -u
# shellcheck source=/dev/null
. /usr/local/bin/guac-lib.sh
[ -f /etc/guacamole-ha.env ] && . /etc/guacamole-ha.env

RET="${LOG_RETENTION_DAYS:-30}"
case "$RET" in ''|*[!0-9]*) RET=30 ;; esac

log "log-cleanup: deleting in-DB history older than ${RET} day(s)"
if ! wait_for_db 5 >/dev/null 2>&1; then
    log "log-cleanup: database not reachable; skipping this run"
    exit 0
fi

if guac_psql -v ON_ERROR_STOP=1 \
        -c "DELETE FROM guacamole_connection_history WHERE start_date < (now() - interval '${RET} days');" \
        -c "DELETE FROM guacamole_user_history       WHERE start_date < (now() - interval '${RET} days');"; then
    log "log-cleanup: done"
else
    log "log-cleanup: error while deleting history (will retry on next schedule)"
fi
exit 0
