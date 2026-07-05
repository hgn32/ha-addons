# VOICEVOX Engine

音声合成エンジン [VOICEVOX Engine](https://github.com/VOICEVOX/voicevox_engine) を Home Assistant アドオンとして動作させます。

## アーキテクチャ対応

| アーキテクチャ | 対応状況 |
|---|---|
| amd64 (Generic x86-64) | ✅ 動作確認済み |
| aarch64 (Raspberry Pi等) | ⚠️ 公式未サポート（動作する可能性はあるが保証なし） |

aarch64での動作は [VOICEVOX公式Issue #644](https://github.com/VOICEVOX/voicevox_engine/issues/644) にて「優先度：低（運用中止）」とされており、公式にはサポートされていません。

## GPU版について

GPU版を使用する場合は `Dockerfile` 内の `FROM` を以下に変更してください：

```
FROM voicevox/voicevox_engine:nvidia-amd64-latest
```

GPU版はamd64のみ対応です。

## インストール

1. Home Assistant の **設定 → アドオン → アドオンストア** を開く
2. 右上のメニューから **リポジトリを追加** を選択し、以下の URL を入力する
   ```
   https://github.com/hgn32/ha-addons
   ```
3. **VOICEVOX Engine** を選択して **インストール**
4. アドオンを起動後、`http://<HA のアドレス>:50021` で API にアクセス可能

## アドオン設定

| 設定キー | 型 | 既定値 | 説明 |
|---|---|---|---|
| `max_memory_mb` | int | `0`（無制限） | VOICEVOX Engine プロセスの仮想メモリ上限（`ulimit -v`、単位 MB）。`0` で制限なし |
| `load_all_models` | bool | `true` | 起動時に全モデルを事前読み込みする。`false` で必要時読み込み（起動が速い） |

VOICEVOX Engine は Python プロセスのため、JVM の `-Xmx` のような正確なヒープ上限指定はできません。
`max_memory_mb` は OS の `ulimit -v`（仮想アドレス空間の上限）で代用しています。仮想アドレス空間
（VSZ）は実際のメモリ使用量（RSS）よりはるかに大きくなるため、小さい値を設定するとエンジンが
メモリ確保に失敗して待ち受けを開始できず、ポート 50021 が `Connection refused` になります。
実測の RSS / VSZ は起動時にログタブへ 15 秒ごとに表示されるので、それを見てから値を決めてください。

## 起動しない・つながらないときの見方（ログタブ）

起動の各段階が必ずログタブに出ます。どの行まで出ているかで原因を切り分けできます。

1. `[voicevox] options.json: ...` — 読み込まれた設定の内容
2. `[voicevox] 起動コマンド: ...` — 実際の起動引数（CORS 設定など）
3. `[voicevox] 起動待ち N秒: RSS=..MB VSZ=..MB` — モデル読み込み中（15 秒ごと）
4. `[voicevox] OK: エンジン起動完了。50021 で待ち受け中` — **この行が出て初めて API に接続できます**
5. `[voicevox] エンジンプロセスが終了しました (exit code=N)` — エンジンが落ちた場合（正常時は出ません）

「起動待ち」が延々続く場合はモデル読み込みが完了していません。`load_all_models` を `false` に
すると事前読み込みを飛ばして数秒で待ち受けが始まるため、読み込みフェーズの問題かどうかを
すぐに確認できます。

## ポート

| ポート | 用途 |
|---|---|
| `50021` | VOICEVOX Engine API |

## API ドキュメント

`http://<HA のアドレス>:50021/docs` で Swagger UI が確認できます。

## HA との連携（自動検知）

別途 **[hgn32/ha-voicevox-tts](https://github.com/hgn32/ha-voicevox-tts)** インテグレーションを HACS でインストールしてください。

インストール後にアドオンを起動すると mDNS でエンジンが自動検知され、**設定 → 通知** に「VOICEVOX Engine が見つかりました」と表示されます。スタイルを選択してセットアップ完了です。`configuration.yaml` の編集は不要です。

手動でセットアップする場合は **設定 → デバイスとサービス → インテグレーションを追加** から「VOICEVOX TTS」を検索してください。

スタイル ID の一覧は [ha-voicevox-tts README](https://github.com/hgn32/ha-voicevox-tts#%E3%82%B9%E3%82%BF%E3%82%A4%E3%83%AB%E4%B8%80%E8%A6%A7) を参照してください。
