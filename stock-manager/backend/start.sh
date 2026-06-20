#!/bin/sh
set -e

# Persistent data lives in the dedicated add-on config dir, mounted at /config
# (host path /addon_configs/<slug>, included in backups).
mkdir -p /config/images

# 事前マイグレーション: Prisma が --accept-data-loss なしに適用できない
# 安全な構造変更（nullable化等）を直接 SQLite で処理する。
node migrate.js

# スキーマ適用。データロスが発生する変更が残っている場合はここで失敗して停止する。
if ! npx prisma db push 2>&1; then
  echo "" >&2
  echo "================================================================" >&2
  echo "[FATAL] スキーマ更新に失敗しました。" >&2
  echo "データが失われる変更が含まれている可能性があります。" >&2
  echo "" >&2
  echo "対処方法:" >&2
  echo "  1. /config/stock.db をバックアップ" >&2
  echo "  2. アドオンを再起動" >&2
  echo "================================================================" >&2
  exit 1
fi

exec node dist/index.js
