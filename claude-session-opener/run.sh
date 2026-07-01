#!/usr/bin/with-contenv bashio

# schedule_time は常に UTC として解釈する。
# HA ホストのタイムゾーン設定に依存させず、毎朝の起点時刻を確実にするため固定。
export TZ="UTC"

bashio::log.info "Claude Session Opener 起動"
bashio::log.info "現在時刻: $(date '+%Y-%m-%d %H:%M') (${TZ})"

exec node /server.js
