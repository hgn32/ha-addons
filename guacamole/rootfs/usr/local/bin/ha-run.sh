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
AUTO_LOGIN="$(jqget ingress_auto_login)";   [ -z "$AUTO_LOGIN" ] && AUTO_LOGIN="true"
AUTO_LOGIN_USER="$(jqget ingress_auto_login_user)"; [ -z "$AUTO_LOGIN_USER" ] && AUTO_LOGIN_USER="guacadmin"
AUTO_RESTORE="$(jqget auto_restore_settings)"; [ -z "$AUTO_RESTORE" ] && AUTO_RESTORE="true"

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

# ---- GUACAMOLE_HOME を揮発領域に設定 (/config 外) --------------------------------
export GUACAMOLE_HOME=/var/lib/guac-home
rm -rf "$GUACAMOLE_HOME"
mkdir -p "$GUACAMOLE_HOME/extensions"
ln -sf /app/guacamole/extensions-available "$GUACAMOLE_HOME/extensions-available"
ln -sf /app/guacamole/lib                  "$GUACAMOLE_HOME/lib"
ln -sf /app/guacamole/schema               "$GUACAMOLE_HOME/schema"

# ---- guacamole.properties を揮発領域に生成（/config には置かない） -------------
# NOTE: printf %s を使い、パスワード内の $ 記号が shell 変数として展開されないようにする。
{
    printf 'postgresql-hostname: %s\n' "$PG_HOST"
    printf 'postgresql-port: %s\n'     "$PG_PORT"
    printf 'postgresql-database: %s\n' "$PG_DATABASE"
    printf 'postgresql-username: %s\n' "$PG_USER"
    printf 'postgresql-password: %s\n' "$PG_PASSWORD"
    printf 'guacd-hostname: 127.0.0.1\n'
    printf 'guacd-port: 4822\n'
} > "$GUACAMOLE_HOME/guacamole.properties"

# ---- スクリプト用環境ファイル ------------------------------------------------
# guac_psql / wait_for_db が参照する接続情報を書き出す。
# PG_PASSWORD はシングルクォートでラップし、ソース時に $ が展開されないようにする。
_sq() { printf '%s' "$1" | sed "s/'/'\\\\''/g" | { read -r v; printf "'%s'" "$v"; }; }
{
    printf 'GUAC_VER=%s\n'    "${GUAC_VER:-}"
    printf 'PG_HOST=%s\n'     "$PG_HOST"
    printf 'PG_PORT=%s\n'     "$PG_PORT"
    printf 'PG_USER=%s\n'     "$PG_USER"
    printf 'PG_PASSWORD=%s\n' "$(_sq "$PG_PASSWORD")"
    printf 'PG_DATABASE=%s\n' "$PG_DATABASE"
} > /etc/guacamole-ha.env

# ---- 外部 PostgreSQL サーバ到達確認（postgres メンテナンス DB で接続） ----------
# $PG_DATABASE はまだ存在しない可能性があるため postgres DB で疎通チェックする。
log "Waiting for PostgreSQL server at ${PG_HOST}:${PG_PORT}..."
_pgmaint() { PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres "$@"; }
tries=60
while ! nc -z "$PG_HOST" "$PG_PORT" 2>/dev/null; do
    tries=$((tries-1)); [ "$tries" -le 0 ] && { log "FATAL: TCP timeout waiting for ${PG_HOST}:${PG_PORT}"; exit 1; }; sleep 2
done
tries=60
while ! _pgmaint -tAc 'SELECT 1' >/dev/null 2>&1; do
    tries=$((tries-1)); [ "$tries" -le 0 ] && { log "FATAL: psql timeout (wrong password?)"; exit 1; }; sleep 2
done
log "PostgreSQL server is ready"

# ---- DB 作成（存在しない場合） -----------------------------------------------
db_exists="$(_pgmaint -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DATABASE}'" 2>/dev/null | tr -d '[:space:]')"
if [ "$db_exists" != "1" ]; then
    log "Database '${PG_DATABASE}' not found; creating..."
    _pgmaint -c "CREATE DATABASE \"${PG_DATABASE}\"" >/dev/null
    log "Database '${PG_DATABASE}' created"
else
    log "Database '${PG_DATABASE}' exists"
fi

# ---- スキーマ初期化（未初期化の DB にのみ適用） --------------------------------
# SCHEMA_FRESH=true のときだけ自動リストアを許可する。
# 既存 DB への再起動・設定変更では SCHEMA_FRESH=false になるためリストアをスキップする。
SCHEMA_FRESH=false
if guac_psql -tAc "SELECT to_regclass('public.guacamole_connection') IS NOT NULL" 2>/dev/null | grep -q t; then
    log "Schema already initialized; skipping"
else
    log "Schema not initialized; applying Guacamole schema SQL files..."
    for sql in $(ls /app/guacamole/schema/*.sql 2>/dev/null | sort); do
        log "  applying: $(basename "$sql")"
        guac_psql -f "$sql" >/dev/null
    done
    log "Schema initialization complete"
    SCHEMA_FRESH=true
fi

# ---- 自動リストア（スキーマを今回初めて適用した DB にのみ） -----------------
# HA バックアップからリストア後にスキーマ初期化が走った場合だけ取り込む。
# 通常の再起動（スキーマ既存）では絶対にリストアしない。
RESTORE_RAN=false
DUMP="$(ls -1t /config/backup/guacamole_db_*.dump 2>/dev/null | head -1)"
if [ "$AUTO_RESTORE" = "true" ]; then
    if [ "$SCHEMA_FRESH" = "true" ] && [ -n "$DUMP" ]; then
        log "Auto-restore: fresh schema + dump found; restoring from ${DUMP}..."
        if PGPASSWORD="$PG_PASSWORD" pg_restore \
                -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" \
                --no-owner --clean --if-exists \
                "$DUMP" 2>/tmp/guac_restore.err; then
            log "Auto-restore: completed successfully"
            RESTORE_RAN=true
        else
            log "Auto-restore: FAILED — DB left with default content (guacadmin/guacadmin)"
            tail -n 10 /tmp/guac_restore.err 2>/dev/null | sed 's/^/[guacamole][restore] /' || true
        fi
    elif [ "$SCHEMA_FRESH" = "false" ]; then
        log "Auto-restore: schema already existed; skipping (regular restart)"
    else
        log "Auto-restore: no dump found in /config/backup/; starting fresh"
    fi
else
    log "Auto-restore: disabled"
fi

# ---- 起動時バックアップ（リストアが実行されなかった場合のみ） -----------------
# リストア直後は上書きしない。backup_enabled チェックは guac-backup.sh 内で行う。
if [ "$RESTORE_RAN" = "false" ]; then
    /usr/local/bin/guac-backup.sh
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
