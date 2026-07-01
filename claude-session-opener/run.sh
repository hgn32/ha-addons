#!/usr/bin/with-contenv bashio

# schedule_time は常に UTC として解釈する。
# HA ホストのタイムゾーン設定に依存させず、毎朝の起点時刻を確実にするため固定。
export TZ="UTC"

# --- 認証情報の永続化 ---
# Claude Code CLI の認証情報（サブスクリプション OAuth トークン）を
# HA Addon の永続ストレージ /data に保存し、コンテナ再起動をまたいで維持する。
CRED_DIR="/data/claude-credentials"
mkdir -p "${CRED_DIR}"

if [ -e "${HOME}/.claude" ] && [ ! -L "${HOME}/.claude" ]; then
    bashio::log.warning "既存の ${HOME}/.claude を ${CRED_DIR} に移動します"
    cp -a "${HOME}/.claude/." "${CRED_DIR}/" 2>/dev/null || true
    rm -rf "${HOME}/.claude"
fi

if [ ! -L "${HOME}/.claude" ]; then
    ln -s "${CRED_DIR}" "${HOME}/.claude"
fi

# --- スケジュール設定 ---
SCHEDULE_TIME=$(bashio::config 'schedule_time')
RUN_HOUR=$(echo "${SCHEDULE_TIME}" | cut -d: -f1 | sed 's/^0//')
RUN_MINUTE=$(echo "${SCHEDULE_TIME}" | cut -d: -f2 | sed 's/^0//')
RUN_HOUR=${RUN_HOUR:-0}
RUN_MINUTE=${RUN_MINUTE:-0}

bashio::log.info "Claude Session Opener 起動（試験的機能）"
bashio::log.info "現在時刻: $(date '+%Y-%m-%d %H:%M') (${TZ})"
bashio::log.info "実行時刻: ${SCHEDULE_TIME} (${TZ})"
bashio::log.warning "この Add-on が実際に Claude Pro/Max の5時間セッションを起点にできるかは未検証です。"
bashio::log.warning "Claude Code 内で /usage を確認し、効果があるか必ず検証してください。"

if [ ! -f "${CRED_DIR}/.credentials.json" ]; then
    bashio::log.warning "認証情報が見つかりません。このアドオンのサイドバーパネル（Ingress）を開き、"
    bashio::log.warning "画面の案内に従ってサブスクリプション（Claude.ai アカウント）でログインしてください。"
fi

# ログイン用 Web UI（Ingress）をバックグラウンドで起動
node /login_server.js &

# 毎日指定時刻に ping.sh を実行するループ
while true; do
    CURRENT_HOUR=$(date +%H | sed 's/^0//')
    CURRENT_MINUTE=$(date +%M | sed 's/^0//')

    if [ "${CURRENT_HOUR}" = "${RUN_HOUR}" ] && [ "${CURRENT_MINUTE}" = "${RUN_MINUTE}" ]; then
        bashio::log.info "セッションオープナーを実行します..."
        /ping.sh
        bashio::log.info "実行完了。次回は明日 ${SCHEDULE_TIME} に実行します。"
        # 同じ分に再実行しないよう61秒待機
        sleep 61
    fi

    sleep 30
done
