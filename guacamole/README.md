# Guacamole

[Apache Guacamole](https://guacamole.apache.org/) は、ブラウザだけで RDP / VNC / SSH / Telnet に接続できるクライアントレス・リモートデスクトップゲートウェイです。本アドオンは [alexbelgium/hassio-addons](https://github.com/alexbelgium/hassio-addons/tree/master/guacamole) を参考にしつつ、**軽量化**して再構成したものです。

実体（guacd + Tomcat + Guacamole + 内蔵 PostgreSQL）は upstream の [`abesnier/guacamole`](https://github.com/MaxWaldorf/guacamole) をそのまま利用し、Home Assistant 連携に必要な薄いレイヤだけを足しています。

## 参考アドオンとの違い（軽量化ポイント）

- 大量のデバイス割当（GPU / video / 各種ストレージ）を**全廃**
- alexbelgium の重いテンプレート層（nginx-extras / syslog / automodules / banner 等）を**不採用**
- 拡張（プラグイン）は既定で**最小限（コアの PostgreSQL 認証のみ）**。必要なものだけ設定で有効化
- ベースを軽量な **alpine** ビルド（`1.6.0-alpine-pg16`）に固定
- **ログイン画面のバイパス**（HA ingress 経由の自動ログイン）に対応

## 主な機能

- HA サイドバーから ingress でアクセス（ポート開放不要）
- ingress 経由の**自動ログイン**（Guacamole のログイン画面を省略）
- 拡張プラグインを設定で追加（TOTP/LDAP/SSO など）
- **設定のみ**をバックアップ（postgres 本体・プラグイン・ログは除外）
- PostgreSQL に溜まるログ（接続履歴・ログイン履歴）を**cron で定期削除**

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
3. **Guacamole** を選択して **インストール**
4. 起動後、サイドバーの **Guacamole** を開く

## アドオン設定

| 設定キー | 型 | 既定値 | 説明 |
|---|---|---|---|
| `extensions` | list | `[]` | 有効化する拡張。例: `auth-totp`, `auth-ldap`, `auth-sso-openid`, `vault-ksm` など |
| `ingress_auto_login` | bool | `true` | ingress 経由時に Guacamole のログイン画面をバイパスして自動ログインする |
| `ingress_auto_login_user` | str | `guacadmin` | 自動ログインするユーザ名（DB に存在する必要あり） |
| `tz` | str | `UTC` | タイムゾーン |
| `log_cleanup_schedule` | str | `0 18 * * *` | DB 内ログ削除の cron（**UTC**）。空にすると無効。既定は 03:00 JST |
| `log_retention_days` | int | `30` | この日数より古い接続/ログイン履歴を削除 |
| `backup_database` | bool | `true` | バックアップに設定の論理ダンプ（接続・ユーザ等）を含める |
| `auto_restore_settings` | bool | `true` | 空の DB に対し、バックアップした設定を自動で取り込む |

> 初期ログインは `guacadmin` / `guacadmin` です。`ingress_auto_login` を有効にしたままでも、**最初に必ずパスワードを変更**してください。

## バックアップの考え方

- **バックアップされる**: `guacamole.properties` と、設定（接続・ユーザ・権限など）の論理ダンプ
- **バックアップされない**: PostgreSQL データ本体 / 拡張 jar / 各種ログ / 履歴テーブルのデータ

詳細は [DOCS.md](./DOCS.md) を参照してください。
