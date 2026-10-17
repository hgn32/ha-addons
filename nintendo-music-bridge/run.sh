#!/usr/bin/with-contenv bashio
set -e

bashio::log.info "Nintendo Music Bridge 起動"

export XDG_RUNTIME_DIR=/run/user/0
mkdir -p "${XDG_RUNTIME_DIR}" /etc/pipewire/pipewire.conf.d
chmod 700 "${XDG_RUNTIME_DIR}"

# VBAN 送信シンク。Chrome の音声をここへ出す
# https://docs.pipewire.org/page_module_vban_send.html
cat > /etc/pipewire/pipewire.conf.d/vban-send.conf <<CONF
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
      node.name = "vban-sender-ma"
      node.description = "VBAN to Music Assistant"
      media.class = "Audio/Sink"
    }
  }
}
]
CONF

bashio::log.info "VBAN 送信先: $(bashio::config 'vban_host'):$(bashio::config 'vban_port') ストリーム名: $(bashio::config 'vban_stream_name') / S16LE / $(bashio::config 'sample_rate')Hz / 2ch"

exec python3 -u /server.py
