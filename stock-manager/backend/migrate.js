#!/usr/bin/env node
// データマイグレーション管理。
// _data_migrations テーブルで適用済みを追跡し、未適用のものだけ実行する。
// どのバージョンからアップグレードしても安全に動く。

const b = require('./node_modules/better-sqlite3');
const fs = require('fs');

const url = process.env.DATABASE_URL || 'file:/config/stock.db';
const dbPath = url.replace(/^file:/, '');

if (!fs.existsSync(dbPath)) process.exit(0);

const db = b(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS "_data_migrations" (
    name       TEXT     NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

function applied(name) {
  return !!db.prepare('SELECT 1 FROM "_data_migrations" WHERE name = ?').get(name);
}

function run(name, fn) {
  if (applied(name)) return;
  fn();
  db.prepare('INSERT INTO "_data_migrations" (name) VALUES (?)').run(name);
  console.log(`[migrate] ${name}: 完了`);
}

// ---- マイグレーション一覧 ----

run('001_nullable_fk_empty_to_null', () => {
  db.prepare("UPDATE \"Product\" SET category_id = NULL WHERE category_id = ''").run();
  db.prepare("UPDATE \"Product\" SET location_id = NULL WHERE location_id = ''").run();
  db.prepare("UPDATE \"Transaction\" SET supplier_id = NULL WHERE supplier_id = ''").run();
});

// 今後はここに追加していく

// --------------------------------

db.close();
