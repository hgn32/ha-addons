## 0.9.7

- 【重大な修正】`refresh-wg` サービスが無限クラッシュループに陥る不具合を修正
  - `wg0.conf` の `Address` に IPv6 を追加した状態で `wg-quick up wg0` が失敗する
    などして `run.sh` が(`set -e` により)異常終了すると、`WG_DMZ` /
    `WG_DMZ_allow` の iptables チェーンが後片付けされないまま残り、次の再起動で
    `iptables --new WG_DMZ` が `Chain already exists` で即座に失敗 → 再度クラッシュ、
    という**1〜2秒間隔の無限再起動ループ**に陥っていた(実機ログで確認)
  - 起動時にチェーンを一度フラッシュしてから作り直すことで冪等化し、ループを解消
  - `wg-quick up/down wg0` が失敗した場合に理由をログへ明示的に出力するようにした
    (このループのせいで NAT 設定(0.9.6 の修正)まで処理が到達していなかった)

## 0.9.6

- 【修正】サーバーインターフェースに IPv6 アドレス(例: `fd42:42:42::0/64`)を追加しても
  IPv6 の VPN クライアントが通信できない問題を修正
  - `net.ipv6.conf.all.forwarding` を有効化するようにした(従来は IPv4 の
    `ip_forward` のみ有効化。IPv6 が無効なカーネルでは警告のみ)
  - IPv6 のインターフェースアドレスに対して `ip6tables` で MASQUERADE(NAT)を
    張るようにした(従来は `iptables` のみで IPv4 だけが NAT されていた)
  - `wg0.conf` の `Address` 行から IPv4/IPv6 が混在していても両方のアドレスを
    正しく取り出せるようにパースを修正
  - `default_interface_addresses` オプションで IPv6 の CIDR も指定できるように
    スキーマを緩和

## 0.9.5

- `translations/ja.yaml` の構文エラーを修正
  - `default_interface_addresses` の説明文中の未クオートのコロン(「例: ...」)が
    YAML のマッピング区切りと解釈され、Supervisor がストアを読み込むたびに
    `Can't read YAML file .../wireguard-ui/translations/ja.yaml` エラーを
    出していた。文字列全体をクオートして解消(表示のみの修正で動作影響なし)
