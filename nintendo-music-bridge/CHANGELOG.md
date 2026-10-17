## 0.5.1

- 名前を「Web Music Player」に変更（YouTube Music にも対応を進めるため）。
  アドオンの識別子は変えていないので、ログイン状態などはそのまま残る

## 0.5.0

- **スピーカーへの出力（Cast）を追加。** パネルでスピーカー（HA の media_player）を選んで
  「スピーカーで再生」を押すと、Chrome の音を MP3 のストリームにしてスピーカーで再生する。
  Music Assistant は不要
- VBAN（Music Assistant への送信）は設定でオン／オフできるようにした（初期値はオフ）
- 調査モードを YouTube Music（music.youtube.com）でも使えるようにした

## 0.4.4

- アドオンの停止・更新中に、Chrome が「Missing X server」で何度も落ちて起動し直していたのを修正
  （画面が止まっているときは Chrome を起動し直さない）
