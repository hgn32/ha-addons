#!/usr/bin/env node
// 事前マイグレーション: prisma db push の前に実行する。
// 外部キーフィールドに残存している空文字を NULL に変換する（旧データ移行）。

const b = require('./node_modules/better-sqlite3');
const fs = require('fs');

const url = process.env.DATABASE_URL || 'file:/config/stock.db';
const dbPath = url.replace(/^file:/, '');

if (!fs.existsSync(dbPath)) process.exit(0);

const db = b(dbPath);
db.prepare("UPDATE \"Product\" SET category_id = NULL WHERE category_id = ''").run();
db.prepare("UPDATE \"Product\" SET location_id = NULL WHERE location_id = ''").run();
db.prepare("UPDATE \"Transaction\" SET supplier_id = NULL WHERE supplier_id = ''").run();
db.close();
