#!/bin/sh
set -e

# Persistent data lives in the dedicated add-on config dir, mounted at /config
# (host path /addon_configs/<slug>, included in backups).
mkdir -p /config/images

# force_schema_push 設定を確認
FORCE_PUSH=$(node -e "
try {
  const o = require('/data/options.json');
  console.log(o.force_schema_push ? 'true' : 'false');
} catch { console.log('false'); }
")

if [ "$FORCE_PUSH" = "true" ]; then
  echo "[schema] force_schema_push が有効: --accept-data-loss で実行します"
  npx prisma db push --accept-data-loss

  # 成功したら設定をOFFに戻す
  node -e "
    const http = require('http');
    const fs = require('fs');
    const opts = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
    opts.force_schema_push = false;
    const body = JSON.stringify(opts);
    const req = http.request({
      host: 'supervisor',
      port: 80,
      path: '/addons/self/options',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.SUPERVISOR_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      res.resume();
      res.on('end', () => console.log('[schema] force_schema_push をOFFに設定しました'));
    });
    req.on('error', e => console.error('[schema] オプション更新失敗:', e.message));
    req.write(body);
    req.end();
  "
else
  echo "[schema] スキーマを更新します"
  if ! npx prisma db push 2>&1; then
    echo "" >&2
    echo "================================================================" >&2
    echo "[FATAL] スキーマ更新に失敗しました。" >&2
    echo "データが失われる変更が含まれている可能性があります。" >&2
    echo "" >&2
    echo "対処方法:" >&2
    echo "  1. /config/stock.db をバックアップ" >&2
    echo "  2. アドオン設定で force_schema_push をONにして再起動" >&2
    echo "================================================================" >&2
    exit 1
  fi
fi

exec node dist/index.js
