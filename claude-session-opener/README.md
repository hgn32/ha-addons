# Claude Session Opener

Claude Pro/Max サブスクリプションの「5時間セッション制限」を、毎朝決まった時刻を
起点にリセットさせるため、最小トークンのタスクを自動送信する Home Assistant
アドオンです。サブスクリプション（OAuth）ログインを使い、API キーは使いません。
実際にセッションがリセットされているかは `claude` の `/usage` で確認できます。

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
3. **Claude Session Opener** を選択して **インストール**

## 初回セットアップ（ログイン）

初回のみサブスクリプションアカウントでのログインが必要です。

1. アドオンを起動する
2. サイドバーの **「Claude Login」** パネルを開く
3. **「ログインを開始」** → 表示された URL をブラウザで開いてログイン
4. ログイン後に表示される認証コードをパネルに貼り付けて **「送信」**

認証情報は `/data/claude-credentials/` に保存され、コンテナを再起動しても
維持されます。

Web Terminal 等が使える場合は、コンテナに入って直接ログインすることもできます。

```
docker exec -it addon_claude_session_opener /bin/bash
claude auth login --claudeai
```

## 設定

アドオンの **設定** タブで `schedule_time`（`HH:MM`、**UTC**）を指定します。
デフォルトは `07:00`（UTC）です。日本時間の朝7時にしたい場合は `22:00`
（前日の UTC 22:00 = JST 07:00）にしてください。

```yaml
schedule_time: "07:00"
```

## データ・ログのパス

| 種類 | パス |
|---|---|
| 認証情報 | `/data/claude-credentials/`（コンテナ再起動後も維持） |
| 実行ログ | `/data/session_opener.log` および HA のアドオンログ |
| ログイン画面 | サイドバーの **「Claude Login」** パネル（Ingress 経由） |

ログには API キーや認証トークンは一切出力しません。
