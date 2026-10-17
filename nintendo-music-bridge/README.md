# Nintendo Music Bridge（フェーズ0）

[Nintendo Music](https://music.nintendo.com/) の Web 版をアドオン内の公式 Google Chrome で再生し、
その音声を VBAN で [Music Assistant](https://www.music-assistant.io/) へ送るアドオンです。

いまは**フェーズ0（実現可否の確認用の最小構成）**です。Music Assistant の画面からの選曲（ブリッジ API・
MA プロバイダ）はまだありません。Chrome の画面を操作して再生し、音が MA のスピーカーで鳴るかを確かめる段階です。

## 使い方

1. Music Assistant の設定 → プラグインで **VBAN Receiver** を追加し、次のように設定する
   （[公式ドキュメント](https://www.music-assistant.io/plugins/vban-receiver/)）

   | 項目 | 値 |
   |---|---|
   | Receiver: UDP Port | 6980（このアドオンの `vban_port` と同じ） |
   | Sender: VBAN Stream Name | `NintendoMusic`（このアドオンの `vban_stream_name` と同じ） |
   | Sender: VBAN Sender hostname/IP address | `127.0.0.1`（このアドオンは host_network で、MA と同じホストから送るため） |
   | PCM audio format | S16LE |
   | PCM sample rate | 48000（このアドオンの `sample_rate` と同じ） |
   | Channels | 2 |

2. このアドオンを起動し、サイドバーの **Nintendo Music** を開く
3. 画面内の Chrome で Nintendo Music に任天堂アカウントでログインする
   （ログイン状態はアドオン内に保存され、再起動後も残ります）
4. 曲を再生する。画面上部の「音声出力」が「再生中（VBAN 送信中）」になる
5. MA の Browse で VBAN Receiver のストリームを選び、スピーカーで再生する

## 調査モード

Music Assistant から操作するためのブリッジ API を作る前の下調べ用です。画面上部の
「調査モード」を開き、次の手順で記録してください。

1. 「調査を開始」を押す
2. 画面内で、検索 → 検索結果からゲームやプレイリストを開く → 曲を再生、と普段どおり操作する。
   検索結果・プレイリスト・再生中の各画面で「画面の部品を記録」を1回ずつ押す
3. 「調査を終了」→「結果をコピー」

認証トークン・ライセンス関係の通信の中身・リクエストヘッダは記録しません。

## 設定

| 項目 | 既定値 | 内容 |
|---|---|---|
| `vban_host` | `127.0.0.1` | VBAN の送信先（MA が動いているホスト） |
| `vban_port` | 6980 | VBAN の送信先ポート |
| `vban_stream_name` | `NintendoMusic` | VBAN のストリーム名（英数字16文字まで） |
| `sample_rate` | 48000 | 送信するサンプルレート（44100 / 48000） |

## 仕組み・注意

- Widevine が同梱されている公式 Google Chrome（amd64）を使います。DRM の回避は一切行わず、
  Chrome が正規に再生した音を OS の音声出力（PipeWire）として取り出して送ります
- Chrome は落ちても自動で起動し直します
- Chrome は CDP（DevTools Protocol）を 127.0.0.1:9222 で開いて起動します（調査モード・今後のブリッジ API 用）
- Chrome の画面上部に `--no-sandbox` の警告が出ますが、コンテナ内の制約によるものです
- ログタブに `Failed to connect to system bus`（RTKit）の行が1つ出ますが、リアルタイム優先度が
  使えないという通知で、動作には影響しません
- host_network で動きますが、Ingress 以外（LAN）からのこの画面への接続は拒否します
