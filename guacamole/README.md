# Guacamole

[Apache Guacamole](https://guacamole.apache.org/) は、ブラウザだけで RDP / VNC / SSH / Telnet に接続できるクライアントレス・リモートデスクトップゲートウェイです。
[`abesnier/guacamole`](https://github.com/MaxWaldorf/guacamole) をそのまま利用し、Home Assistant 連携に必要なレイヤだけを足しています。

## 主な機能

- HA サイドバーから ingress でアクセス（ポート開放不要）
- ingress 経由の**自動ログイン**（Guacamole のログイン画面を省略）
- 拡張プラグインを設定で追加（TOTP / LDAP / SSO / クイック接続 など）
- **設定のみ**をバックアップ（postgres 本体・プラグイン・ログは除外）
- 「**ログのクリーンナップ → 設定バックアップ**」を 1 本の cron でまとめて実行
  （HA のバックアップ時刻に合わせやすい）

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
| `backup_schedule` | str | `0 18 * * *` | 「ログ削除 → 設定バックアップ」を行う cron（**UTC**）。空にすると無効。既定は 03:00 JST |
| `log_retention_days` | int | `30` | この日数より古い接続/ログイン履歴を削除 |
| `backup_path` | str | `/config/guacamole` | 設定バックアップ（ダンプ）の書き出し先ディレクトリ |
| `backup_database` | bool | `true` | バックアップに設定の論理ダンプ（接続・ユーザ等）を含める |
| `auto_restore_settings` | bool | `true` | 空の DB に対し、バックアップした設定を自動で取り込む |

> 初期ログインは `guacadmin` / `guacadmin` です。`ingress_auto_login` を有効にしたままでも、**最初に必ずパスワードを変更**してください。

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

## バックアップの考え方

- **バックアップされる**: `guacamole.properties` と、設定（接続・ユーザ・権限など）の論理ダンプ
  （ダンプの書き出し先は `backup_path`、既定 `/config/guacamole`）
- **バックアップされない**: PostgreSQL データ本体 / 拡張 jar / 各種ログ / 履歴テーブルのデータ
- HA のバックアップ直前（`backup_pre`）と `backup_schedule` の cron は、どちらも
  **ログのクリーンナップ → 設定ダンプ** をこの順で実行します。`backup_schedule` を HA の
  バックアップ時刻の少し前に合わせると、クリーンナップ済みの最新ダンプがスナップショットに入ります。

> 拡張（プラグイン）の jar はイメージに同梱され、起動時に `/config/guacamole/extensions` へ
> 展開されます（`/config` 配下に永続化されますが、バックアップ対象からは除外されます）。

詳細は [DOCS.md](./DOCS.md) を参照してください。
