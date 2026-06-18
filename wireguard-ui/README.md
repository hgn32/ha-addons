# WireGuard UI (Home Assistant add-on)

[ngoduykhanh/wireguard-ui](https://github.com/ngoduykhanh/wireguard-ui) を使った
WireGuard VPN サーバー + Web 管理画面のアドオンです。クライアントの追加・削除・
QR コード発行・設定ファイルダウンロードをすべてブラウザから行えます。

- 管理画面は **HA の Ingress 経由**でアクセス(ポート公開なし、HA のログインで保護)
- WireGuard サーバー本体は `51820/udp`(ホスト側ポートは変更可)
- スマホの WireGuard アプリは QR コードを読むだけで接続設定完了
- DMZ サブネット機能で「インターネットだけ許可」などのファイアウォール制御が可能
  (詳細は **Documentation タブ**参照)

## ログインについて

| モード | 動作 |
|---|---|
| `single_user_mode: true`(デフォルト) | ログイン画面なし。HA にログインできる人は誰でも管理者として操作可能(Ingress が HA 認証で保護) |
| `single_user_mode: false` | Web UI 独自のログイン画面を表示 |

マルチユーザーモードの初期アカウントは下記です(**初回起動時のみ** DB に作成。
以降の変更・ユーザー追加は Web UI の Users 画面から)。

| 項目 | 値 |
|---|---|
| ユーザー名 | `wireguardadmin` |
| パスワード | `adminwireguard` |

## インストール

1. Home Assistant の **設定 → アドオン → アドオンストア** を開く
2. 右上のメニューから **リポジトリを追加** を選択し、以下の URL を入力する
   ```
   https://github.com/hgn32/ha-addons
   ```
3. 「WireGuard UI」を選択して **Install** → **Start**
4. **OPEN WEB UI**(Ingress)で管理画面を開く

## セットアップ手順

1. ルーターで **`51820/udp`** を Home Assistant の IP にポートフォワードする
   (アドオンのネットワーク設定でホスト側ポートを変えた場合はそのポートを転送。
   クライアント設定の Endpoint ポートには自動で反映されます)
2. Web UI の **Global Settings → Endpoint Address** で **Suggest** を押し、
   外部からアクセスできるアドレス(DDNS 名やグローバル IP)+ポートを設定する
3. **Wireguard Clients → New Client** からクライアントを作成
4. **Apply Config** を押すと `wg0.conf` が書き出され、WireGuard インターフェースが
   自動で再起動・ファイアウォールルールが再適用されます
5. クライアント一覧の QR コードをスマホの WireGuard アプリで読み取る

## 設定オプション

| 設定 | 内容 | デフォルト |
|---|---|---|
| `single_user_mode` | HA 認証のみで管理画面を使う(ログイン画面なし) | `true` |
| `default_interface_addresses` | WireGuard インターフェースの初期アドレス(初回のみ反映) | `192.168.101.0/24` |
| `subnet_ranges` | IP 割当に使う名前付きサブネット範囲(`名前: CIDR[,CIDR]`)。反映には再起動が必要 | `mobile: 192.168.101.0/26`, `esphome: 192.168.101.64/26` |
| `dmz_subnet` | DMZ 扱いにする CIDR(インターネットのみ許可、ローカル網への接続を遮断) | なし(空) |
| `dmz_subnet_allow` | DMZ からの例外許可ルール(書式は Documentation タブ参照) | `default_route_ip\|53/udp`(HA の DNS を許可) |
| `default_client_dns` | クライアント設定の初期 DNS(未設定なら HA 内部 DNS) | なし |
| `default_client_endpoint` | クライアントが接続する公開アドレスの初期値(Web UI の Suggest 推奨) | なし |
| `log_level` | WireGuard UI のログレベル | `debug` |

### 未設定時の主な初期値(参考アドオン準拠)

| 項目 | 初期値 |
|---|---|
| クライアントの AllowedIPs | `0.0.0.0/0,::/0`(全通信を VPN 経由) |
| クライアントの DNS | アドオンのデフォルトゲートウェイ(= HA 内部 DNS。AdGuard 連携もそのまま有効) |
| Endpoint | `:<ホスト側ポート>`(ホスト未設定。Web UI の Suggest で設定推奨) |
| MTU | `1420` |
| Persistent Keepalive | `0`(無効) |
| ログレベル | `debug` |

これらは初回起動時に DB へ取り込まれる初期値で、2 回目以降は Web UI の
**Wireguard Server / Global Settings** の値が優先されます。

## データの置き場所

| 種類 | コンテナ内パス |
|---|---|
| クライアント・ユーザー・サーバー設定 DB(JSON ファイル群) | `/config/db/` |
| セッション暗号化キー | `/config/session-key` |

アドオン専用の設定ディレクトリ（コンテナ内 `/config`、ホスト実体 `/addon_configs/<slug>/`）
に保存されるため、HA のバックアップ対象に含まれます。File editor や Samba からも閲覧できます。
旧バージョン(`/data` 保存)からは初回起動時に自動で移行します。
`wg0.conf` は起動のたびに DB から再生成されます。

## 内部構成

- `wireguard-ui`(公式 v0.6.2 バイナリ)が `127.0.0.1:8080` で動作
- nginx が Ingress(8099)を受けて URL 書き換え・セッション Cookie の結合を行い
  `wireguard-ui` へプロキシ([Supervisor が Set-Cookie を 1 つしか転送しない問題](https://github.com/home-assistant/supervisor/issues/4290)への対応)
- `refresh-wg` サービスが `wg0.conf` を監視し、変更時に `wg syncconf` /
  `wg-quick` で反映、NAT(MASQUERADE)と DMZ の iptables ルールを再適用
