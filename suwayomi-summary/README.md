# Suwayomi Summary (Home Assistant add-on)

Suwayomi / Mihon / Tachiyomi の `.tachibk` バックアップを Home Assistant の Ingress 経由で開いて、漫画一覧とソース一覧を表で見るツール。

- ポート公開なし、HAのIngressで直接アクセス
- 認証はHAが代行
- バックエンド: FastAPI / フロント: DataTables

## インストール

1. Home Assistant の **設定 → アドオン → アドオンストア** を開く
2. 右上のメニューから **リポジトリを追加** を選択し、以下の URL を入力する
   ```
   https://github.com/hgn32/ha-addons
   ```
3. 「Suwayomi Summary」を選択して **Install** → **Start**
4. **OPEN WEB UI** または左サイドバーの **Suwayomi Summary** からアクセス

## データの置き場所

`map: ["config:rw"]` 経由で HA の `/config` フォルダに永続化されます。

| 種類 | パス（HA上） |
|---|---|
| バックアップフォルダ | `/config/suwayomi/` |
| 変換テーブル | `/config/suwayomi/aliases.json` |

初回起動時に自動作成されます。HAの File editor / Samba / VSCode add-on などで編集してください。

## 使い方

1. **アップロード**: 画面上で `.tachibk` を直接アップロード
2. **フォルダから選択**: `/config/suwayomi/` に置いた `.tachibk` / `.proto.gz` を一覧から選択

## Suwayomi Server 連携: DL済みチャプターの一括削除

トップページの **「全DL済みを削除」** ボタンで、Suwayomi Server 上のダウンロード済み
チャプターをすべて削除できます（ライブラリの漫画・既読状態は残ります）。
実行後、削除した章数が表示されます。

Suwayomi Server の GraphQL API (`/api/graphql`) を **BASIC認証** で呼び出すため、
アドオンの **設定** タブで以下を設定してください。ID / パスワードが未設定の場合は
トップページに警告が表示され、ボタンは無効になります。

| 設定 | 内容 | デフォルト |
|---|---|---|
| `suwayomi_url` | Suwayomi Server の URL | `http://172.30.32.1:4567`（同一ホストの Suwayomi Server アドオン） |
| `suwayomi_username` | BASIC認証のID | （空） |
| `suwayomi_password` | BASIC認証のパスワード | （空） |

`172.30.32.1` はアドオンコンテナから見た HA ホストのアドレスです。Suwayomi Server が
別マシンにある場合などは `http://192.168.x.x:4567` のように変更してください。

スタンドアロン起動時は環境変数 `SUWAYOMI_URL` / `SUWAYOMI_USERNAME` /
`SUWAYOMI_PASSWORD` で指定できます（アドオン設定より優先）。

### 変換テーブル `aliases.json`
```json
{
  "BOKEN-KA NI NAROU!~ SUKIRU BOUDO DE DANJON KORYAKU ~ RAW": "冒険家になろう！～スキルボードでダンジョン攻略～",
  "FLYING WITCH - RAW": "フライング・ウィッチ"
}
```
編集後、ページ再読み込みで反映（add-on再起動は不要）。

## 表示する列

### 漫画一覧
| 列 | 内容 |
|---|---|
| 生の名前 | バックアップに記録されているタイトル |
| 変換後名 | aliases.json に登録があれば、その表示用名前 |
| ソース | バックアップ内の sourceId から解決した名前 |
| 話数 | 章の数 |
| AniList | AniList トラッキングが付いているか (✓ / –) |
| 最新話の取得日時 | 章の `dateFetch` の最大値 (UTC) |

→ 「最新話の取得日時」を昇順にすると **死んでる漫画** がわかる

### ソース一覧
| 列 | 内容 |
|---|---|
| ソース名 | (未インストールのソースは赤バッジ付き) |
| 漫画数 | このソースに属する漫画の数 |
| 最新話の取得日時 | このソース全体での `dateFetch` の最大値 |

→ 漫画数の少ないソース・更新の止まったソースが見えるので、**ソースのマージ判断** に使える

## タイトルのゴミ除去について

Mihon / Suwayomi のバックアップには、ソース由来のノイズがタイトルに付くことがあります。

### 自動除去されるパターン（`aliases.json` 不要）

| サフィックス | 例 |
|---|---|
| ` - RAW` | `BOKEN-KA NI NAROU! - RAW` → `BOKEN-KA NI NAROU!` |
| ` (Raw – Free)` | `TITLE (Raw – Free)` → `TITLE` |
| `(Raw – Free)` （前スペースなし） | `TITLE(Raw – Free)` → `TITLE` |

### 重複検出で無視されるパターン

| サフィックス | 備考 |
|---|---|
| `@comic` | `＠comic`・`＠ＣＯＭＩＣ` も NFKC で同一視 |
| `THE COMIC` | コミカライズ版マーカー |

### `aliases.json` で対応が必要なパターン

上記以外のノイズは `aliases.json` に登録して正式名へ変換してください。初回起動時に 108 件のデフォルトエントリが自動生成されます。

## スタンドアロン起動 (HAなしで動かす場合)

```bash
pip install -r requirements.txt
BACKUP_DIR=./backups ALIASES_FILE=./aliases.json \
  uvicorn app.main:app --host 0.0.0.0 --port 8099
```

## 仕様メモ

- スキーマ出典: Mihon の proto 定義 (mihonapp/mihon issue #1074)。実 Suwayomi バックアップで検証済み
- Suwayomi 独自の追加フィールド (フィールド番号 9000 / 9001) は無視
- `dateFetch` / `dateAdded` 等は Mihon が ms-since-epoch (UTC) で保存しているため、UTC で表示
- Ingress 対応のため、HTML 内のリンク・フォームはすべて相対パス
