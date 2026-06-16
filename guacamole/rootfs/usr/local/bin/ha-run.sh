#!/bin/sh
# Home Assistant 用エントリポイント。
# アドオン設定を反映し、最後に s6-overlay の /init を exec する。
set -e
# shellcheck source=/dev/null
. /usr/local/bin/guac-lib.sh

OPTIONS=/data/options.json
log "Starting Guacamole add-on (lightweight wrapper)"

# ---- 設定読み込み -----------------------------------------------------------
# jq の `//` は false を空扱いするため bool で誤動作する。キー指定で安全に取得する。
# 値が null/未設定なら空文字を返す（false はちゃんと "false" を返す）。
jqget() { jq -r --arg k "$1" 'if (.[$k] != null) then .[$k] else "" end' "$OPTIONS" 2>/dev/null; }

EXT_LIST="$(jq -r '((.extensions // []) | join(","))' "$OPTIONS" 2>/dev/null || echo "")"
TZ_OPT="$(jqget tz)";                       [ -z "$TZ_OPT" ] && TZ_OPT="UTC"
AUTO_LOGIN="$(jqget ingress_auto_login)";   [ -z "$AUTO_LOGIN" ] && AUTO_LOGIN="true"
AUTO_LOGIN_USER="$(jqget ingress_auto_login_user)"; [ -z "$AUTO_LOGIN_USER" ] && AUTO_LOGIN_USER="guacadmin"
BACKUP_SCHED="$(jqget backup_schedule)"
LOG_RET="$(jqget log_retention_days)";      case "$LOG_RET" in ''|*[!0-9]*) LOG_RET=30 ;; esac
AUTO_RESTORE="$(jqget auto_restore_settings)"; [ -z "$AUTO_RESTORE" ] && AUTO_RESTORE="true"
BACKUP_DIR="$(backup_dir)"

export TZ="$TZ_OPT"

# ---- GUACAMOLE_HOME (/config/guacamole) を確実に展開 ------------------------
# HA の addon_config マウントで /config がボリューム化されると、イメージ同梱の
# /app/guacamole が /config/guacamole に複製されない。さらに busybox cp は
# `src/.` 記法を扱えず（黙って失敗する）、既存ディレクトリへの再コピーでネストも
# 起こす。そのためエントリ単位で明示的に複製する。
mkdir -p /config/guacamole/extensions
# 静的データ（イメージ同梱の最新で更新。ネスト回避のため一旦削除してから複製）
for d in extensions-available lib schema; do
    [ -d "/app/guacamole/$d" ] || continue
    rm -rf "/config/guacamole/$d"
    cp -r "/app/guacamole/$d" "/config/guacamole/$d"
