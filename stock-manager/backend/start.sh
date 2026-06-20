#!/bin/sh
set -e

# Persistent data lives in the dedicated add-on config dir, mounted at /config
# (host path /addon_configs/<slug>, included in backups).
mkdir -p /config/images

# Create or update the SQLite schema from prisma/schema.prisma.
npx prisma db push --accept-data-loss

# 外部キーフィールドの空文字をNULLに変換（旧データの移行）
node -e "
const b = require('./node_modules/better-sqlite3');
const url = process.env.DATABASE_URL || 'file:/config/stock.db';
const db = b(url.replace('file:', ''));
db.exec(\"UPDATE Product SET category_id = NULL WHERE category_id = ''\");
db.exec(\"UPDATE Product SET location_id = NULL WHERE location_id = ''\");
db.exec(\"UPDATE \\\"Transaction\\\" SET supplier_id = NULL WHERE supplier_id = ''\");
db.close();
"

exec node dist/index.js
