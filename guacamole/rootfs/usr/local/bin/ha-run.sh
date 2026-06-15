#!/usr/bin/env bash
# Home Assistant 用エントリポイント。
# アドオン設定を反映し、最後に upstream の /startup.sh を exec する。
set -e
# shellcheck source=/dev/null
source /usr/local/bin/guac-lib.sh

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
LOG_SCHED="$(jqget log_cleanup_schedule)"
LOG_RET="$(jqget log_retention_days)";      [[ "$LOG_RET" =~ ^[0-9]+$ ]] || LOG_RET=30
AUTO_RESTORE="$(jqget auto_restore_settings)"; [ -z "$AUTO_RESTORE" ] && AUTO_RESTORE="true"

export TZ="$TZ_OPT"

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
mkdir -p /config/settings
rm -f /tmp/guac_do_restore
if [ ! -f /config/postgres/PG_VERSION ]; then
    log "No existing PostgreSQL cluster found (fresh install or restored backup)"
    # リストアで戻った guacamole.properties は旧クラスタのパスワードを保持しており
    # 新規クラスタと不一致になる。削除して再生成させ整合させる
    # （接続先などの設定はひな形から同値で再生成される）。
    if [ -f "$GUAC_PROP_CONFIG" ]; then
        log "Removing stale guacamole.properties so the DB password is regenerated consistently"
        rm -f "$GUAC_PROP_CONFIG"
    fi
    if [ "$AUTO_RESTORE" = "true" ] && [ -f /config/settings/guacamole_settings.sql.gz ]; then
        touch /tmp/guac_do_restore
        log "Settings backup detected; will import it into the fresh DB after initialization"
    fi
fi

# ---- cron / backup / restore 用の環境ファイル -------------------------------
cat > /etc/guacamole-ha.env <<EOF
LOG_RETENTION_DAYS=${LOG_RET}
GUAC_VER=${GUAC_VER:-}
EOF

# ---- DB 内ログ削除 cron -----------------------------------------------------
mkdir -p /etc/crontabs
if [ -n "$LOG_SCHED" ]; then
    echo "$LOG_SCHED /usr/local/bin/guac-log-cleanup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
    log "In-DB log cleanup scheduled (UTC): '${LOG_SCHED}', retention=${LOG_RET} day(s)"
else
    : > /etc/crontabs/root
    log "log_cleanup_schedule is empty; in-DB log cleanup disabled"
fi

# 設定リストアは supervisord の一回限りプログラム(guac-restore)が担当する。
# upstream の /startup.sh は初期化中に一時 PostgreSQL を TCP で起動するため、
# ここでバックグラウンド実行すると一時インスタンスへ書き込む競合が起きうる。
# supervisord 配下なら本番 PostgreSQL 起動後に走るため安全。
# 実行可否は /tmp/guac_do_restore フラグで制御する（上で設定済み）。

log "Handing over to upstream Guacamole startup"
exec /startup.sh
