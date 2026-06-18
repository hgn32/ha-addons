# Guacamole

[Apache Guacamole](https://guacamole.apache.org/) は、ブラウザだけで RDP / VNC / SSH / Telnet に接続できるクライアントレス・リモートデスクトップゲートウェイです。
[`abesnier/guacamole`](https://github.com/MaxWaldorf/guacamole) をそのまま利用し、Home Assistant 連携に必要なレイヤだけを足しています。

**PostgreSQL は同梱せず、外部サーバを使用します。** 事前に PostgreSQL アドオン（または任意の PG サーバ）を用意してください。

## 主な機能

- HA サイドバーから ingress でアクセス（ポート開放不要）
- ingress 経由の**自動ログイン**（Guacamole のログイン画面を省略）
- 拡張プラグインを設定で追加（TOTP / LDAP / SSO / クイック接続 など）
- 起動時にスキーマ未初期化の DB を自動検知して SQL を適用
- **起動時に自動バックアップ**（リストア直後を除く）
- HA バックアップ時に外部 PG を `pg_dump` して `/config/backup/` へ保存
- バックアップ前に接続履歴を削除してバックアップサイズを削減（オプション）
- `/config/restore.dump` を置いて起動するとデータを上書きリストア

## 対応アーキテクチャ

| アーキテクチャ | 対応状況 |
|---|---|
| amd64 | ✅ |
| aarch64 | ✅ |

## インストール

1. **PostgreSQL アドオンを先にインストール・起動**しておく
   （推奨: `db21ed7f-postgres-latest`。データベース `guacamole_db` は自動作成される）
2. Home Assistant の **設定 → アドオン → アドオンストア** を開く
3. 右上のメニューから **リポジトリを追加** を選択し、以下の URL を入力する
   ```
   https://github.com/hgn32/ha-addons
   ```
4. **Guacamole** を選択して **インストール**
5. `pg_host` など接続設定を確認して **起動**
6. 起動後、サイドバーの **Guacamole** を開く

## アドオン設定

| 設定キー | 型 | 既定値 | 説明 |
|---|---|---|---|
| `pg_host` | str | `db21ed7f-postgres-latest` | PostgreSQL サーバのホスト名（空にすると起動エラー） |
| `pg_port` | int | `5432` | PostgreSQL ポート番号 |
| `pg_user` | str | `postgres` | 接続ユーザ名 |
| `pg_password` | password | （空） | 接続パスワード |
| `pg_database` | str | `guacamole_db` | 使用するデータベース名 |
| `backup_enabled` | bool | `true` | 起動時および HA バックアップ時に pg_dump を取得して `/config/backup/` に保存する |
| `vacuum_logs_on_backup` | bool | `false` | バックアップ前に接続履歴テーブルをデータベースから削除する（バックアップサイズ削減） |
| `extensions` | list | `[]` | 有効化する拡張。例: `auth-totp`, `auth-ldap`, `auth-sso-openid`, `vault-ksm` など |
| `ingress_auto_login` | bool | `true` | ingress 経由時に Guacamole のログイン画面をバイパスして自動ログインする |
| `ingress_auto_login_user` | str | `guacadmin` | 自動ログインするユーザ名（DB に存在する必要あり） |

> 初期ログインは `guacadmin` / `guacadmin` です。`ingress_auto_login` を有効にしたままでも、**最初に必ずパスワードを変更**してください。

## バックアップとリストアの流れ

### バックアップ（自動）

バックアップは以下の 2 つのタイミングで実行されます。

| タイミング | 条件 |
|---|---|
| **起動時** | リストアが実行されなかった場合（通常再起動・設定変更など） |
| **HA バックアップ時** | `backup_pre` フックにより常に実行 |

どちらの場合も `pg_dump`（カスタム形式）を実行し、`/config/backup/guacamole_db_YYYYMMDD_HHMMSS.dump` を生成します（最新 1 件のみ保持）。

- `backup_enabled: false` に設定するとダンプをスキップします
- `vacuum_logs_on_backup: true` にすると、ダンプ前に接続履歴テーブルを TRUNCATE します

### リストア

`/config/restore.dump` を配置してアドオンを再起動するとリストアが実行されます。

**手順**

1. リストアしたい pg_dump ファイルを `/config/restore.dump` として配置する
2. アドオンを再起動する
3. 起動時に既存データを消去して `/config/restore.dump` からリストアされる
4. リストア成功後、`/config/restore.dump` は自動的に削除される

> **注意**: リストアは既存データを上書きします。事前にバックアップを取っておくことを推奨します。
> リストアに失敗した場合は `/config/restore.dump` が残り、次回起動時に再試行されます。

## クイック接続（auth-quickconnect）

接続を事前に定義しなくても、**接続文字列（URI）をその場で入力**して即座にリモート接続
できる機能です。一時的な接続やテストに便利です。

### 有効化

`extensions` に `auth-quickconnect` を追加します。

```yaml
extensions:
  - auth-quickconnect
```

### 使い方（URI の書式）

```
protocol://[ユーザ[:パスワード]@]ホスト[:ポート][?パラメータ1=値1&パラメータ2=値2]
```

| 入力例 | 説明 |
|---|---|
| `ssh://192.168.1.10` | SSH（既定ポート 22） |
| `ssh://user@192.168.1.10` | ユーザ名つき SSH |
| `rdp://user:pass@192.168.1.20:3389?security=nla&ignore-cert=true` | NLA 有効・証明書無視の RDP |
| `vnc://192.168.1.30:5900?password=secret` | VNC |
| `telnet://10.0.0.5` | Telnet |

- クイック接続は**保存されません**（その場限り）。常用する接続は通常どおり接続定義として
  保存してください。
- 自動ログイン（`ingress_auto_login`）有効時は、ログインユーザに接続を作成できる権限が必要です。

詳細は [DOCS.md](./DOCS.md) を参照してください。
