# Suwayomi Summary (Home Assistant add-on)

Suwayomi / Mihon / Tachiyomi の `.tachibk` バックアップを Home Assistant の Ingress 経由で開いて、漫画一覧とソース一覧を表で見るツール。

- ポート公開なし、HAのIngressで直接アクセス
- 認証はHAが代行
- バックエンド: FastAPI / フロント: DataTables

## インストール

1. このフォルダをまるごと、HAの `addons/` 配下に置く（ローカル add-on として）。例:
   ```
   /addons/suwayomi_summary/
     ├── config.json
     ├── Dockerfile
     ├── run.sh
     ├── requirements.txt
     └── app/
   ```
2. HA の **Settings → Add-ons → Add-on Store → ⋮ → Check for updates** で再読み込み
3. 「Local add-ons」に **Suwayomi Summary** が現れるので **Install** → **Start**
4. **OPEN WEB UI** または左サイドバーの **Suwayomi Summary** からアクセス

## データの置き場所

`map: ["config:rw"]` 経由で HA の `/config` フォルダに永続化されます。

| 種類 | パス（HA上） |
|---|---|
| バックアップフォルダ | `/config/suwayomi_summary/backups/` |
| 変換テーブル | `/config/suwayomi_summary/aliases.json` |

初回起動時に自動作成されます。HAの File editor / Samba / VSCode add-on などで編集してください。

## 使い方

1. **アップロード**: 画面上で `.tachibk` を直接アップロード
2. **フォルダから選択**: `/config/suwayomi_summary/backups/` に置いた `.tachibk` / `.proto.gz` を一覧から選択

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

以下のサフィックスはエイリアス未登録でも表示時に自動除去されます（`decoder.py` の `_SUFFIXES_TO_STRIP` で定義）。

| サフィックス | 例 |
|---|---|
| ` - RAW` | `BOKEN-KA NI NAROU! - RAW` → `BOKEN-KA NI NAROU!` |
| ` (Raw – Free)` | `TITLE (Raw – Free)` → `TITLE` |
| `(Raw – Free)` （前スペースなし） | `TITLE(Raw – Free)` → `TITLE` |

> NFKC 正規化後にマッチするため、全角ダッシュ・全角スペース等も対象になります。

### 重複検出で無視されるパターン

同じ作品の別版（コミカライズ等）を重複扱いしないための追加除去（`_DUP_EXTRA_SUFFIXES`）。

| サフィックス | 備考 |
|---|---|
| `@comic` | `＠comic`・`＠ＣＯＭＩＣ` も NFKC で同一視 |
| `THE COMIC` | コミカライズ版マーカー |

### `aliases.json` で対応が必要なパターン

上記以外のノイズ（例: ` RAW` 末尾のみ・タイトル全体が英字表記など）は `aliases.json` に登録して正式名へ変換してください。初回起動時に 108 件のデフォルトエントリが自動生成されます。

```json
{
  "BOKEN-KA NI NAROU!~ SUKIRU BOUDO DE DANJON KORYAKU ~ RAW": "冒険家になろう！～スキルボードでダンジョン攻略～",
  "FLYING WITCH - RAW": "フライング・ウィッチ"
}
```

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
