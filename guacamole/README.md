# Guacamole

[Apache Guacamole](https://guacamole.apache.org/) は、ブラウザだけで RDP / VNC / SSH / Telnet に接続できるクライアントレス・リモートデスクトップゲートウェイです。
[`abesnier/guacamole`](https://github.com/MaxWaldorf/guacamole) をそのまま利用し、Home Assistant 連携に必要なレイヤだけを足しています。

**PostgreSQL は同梱せず、外部サーバを使用します。** 事前に PostgreSQL アドオン（または任意の PG サーバ）を用意してください。

## 主な機能

- HA サイドバーから ingress でアクセス（ポート開放不要）
- ingress 経由の**自動ログイン**（Guacamole のログイン画面を省略）
- 拡張プラグインを設定で追加（TOTP / LDAP / SSO / クイック接続 など）
- 起動時にスキーマ未初期化の DB を自動検知して SQL を適用
- HA バックアップ時に外部 PG を `pg_dump` して `/config/backup/` へ保存（On/Off 可）

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
| `backup_enabled` | bool | `true` | HA バックアップ時に pg_dump を取得して `/config/backup/` に保存する |
| `extensions` | list | `[]` | 有効化する拡張。例: `auth-totp`, `auth-ldap`, `auth-sso-openid`, `vault-ksm` など |
| `ingress_auto_login` | bool | `true` | ingress 経由時に Guacamole のログイン画面をバイパスして自動ログインする |
| `ingress_auto_login_user` | str | `guacadmin` | 自動ログインするユーザ名（DB に存在する必要あり） |
| `tz` | str | `UTC` | タイムゾーン |

> 初期ログインは `guacadmin` / `guacadmin` です。`ingress_auto_login` を有効にしたままでも、**最初に必ずパスワードを変更**してください。

## バックアップの考え方

- **HA バックアップ時**: `backup_pre` フックで `pg_dump`（カスタム形式）を実行し、
  `/config/backup/guacamole_db.dump` を生成してから HA スナップショットに含める
- **バックアップされる**: `/config/backup/guacamole_db.dump`（DB 全体のダンプ）
- **バックアップされない**: Guacamole の実行バイナリ・拡張 jar・ログ
- `backup_enabled: false` に設定するとダンプをスキップする（外部 PG 側でバックアップを管理する場合）

### ダンプのリストア

バックアップから Guacamole のデータを復元するには、外部 PG サーバに対して手動で実行します。

```sh
pg_restore -h <PG_HOST> -p 5432 -U postgres -d guacamole_db \
    --no-owner --clean /config/backup/guacamole_db.dump
```

## クイック接続（auth-quickconnect）

接続を事前に定義しなくても、**接続文字列（URI）をその場で入力**して即座にリモート接続
できる機能です。一時的な接続やテストに便利です。

### 有効化

`extensions` に `auth-quickconnect` を追加します。

```yaml
extensions:
  - auth-quickconnect
```

有効化すると、Guacamole のホーム画面に **Quick Connect** の入力欄が表示されます。

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

- `?` 以降には Guacamole の接続パラメータをそのまま指定できます
  （例: `width`, `height`, `color-depth`, `disable-audio`, `enable-wallpaper` など）。
- クイック接続は**保存されません**（その場限り）。常用する接続は通常どおり接続定義として
  保存してください。
- 接続先は guacd（このコンテナ）から名前解決・到達できる必要があります。
- 自動ログイン（`ingress_auto_login`）有効時は、ログインユーザに接続を作成できる権限が必要です。

詳細は [DOCS.md](./DOCS.md) を参照してください。
