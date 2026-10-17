# Nintendo Music Bridge

[Nintendo Music](https://music.nintendo.com/) の Web 版をアドオン内の公式 Google Chrome で再生し、
Google Cast 対応のスピーカー（HA の `media_player`）へ流すアドオンです。
YouTube Music への対応を進めています（いまは調査モードのみ）。

## 使い方

1. アドオンを起動し、サイドバーの **Nintendo Music** を開く
2. 初回だけ、画面下の Chrome で Nintendo Music に任天堂アカウントでログインする
   （ログイン状態はアドオン内に保存され、再起動後も残ります）
3. 上の検索欄から ゲーム → プレイリスト → 曲 と選び、「再生」「ここから再生」を押す
4. 「スピーカー」で再生先を選び、「スピーカーで再生」を押す。
   Chrome の音がストリームとしてスピーカーで再生される（再生中の曲を変えても、そのまま流れ続ける）

## スピーカーへの出力の仕組み

- アドオンが Chrome の音を MP3 のストリーム（インターネットラジオと同じ形）にして、
  `http://<HA の IP>:8481/stream/<推測できない文字列>/live.mp3` で出します
- 「スピーカーで再生」は、HA の `media_player.play_media` にこの URL を渡します。スピーカーが自分で取りに来ます
- スピーカーは LAN 側から取りに来るので、このストリームの URL だけは LAN から使えます。
  それ以外（パネル・ブリッジ API）は LAN からは使えません

## ブリッジ API

アドオンと同じホスト（HA 本体など）と HA の内部ネットワークから `http://127.0.0.1:8481` で使えます。

| メソッド・パス | 内容 |
|---|---|
| `GET /bridge/search?q=<語>&type=<GAME/TRACK/OFFICIAL_PLAYLIST>` | 検索（type は省略可） |
| `GET /bridge/games` | ゲーム一覧（ハード別） |
| `GET /bridge/games/<ゲームID>/playlists` | ゲームのプレイリスト一覧 |
| `GET /bridge/playlists/<プレイリストID>` | プレイリストの曲一覧 |
| `GET /bridge/status` | 再生中の曲名・ゲーム名・再生位置・一時停止中か |
| `POST /bridge/play`（本文 `{"playlist_id": "<ID>", "index": 0}`） | プレイリストを再生（index 番目の曲から） |
| `POST /bridge/pause` / `resume` / `next` / `previous` | 再生操作 |
| `GET /bridge/players` | HA の media_player の一覧 |
| `POST /bridge/cast`（本文 `{"entity_id": "media_player.xxx"}`） | そのスピーカーでストリームを再生させる |

## 調査モード

Nintendo Music / YouTube Music の画面の作りを調べるための記録機能です。パネルの「調査モード」を開き、
「調査を開始」→ 普段どおり操作（要所で「画面の部品を記録」）→「調査を終了」→「結果をコピー」。
認証トークン・ライセンス関係の通信の中身・リクエストヘッダは記録しません。

## 設定

| 項目 | 既定値 | 内容 |
|---|---|---|
| `lang` | `ja-JP` | ページ・Chrome の画面・曲名の言語（ja-JP / en-US） |
| `country` | `JP` | Nintendo Music の国 |
| `vban_enabled` | オフ | オンにすると、Music Assistant の VBAN Receiver へも VBAN で送る |
| `vban_host` / `vban_port` / `vban_stream_name` / `sample_rate` | | VBAN の送信先と形式（`sample_rate` はストリームにも使う） |

## 仕組み・注意

- Widevine が同梱されている公式 Google Chrome（amd64）を使います。DRM の回避は一切行わず、
  Chrome が正規に再生した音を OS の音声出力（PipeWire）として取り出して流します
- Chrome は落ちても自動で起動し直します
- Chrome は CDP（DevTools Protocol）を 127.0.0.1:9222 で開いて起動します（ブリッジ API・調査モード用）
- 再生中は、実際に出している音のレートを1分ごとにログタブに出します
- ログタブに `Failed to connect to system bus`（RTKit）の行が1つ出ますが、動作には影響しません
