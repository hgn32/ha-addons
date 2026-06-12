# WireGuard UI (Home Assistant add-on)

[ngoduykhanh/wireguard-ui](https://github.com/ngoduykhanh/wireguard-ui) を使った
WireGuard VPN サーバー + Web 管理画面のアドオンです。クライアントの追加・削除・
QR コード発行・設定ファイルダウンロードをすべてブラウザから行えます。

- WireGuard サーバー本体（`51820/udp`）と管理画面（`5000/tcp`）が 1 つのアドオンで動作
- スマホの WireGuard アプリは QR コードを読むだけで接続設定完了
- 設定・鍵・クライアント情報はアドオンの `/data` に永続化

## デフォルトログイン

| 項目 | 値 |
|---|---|
| ユーザー名 | `wireguardadmin` |
| パスワード | `adminwireguard` |

> [!IMPORTANT]
> `username` / `password` オプションは **初回起動時のみ** データベースに反映されます。
> 2 回目以降に変更したい場合は Web UI（右上メニュー → Users）で変更してください。
> 外部公開する場合は必ずパスワードを変更してください。

## インストール

1. Home Assistant の **設定 → アドオン → アドオンストア** を開く
2. 右上のメニューから **リポジトリを追加** を選択し、以下の URL を入力する
   ```
   https://github.com/hgn32/ha-addons
   ```
3. 「WireGuard UI」を選択して **Install** → **Start**
4. **OPEN WEB UI**（`http://<HAのIP>:5000`）を開いてログイン

## セットアップ手順

1. ルーターで **`51820/udp`** を Home Assistant の IP にポートフォワードする
2. アドオン設定の `endpoint_address` に外部からアクセスできるアドレス
   （DDNS 名やグローバル IP、例 `vpn.example.com`）を設定する
   - 空のままにすると起動時にグローバル IP を自動検出します
3. Web UI で **Wireguard Clients → New Client** からクライアントを作成
4. **Apply Config** を押すと `wg0.conf` が書き出され、WireGuard インターフェースが
   自動で再起動されます（`manage_wireguard: true` のとき）
5. クライアント一覧の QR コードをスマホの WireGuard アプリで読み取る

## 設定オプション

| 設定 | 内容 | デフォルト |
|---|---|---|
| `username` | 初回作成される管理ユーザー名 | `wireguardadmin` |
| `password` | 初回作成される管理パスワード | `adminwireguard` |
| `endpoint_address` | クライアントが接続する先のアドレス（空 = 自動検出） | （空） |
| `server_interface_addresses` | VPN 内で使うサブネット（リスト） | `10.252.1.0/24` |
| `server_listen_port` | WireGuard の待ち受けポート | `51820` |
| `default_client_dns` | クライアントに配る DNS | `1.1.1.1` |
| `default_client_allowed_ips` | クライアントの AllowedIPs 初期値 | `0.0.0.0/0`（全通信を VPN 経由） |
| `mtu` | インターフェースの MTU | `1420` |
| `persistent_keepalive` | キープアライブ間隔（秒） | `15` |
| `manage_wireguard` | アドオンが wg-quick の起動/再起動を管理するか | `true` |
| `post_up_script` / `post_down_script` | インターフェース起動/停止時のスクリプト | NAT（MASQUERADE）設定 |
| `log_level` | ログレベル（`DEBUG`〜`OFF`） | `INFO` |

このほか、任意設定として `subnet_ranges`（サブネットに名前を付けて IP 割当を管理、
例 `Home: 10.252.1.0/24`）、メール送信（`sendgrid_api_key` または `smtp_*`）、
Telegram 通知（`telegram_*`）が使えます。
詳細は [wireguard-ui の README](https://github.com/ngoduykhanh/wireguard-ui#environment-variables) を参照してください。

> [!NOTE]
> `default_client_dns` や `endpoint_address` などの WGUI 系設定も**初回起動時に
> データベースへ取り込まれる初期値**です。2 回目以降は Web UI の
> **Wireguard Server / Global Settings** 画面の値が優先されます。

## ホーム LAN へのアクセスについて

デフォルトの `post_up_script` でアドオンのネットワーク経由の NAT
（IP マスカレード）を設定しているため、VPN クライアントから
Home Assistant 本体・ホーム LAN・インターネットへアクセスできます。
VPN を「外出先からおうちの LAN に入る用途」だけに絞りたい場合は、
`default_client_allowed_ips` を LAN のサブネット（例 `192.168.1.0/24,10.252.1.0/24`）
に変更してください。

## データの置き場所

| 種類 | パス（コンテナ内） |
|---|---|
| クライアント・ユーザー DB | `/data/db/` |
| WireGuard 設定（サーバー鍵含む） | `/data/wireguard/wg0.conf` |
| セッション鍵 | `/data/session-secret` |

`/data` はアドオン専用の永続ストレージです。アドオンを**アンインストールすると消えます**
（再起動・アップデートでは消えません）。

## 参考

- 設定項目の構成は [samrocketman/addons-homeassistant の wireguard-ui アドオン](https://github.com/samrocketman/addons-homeassistant/tree/main/wireguard-ui) を参考にしています
- ベースイメージ: [`ngoduykhanh/wireguard-ui:0.6.2`](https://hub.docker.com/r/ngoduykhanh/wireguard-ui)
