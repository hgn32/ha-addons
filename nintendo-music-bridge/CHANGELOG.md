## 0.6.0

- **お気に入りリストを追加。** パネルで Nintendo Music / YouTube Music のプレイリストの URL を
  名前をつけて登録し、並べ替え・削除・チェックしたものを順にスピーカーで再生できる
- **HA から再生できるようにした。** オートメーションでイベント `web_music_player_play`
  （`favorites`: お気に入りの名前のリスト、`entity_id`: スピーカー）を発行すると順に再生し、
  `web_music_player_stop` で止まる
- YouTube Music のプレイリストを再生できるようにした（次の曲・前の曲はまだ未対応）
- 一時停止・再開のとき、スピーカーにも同時に指示するようにした（反応の遅れを減らす）

## 0.5.1

- 名前を「Web Music Player」に変更（YouTube Music にも対応を進めるため）。
  アドオンの識別子は変えていないので、ログイン状態などはそのまま残る

## 0.5.0

- **スピーカーへの出力（Cast）を追加。** パネルでスピーカー（HA の media_player）を選んで
  「スピーカーで再生」を押すと、Chrome の音を MP3 のストリームにしてスピーカーで再生する。
  Music Assistant は不要
- VBAN（Music Assistant への送信）は設定でオン／オフできるようにした（初期値はオフ）
- 調査モードを YouTube Music（music.youtube.com）でも使えるようにした
