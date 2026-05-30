# InvenTree

オープンソースの在庫管理システム [InvenTree](https://inventree.org/) を Home Assistant アドオンとして動作させます。

## 機能

- 部品・在庫のトラッキング
- BOM（部品表）管理
- バーコード対応
- REST API / プラグイン対応

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
3. **InvenTree** を選択して **インストール**
4. アドオンを起動後、`http://<HA のアドレス>:50021` にアクセス

## ポート

| ポート | 用途 |
|---|---|
| `50021` | Web UI / API |
