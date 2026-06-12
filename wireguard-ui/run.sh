#!/bin/sh
# WireGuard UI Home Assistant add-on entrypoint.
# Maps /data/options.json to wireguard-ui environment variables, moves
# state (jsondb / wg0.conf / session secret) onto persistent /data and
# hands over to the upstream /app/init.sh (wg-quick + web UI).
set -u

OPTIONS=/data/options.json

# export "$1"=<option $2> unless the option is null/empty
export_opt() {
  v="$(jq -r --arg k "$2" '.[$k] | if . == null then "" else tostring end' "$OPTIONS")"
  if [ -n "$v" ]; then
    export "$1=$v"
  fi
}

# --- persistent storage --------------------------------------------------
mkdir -p /data/db /data/wireguard

# wireguard-ui writes its jsondb to ./db relative to /app
if [ ! -L /app/db ]; then
  rm -rf /app/db
  ln -s /data/db /app/db
fi

# keep wg0.conf (incl. server keys) across restarts and updates
if [ ! -L /etc/wireguard ]; then
  rm -rf /etc/wireguard
  ln -s /data/wireguard /etc/wireguard
fi

# stable session secret so logins survive add-on restarts
if [ ! -s /data/session-secret ]; then
  umask 077
  wg genkey > /data/session-secret
  umask 022
fi
SESSION_SECRET="$(cat /data/session-secret)"
export SESSION_SECRET

# --- networking ----------------------------------------------------------
# VPN clients are NATed out of the add-on network namespace (see
# post_up_script); that needs IPv4 forwarding inside the container.
if ! echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null; then
  echo "[wireguard-ui] WARNING: could not enable net.ipv4.ip_forward;" \
       "VPN clients will not be able to reach other networks" >&2
fi

# --- map add-on options to wireguard-ui environment ------------------------
export BIND_ADDRESS="0.0.0.0:5000"

export_opt WGUI_USERNAME username
export_opt WGUI_PASSWORD password
export_opt WGUI_ENDPOINT_ADDRESS endpoint_address
export_opt WGUI_SERVER_LISTEN_PORT server_listen_port
export_opt WGUI_DNS default_client_dns
export_opt WGUI_DEFAULT_CLIENT_ALLOWED_IPS default_client_allowed_ips
export_opt WGUI_DEFAULT_CLIENT_EXTRA_ALLOWED_IPS default_client_extra_allowed_ips
export_opt WGUI_MTU mtu
export_opt WGUI_PERSISTENT_KEEPALIVE persistent_keepalive
export_opt WGUI_SERVER_POST_UP_SCRIPT post_up_script
export_opt WGUI_SERVER_POST_DOWN_SCRIPT post_down_script
export_opt WGUI_LOG_LEVEL log_level
export_opt EMAIL_FROM_ADDRESS email_from_address
export_opt EMAIL_FROM_NAME email_from_name
export_opt SENDGRID_API_KEY sendgrid_api_key
export_opt SMTP_HOSTNAME smtp_hostname
export_opt SMTP_PORT smtp_port
export_opt SMTP_USERNAME smtp_username
export_opt SMTP_PASSWORD smtp_password
export_opt SMTP_AUTH_TYPE smtp_auth_type
export_opt SMTP_ENCRYPTION smtp_encryption
export_opt SMTP_HELO smtp_helo
export_opt TELEGRAM_TOKEN telegram_token
export_opt TELEGRAM_ALLOW_CONF_REQUEST telegram_allow_conf_request
export_opt TELEGRAM_FLOOD_WAIT telegram_flood_wait

addrs="$(jq -r '.server_interface_addresses // [] | join(",")' "$OPTIONS")"
if [ -n "$addrs" ]; then
  export WGUI_SERVER_INTERFACE_ADDRESSES="$addrs"
fi

ranges="$(jq -r '.subnet_ranges // [] | join(";")' "$OPTIONS")"
if [ -n "$ranges" ]; then
  export SUBNET_RANGES="$ranges"
fi

# wg-quick is managed by upstream init.sh via these flags
if [ "$(jq -r '.manage_wireguard' "$OPTIONS")" = "true" ]; then
  export WGUI_MANAGE_START=true
  export WGUI_MANAGE_RESTART=true
fi

# credentials only seed the database on first start
if [ -n "$(ls -A /data/db/users 2>/dev/null)" ]; then
  echo "[wireguard-ui] Existing user database found:" \
       "username/password options are only applied on first start (manage users in the web UI)"
fi

echo "[wireguard-ui] starting web UI on port 5000 (user: ${WGUI_USERNAME:-admin})"
cd /app
exec ./init.sh
