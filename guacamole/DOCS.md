# Guacamole アドオン 詳細ドキュメント

## アーキテクチャ

```
HA ingress ──▶ nginx(:8099) ──▶ Tomcat(:8080, ROOT.war = Guacamole Web)
                                     │
                              guacd(:4822, 内部) ──▶ RDP/VNC/SSH/Telnet
                                     │
                              PostgreSQL(:5432, 内部, /config/postgres)
```

- 実体は upstream `abesnier/guacamole:1.6.0-alpine-pg16`（guacd + Tomcat + Guacamole + 内蔵 PostgreSQL を supervisord で管理）。
- 本アドオンはそこに **ingress 用 nginx** と、**設定読み取り / ログ削除 cron / 設定バックアップ** を行う薄いスクリプト群を足しているだけです。
- データはすべて addon_config（`/config`）配下に永続化されます。
  - `/config/postgres` … PostgreSQL データ本体
  - `/config/guacamole/guacamole.properties` … Guacamole 設定ファイル
  - `/config/guacamole/extensions*`, `lib`, `schema` … 拡張・ライブラリ・スキーマ
  - `/config/settings/guacamole_settings.sql.gz` … バックアップ用の設定ダンプ

## ログイン画面のバイパス（ingress 自動ログイン）

`ingress_auto_login: true`（既定）のとき、Guacamole の `auth-header` 拡張を有効化し、
nginx が固定ユーザ名を `X-WEBAUTH-USER` ヘッダで付与することで**ログイン画面を省略**します。

- HA ingress は既に Home Assistant のログインで保護されているため、Guacamole 側の
  ログインは冗長です。これを省略して直接ダッシュボードに入れます。
- nginx は `X-WEBAUTH-USER` を**常に上書き**します。クライアントが同名ヘッダを送っても
  無視されるため、なりすましはできません。
- Tomcat(:8080) は**ホストに公開していません**（ingress 経由＝nginx 経由のみ）。
  そのためヘッダ認証を悪用する経路はありません。

無効化（通常のログイン画面に戻す）するには `ingress_auto_login: false` にします。

> セキュリティ上の注意: 自動ログインを有効にしたまま Tomcat ポートを別途ホスト公開しないでください。

## 拡張（プラグイン）

イメージには Guacamole の各拡張 jar が同梱されていますが、既定では**コアの
PostgreSQL 認証のみ**が有効です。`extensions` に名前を列挙したものだけが有効化されます。

指定できる主な値:

| 値 | 内容 |
|---|---|
| `auth-totp` | TOTP 二要素認証 |
| `auth-header` | ヘッダ認証（自動ログイン有効時は自動で追加されます） |
| `auth-ldap` | LDAP 認証 |
| `auth-json` | JSON 認証 |
| `auth-quickconnect` | クイック接続 |
| `auth-ban` | 総当たり対策（一時 BAN） |
| `auth-sso-openid` / `auth-sso-saml` / `auth-sso-cas` | SSO |
| `auth-jdbc-mysql` / `auth-jdbc-sqlserver` | 追加 DB 認証 |
| `display-statistics` | 画面統計表示 |
| `history-recording-storage` | セッション録画の保存 |
| `vault-ksm` | Keeper Secrets Manager |

各拡張固有の設定（LDAP のサーバ等）は `guacamole.properties` に追記してください。

## バックアップ / リストア

Guacamole の「設定」（接続・ユーザ・権限など）は PostgreSQL の中に保存されます。
そこで本アドオンは次の方針を取ります。

### バックアップに**含める**もの（= 設定）

- `guacamole.properties`
- 設定の論理ダンプ `guacamole_settings.sql.gz`
  - バックアップ直前(`backup_pre`)に `pg_dump --data-only` で自動生成
  - **履歴(ログ)テーブルのデータは除外**（`guacamole_connection_history` /
    `guacamole_user_history`）

### バックアップから**除外**するもの

`backup_exclude` により以下を除外します（ディレクトリごとスキップ）。

- `*/postgres*` … PostgreSQL データ本体（postgres 本体）
- `*/extensions*`, `*/lib`, `*/schema` … プラグイン・ライブラリ・スキーマ
- `*/db_check`, `*/recordings`, `*/logs` … 各種ログ・録画・状態

結果として、HA のバックアップには**設定だけ**が入り、軽量になります。

### リストア時の動作

1. バックアップを復元すると `guacamole.properties` と設定ダンプが戻ります
   （PostgreSQL データ本体は除外されているため空のまま）。
2. アドオン起動時、PostgreSQL が空であることを検出すると新規クラスタを初期化し、
   スキーマを適用します。
3. その後、設定ダンプを**自動で取り込みます**（`auto_restore_settings: true` のとき）。
   - 安全装置として、**接続定義が 1 件でも存在する DB には絶対に取り込みません**
     （データ消失防止）。
   - ダンプのバージョンと現行 Guacamole のバージョンが異なる場合は自動取り込みを
     見送ります（下記の手動手順を利用してください）。

### 手動リストア

```bash
# アドオンのコンテナ内で
gunzip -c /config/settings/guacamole_settings.sql.gz \
  | PGPASSWORD="$(grep '^postgresql-password:' /config/guacamole/guacamole.properties | sed 's/^postgresql-password:[[:space:]]*//')" \
    psql -h 127.0.0.1 -U guacamole -d guacamole_db
```

## PostgreSQL 内ログの定期削除

Guacamole は接続/ログインの履歴を PostgreSQL に蓄積します。これを cron で定期削除します。

- 実行タイミング: `log_cleanup_schedule`（**UTC** の cron 式。既定 `0 18 * * *` = 03:00 JST）
- 保持日数: `log_retention_days`（既定 30 日）
- 対象テーブル: `guacamole_connection_history`, `guacamole_user_history`
- `log_cleanup_schedule` を空にすると無効化されます。

## トラブルシュート

- **画面が真っ白 / リソースが 404**: ingress は base href を持たない Guacamole の
  相対パス構成で動作します。ブラウザのキャッシュを消して再読込してください。
- **自動ログインされない**: `ingress_auto_login_user` のユーザが DB に存在するか、
  `auth-header` が有効か確認してください（自動ログイン有効時は自動で有効化されます）。
- **リモート接続が繋がらない**: 接続先ホストへ guacd（コンテナ）から到達できるか、
  ネットワーク到達性とポートを確認してください。
