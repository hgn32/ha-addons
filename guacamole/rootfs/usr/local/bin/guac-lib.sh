#!/usr/bin/env bash
# 共通ヘルパ（ha-run.sh / backup / restore / log-cleanup から source される）
# shellcheck shell=bash

# guacamole.properties の場所
GUAC_PROP_TEMPLATE="/app/guacamole/guacamole.properties"   # イメージ同梱のひな形
GUAC_PROP_CONFIG="/config/guacamole/guacamole.properties"  # 永続側（バックアップ対象）

log() { echo "[guacamole] $(date '+%F %T %Z') $*"; }

# 設定ダンプ(バックアップ)の出力先ディレクトリ。
# アドオン設定 backup_path（既定 /config/guacamole）。空/未設定なら既定にフォールバック。
backup_dir() {
    local d
    d="$(jq -r '.backup_path // ""' /data/options.json 2>/dev/null || echo "")"
    [ -n "$d" ] || d="/config/guacamole"
    printf '%s\n' "$d"
}

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

# 永続側 properties から PostgreSQL パスワードを取得
guac_pw() {
    [ -f "$GUAC_PROP_CONFIG" ] || return 1
    grep -E '^postgresql-password:' "$GUAC_PROP_CONFIG" | head -n1 \
        | sed -E 's/^postgresql-password:[[:space:]]*//'
}

# guacamole ロール（= bootstrap superuser）で TCP 接続する psql
guac_psql() {
    PGPASSWORD="$(guac_pw)" psql -h 127.0.0.1 -p 5432 -U guacamole -d guacamole_db "$@"
}

# DB が応答可能になるまで待機（引数: 最大試行回数、既定120 = 約4分）
wait_for_db() {
    local tries="${1:-120}"
    while ! nc -z 127.0.0.1 5432 2>/dev/null; do
        tries=$((tries - 1)); [ "$tries" -le 0 ] && return 1; sleep 2
    done
    tries="${1:-120}"
    while ! guac_psql -tAc 'SELECT 1' >/dev/null 2>&1; do
        tries=$((tries - 1)); [ "$tries" -le 0 ] && return 1; sleep 2
    done
    return 0
}
