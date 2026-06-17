#!/bin/sh
# 定期メンテナンス: 古い接続/ログイン履歴を DB から削除する。
# 呼び出し元: cron（アドオン設定 backup_schedule）
set -u
# shellcheck source=/dev/null
. /usr/local/bin/guac-lib.sh

log "maintenance: log cleanup"
/usr/local/bin/guac-log-cleanup.sh || log "maintenance: log-cleanup exited non-zero (continuing)"
exit 0
