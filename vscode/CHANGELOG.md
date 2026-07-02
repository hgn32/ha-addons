## 6.0.4

- `MS-CEINTL.vscode-language-pack-ja`（日本語言語パック）の同梱を取りやめ。ビルド時にファイルを直接配置する方法では code-server が言語パックを正しく登録できず、「Invalid extensions detected」の表示や再読み込み要求が繰り返される不具合があったため（[coder/code-server#4735](https://github.com/coder/code-server/issues/4735)）。日本語表示にしたい場合は VS Code 内の Extensions ビューからオンラインでインストールしてください（README 参照）
- 起動時に強制していた表示言語 `ja` へのデフォルト設定を撤去。既存インストールでも自動的に元の状態に戻る

## 6.0.3

- `Anthropic.claude-code` 拡張機能の同梱を取りやめ（同梱のネイティブバイナリが musl 向けビルドで、この glibc ベースの環境では起動できず、常時エラー表示や再読み込み要求が出る不具合があったため）
- `claude` CLI（npm 版）はそのまま同梱。VSCode 内のターミナルから利用可能

## 6.0.2

- 初期リリース
