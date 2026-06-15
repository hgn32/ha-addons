#!/usr/bin/env bash
# 定期メンテナンスの「セット」: ログのクリーンナップ → 設定バックアップ をこの順で実行する。
#
# 呼び出し元:
#   - cron（アドオン設定 backup_schedule）… 任意の時刻に定期実行
#   - HA の backup_pre フック（config.json）… HA バックアップ直前に毎回実行
#
# backup_pre から呼ばれてもバックアップ自体を止めないよう、常に 0 で終了する。
set -u
# shellcheck source=/dev/null
. /usr/local/bin/guac-lib.sh

log "maintenance: (1) log cleanup -> (2) settings backup"
/usr/local/bin/guac-log-cleanup.sh   || log "maintenance: log-cleanup exited non-zero (continuing)"
/usr/local/bin/guac-dump-settings.sh || log "maintenance: settings dump exited non-zero (continuing)"
exit 0
