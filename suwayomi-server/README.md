# Suwayomi Server

[Mihon](https://mihon.app/)（旧 Tachiyomi）互换のセルフホスト型マンガサーバー [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) を Home Assistant アドオンとして動作させます。

## 機能

- Mihon / Tachiyomi からリモートサーバーとして接続可能
- 拡張機能（エクステンション）でさまざまなマンガソースに対応
- Web UI でブラウザから直接読書可能
- ダウンロード・既読管理

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

## ポート

| ポート | 用途 |
|---|---|
| `4567` | Web UI / API |

## データの保存先

`startup_script_org.sh` により、設定・データベース・拡張機能は `/config/suwayomi/` 配下にシンボリックリンクで永続化されます。

| 種類 | HA 上のパス |
|---|---|
| サーバー設定 | `/config/suwayomi/server.conf` |
| オプション | `/config/suwayomi/options.json` |
| データベース | `/config/suwayomi/database.mv.db` |
| 拡張機能 | `/config/suwayomi/extensions/` |

## Mihon との連携

Mihon アプリの **設定 → バックアップと同期 → Suwayomi** からサーバーの URL を設定することで、スマートフォンから利用できます。
