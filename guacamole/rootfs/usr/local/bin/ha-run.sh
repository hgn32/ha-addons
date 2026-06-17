#!/bin/sh
# Home Assistant 用エントリポイント。
# アドオン設定を反映し、最後に s6-overlay の /init を exec する。
set -e
# shellcheck source=/dev/null
. /usr/local/bin/guac-lib.sh

OPTIONS=/data/options.json
log "Starting Guacamole add-on (external PostgreSQL mode)"

# ---- 設定読み込み -----------------------------------------------------------
# jq の `//` は false を空扱いするため bool で誤動作する。キー指定で安全に取得する。
jqget() { jq -r --arg k "$1" 'if (.[$k] != null) then .[$k] else "" end' "$OPTIONS" 2>/dev/null; }

EXT_LIST="$(jq -r '((.extensions // []) | join(","))' "$OPTIONS" 2>/dev/null || echo "")"
TZ_OPT="$(jqget tz)";                       [ -z "$TZ_OPT" ] && TZ_OPT="UTC"
AUTO_LOGIN="$(jqget ingress_auto_login)";   [ -z "$AUTO_LOGIN" ] && AUTO_LOGIN="true"
AUTO_LOGIN_USER="$(jqget ingress_auto_login_user)"; [ -z "$AUTO_LOGIN_USER" ] && AUTO_LOGIN_USER="guacadmin"

# ---- 外部 PostgreSQL 接続設定 -----------------------------------------------
PG_HOST="$(jqget pg_host)"
PG_PORT="$(jqget pg_port)";         [ -z "$PG_PORT" ]     && PG_PORT="5432"
PG_USER="$(jqget pg_user)";         [ -z "$PG_USER" ]     && PG_USER="postgres"
PG_PASSWORD="$(jqget pg_password)"
PG_DATABASE="$(jqget pg_database)"; [ -z "$PG_DATABASE" ] && PG_DATABASE="guacamole_db"

if [ -z "$PG_HOST" ]; then
    log "FATAL: pg_host is not configured. An external PostgreSQL server is required."
    exit 1
fi
log "PostgreSQL target: ${PG_HOST}:${PG_PORT} db=${PG_DATABASE} user=${PG_USER}"

export TZ="$TZ_OPT"

# ---- GUACAMOLE_HOME を揮発領域に設定 (/config 外) --------------------------------
# guacamole.properties を含む全設定ファイルをここに生成する。
export GUACAMOLE_HOME=/var/lib/guac-home
rm -rf "$GUACAMOLE_HOME"
mkdir -p "$GUACAMOLE_HOME/extensions"
ln -sf /app/guacamole/extensions-available "$GUACAMOLE_HOME/extensions-available"
ln -sf /app/guacamole/lib                  "$GUACAMOLE_HOME/lib"
ln -sf /app/guacamole/schema               "$GUACAMOLE_HOME/schema"

# ---- guacamole.properties を揮発領域に生成（/config には置かない） -------------
cat > "$GUACAMOLE_HOME/guacamole.properties" <<EOF
postgresql-hostname: ${PG_HOST}
postgresql-port: ${PG_PORT}
postgresql-database: ${PG_DATABASE}
postgresql-username: ${PG_USER}
postgresql-password: ${PG_PASSWORD}
guacd-hostname: 127.0.0.1
guacd-port: 4822
EOF

# ---- スクリプト用環境ファイル ------------------------------------------------
# guac_psql / wait_for_db が参照する接続情報を書き出す。
cat > /etc/guacamole-ha.env <<EOF
GUAC_VER=${GUAC_VER:-}
PG_HOST=${PG_HOST}
PG_PORT=${PG_PORT}
PG_USER=${PG_USER}
PG_PASSWORD=${PG_PASSWORD}
PG_DATABASE=${PG_DATABASE}
EOF

# ---- 外部 PostgreSQL への接続確認 -------------------------------------------
log "Waiting for PostgreSQL at ${PG_HOST}:${PG_PORT}..."
if ! wait_for_db 60; then
    log "FATAL: could not connect to PostgreSQL at ${PG_HOST}:${PG_PORT} within 120 seconds"
    exit 1
fi
log "PostgreSQL is ready"

# ---- スキーマ初期化（未初期化の DB にのみ適用） --------------------------------
if guac_psql -tAc "SELECT to_regclass('public.guacamole_connection') IS NOT NULL" 2>/dev/null | grep -q t; then
    log "Schema already initialized; skipping"
else
    log "Schema not initialized; applying Guacamole schema SQL files..."
    for sql in $(ls /app/guacamole/schema/*.sql 2>/dev/null | sort); do
        log "  applying: $(basename "$sql")"
        guac_psql -f "$sql" >/dev/null
    done
    log "Schema initialization complete"
fi

# ---- ログイン画面バイパス（ingress 自動ログイン） ---------------------------
if [ "$AUTO_LOGIN" = "true" ]; then
    log "Ingress auto-login: ENABLED (user=${AUTO_LOGIN_USER})"
    case ",$EXT_LIST," in
        *,auth-header,*) : ;;
        *) EXT_LIST="${EXT_LIST:+$EXT_LIST,}auth-header" ;;
    esac
    set_property http-auth-header X-WEBAUTH-USER "$GUACAMOLE_HOME/guacamole.properties"
    printf 'proxy_set_header X-WEBAUTH-USER "%s";\n' "$AUTO_LOGIN_USER" > /etc/nginx/includes/auth_header.conf
else
    log "Ingress auto-login: DISABLED (Guacamole standard login)"
    del_property http-auth-header "$GUACAMOLE_HOME/guacamole.properties"
    printf 'proxy_set_header X-WEBAUTH-USER "";\n' > /etc/nginx/includes/auth_header.conf
fi

# ---- 拡張（プラグイン）。既定は最小限、設定で追加 ---------------------------
export EXTENSIONS="$EXT_LIST"
log "Extensions to enable: ${EXTENSIONS:-<none (postgresql-jdbc core only)>}"

# コア拡張 (postgresql-jdbc) は必須
for j in /app/guacamole/extensions/*.jar; do
    [ -f "$j" ] && cp -n "$j" "$GUACAMOLE_HOME/extensions/"
done
if ! ls "$GUACAMOLE_HOME/extensions/"*jdbc-postgresql*.jar >/dev/null 2>&1; then
    for j in /app/guacamole/extensions-available/*jdbc-postgresql*.jar; do
        [ -f "$j" ] && cp -n "$j" "$GUACAMOLE_HOME/extensions/"
    done
fi

# crond が起動しても空のままで問題ない
mkdir -p /etc/crontabs && : > /etc/crontabs/root

# ベースイメージの init は s6-overlay(/init)。最後にこれへ処理を渡し、
# s6 が guacd / tomcat と nginx / cron を起動する。
log "Handing over to s6-overlay (/init)"
if [ -x /init ]; then
    exec /init
elif [ -x /startup.sh ]; then
    exec /startup.sh
else
    log "FATAL: no init found in image (neither /init nor /startup.sh)"
    exit 1
fi
