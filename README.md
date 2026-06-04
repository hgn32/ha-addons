# hgn32 HA Addons

[![Open your Home Assistant instance and show the add add-on repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fhgn32%2Fha-addons)

Home Assistant 用のカスタムアドオンリポジトリです。

## アドオン一覧

### [Discord Chat Cleanup Bot](./discord-cleanup)

指定した Discord チャンネルの古いメッセージを毎日自動削除します。

### [Stock Manager](./stock-manager)

在庫管理 Web アプリです。品目・カテゴリ・置き場・購入先のマスタ管理、在庫追加・消費・強制メンテ、在庫履歴、Amazon 購入履歴の自動取込に対応しています。

### [Nginx Gateway](./nginx-gateway)

リバースプロキシとして動作する Nginx Gateway アドオンです。

### [Suwayomi Server](./suwayomi-server)

[Mihon](https://mihon.app/) 互換のセルフホスト型マンガサーバー [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) を Home Assistant アドオンとして動作させます。

### [Suwayomi Summary](./suwayomi-summary)

Suwayomi / Mihon の `.tachibk` バックアップファイルを Web ブラウザで閲覧できるビューワーです。

### [VOICEVOX Engine](./voicevox)

[VOICEVOX](https://voicevox.hiroshiba.jp/) 音声合成エンジンを Home Assistant アドオンとして動作させます。HA の TTS（音声読み上げ）として使うには、companion インテグレーション **[hgn32/ha-voicevox-tts](https://github.com/hgn32/ha-voicevox-tts)** を HACS でインストールしてください。アドオン起動時に自動検知されます。

## インストール方法

1. Home Assistant の **設定 → アドオン → アドオンストア** を開く
2. 右上のメニューから **リポジトリを追加** を選択
3. 以下の URL を入力して追加する

```
https://github.com/hgn32/ha-addons
```

または上部のバッジをクリックして自動追加することもできます。

## ライセンス

[MIT License](./LICENSE)
