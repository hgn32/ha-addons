# Guacamole アドオン 詳細ドキュメント

## アーキテクチャ

```
HA ingress ──▶ nginx(:8099) ──▶ Tomcat(:8080, ROOT.war = Guacamole Web)
                                     │
                              guacd(:4822, 内部) ──▶ RDP/VNC/SSH/Telnet
                                     │
                              PostgreSQL(:5432, 内部, /config/postgres)
```

- 実体は upstream `abesnier/guacamole:1.6.0-alpine-pg16`（guacd + Tomcat + Guacamole + 内蔵 PostgreSQL を **s6-overlay**(`/init`) で管理）。
- 本アドオンのエントリポイント `ha-run.sh` はアドオン設定を反映したあと `/init` を exec します。
  追加プロセス（**ingress 用 nginx** / メンテナンス **cron** / 設定 **restore**）も supervisord ではなく
  `/etc/services.d` 配下の **s6 サービス**として起動します。
- データはすべて addon_config（`/config`）配下に永続化されます。
  - `/config/postgres` … PostgreSQL データ本体
  - `/config/guacamole/guacamole.properties` … Guacamole 設定ファイル
  - `/config/guacamole/extensions*`, `lib`, `schema` … 拡張・ライブラリ・スキーマ
  - `<backup_path>/guacamole_settings.sql.gz` … バックアップ用の設定ダンプ（`backup_path` 既定 `/config/guacamole`）

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

### 拡張 jar の所在（イメージ同梱だが /config に展開される）

拡張 jar は**イメージにビルド時同梱**されています（`/app/guacamole/extensions-available`）。
ベースイメージは起動時の初期化で `GUACAMOLE_HOME` を `/config/guacamole` とし、同梱物を
`/config/guacamole` 配下へ複製します。その後、`extensions` で選んだものだけが
`/config/guacamole/extensions` へ配置されて有効化されます。

- つまり jar は **`/config/guacamole/extensions*` に永続化されます**（`/data` ではありません）。
- ただし `backup_exclude`（`*/extensions*` ほか）により **HA バックアップからは除外**されます。
  リストア時はイメージ同梱分から再展開されるため、設定ダンプだけで復元できます。

### クイック接続（auth-quickconnect）

`extensions` に `auth-quickconnect` を加えると、ホーム画面の入力欄に接続 URI を直接入力して
その場で接続できます（接続は保存されません）。URI の書式と例は [README](./README.md) の
「クイック接続」を参照してください。

## バックアップ / リストア

Guacamole の「設定」（接続・ユーザ・権限など）は PostgreSQL の中に保存されます。
そこで本アドオンは次の方針を取ります。

### バックアップに**含める**もの（= 設定）

- `guacamole.properties`
- 設定の論理ダンプ `guacamole_settings.sql.gz`（`backup_path` 配下、既定 `/config/guacamole`）
  - `pg_dump --data-only` で生成
  - **履歴(ログ)テーブルのデータは除外**（`guacamole_connection_history` /
    `guacamole_user_history`）

### メンテナンス（ログ削除 → バックアップ）はワンセット

「ログのクリーンナップ → 設定ダンプ」をこの順で実行する 1 本の処理（`guac-backup.sh`）として
まとめてあり、次の 2 経路から呼ばれます。

- **HA の `backup_pre` フック** … HA がバックアップを取る直前に毎回実行。常に最新・整理済みの
  ダンプがスナップショットへ入ります。
- **`backup_schedule` の cron**（**UTC**、既定 `0 18 * * *` = 03:00 JST、空で無効） … 任意の時刻に
  定期実行。HA のバックアップ時刻の**少し前**に合わせると、整理済みの最新ダンプが確実に取り込まれます。

> `backup_database: false` のときはダンプを作らず、ログのクリーンナップのみ行います。

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

`backup_path`（既定 `/config/guacamole`）のダンプを取り込みます。

```bash
# アドオンのコンテナ内で（backup_path が既定の場合）
gunzip -c /config/guacamole/guacamole_settings.sql.gz \
  | PGPASSWORD="$(grep '^postgresql-password:' /config/guacamole/guacamole.properties | sed 's/^postgresql-password:[[:space:]]*//')" \
    psql -h 127.0.0.1 -U guacamole -d guacamole_db
```

## PostgreSQL 内ログの定期削除

Guacamole は接続/ログインの履歴を PostgreSQL に蓄積します。これを cron で定期削除します。

ログ削除は `backup_schedule` の cron（および `backup_pre` フック）で実行する
`guac-backup.sh` の第 1 ステップとして組み込まれています。

- 実行タイミング: `backup_schedule`（**UTC** の cron 式。既定 `0 18 * * *` = 03:00 JST）
- 保持日数: `log_retention_days`（既定 30 日）
- 対象テーブル: `guacamole_connection_history`, `guacamole_user_history`
- `backup_schedule` を空にすると定期実行は無効になりますが、HA バックアップ直前の
  `backup_pre` フック経由でのログ削除は引き続き実行されます。

## トラブルシュート

- **画面が真っ白 / リソースが 404**: ingress は base href を持たない Guacamole の
  相対パス構成で動作します。ブラウザのキャッシュを消して再読込してください。
- **自動ログインされない**: `ingress_auto_login_user` のユーザが DB に存在するか、
  `auth-header` が有効か確認してください（自動ログイン有効時は自動で有効化されます）。
- **リモート接続が繋がらない**: 接続先ホストへ guacd（コンテナ）から到達できるか、
  ネットワーク到達性とポートを確認してください。
