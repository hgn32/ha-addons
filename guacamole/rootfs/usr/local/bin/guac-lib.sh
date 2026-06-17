#!/bin/sh
# 共通ヘルパ（ha-run.sh / backup / log-cleanup から source される）

# イメージ同梱のひな形（set_property / del_property のデフォルト対象）
GUAC_PROP_TEMPLATE="/app/guacamole/guacamole.properties"

log() { echo "[guacamole] $(date '+%F %T %Z') $*"; }

# set_property KEY VALUE [FILE]
# 既存行があれば置換、無ければ追記する。FILE 既定はイメージ同梱ひな形。
set_property() {
    local key="$1" val="$2" file="${3:-$GUAC_PROP_TEMPLATE}"
    [ -f "$file" ] || { mkdir -p "$(dirname "$file")"; : > "$file"; }
    if grep -qE "^${key}:" "$file" 2>/dev/null; then
        sed -i "s|^${key}:.*|${key}: ${val}|" "$file"
    else
        printf '%s: %s\n' "$key" "$val" >> "$file"
    fi
}

# del_property KEY [FILE]
del_property() {
    local key="$1" file="${2:-$GUAC_PROP_TEMPLATE}"
    [ -f "$file" ] && sed -i "/^${key}:.*/d" "$file"
}

# /etc/guacamole-ha.env から PG 接続情報を読み込む。
# ha-run.sh がこのファイルを書いてから guac_psql/wait_for_db を呼ぶため
# 通常は必ず存在する。cron スクリプトからは起動後に参照される。
_load_pg_env() {
    [ -f /etc/guacamole-ha.env ] && . /etc/guacamole-ha.env
    PG_HOST="${PG_HOST:-127.0.0.1}"
    PG_PORT="${PG_PORT:-5432}"
    PG_USER="${PG_USER:-postgres}"
    PG_PASSWORD="${PG_PASSWORD:-}"
    PG_DATABASE="${PG_DATABASE:-guacamole_db}"
}

# 外部 PostgreSQL に接続する psql（接続情報は /etc/guacamole-ha.env から取得）
guac_psql() {
    _load_pg_env
    PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" "$@"
}

# DB サーバが応答可能になるまで待機（引数: 最大試行回数、既定60 = 最大約2分/フェーズ）
# $PG_DATABASE が未作成でも成功するよう postgres メンテナンス DB で接続確認する。
wait_for_db() {
    _load_pg_env
    local tries="${1:-60}"
    while ! nc -z "$PG_HOST" "$PG_PORT" 2>/dev/null; do
        tries=$((tries - 1)); [ "$tries" -le 0 ] && return 1; sleep 2
    done
    tries="${1:-60}"
    while ! PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" \
              -U "$PG_USER" -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; do
        tries=$((tries - 1)); [ "$tries" -le 0 ] && return 1; sleep 2
    done
    return 0
}
