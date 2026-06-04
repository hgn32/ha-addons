# Stock Manager

シンプルな在庫管理 Home Assistant アドオン。

## 機能

- **ダッシュボード**: 在庫一覧。カテゴリフィルタ・並び替え（在庫数 / 名前 / 次回購入予定日）。在庫追加・消費・履歴をカード上から操作
- **品目マスタ**: 写真・JANコード・Amazon ASIN・カテゴリ・置き場・購入先・メモを管理。ドラッグ並び替え・CSV出力対応
- **在庫操作**: 在庫追加・在庫消費・強制メンテ（直接数量指定）
- **在庫履歴**: すべての在庫変動を記録。品目・種別フィルタ・ページネーション付き
- **カテゴリ / 置き場 / 購入先マスタ**: ドラッグ並び替え・CSV出力対応
- **Amazon購入履歴クローラー**: ログインCookieを使って注文履歴を差分取得し、在庫へ自動反映

## Amazon購入履歴クローラー

Amazon.co.jpの注文履歴を定期取得し、前回取得以降の差分のみを在庫管理に取り込みます。

### 認証（Cookie）

1. ブラウザでAmazon.co.jpにログイン
2. DevTools（F12）→ Network タブで任意のリクエストの `Cookie` ヘッダーをコピー
3. アプリの「Amazon取込」画面に貼り付けて保存（または `amazon_cookie` オプション / `AMAZON_COOKIE` 環境変数）
4. セッション切れ時はエラーになるので、再取得して差し替える

### 取込の振り分け

| 状態 | 動作 |
|------|------|
| ASIN/JANが品目マスタに存在 | 在庫を購入数量分 自動加算 |
| 未登録（取込する） | 品目マスタに新規登録 + 在庫加算 |
| 未登録（管理しない） | 無視リストに登録し、以降の取得でスキップ |

### 定期実行

`node-cron` で定期実行します（既定: 毎日 6:00 JST）。  
スケジュールは `amazon_cron` オプション、または `AMAZON_CRON` 環境変数で変更できます。

### 通知

取込完了時（自動追加 or 確認待ちが1件以上）に Home Assistant のネイティブ通知を送信します。

`notify_service` オプションで通知先サービスを指定します（既定: `persistent_notification`）。

| 設定値 | 通知先 |
|--------|--------|
| `persistent_notification`（既定） | HA サイドバーのベルアイコン |
| `mobile_app_<デバイス名>` | HA コンパニオンアプリのプッシュ通知 |
| `notify`（グループ通知） | HA で設定済みの全通知先 |

> 注意: Amazonの利用規約上スクレイピングは制限されています。自分のデータを自分で取得する
> 個人・社内用途を想定し、リクエスト間に1〜3秒のsleepを挟んで負荷を抑えています。

## データ保存場所

`/config/stock_manager_3a30c8ec/` に保存します。

| パス | 内容 |
|------|------|
| `stock.db` | SQLite データベース（品目・在庫・履歴・各マスタ） |
| `images/` | 品目画像 |
| `chrome-profile/` | Chromiumプロファイル（ブラウザフィンガープリント維持用） |

アドオンを再起動・更新してもデータは保持されます。

## アクセス

Home Assistant のサイドバー（Ingress）から開けます。

## 技術スタック

- **フロントエンド**: React 19 + TypeScript + MUI 9 / Vite
- **バックエンド**: Node.js + Express 5 + TypeScript
- **DB**: Prisma + SQLite
- **クローラー**: Puppeteer-core + Chromium

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
