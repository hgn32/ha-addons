#!/usr/bin/with-contenv bashio
# ==============================================================================
# Home Assistant Add-on: WireGuard UI
# Enables IPv4 forwarding so VPN client traffic can be routed/NATed
# ==============================================================================

if ! echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null; then
  bashio::log.warning \
    "Could not enable net.ipv4.ip_forward; VPN clients may not reach other networks"
fi
