#!/usr/bin/with-contenv bashio
set -e

mkdir -p /share/nginx

if [ ! -f /share/nginx/nginx.conf ]; then
  bashio::log.error "/share/nginx/nginx.conf not found"
  exit 1
fi
mkdir -p /etc/nginx
ln -sf /share/nginx/nginx.conf /etc/nginx/nginx.conf

if bashio::config.has_value 'geoip_account_id' && bashio::config.has_value 'geoip_license_key'; then
  ACCOUNT_ID=$(bashio::config 'geoip_account_id')
  LICENSE_KEY=$(bashio::config 'geoip_license_key')
  cat > /tmp/GeoIP.conf <<GEOIP
AccountID ${ACCOUNT_ID}
LicenseKey ${LICENSE_KEY}
EditionIDs GeoLite2-Country
DatabaseDirectory /share/nginx
GEOIP
  geoipupdate -f /tmp/GeoIP.conf
elif [ -f /share/nginx/GeoIP.conf ]; then
  geoipupdate -f /share/nginx/GeoIP.conf
fi

bashio::log.info "version:"
nginx -V
bashio::log.info "modules:"
ls -l /usr/lib/nginx/modules
bashio::log.info "/ssl:"
ls -l /ssl
bashio::log.info "starting nginx..."
nginx -g 'daemon off;'
