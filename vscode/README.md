# Home Assistant Add-on: Studio Code Server

ブラウザからアクセスできる Visual Studio Code 環境を Home Assistant フロントエンドに統合します。
[hassio-addons/addon-vscode](https://github.com/hassio-addons/addon-vscode) をベースにしたカスタムビルドです。

## 機能

- ブラウザ経由で VSCode を操作
- Home Assistant の設定ファイルに直接アクセス
- ESPHome・YAML など HA 向け拡張機能をプリインストール
- Claude Code 拡張機能をプリインストール
- SSH / Git / zsh 環境を同梱
- MQTT / MySQL サービスの自動設定

## Claude Code 拡張機能について

`Anthropic.claude-code` 拡張機能を同梱していますが、拡張機能に付属する
ネイティブバイナリは musl 向けビルドで、このアドオンのベースイメージ
（Debian/glibc）では起動できません
（`musl dynamic loader (/lib/ld-musl-*) is missing` エラー）。

そのため、この Docker イメージのビルド時に `npm install -g` で
このシステム向けの `claude` CLI を別途インストールし
（`/usr/local/bin/claude`）、拡張機能の設定
`claudeCode.claudeProcessWrapper` でそちらを使うようあらかじめ
構成しています。ユーザー側での追加設定は不要です。

初回利用時は、VSCode 内のターミナルまたは Claude Code のサイドパネルから
サブスクリプションアカウントでログインしてください。

## 設定

| オプション | デフォルト | 説明 |
|---|---|---|
| `config_path` | `/config` | VSCode で開くワークスペースパス |
| `packages` | `[]` | 追加インストールする apt パッケージ |
| `init_commands` | `[]` | 起動時に実行するコマンド |
| `log_level` | - | ログレベル (trace/debug/info/notice/warning/error/fatal) |