done
# 常時必須のコア拡張(postgresql-jdbc 等)の jar を extensions/ に確保（既存は温存）
for j in /app/guacamole/extensions/*.jar; do
    [ -f "$j" ] && cp -n "$j" /config/guacamole/extensions/
done
# DB 認証コア(postgresql-jdbc)が extensions/ に無ければ extensions-available から補完。
# これが無いと全ログインが "no specific failure recorded" で失敗する。
if ! ls /config/guacamole/extensions/*jdbc-postgresql*.jar >/dev/null 2>&1; then
    for j in /app/guacamole/extensions-available/*jdbc-postgresql*.jar; do
        [ -f "$j" ] && cp -n "$j" /config/guacamole/extensions/
    done
fi
# トップレベルのファイル(guacamole.properties 等)は無ければ複製
for f in /app/guacamole/*; do
    [ -f "$f" ] || continue
    [ -e "/config/guacamole/$(basename "$f")" ] || cp "$f" /config/guacamole/
done
# それでも properties が無ければ最低限の既定で生成（postgres は trust 認証）
if [ ! -f "$GUAC_PROP_CONFIG" ]; then
    log "guacamole.properties not found; creating with defaults"
    cat > "$GUAC_PROP_CONFIG" <<'EOF'
postgresql-hostname: 127.0.0.1
postgresql-port: 5432
postgresql-database: guacamole_db
postgresql-username: guacamole
postgresql-password: guacamole
guacd-hostname: 127.0.0.1
guacd-port: 4822
EOF
fi

# ---- ログイン画面バイパス（ingress 自動ログイン） ---------------------------
# 信頼プロキシ（nginx）が付与する X-WEBAUTH-USER ヘッダで auth-header 拡張により
# 自動認証する。HA ingress は HA 認証済みなので Guacamole 側ログインは冗長。
if [ "$AUTO_LOGIN" = "true" ]; then
    log "Ingress auto-login: ENABLED (user=${AUTO_LOGIN_USER})"
    # auth-header 拡張を必ず有効化（重複追加しない）
    case ",$EXT_LIST," in
        *,auth-header,*) : ;;
        *) EXT_LIST="${EXT_LIST:+$EXT_LIST,}auth-header" ;;
    esac
    set_property http-auth-header X-WEBAUTH-USER "$GUAC_PROP_TEMPLATE"
    [ -f "$GUAC_PROP_CONFIG" ] && set_property http-auth-header X-WEBAUTH-USER "$GUAC_PROP_CONFIG"
    # nginx 側：固定ユーザを注入（クライアント値は上書き）
    printf 'proxy_set_header X-WEBAUTH-USER "%s";\n' "$AUTO_LOGIN_USER" > /etc/nginx/includes/auth_header.conf
else
    log "Ingress auto-login: DISABLED (Guacamole standard login)"
    del_property http-auth-header "$GUAC_PROP_TEMPLATE"
    [ -f "$GUAC_PROP_CONFIG" ] && del_property http-auth-header "$GUAC_PROP_CONFIG"
    printf 'proxy_set_header X-WEBAUTH-USER "";\n' > /etc/nginx/includes/auth_header.conf
fi

# ---- 拡張（プラグイン）。既定は最小限、設定で追加 ---------------------------
# 同梱の extensions-available から EXTENSIONS で指定されたものだけ有効化される。
export EXTENSIONS="$EXT_LIST"
log "Extensions to enable: ${EXTENSIONS:-<none (postgresql-jdbc core only)>}"

# ---- 新規/リストア DB の検出 ------------------------------------------------
mkdir -p "$BACKUP_DIR"
rm -f /tmp/guac_do_restore
if [ ! -f /config/postgres/PG_VERSION ]; then
    log "No existing PostgreSQL cluster found (fresh install or restored backup)"
    if [ -d /app/guacamole-db-template ]; then
        log "Copying pre-initialized DB template to /config/postgres (skips initdb+schema ~10s)"
        cp -r /app/guacamole-db-template /config/postgres
        chown -R postgres:postgres /config/postgres
        chmod 700 /config/postgres
    fi
    if [ "$AUTO_RESTORE" = "true" ] && [ -f "$BACKUP_DIR/guacamole_settings.sql.gz" ]; then
        touch /tmp/guac_do_restore
        log "Settings backup detected (${BACKUP_DIR}); will import it into the fresh DB after initialization"
    fi
fi

# ---- cron / backup / restore 用の環境ファイル -------------------------------
cat > /etc/guacamole-ha.env <<EOF
LOG_RETENTION_DAYS=${LOG_RET}
GUAC_VER=${GUAC_VER:-}
EOF

# ---- 定期メンテナンス cron（ログ削除 → 設定バックアップ） -------------------
# 1 本のスケジュールで「ログのクリーンナップ → 設定バックアップ」をまとめて実行する。
# HA のバックアップ時刻の少し前に合わせて指定すると、クリーンナップ済みの最新ダンプが
# スナップショットに含まれる（backup_pre フックでも同じ処理が走る）。
mkdir -p /etc/crontabs
if [ -n "$BACKUP_SCHED" ]; then
    echo "$BACKUP_SCHED /usr/local/bin/guac-backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
    log "Scheduled maintenance (UTC): '${BACKUP_SCHED}' = log cleanup (retention=${LOG_RET}d) + settings backup -> ${BACKUP_DIR}"
else
    : > /etc/crontabs/root
    log "backup_schedule is empty; scheduled cleanup+backup disabled (HA backup_pre still runs the same set)"
fi

# 設定リストアは s6 サービス(guac-restore)が担当する。
# DB の準備完了はリストア側スクリプトが待つため、ここでは可否フラグを立てるだけにする。
# upstream の guacamole サービスが PostgreSQL 起動・スキーマ適用を済ませてから取り込むため、
# 一時インスタンスへの書き込み競合は起きない。
# 実行可否は /tmp/guac_do_restore フラグで制御する（上で設定済み）。

# ベースイメージの init は s6-overlay(/init)。最後にこれへ処理を渡し、
# s6 が postgres / guacd / tomcat と nginx / cron / restore を起動する。
log "Handing over to s6-overlay (/init)"
if [ -x /init ]; then
    exec /init
elif [ -x /startup.sh ]; then
    # 旧来の startup.sh 方式イメージ向けフォールバック
    exec /startup.sh
else
    log "FATAL: no init found in image (neither /init nor /startup.sh)"
    exit 1
fi
