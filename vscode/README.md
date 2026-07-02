# Home Assistant Add-on: Studio Code Server

ブラウザからアクセスできる Visual Studio Code 環境を Home Assistant フロントエンドに統合します。
[hassio-addons/addon-vscode](https://github.com/hassio-addons/addon-vscode) をベースにしたカスタムビルドです。

## 機能

- ブラウザ経由で VSCode を操作
- Home Assistant の設定ファイル・アドオン設定・バックアップ・メディア・share・SSL
  ディレクトリ、Supervisor API に直接アクセス
- プリインストール済み拡張機能: Material Icon Theme
- SSH / Git / zsh 環境を同梱
- Claude Code CLI (`claude` コマンド) を同梱。VSCode 内のターミナルから利用できます

## 日本語表示（言語パック）について

日本語言語パック拡張機能（`MS-CEINTL.vscode-language-pack-ja`）は同梱していません。
以前はビルド時にファイルを直接配置する方法で同梱していましたが、code-server は
Extensions ビュー経由（オンライン）でインストールした場合以外は言語パックを
正しく登録できず、拡張機能が「Invalid extensions detected」と表示され続けたり
ウィンドウの再読み込みを繰り返し要求したりする不具合がありました
（[coder/code-server#4735](https://github.com/coder/code-server/issues/4735)）。

日本語 UI で使いたい場合は、VS Code 画面内の Extensions ビュー（左サイドバーの
四角いアイコン）で `vscode-language-pack-ja` を検索してインストールしてください。
オンラインでインストールした場合は正常に「言語を変更して再読み込みしますか？」
という通知が表示され、その案内に従うことで日本語表示に切り替わります。

## Claude Code について

以前は `Anthropic.claude-code` 拡張機能を同梱していましたが、拡張機能に付属する
ネイティブバイナリが musl 向けビルドで、このアドオンのベースイメージ
（Debian/glibc）では起動できず
（`musl dynamic loader (/lib/ld-musl-*) is missing` エラー）、常時エラー表示や
再読み込み要求が出る不具合があったため同梱を取りやめました。

代わりに `claude` CLI 本体（npm 版）のみを同梱しています。VSCode 内のターミナルを
開いて `claude` コマンドを実行してください。初回利用時はサブスクリプション
アカウントでログインが必要です。

## 設定

| オプション | デフォルト | 説明 |
|---|---|---|
| `config_path` | `/config` | VSCode で開くワークスペースパス |
| `max_memory_mb` | `2048` | Node.js（code-server）に割り当てる最大メモリ量 (MB) |
| `packages` | `[]` | 追加インストールする apt パッケージ |
| `init_commands` | `[]` | 起動時に実行するコマンド |
| `log_level` | - | ログレベル (trace/debug/info/notice/warning/error/fatal) |
