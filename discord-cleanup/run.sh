#!/usr/bin/with-contenv bashio

# Home Assistant の設定値を環境変数として渡す
export BOT_TOKEN=$(bashio::config 'bot_token')
export CHANNEL_IDS=$(bashio::config 'channel_ids' | tr -d '[]"' | tr ',' ' ')
export KEEP_DAYS=$(bashio::config 'keep_days')
export RUN_HOUR=$(bashio::config 'run_hour')
export RUN_MINUTE=$(bashio::config 'run_minute')
export DRY_RUN=$(bashio::config 'dry_run')

bashio::log.info "Discord Cleanup Addon 起動"
bashio::log.info "対象チャンネル: ${CHANNEL_IDS}"
bashio::log.info "保持期間: ${KEEP_DAYS} 日"
bashio::log.info "実行時刻: ${RUN_HOUR}:$(printf '%02d' ${RUN_MINUTE})"
bashio::log.info "ドライラン: ${DRY_RUN}"

# 毎日指定時刻に実行するループ
while true; do
    CURRENT_HOUR=$(date +%H | sed 's/^0//')
    CURRENT_MINUTE=$(date +%M | sed 's/^0//')

    if [ "${CURRENT_HOUR}" = "${RUN_HOUR}" ] && [ "${CURRENT_MINUTE}" = "${RUN_MINUTE}" ]; then
        bashio::log.info "削除ジョブを開始します..."
        python3 /app/discord_cleanup.py
        bashio::log.info "削除ジョブが完了しました。次回は明日 ${RUN_HOUR}:$(printf '%02d' ${RUN_MINUTE}) に実行します。"
        # 同じ分に再実行しないよう61秒待機
        sleep 61
    fi

    sleep 30
done