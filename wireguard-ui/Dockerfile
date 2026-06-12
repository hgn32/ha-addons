# Web UI for managing a WireGuard VPN server
# https://github.com/ngoduykhanh/wireguard-ui
# Official image (alpine) ships wg-ui binary, wireguard-tools, iptables, jq
FROM ngoduykhanh/wireguard-ui:0.6.2

COPY run.sh /run.sh
RUN chmod a+x /run.sh

EXPOSE 5000/tcp 51820/udp

ENTRYPOINT []
CMD [ "/run.sh" ]
