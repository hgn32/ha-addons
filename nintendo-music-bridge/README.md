# Web Music Player

[Nintendo Music](https://music.nintendo.com/) の Web 版をアドオン内の公式 Google Chrome で再生し、
Google Cast 対応のスピーカー（HA の `media_player`）へ流すアドオンです。
YouTube Music のプレイリストも再生できます。お気に入りに登録したプレイリストを、
HA のオートメーションから決まった時刻に決まったスピーカーで流せます。

## 使い方

1. アドオンを起動し、サイドバーの **Web Music Player** を開く
2. 初回だけ、画面下の Chrome で Nintendo Music に任天堂アカウントでログインする
   （ログイン状態はアドオン内に保存され、再起動後も残ります）
3. 下の「お気に入り」に再生したいプレイリストを登録する（次の節）
4. 「スピーカー」で再生先を選び、お気に入りの ▶ を押す。
   Chrome の音がストリームとしてスピーカーで再生される
   （下の Chrome で自分で曲を選んで流しているときは「スピーカーで再生」を押す）

## お気に入りと HA からの再生

パネルの「お気に入り」に、名前と URL を登録します（「いまの画面を追加」で、下の Chrome で開いているページも登録できます）。

| サービス | 登録できる URL |
|---|---|
| Nintendo Music | ゲームのページ（`https://music.nintendo.com/ja-JP/game/...`）かプレイリストのページ（`.../ja-JP/playlist/...`）。共有リンク（`.../shared/.../officialPlaylists/...`）はプレイリストのページに直して登録します。ページを開いて再生ボタンを押します |
| YouTube Music | `list=` を含む URL（例: `https://music.youtube.com/playlist?list=...`） |

それ以外の URL（トップページ、Nintendo Music のユーザープレイリストなど）は登録できません。

HA のオートメーションのアクション「イベントを発行」で、次のように発行すると順に再生します。

```yaml
event: web_music_player_play
event_data:
  favorites: ["朝のBGM", "ピクミン"]
  entity_id: media_player.jbl_bar_800
```

`favorites` を省くとお気に入りの全部を並び順で、`shuffle: true` を付けると順番を混ぜて再生します。

```yaml
event: web_music_player_play
event_data:
  shuffle: true
  entity_id: media_player.jbl_bar_800
```

止めるときは `event: web_music_player_stop` を発行します。

### 再生の切り替え・止めるときの動き

| 場面 | 動き |
|---|---|
| 再生を始める（お気に入り・HA・▶） | Chrome のタブを1つだけ残して、ほかを閉じる |
| 再生中に別のお気に入りを再生する | 切り替える。スピーカーが変わるときは前のスピーカーを止める。同じスピーカーなら Cast し直さない（途切れない）。`entity_id` を省くと、いまのスピーカーのまま |
| 「スピーカーで再生」で別のスピーカーを選ぶ | 前のスピーカーを止めて切り替える（2台で同時には鳴らさない） |
| お気に入りの再生中に「開く」ボタンを押す | お気に入りの順送りだけ終える（スピーカーへの出力は続く） |
| 止める（`web_music_player_stop`・パネルの停止） | お気に入りの再生中でなくても、全部のタブの音とスピーカーを止める |
| 一時停止 | 全部のタブの音を止める（タブは閉じない） |
| スピーカー側で止められた（HA・本体の操作、入力の切り替え） | スピーカーが30秒以上ストリームを取りに来なければ、再生を止める（一時停止中は除く） |
| アドオンの再起動・Chrome が落ちた | 前のタブを開き直さない。お気に入りの再生は終える |

- 1つのプレイリストは、再生が止まって15秒たったら終わりとみなして次へ進みます
  （YouTube Music は、最後の曲のあと関連曲の自動再生に移った時点で次へ進みます。
  Nintendo Music がリピート再生のときは、一周した時点＝最初の曲に戻ったとき
  （1曲だけのプレイリストなら、曲の最後から頭に戻ったとき）に次へ進みます）
- お気に入りを開いている途中で Chrome のページが固まったら（10秒応答がない）、タブを開き直して
  そのお気に入りをもう一度開きます
- YouTube Music の「次の曲・前の曲」は、日本語の画面（設定の lang が ja-JP）のときだけ使えます（プレーヤーの「前へ」「次へ」ボタンを押します）

## スピーカーへの出力の仕組み

- アドオンが Chrome の音を MP3 のストリーム（インターネットラジオと同じ形）にして、
  `http://<HA の IP>:8481/stream/<推測できない文字列>/live.mp3` で出します
- 「スピーカーで再生」は、HA の `media_player.play_media` にこの URL を渡します。スピーカーが自分で取りに来ます
  （中身の種類は `audio/mpeg`、タイトルは「Web Music Player」として渡します）
- スピーカーは LAN 側から取りに来るので、このストリームの URL だけは LAN から使えます。
  それ以外（パネル・ブリッジ API）は LAN からは使えません

## ブリッジ API

アドオンと同じホスト（HA 本体など）と HA の内部ネットワークから `http://127.0.0.1:8481` で使えます。

| メソッド・パス | 内容 |
|---|---|
| `GET /bridge/status` | 再生中の曲名・ゲーム名・再生位置・一時停止中か |
| `POST /bridge/pause` / `resume` / `next` / `previous` | 再生操作 |
| `GET /bridge/players` | HA の media_player の一覧 |
| `POST /bridge/open/nm` / `POST /bridge/open/ytm` | Chrome で Nintendo Music / YouTube Music のトップを開く |
| `POST /bridge/cast`（本文 `{"entity_id": "media_player.xxx"}`） | そのスピーカーでストリームを再生させる |
| `GET /bridge/favorites` / `POST /bridge/favorites`（`{"name", "url"}`） | お気に入りの一覧・追加 |
| `POST /bridge/session/play`（`{"favorites": [名前...], "shuffle", "entity_id"}`。favorites を省くと全部） / `POST /bridge/session/stop` | お気に入りを順に再生・停止 |

## 設定

| 項目 | 既定値 | 内容 |
|---|---|---|
| `lang` | `ja-JP` | ページ・Chrome の画面・曲名の言語（ja-JP / en-US） |
| `sample_rate` | `48000` | Chrome の音を受ける出力とストリームのサンプルレート（44100 / 48000） |

## 仕組み・注意

- Widevine が同梱されている公式 Google Chrome（amd64）を使います。DRM の回避は一切行わず、
  Chrome が正規に再生した音を OS の音声出力（PipeWire）として取り出して流します
- Chrome は落ちても自動で起動し直します
- Chrome は CDP（DevTools Protocol）を 127.0.0.1:9222 で開いて起動します（再生操作用）
- 再生中は、実際に出している音のレートと音の大きさ（平均・最大 dBFS）を1分ごとにログタブに出します
- 再生を始めたときは、再生開始までにかかった時間の内訳をログタブに出します
- ページが固まってタブを開き直したときは、そのときの Chrome のタブの状態をログタブに出します
- ログタブに `Failed to connect to system bus`（RTKit）の行が1つ出ますが、動作には影響しません
