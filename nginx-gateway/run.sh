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

  # 設定された cron スケジュール（UTC）で定期更新する。
  # geoip2 モジュールは reload しないと差し替えた mmdb を読み込まないため、
  # geoip_reload_nginx が true のときは更新成功後に nginx -s reload する。
  SCHEDULE=$(bashio::config 'geoip_update_schedule')
  if [ -n "${SCHEDULE}" ]; then
    export TZ="UTC"

    if bashio::config.true 'geoip_reload_nginx'; then
      RELOAD=true
    else
      RELOAD=false
    fi

    # cron のジョブ環境は最小のため、設定値は env ファイル経由で渡す
    cat > /etc/geoip-refresh.env <<EOF
GEOIP_CONF=${GEOIP_CONF}
GEOIP_RELOAD=${RELOAD}
EOF

    # 更新ラッパー（絶対パスで実行し、出力は /proc/1/fd/1 = アドオンログへ流す）
    cat > /usr/local/bin/geoip-refresh <<'EOF'
#!/usr/bin/env bash
export TZ="UTC"
exec >> /proc/1/fd/1 2>&1
. /etc/geoip-refresh.env
ts() { date '+%F %T %Z'; }
echo "[geoip-refresh] $(ts) running geoipupdate..."
if /usr/local/bin/geoipupdate -f "${GEOIP_CONF}"; then
  if [ "${GEOIP_RELOAD}" = "true" ]; then
    /usr/sbin/nginx -s reload \
      && echo "[geoip-refresh] $(ts) GeoIP database updated and nginx reloaded"
  else
    echo "[geoip-refresh] $(ts) GeoIP database updated (nginx reload disabled)"
  fi
else
  echo "[geoip-refresh] $(ts) geoipupdate failed; keeping existing database"
fi
EOF
    chmod +x /usr/local/bin/geoip-refresh

    # crontab を作成し crond をバックグラウンド起動（crond のログもアドオンログへ）
    mkdir -p /etc/crontabs
    echo "${SCHEDULE} /usr/local/bin/geoip-refresh" > /etc/crontabs/root
    bashio::log.info "GeoIP update scheduled (UTC): '${SCHEDULE}', reload=${RELOAD}"
    crond -b -c /etc/crontabs -L /proc/1/fd/1 \
      || bashio::log.warning "failed to start crond; scheduled GeoIP updates disabled"
  else
    bashio::log.info "geoip_update_schedule is empty; scheduled GeoIP updates disabled"
  fi
fi

bashio::log.info "version:"
nginx -V
bashio::log.info "modules:"
ls -l /usr/lib/nginx/modules
bashio::log.info "/ssl:"
ls -l /ssl
bashio::log.info "starting nginx..."
exec nginx -g 'daemon off;'
