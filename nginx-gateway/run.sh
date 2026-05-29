#!/usr/bin/env sh
set -e

mkdir -p /share/nginx

if [ ! -f /share/nginx/nginx.conf ]; then
  echo "ERROR: /share/nginx/nginx.conf not found" >&2
  exit 1
fi
mkdir -p /etc/nginx
ln -sf /share/nginx/nginx.conf /etc/nginx/nginx.conf

if [ -f /share/nginx/GeoIP.conf ]; then
  geoipupdate -f /share/nginx/GeoIP.conf
fi

echo "[custom-nginx] version"
nginx -V
echo "[custom-nginx] modules"
ls -l /usr/lib/nginx/modules
echo "[custom-nginx] /ssl"
ls -l /ssl
echo "[custom-nginx] starting..."
nginx -g 'daemon off;'
