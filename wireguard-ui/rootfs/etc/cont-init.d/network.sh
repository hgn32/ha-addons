#!/usr/bin/with-contenv bashio
# ==============================================================================
# Home Assistant Add-on: WireGuard UI
# Enables IPv4/IPv6 forwarding so VPN client traffic can be routed/NATed
# ==============================================================================

if ! echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null; then
  bashio::log.warning \
    "Could not enable net.ipv4.ip_forward; VPN clients may not reach other networks"
fi

# IPv6 を有効にした環境で、IPv6 の VPN クライアントを LAN/インターネットへ
# ルーティングできるようにする。IPv6 が無効なカーネルでは失敗するため警告のみ。
if ! echo 1 > /proc/sys/net/ipv6/conf/all/forwarding 2>/dev/null; then
  bashio::log.warning \
    "Could not enable net.ipv6.conf.all.forwarding; IPv6 VPN clients may not be routed"
fi
