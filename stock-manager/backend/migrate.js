#!/usr/bin/env node
// 事前マイグレーション: prisma db push の前に実行する。
// Prisma が --accept-data-loss なしに適用できない安全な構造変更を直接 SQLite で処理する。
// 冪等: 既に適用済みの場合はスキップする。

const b = require('./node_modules/better-sqlite3');
const fs = require('fs');

const url = process.env.DATABASE_URL || 'file:/config/stock.db';
const dbPath = url.replace(/^file:/, '');

if (!fs.existsSync(dbPath)) {
  // 初回起動: DBがまだ存在しない。Prisma が新規作成するので何もしない。
  process.exit(0);
}

const db = b(dbPath);

function colInfo(table) {
  return db.prepare(`PRAGMA table_info('${table}')`).all();
}

// --- Product: category_id / location_id を NOT NULL → nullable に ---
const productCols = colInfo('Product');
const catCol = productCols.find(c => c.name === 'category_id');
if (catCol && catCol.notnull === 1) {
  console.log('[migrate] Product: category_id/location_id を nullable に変更...');
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE "__Product_new" (
      "id"            TEXT     NOT NULL PRIMARY KEY,
      "name"          TEXT     NOT NULL DEFAULT '',
      "volume"        TEXT     NOT NULL DEFAULT '',
      "piece_count"   INTEGER  NOT NULL DEFAULT 1,
      "maker"         TEXT     NOT NULL DEFAULT '',
      "jan_code"      TEXT     NOT NULL DEFAULT '',
      "amazon_asin"   TEXT     NOT NULL DEFAULT '',
      "amazon_url"    TEXT     NOT NULL DEFAULT '',
      "category_id"   TEXT,
      "location_id"   TEXT,
      "note"          TEXT     NOT NULL DEFAULT '',
      "photo"         TEXT     NOT NULL DEFAULT '',
      "quantity"      INTEGER  NOT NULL DEFAULT 0,
      "warn_quantity" INTEGER  NOT NULL DEFAULT 1,
      "sort_order"    INTEGER  NOT NULL DEFAULT 0,
      "created_at"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO "__Product_new"
      SELECT id, name, volume, piece_count, maker, jan_code, amazon_asin, amazon_url,
             NULLIF(category_id, ''), NULLIF(location_id, ''),
             note, photo, quantity, warn_quantity, sort_order, created_at
      FROM "Product";
    DROP TABLE "Product";
    ALTER TABLE "__Product_new" RENAME TO "Product";
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  console.log('[migrate] Product 完了。');
} else {
  // 既に nullable: 残存している空文字だけ NULL に変換
  db.prepare("UPDATE \"Product\" SET category_id = NULL WHERE category_id = ''").run();
  db.prepare("UPDATE \"Product\" SET location_id = NULL WHERE location_id = ''").run();
}

// --- Transaction: supplier_id を NOT NULL → nullable に ---
const txCols = colInfo('Transaction');
const supCol = txCols.find(c => c.name === 'supplier_id');
if (supCol && supCol.notnull === 1) {
  console.log('[migrate] Transaction: supplier_id を nullable に変更...');
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE "__Transaction_new" (
      "id"          TEXT     NOT NULL PRIMARY KEY,
      "type"        TEXT     NOT NULL,
      "product_id"  TEXT     NOT NULL,
      "quantity"    INTEGER  NOT NULL,
      "unit_price"  REAL     NOT NULL DEFAULT 0,
      "supplier_id" TEXT,
      "note"        TEXT     NOT NULL DEFAULT '',
      "date"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO "__Transaction_new"
      SELECT id, type, product_id, quantity, unit_price,
             NULLIF(supplier_id, ''),
             note, date
      FROM "Transaction";
    DROP TABLE "Transaction";
    ALTER TABLE "__Transaction_new" RENAME TO "Transaction";
    CREATE INDEX IF NOT EXISTS "Transaction_product_id_idx" ON "Transaction"("product_id");
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  console.log('[migrate] Transaction 完了。');
} else {
  db.prepare("UPDATE \"Transaction\" SET supplier_id = NULL WHERE supplier_id = ''").run();
}

db.close();
console.log('[migrate] 事前マイグレーション完了。');
