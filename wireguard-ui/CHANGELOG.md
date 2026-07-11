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
