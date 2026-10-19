#!/usr/bin/with-contenv bashio
set -e

bashio::log.info "Web Music Player 起動"

export XDG_RUNTIME_DIR=/run/user/0
mkdir -p "${XDG_RUNTIME_DIR}" /etc/pipewire/pipewire.conf.d
chmod 700 "${XDG_RUNTIME_DIR}"

# Chrome の音声の出力先シンク（player-out）。スピーカーへの Cast はこのシンクのモニターを流す
cat > /etc/pipewire/pipewire.conf.d/player-out.conf <<CONF
context.objects = [
{ factory = adapter
  args = {
    factory.name = support.null-audio-sink
    node.name = "player-out"
    node.description = "Player output"
    media.class = "Audio/Sink"
    audio.position = [ FL FR ]
    audio.rate = $(bashio::config 'sample_rate')
  }
}
]
CONF

# カタログ（検索・プレイリスト）の言語と国
export NM_LANG="$(bashio::config 'lang')"
export NM_COUNTRY="$(bashio::config 'country')"
export NM_RATE="$(bashio::config 'sample_rate')"

exec python3 -u /server.py
