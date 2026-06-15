# Suwayomi Server

[Mihon](https://mihon.app/)（旧 Tachiyomi）互换のセルフホスト型マンガサーバー [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) を Home Assistant アドオンとして動作させます。

## 機能

- Mihon / Tachiyomi からリモートサーバーとして接続可能
- 拡張機能（エクステンション）でさまざまなマンガソースに対応
- Web UI でブラウザから直接読書可能
- ダウンロード・既読管理
- **`.tachibk` バックアップビューア内蔵**（旧 Suwayomi Summary アドオンを統合）

## 対応アーキテクチャ

| アーキテクチャ | 対応状況 |
|---|---|
| amd64 | ✅ |
| aarch64 | ✅ |

## インストール

1. Home Assistant の **設定 → アドオン → アドオンストア** を開く
2. 右上のメニューから **リポジトリを追加** を選択し、以下の URL を入力する
   ```
   https://github.com/hgn32/ha-addons
   ```
3. **Suwayomi Server** を選択して **インストール**
4. アドオンを起動後、`http://<HA のアドレス>:4567` にアクセス

## ポート / 画面

| アクセス方法 | 用途 |
|---|---|
| ポート `4567` | Suwayomi Server 本体の Web UI / API |
| サイドバーパネル「Suwayomi Summary」（ingress） | `.tachibk` バックアップビューア |

## バックアップビューア（Suwayomi Summary）

旧 Suwayomi Summary アドオンの機能を本体に統合しました。サイドバーの
**Suwayomi Summary** パネル（ingress）から、`.tachibk` / `.proto.gz` バックアップの
内容表示や、ダウンロード済みチャプターの一括削除などを行えます。

- バックアップ/変換テーブルの保存先: `/config`（本体と共有、`/config/aliases.json`）
- Suwayomi Server への接続は同一コンテナ内の `localhost:4567` を既定で使用します。
  BASIC 認証を有効にしている場合のみ、アドオンの **設定** タブで
  `suwayomi_username` / `suwayomi_password` を設定してください。

## データの保存先

`startup_script_org.sh` により、設定・データベース・拡張機能はアドオン専用の設定ディレクトリ（コンテナ内 `/config`、ホスト実体 `/addon_configs/<slug>/`、バックアップ対象）にシンボリックリンクで永続化されます。

| 種類 | コンテナ内パス |
|---|---|
| サーバー設定 | `/config/server.conf` |
| オプション | `/config/options.json` |
| データベース | `/config/database.mv.db` |
| 拡張機能 | `/config/extensions/` |

## Mihon との連携

Mihon アプリの **設定 → バックアップと同期 → Suwayomi** からサーバーの URL を設定することで、スマートフォンから利用できます。
