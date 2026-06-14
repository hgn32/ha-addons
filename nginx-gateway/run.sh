#!/usr/bin/with-contenv bashio
set -e

mkdir -p /share/nginx

if [ ! -f /share/nginx/nginx.conf ]; then
  bashio::log.error "/share/nginx/nginx.conf not found"
  exit 1
fi
mkdir -p /etc/nginx
ln -sf /share/nginx/nginx.conf /etc/nginx/nginx.conf

# GeoIP.conf のパスを決定（アドオン設定があれば生成、無ければ /share/nginx/GeoIP.conf）
GEOIP_CONF=""
if bashio::config.has_value 'geoip_account_id' && bashio::config.has_value 'geoip_license_key'; then
  ACCOUNT_ID=$(bashio::config 'geoip_account_id')
  LICENSE_KEY=$(bashio::config 'geoip_license_key')
  cat > /tmp/GeoIP.conf <<GEOIP
AccountID ${ACCOUNT_ID}
LicenseKey ${LICENSE_KEY}
EditionIDs GeoLite2-Country
DatabaseDirectory /share/nginx
GEOIP
  GEOIP_CONF=/tmp/GeoIP.conf
elif [ -f /share/nginx/GeoIP.conf ]; then
  GEOIP_CONF=/share/nginx/GeoIP.conf
fi

if [ -n "${GEOIP_CONF}" ]; then
  # 起動時に1回更新（従来どおり。初回失敗は set -e で起動を中断）
  geoipupdate -f "${GEOIP_CONF}"

  # 毎週バックグラウンドで更新し、成功時に nginx をリロードして新 DB を反映する
  # （geoip2 モジュールは reload しないと差し替えた mmdb を読み込まないため）
  (
    while true; do
      sleep 604800   # 7 days
      bashio::log.info "running weekly geoipupdate..."
      if geoipupdate -f "${GEOIP_CONF}"; then
        if nginx -s reload; then
          bashio::log.info "GeoIP database updated and nginx reloaded"
        else
          bashio::log.warning "geoipupdate succeeded but nginx reload failed"
        fi
      else
        bashio::log.warning "weekly geoipupdate failed; keeping existing database"
      fi
    done
  ) &
fi

bashio::log.info "version:"
nginx -V
bashio::log.info "modules:"
ls -l /usr/lib/nginx/modules
bashio::log.info "/ssl:"
ls -l /ssl
bashio::log.info "starting nginx..."
exec nginx -g 'daemon off;'
