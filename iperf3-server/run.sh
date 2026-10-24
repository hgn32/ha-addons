#!/usr/bin/with-contenv bashio
set -e

PORT=$(bashio::config 'port')

bashio::log.info "$(iperf3 --version | head -1)"
bashio::log.info "iperf3 サーバーを起動します（ポート ${PORT}、TCP/UDP）"

# --forceflush: 測定結果をすぐログタブに出す
# --idle-timeout: 途中で切れたクライアントで止まったままにならないよう、無通信が続いたら待ち受けをやり直す
exec iperf3 --server --port "${PORT}" --forceflush --idle-timeout 60
