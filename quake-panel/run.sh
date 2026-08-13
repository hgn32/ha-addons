#!/bin/sh
# Quake Panel の起動スクリプト。
# アドオン設定を環境変数へ移し、サーバー本体を exec で置き換える。
set -e

# options.json の読み込み失敗を握りつぶさない。
# `eval "$(...)"` は中のコマンドが落ちても成功扱いになるため、必ず分けて受ける。
if ! OPTIONS_ENV="$(node /options-env.mjs)"; then
  echo "[FATAL] アドオン設定を読み込めませんでした。設定タブの内容を確認してください。" >&2
  exit 1
fi
eval "${OPTIONS_ENV}"

echo "----------------------------------------------------------------"
echo " Quake Panel — 常時表示型 地震速報パネル"
echo "   利用地           : ${HOME_NAME} (${HOME_LAT}, ${HOME_LON})"
echo "   津波予報の強調    : ${TSUNAMI_HOME_AREAS}"
echo "   画像取得間隔      : 平常時 ${KMONI_IDLE_FRAME_INTERVAL_MS}ms / EEW 中 ${KMONI_ACTIVE_FRAME_INTERVAL_MS}ms"
echo "   地震情報の保持件数 : ${QUAKE_HISTORY_SIZE}"
echo "   ログレベル        : ${LOG_LEVEL}"
echo ""
echo " 開き方:"
echo "   - Home Assistant のサイドバー「地震速報」(Ingress。HA のログインで保護される)"
echo "   - キオスク端末からは http://<Home Assistant の IP>:8080/ (LAN 内限定)"
echo ""
echo " 強震モニタのコンテンツは再配布禁止です。インターネットへ素で公開せず、"
echo " 画面左下のクレジット表示も消さないでください。"
echo "----------------------------------------------------------------"

exec node /app/server/dist/index.js
