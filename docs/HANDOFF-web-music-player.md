# 引き継ぎメモ: Web Music Player（nintendo-music-bridge）

main へマージする前に、このファイルは削除すること（作業ブランチ専用）。

## 現状

- ブランチ: `claude/pensive-shannon-qz9mxw`（main には未マージ）
- アドオン: `nintendo-music-bridge/`（表示名 Web Music Player、slug `nintendo_music_bridge`、HA 上は `local_nintendo_music_bridge`）
- 版: 0.6.0（CI 成功、ユーザーが HA に適用済み）
- ytm-cookie アドオンはリポジトリから削除済み。HA 側の local_ytm_cookie のアンインストールはユーザーが行う

## 実機で確認できていること（ユーザー確認）

- Nintendo Music の再生、JBL BAR 800（`media_player.jbl_bar_800`）への Cast 出力。ボタン操作から音が変わるまで約5秒かかる（Cast 側のバッファによるもの）
- アドオン内の Chrome で YouTube Music にログイン（Premium）し、再生できた

## 実機でまだ確認できていないこと（次にやること）

1. YouTube Music の `watch?list=<ID>` を開いて自動再生が始まるか
2. YTM のプレイリストの終わりの検知（URL の list= が変わったら次へ進む）
3. Nintendo Music の終わりの検知（再生停止が15秒続いたら終わりとみなす）
4. 長時間の Cast の安定性
5. YTM の次の曲・前の曲（未対応）

## テストのやり方（HA-MCP の書き込みツールが要る）

- 前のセッションでは、HA-MCP の読み取り専用を外した後もセッションのツール一覧が古いままで、
  `ha_call_write_tool` が使えなかった。新しいセッションでは使える見込み
- `ha_manage_app`（slug `local_nintendo_music_bridge`）経由でアドオンの API を叩く
  - POST `/bridge/favorites` `{"name": "...", "url": "<YTM プレイリスト URL>"}`
  - POST `/bridge/session/play` `{"favorites": ["<名前>"]}` ← entity_id を付けない（スピーカーに流さない）
  - GET `/bridge/status`、`/bridge/session` とアドオンのログで確認
- **スピーカーに流す（entity_id を付ける）前に必ずユーザーに聞くこと**（家で音が鳴るため）

## 守ること

- 全て日本語で回答し、結論を先に書き、説明では表を使う。質問は1つずつにする
- HA への適用（更新）はユーザーが行う。ha-mcp から更新をかけない
- アカウントのID・パスワードは受け取らない、保存しない
- その他は CLAUDE.md に従う
