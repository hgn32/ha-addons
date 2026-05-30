# Discord Chat Cleanup Bot

指定した Discord チャンネルの古いメッセージを毎日自動削除する Home Assistant アドオンです。

## 機能

- 指定チャンネルの古いメッセージを毎日定刻に自動削除
- 保持日数・実行時刻を設定可能
- `dry_run` モードで実際には削除せず動作確認が可能

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
3. **Discord Chat Cleanup Bot** を選択して **インストール**

## 設定

| オプション | 説明 | デフォルト |
|---|---|---|
| `bot_token` | Discord Bot のトークン | （必須） |
| `channel_ids` | 削除対象のチャンネル ID リスト | （必須） |
| `keep_days` | 何日以上前のメッセージを削除するか | `30` |
| `run_hour` | 実行時刻（時）| `3` |
| `run_minute` | 実行時刻（分）| `0` |
| `dry_run` | `true` にすると削除せず対象を表示するだけ | `false` |

## データ・ログのパス

このアドオンはステートレスで動作します。設定はすべて HA のアドオン設定画面で管理されます。

| 種類 | パス |
|---|---|
| アドオン設定 | HA の **設定 → アドオン → Discord Chat Cleanup Bot → 設定** タブ |
| 実行ログ | HA の **設定 → アドオン → Discord Chat Cleanup Bot → ログ** タブ |

## Discord Bot の準備

1. [Discord Developer Portal](https://discord.com/developers/applications) で Bot を作成
2. **Bot** ページでトークンを取得
3. Bot に以下の権限を付与して招待
   - `Read Message History`
   - `Manage Messages`
