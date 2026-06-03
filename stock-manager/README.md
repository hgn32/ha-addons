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
- **Amazon購入履歴クローラー**: ログインCookieを使って注文履歴を差分取得し、在庫へ反映
- **ダッシュボード**: 在庫サマリーと在庫少ない商品の一覧

## Amazon購入履歴クローラー

Amazon.co.jpの注文履歴を定期取得し、前回取得以降の差分のみを在庫管理に取り込みます。

### 認証（Cookie）

1. ブラウザでAmazon.co.jpにログイン
2. DevTools（F12）→ Network タブで任意のリクエストの `Cookie` ヘッダーをコピー
3. アプリの「Amazon取込」画面に貼り付けて保存（または `amazon_cookie` オプション / `AMAZON_COOKIE` 環境変数）
4. セッション切れ時はエラーになるので、再取得して差し替える

### 取込の振り分け

- **自動**: ASIN/JANが商品マスタに存在 → 在庫を購入数量分 自動加算
- **在庫管理する**: 未登録商品 → 商品マスタに新規登録＋在庫加算
- **在庫管理しない**: 未登録商品 → 無視リストに登録し、以降の取得でスキップ

### 定期実行

`node-cron` で定期実行します（既定: 毎日 6:00 JST）。
スケジュールは `amazon_cron` オプション、または `AMAZON_CRON` 環境変数で変更できます。

> 注意: Amazonの利用規約上スクレイピングは制限されています。自分のデータを自分で取得する
> 個人・社内用途を想定し、リクエスト間に1〜3秒のsleepを挟んで負荷を抑えています。

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
