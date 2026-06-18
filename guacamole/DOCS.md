# Guacamole アドオン 詳細ドキュメント

## アーキテクチャ

```
HA ingress ──▶ nginx(:8099) ──▶ Tomcat(:8080, ROOT.war = Guacamole Web)
                                     │
                              guacd(:4822, 内部) ──▶ RDP/VNC/SSH/Telnet
                                     │
                              外部 PostgreSQL (pg_host:pg_port)
```

- 実体は upstream `abesnier/guacamole:1.6.0-alpine-pg17`（guacd + Tomcat + Guacamole を **s6-overlay** で管理）。
- **PostgreSQL は外部サーバを使用します**（同梱しません）。
- 本アドオンのエントリポイント `ha-run.sh` はアドオン設定を反映したあと `/init` を exec します。
  追加プロセス（**ingress 用 nginx**）も `/etc/services.d` 配下の **s6 サービス**として起動します。
- `GUACAMOLE_HOME` は `/var/lib/guac-home`（揮発領域）。起動のたびに再生成されます。
  設定ファイル `guacamole.properties` は `/config` には保存されません。

## ファイルパスについて

コンテナ内の `/config/` は、HA ホスト上では `/addon_configs/[hash]_guacamole/` に対応します（hash はリポジトリ URL から決まる固定値）。

| コンテナ内パス | HA ホスト上のパス（例） | 用途 |
|---|---|---|
| `/config/backup/` | `/addon_configs/xxxx_guacamole/backup/` | pg_dump の保存先 |
| `/config/restore.dump` | `/addon_configs/xxxx_guacamole/restore.dump` | リストア用ファイル |

## ログイン画面のバイパス（ingress 自動ログイン）

`ingress_auto_login: true`（既定）のとき、Guacamole の `auth-header` 拡張を有効化し、
nginx が固定ユーザ名を `X-WEBAUTH-USER` ヘッダで付与することで**ログイン画面を省略**します。

- HA ingress は既に Home Assistant のログインで保護されているため、Guacamole 側の
  ログインは冗長です。これを省略して直接ダッシュボードに入れます。
- nginx は `X-WEBAUTH-USER` を**常に上書き**します。クライアントが同名ヘッダを送っても
  無視されるため、なりすましはできません。
- Tomcat(:8080) は**ホストに公開していません**（ingress 経由 = nginx 経由のみ）。

無効化（通常のログイン画面に戻す）するには `ingress_auto_login: false` にします。

> セキュリティ上の注意: 自動ログインを有効にしたまま Tomcat ポートを別途ホスト公開しないでください。

## 拡張（プラグイン）

イメージには Guacamole の各拡張 jar が同梱されていますが、既定では**コアの
PostgreSQL 認証のみ**が有効です。`extensions` に名前を列挙したものだけが有効化されます。

| 値 | 内容 |
|---|---|
| `auth-totp` | TOTP 二要素認証 |
| `auth-header` | ヘッダ認証（自動ログイン有効時は自動で追加） |
| `auth-ldap` | LDAP 認証 |
| `auth-json` | JSON 認証 |
| `auth-quickconnect` | クイック接続 |
| `auth-ban` | 総当たり対策（一時 BAN） |
| `auth-sso-openid` / `auth-sso-saml` / `auth-sso-cas` | SSO |
| `auth-jdbc-mysql` / `auth-jdbc-sqlserver` | 追加 DB 認証 |
| `display-statistics` | 画面統計表示 |
| `history-recording-storage` | セッション録画の保存 |
| `vault-ksm` | Keeper Secrets Manager |

各拡張固有の設定（LDAP のサーバ等）は Guacamole の管理画面または `guacamole.properties` に追記してください。

### クイック接続（auth-quickconnect）

`extensions` に `auth-quickconnect` を加えると、ホーム画面の入力欄に接続 URI を直接入力して
その場で接続できます（接続は保存されません）。URI の書式と例は [README](./README.md) の
「クイック接続」を参照してください。

## バックアップ / リストア

Guacamole の設定（接続・ユーザ・権限など）は外部 PostgreSQL に保存されます。

### バックアップ（自動）

以下の 2 タイミングで `pg_dump`（カスタム形式）を実行し、
`/config/backup/guacamole_db_YYYYMMDD_HHMMSS.dump` を生成します（最新 1 件保持）。

| タイミング | 条件 |
|---|---|
| **起動時** | リストアが実行されなかった場合 |
| **HA バックアップ時** | `backup_pre` フックにより常に実行 |

- `backup_enabled: false` でダンプをスキップします
- `vacuum_logs_on_backup: true` でダンプ前に接続履歴テーブルを TRUNCATE します

### リストア

`/config/restore.dump`（HA ホスト上: `/addon_configs/[hash]_guacamole/restore.dump`）を置いてアドオンを再起動するとリストアが実行されます。

1. `pg_restore --clean --if-exists` で既存データを上書きしてリストア
2. 成功時: `/config/restore.dump` を自動削除
3. 失敗時: ファイルを保持（次回起動時に再試行）

> **注意**: リストアは既存データを上書きします。事前にバックアップを確認してください。

## トラブルシュート

- **画面が真っ白 / リソースが 404**: ブラウザのキャッシュを消して再読込してください。
- **自動ログインされない**: `ingress_auto_login_user` のユーザが DB に存在するか確認してください（自動ログイン有効時は `auth-header` が自動で有効化されます）。
- **リモート接続が繋がらない**: 接続先ホストへ guacd（コンテナ）から到達できるか、ネットワーク到達性とポートを確認してください。
- **pg_dump が失敗する**: ログで `server version` を確認してください。外部 PostgreSQL のバージョンとイメージのバージョンが一致している必要があります（本アドオンは PostgreSQL 17 対応）。
