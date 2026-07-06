## 0.9.5

- `translations/ja.yaml` の構文エラーを修正
  - `default_interface_addresses` の説明文中の未クオートのコロン(「例: ...」)が
    YAML のマッピング区切りと解釈され、Supervisor がストアを読み込むたびに
    `Can't read YAML file .../wireguard-ui/translations/ja.yaml` エラーを
    出していた。文字列全体をクオートして解消(表示のみの修正で動作影響なし)
