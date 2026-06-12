# WireGuard VPN server + web management UI for Home Assistant
# https://github.com/ngoduykhanh/wireguard-ui
# The wg-ui binary is taken from the official multi-arch image (static, CGO disabled)
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ngoduykhanh/wireguard-ui:0.6.2 AS wgui

FROM ${BUILD_FROM}

RUN apk add --no-cache \
        inotify-tools \
        iptables \
        nginx \
        wireguard-tools \
    && mkdir -p /etc/wireguard /var/log/nginx \
    && touch /var/log/nginx/error.log

COPY --from=wgui /app/wg-ui /usr/local/bin/wg-ui

COPY rootfs /
