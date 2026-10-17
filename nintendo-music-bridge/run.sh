#!/usr/bin/with-contenv bashio
set -e

bashio::log.info "Nintendo Music Bridge 起動"

export XDG_RUNTIME_DIR=/run/user/0
mkdir -p "${XDG_RUNTIME_DIR}" /etc/pipewire/pipewire.conf.d
chmod 700 "${XDG_RUNTIME_DIR}"

# Chrome の音声の出力先シンク（player-out）。スピーカーへの Cast はこのシンクのモニターを流す。
# VBAN を使うときは VBAN 送信シンク自体を player-out にする（MA の VBAN Receiver へも送る）
# https://docs.pipewire.org/page_module_vban_send.html
if bashio::config.true 'vban_enabled'; then
cat > /etc/pipewire/pipewire.conf.d/player-out.conf <<CONF
context.modules = [
{ name = libpipewire-module-vban-send
  args = {
    destination.ip = "$(bashio::config 'vban_host')"
    destination.port = $(bashio::config 'vban_port')
    sess.name = "$(bashio::config 'vban_stream_name')"
    audio.format = "S16LE"
    audio.rate = $(bashio::config 'sample_rate')
    audio.channels = 2
    audio.position = [ FL FR ]
    stream.props = {
      node.name = "player-out"
      node.description = "Player output (VBAN)"
      media.class = "Audio/Sink"
    }
  }
}
]
CONF
bashio::log.info "VBAN 送信先: $(bashio::config 'vban_host'):$(bashio::config 'vban_port') ストリーム名: $(bashio::config 'vban_stream_name') / S16LE / $(bashio::config 'sample_rate')Hz / 2ch"
else
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
fi

# カタログ（検索・プレイリスト）の言語と国
export NM_LANG="$(bashio::config 'lang')"
export NM_COUNTRY="$(bashio::config 'country')"
export NM_RATE="$(bashio::config 'sample_rate')"

exec python3 -u /server.py
