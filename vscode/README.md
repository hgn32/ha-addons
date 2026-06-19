# Home Assistant Add-on: Studio Code Server

ブラウザからアクセスできる Visual Studio Code 環境を Home Assistant フロントエンドに統合します。
[hassio-addons/addon-vscode](https://github.com/hassio-addons/addon-vscode) をベースにしたカスタムビルドです。

## 機能

- ブラウザ経由で VSCode を操作
- Home Assistant の設定ファイルに直接アクセス
- ESPHome・YAML など HA 向け拡張機能をプリインストール
- SSH / Git / zsh 環境を同梱
- MQTT / MySQL サービスの自動設定

## 設定

| オプション | デフォルト | 説明 |
|---|---|---|
| `config_path` | `/config` | VSCode で開くワークスペースパス |
| `packages` | `[]` | 追加インストールする apt パッケージ |
| `init_commands` | `[]` | 起動時に実行するコマンド |
| `log_level` | - | ログレベル (trace/debug/info/notice/warning/error/fatal) |
