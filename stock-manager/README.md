# Stock Manager

シンプルな在庫管理 Home Assistant アドオン。

## 技術スタック

- **フロントエンド**: React + TypeScript + MUI (Material-UI) / Vite
- **バックエンド**: Node.js + Express + TypeScript
- **DB**: Prisma + SQLite

## 機能

- **商品マスタ**: 写真・JANコード・Amazon ASIN・カテゴリ・置き場・購入先を管理
- **カテゴリ / 置き場 / 購入先マスタ**: 各種マスタのCRUD管理
- **在庫操作**: 在庫追加・在庫使用・強制メンテ（直接数量指定）
- **操作履歴**: すべての在庫変動を記録
- **Amazon購入履歴取込**: Amazon注文レポートCSVを読み込んで自動で在庫追加
- **ダッシュボード**: 在庫サマリーと在庫少ない商品の一覧

## データ保存場所

`/config/stock_manager_3a30c8ec/` に保存します。

- `stock.db` — SQLite データベース（商品・在庫・履歴・各マスタ）
- `images/` — 商品画像

アドオンを再起動・更新してもデータは保持されます。

## アクセス

Home Assistant のサイドバー（Ingress）から開けます。

## 開発

```sh
# バックエンド
cd backend
npm install
npx prisma generate
DATABASE_URL=file:./dev.db npx prisma db push
DATA_DIR=./data DATABASE_URL=file:./dev.db npm run build && npm start

# フロントエンド
cd frontend
npm install
npm run dev
```
