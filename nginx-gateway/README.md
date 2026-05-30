# Nginx Gateway

Nginx をベースにしたリバースプロキシ・ゲートウェイアドオンです。HTTPS・MQTTs・WireGuard のエンドポイントを一括で公開できます。

## 機能

- HTTPS リバースプロキシ
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

## 設定ファイル

Nginx の設定は HA の `share` フォルダ経由でマウントされます。SSL 証明書は `ssl` フォルダ（読み取り専用）から参照できます。
