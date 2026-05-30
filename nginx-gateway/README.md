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

## 設定ファイルの配置

設定ファイルは HA の `/share/nginx/` ディレクトリに置きます。起動前に以下の構成を用意してください。

```
/share/nginx/
├── nginx.conf               # メイン設定
├── GeoIP.conf               # MaxMind GeoIP2 アカウント設定
├── GeoLite2-Country.mmdb    # GeoIP2 データベース（要ダウンロード）
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

[MaxMind](https://www.maxmind.com/) のアカウントを作成し、`GeoLite2-Country.mmdb` を取得して `/share/nginx/` に配置してください。`GeoIP.conf` にアカウント情報を記載することで `geoipupdate` による自動更新も可能です。

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
