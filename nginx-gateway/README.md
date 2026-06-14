# Nginx Gateway

Nginx をベースにしたリバースプロキシ・ゲートウェイアドオンです。GeoIP2 による国別アクセス制御、HTTPS・MQTTs・WireGuard のエンドポイントを一括で公開できます。

## 機能

- HTTPS リバースプロキシ（GeoIP2 による国別フィルタリング）
- MQTTs（MQTT over TLS）中継
- WireGuard VPN エンドポイント
- HA の `ssl` フォルダの証明書を直接利用可能

## 対応アーキテクチャ

| アーキテクチャ | 対応状況 |
|---|---|
| amd64 | ✅ |
| aarch64 | ❌ |

## インストール

1. Home Assistant の **設定 → アドオン → アドオンストア** を開く
2. 右上のメニューから **リポジトリを追加** を選択し、以下の URL を入力する
   ```
   https://github.com/hgn32/ha-addons
   ```
3. **Nginx Gateway** を選択して **インストール**

## ポート

| ポート | 用途 |
|---|---|
| `443/tcp` | HTTPS |
| `8883/tcp` | MQTTs |
| `51820/udp` | WireGuard |

## アドオン設定

| 設定キー | 型 | 既定値 | 説明 |
|---|---|---|---|
| `geoip_account_id` | str | （空） | MaxMind アカウント ID |
| `geoip_license_key` | password | （空） | MaxMind ライセンスキー（マスク表示） |
| `geoip_update_schedule` | str | `0 18 * * *` | GeoIP DB の自動更新スケジュール（cron 式・**UTC**）。空にすると定期更新を無効化 |
| `geoip_reload_nginx` | bool | `true` | 定期更新が成功したとき `nginx -s reload` で新 DB を反映するか |

`geoip_account_id` / `geoip_license_key` はどちらも省略可能です。省略した場合は `/share/nginx/GeoIP.conf` を使います（後述）。

> **設定の注意事項**
> - `geoip_update_schedule` は **UTC** で解釈されます（JST ではありません）。既定の `0 18 * * *` は毎日 18:00 UTC（= 03:00 JST ＝ `0 3 * * *`）。
> - スケジュールを空文字にすると定期更新は無効になり、**起動時の1回のみ**更新します。
> - 設定を変更した場合は**アドオンの再起動**で反映されます（スケジュールは起動時に登録されるため）。
> - `geoip_reload_nginx` を `false` にすると DB は更新されますが nginx には即時反映されず、次回の nginx／アドオン再起動時に反映されます。
> - 更新の実行ログはアドオンの **ログ** タブに `[geoip-refresh] ...` として表示されます。

## 設定ファイルの配置

設定ファイルは HA の `/share/nginx/` ディレクトリに置きます。起動前に以下の構成を用意してください。

```
/share/nginx/
├── nginx.conf               # メイン設定（必須）
├── GeoIP.conf               # MaxMind 認証情報（アドオン設定で代替可）
├── http/
│   ├── default.conf         # デフォルト（マッチしないホストを遮断）
│   ├── homeassistant.conf   # HA 本体の公開設定（例）
│   └── *.conf               # その他サービスごとに追加
└── stream/
    ├── reject.js            # GeoIP チェック用 JS
    ├── mqtt.conf            # MQTTs 設定（使う場合）
    └── wireguard.conf       # WireGuard 設定（使う場合）
```

> **注意**: `stream/` 配下のファイルはすべて `include` されます。使わない設定ファイルは置かないか、拡張子を `.conf` 以外にしてください（例: `mqtt.conf_`）。

### SSL 証明書

HA の `/ssl/` フォルダを読み取り専用でマウントしています。Let's Encrypt 等で取得した証明書を以下のパスに配置してください。

| パス | 内容 |
|---|---|
| `/ssl/fullchain.pem` | 証明書チェーン |
| `/ssl/privkey.pem` | 秘密鍵 |

### GeoIP2 データベース

`GeoLite2-Country.mmdb` はアドオン起動時に `geoipupdate` が自動ダウンロードします。さらに、アドオン稼働中も `geoip_update_schedule`（cron 式・既定は毎日 18:00 UTC = 03:00 JST）に従って**自動で更新**し、`geoip_reload_nginx` が有効なら更新成功時に `nginx -s reload` で新しいデータベースを反映します。事前に以下を準備してください。

1. [MaxMind](https://www.maxmind.com/) でアカウントを作成し、ライセンスキーを発行する
2. アドオンの **設定** タブで `geoip_account_id` と `geoip_license_key` を入力する
3. アドオンを起動すると `/var/lib/geoip/GeoLite2-Country.mmdb` が自動生成される（コンテナ内・バックアップ対象外）

> **保存先とバックアップ**: `GeoLite2-Country.mmdb` は HA のバックアップに含めないよう、`/share` ではなく**コンテナ内の `/var/lib/geoip/`** に保存します。起動時に `geoipupdate` が毎回再取得するため永続化は不要で、アドオン再起動で消えても問題ありません。nginx の `geoip2` ディレクティブも `/var/lib/geoip/GeoLite2-Country.mmdb` を指す必要があります（[サンプル](./sample/nginx.conf)参照）。

> **代替**: アドオン設定に入力せず、`/share/nginx/GeoIP.conf` を手動で配置することもできます（[サンプル](./sample/GeoIP.conf)参照）。両方ある場合はアドオン設定が優先されます。

## サンプル設定

[`sample/`](./sample/) ディレクトリにサンプル設定を用意しています。`example.com` や `192.168.1.100` を実際の値に置き換えて使用してください。

| ファイル | 内容 |
|---|---|
| `sample/nginx.conf` | メイン設定（GeoIP・SSL・プロキシ共通設定） |
| `sample/GeoIP.conf` | MaxMind アカウント設定のテンプレート |
| `sample/http/default.conf` | マッチしないホストを 444 で遮断 |
| `sample/http/homeassistant.conf` | HA 本体を公開する例 |
| `sample/http/myservice.conf` | 任意のサービスを公開する例 |
| `sample/stream/reject.js` | 海外IPを stream レベルで拒否する NJS スクリプト |
| `sample/stream/mqtt.conf` | MQTTs 中継の例 |
| `sample/stream/wireguard.conf` | WireGuard 中継の例 |
